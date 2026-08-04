"""Routes behind the App Login ▸ Users screen.

All `auth='user'` and gated on `base.group_system`. That group is the standalone
stand-in for kra's `_is_kra_admin`: this module has no KRA roles to check, and
inventing a permission group to hold one bit is not worth maintaining. Anyone who
can already reach Odoo's Settings can manage app logins.

Every write returns the STORED value rather than echoing what was sent, so the
screen shows what actually landed. A field that silently normalises what you
typed — digits stripped, a country resolved — and then displays your original
input is how a screen and its database quietly diverge.

The WhatsApp routes replicate kra's `/kpi_wa_server/*` rather than calling them,
because this module must work with no KRA installed. They drive the same
`whatsapp.session` record, since whatsapp_neonize keeps exactly one — so
connecting here also fixes KRA's password-reset codes, and disconnecting here
also stops them. The screen says so; anything less would be a trap.
"""

import logging
import os

from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)

_WA_LABEL = 'App Login WhatsApp Sender'


class AppLoginAdmin(http.Controller):

    # ------------------------------------------------------------------ #
    # helpers                                                            #
    # ------------------------------------------------------------------ #
    def _denied(self):
        if request.env.user.has_group('base.group_system'):
            return None
        return {'status': False, 'message': 'You need Odoo Settings access to manage app logins.'}

    def _user(self, params):
        """The target user, as sudo. Internal users only.

        Portal and public accounts are excluded because they are not people this
        app signs in, and offering them would invite granting app access to a
        shared portal login by accident.
        """
        try:
            uid = int(params.get('user_id') or 0)
        except (TypeError, ValueError):
            return request.env['res.users'].browse()
        user = request.env['res.users'].sudo().browse(uid)
        if not user.exists() or user.share:
            return request.env['res.users'].browse()
        return user

    def _wa_session(self, session_id=None):
        Session = request.env['whatsapp.session'].sudo()
        if session_id:
            try:
                return Session.browse(int(session_id))
            except (TypeError, ValueError):
                pass
        return Session.search([], limit=1, order='id desc')

    def _serialize(self, user):
        return {
            'id': user.id,
            'name': user.name,
            'login': user.login,
            'mobile': user.app_login_mobile or '',
            'country_id': user.app_login_country_id.id or False,
            'dial': user._app_login_dial(),
            'role': user._app_login_role(),
            'enabled': bool(user.app_login_enabled),
            'has_password': bool(user.sudo().app_login_password_hash),
            'must_change': bool(user.app_login_must_change),
            'last_login': user.app_login_last_at and str(user.app_login_last_at) or '',
            'last_device': user.app_login_last_device or '',
        }

    # ------------------------------------------------------------------ #
    # load                                                               #
    # ------------------------------------------------------------------ #
    @http.route('/app_login/admin/users', type='json', auth='user', methods=['POST'], csrf=False)
    def users(self, **params):
        """Everything the screen needs, in one call.

        One round trip rather than five: the screen cannot draw a useful partial
        state, so five calls would only give five ways to be half-loaded.
        """
        denied = self._denied()
        if denied:
            return denied

        company = request.env.company.sudo()
        users = request.env['res.users'].sudo().search(
            [('share', '=', False), ('active', '=', True)], order='name')
        countries = request.env['res.country'].sudo().search_read(
            [('phone_code', '!=', 0)], ['name', 'phone_code'], order='name')

        session = self._wa_session()
        wa_state = session.status if session else 'none'
        qr = ''
        if session and session.status == 'waiting_qr' and session.qr_image:
            qr = session.qr_image.decode() if isinstance(session.qr_image, bytes) else session.qr_image

        # The live App Servers row, so the screen that says WHO may sign in also
        # says WHERE they will be signing in. Guarded because app_server_config
        # is a dependency that could be uninstalled underneath us.
        server = {}
        try:
            row = request.env['app.server.config'].sudo().search(
                [('is_live', '=', True)], limit=1)
            if row:
                server = {'url': row.client_url or '', 'db': row.client_db or '',
                          'app_key': row.app_key or ''}
        except Exception:
            server = {}

        return {
            'status': True,
            'users': [self._serialize(u) for u in users],
            'countries': [{'id': c['id'], 'name': c['name'], 'dial': str(c['phone_code'])}
                          for c in countries],
            'app_name': company.name or 'the app',
            'templates': {
                'login': company.app_login_template('login'),
                'signup': company.app_login_template('signup'),
            },
            'otp_minutes': request.env['app.login.otp'].sudo().ttl_minutes(),
            'signup_enabled': bool(company.app_login_signup_enabled),
            'dev_autofill': bool(company.app_login_dev_autofill),
            'server': server,
            'wa': {
                'state': wa_state,
                'session_id': session.id if session else 0,
                'phone': session.phone_number or '' if session else '',
                'qr': qr,
                'error': (session.error_message or '') if session else '',
            },
        }

    @http.route('/app_login/admin/settings', type='json', auth='user', methods=['POST'], csrf=False)
    def settings(self, **params):
        """What the Settings screen needs — the WhatsApp connection, the message
        wording and the two switches.

        A separate route from /admin/users rather than reusing it: that one
        loads every user, and reading the whole staff list to draw a screen with
        no users on it is work nobody asked for.
        """
        denied = self._denied()
        if denied:
            return denied

        company = request.env.company.sudo()
        session = self._wa_session()
        qr = ''
        if session and session.status == 'waiting_qr' and session.qr_image:
            qr = session.qr_image.decode() if isinstance(session.qr_image, bytes) else session.qr_image

        return {
            'status': True,
            'app_name': company.name or 'the app',
            'otp_minutes': request.env['app.login.otp'].sudo().ttl_minutes(),
            'templates': {
                'login': company.app_login_template('login'),
                'signup': company.app_login_template('signup'),
            },
            'signup_enabled': bool(company.app_login_signup_enabled),
            'dev_autofill': bool(company.app_login_dev_autofill),
            'wa': {
                'state': session.status if session else 'none',
                'session_id': session.id if session else 0,
                'phone': (session.phone_number or '') if session else '',
                'qr': qr,
                'error': (session.error_message or '') if session else '',
            },
        }

    # ------------------------------------------------------------------ #
    # per-user writes                                                    #
    # ------------------------------------------------------------------ #
    @http.route('/app_login/admin/set_mobile', type='json', auth='user', methods=['POST'], csrf=False)
    def set_mobile(self, **params):
        denied = self._denied()
        if denied:
            return denied
        user = self._user(params)
        if not user:
            return {'status': False, 'message': 'No such user.'}
        # res.users.write() strips non-digits itself; passing the raw value keeps
        # one place responsible for that rule.
        user.sudo().write({'app_login_mobile': params.get('mobile') or ''})
        return {'status': True, 'mobile': user.app_login_mobile or ''}

    @http.route('/app_login/admin/set_country', type='json', auth='user', methods=['POST'], csrf=False)
    def set_country(self, **params):
        denied = self._denied()
        if denied:
            return denied
        user = self._user(params)
        if not user:
            return {'status': False, 'message': 'No such user.'}
        try:
            cid = int(params.get('country_id') or 0)
        except (TypeError, ValueError):
            cid = 0
        user.sudo().write({'app_login_country_id': cid or False})
        # The dial code goes back with it: it is what the prefix box shows, and
        # leaving the screen to derive it would be a second implementation of
        # the same rule.
        return {'status': True, 'country_id': user.app_login_country_id.id or False,
                'dial': user._app_login_dial()}

    @http.route('/app_login/admin/set_role', type='json', auth='user', methods=['POST'], csrf=False)
    def set_role(self, **params):
        denied = self._denied()
        if denied:
            return denied
        user = self._user(params)
        if not user:
            return {'status': False, 'message': 'No such user.'}
        # Refuse to strip your own admin rights. Doing it leaves the screen you
        # are standing on unreachable, and the only fix is another admin or the
        # shell.
        if user.id == request.env.user.id and params.get('role') != 'admin':
            return {'status': False,
                    'message': "You can't remove your own admin access from this screen."}
        role = user._app_login_set_role(params.get('role') or 'user')
        return {'status': True, 'role': role}

    @http.route('/app_login/admin/toggle_login', type='json', auth='user', methods=['POST'], csrf=False)
    def toggle_login(self, **params):
        denied = self._denied()
        if denied:
            return denied
        user = self._user(params)
        if not user:
            return {'status': False, 'message': 'No such user.'}
        user.sudo().write({'app_login_enabled': bool(params.get('enabled'))})
        return {'status': True, 'enabled': bool(user.app_login_enabled)}

    @http.route('/app_login/admin/reset_password', type='json', auth='user', methods=['POST'], csrf=False)
    def reset_password(self, **params):
        denied = self._denied()
        if denied:
            return denied
        user = self._user(params)
        if not user:
            return {'status': False, 'message': 'No such user.'}
        user.action_app_login_reset_password()
        return {'status': True, 'has_password': False}

    @http.route('/app_login/admin/import_kra', type='json', auth='user', methods=['POST'], csrf=False)
    def import_kra(self, **params):
        """Fill blank app numbers from kra_kpi_module's, where that module exists.

        The install hook already does this once. This covers the case it cannot:
        KRA installed AFTER this module, so there was nothing to copy at the
        time. Idempotent — it only ever fills a blank, so it cannot overwrite a
        number corrected here since, and pressing it twice is harmless.
        """
        denied = self._denied()
        if denied:
            return denied
        from ..hooks import seed_from_kra
        seeded, locked_out = seed_from_kra(request.env.cr)
        request.env['res.users'].invalidate_model(
            ['app_login_mobile', 'app_login_enabled', 'app_login_must_change'])
        return {'status': True, 'seeded': seeded, 'locked_out': locked_out}

    # ------------------------------------------------------------------ #
    # message templates                                                  #
    # ------------------------------------------------------------------ #
    @http.route('/app_login/admin/set_template', type='json', auth='user', methods=['POST'], csrf=False)
    def set_template(self, **params):
        """Save one template. An empty body restores the built-in wording.

        Storing empty rather than writing the default in means the built-in text
        can be improved later and everyone who never customised it gets the
        improvement.
        """
        denied = self._denied()
        if denied:
            return denied
        kind = params.get('kind')
        if kind not in ('login', 'signup'):
            return {'status': False, 'message': 'Unknown template.'}
        field = 'app_login_signup_template' if kind == 'signup' else 'app_login_code_template'
        company = request.env.company.sudo()
        company.write({field: (params.get('template') or '').strip() or False})
        return {'status': True, 'template': company.app_login_template(kind)}

    # ------------------------------------------------------------------ #
    # company switches                                                   #
    # ------------------------------------------------------------------ #
    @http.route('/app_login/admin/set_flag', type='json', auth='user', methods=['POST'], csrf=False)
    def set_flag(self, **params):
        """Toggle self sign-up or developer auto-fill.

        Named explicitly rather than taking any field name: this writes to
        res.company from a route, and a generic setter would let anyone with
        Settings access change anything on the company by guessing a name.
        """
        denied = self._denied()
        if denied:
            return denied
        allowed = {
            'signup_enabled': 'app_login_signup_enabled',
            'dev_autofill': 'app_login_dev_autofill',
        }
        field = allowed.get(params.get('flag'))
        if not field:
            return {'status': False, 'message': 'Unknown setting.'}
        value = bool(params.get('value'))
        company = request.env.company.sudo()
        company.write({field: value})
        if value:
            # Both of these are dangerous when left on, and both are easy to
            # forget. A log line is the only trace that survives the person who
            # flipped it forgetting they did.
            _logger.warning("app_login: %s switched ON by %s", field, request.env.user.login)
        return {'status': True, 'flag': params.get('flag'), 'value': value}

    # ------------------------------------------------------------------ #
    # WhatsApp sender                                                    #
    # ------------------------------------------------------------------ #
    @http.route('/app_login/admin/wa/connect', type='json', auth='user', methods=['POST'], csrf=False)
    def wa_connect(self, **params):
        """Start (or restart) the WhatsApp client so a QR appears."""
        denied = self._denied()
        if denied:
            return denied
        Session = request.env['whatsapp.session'].sudo()
        session = self._wa_session() or Session.create({'name': _WA_LABEL})
        try:
            session.action_connect()
        except Exception as exc:
            _logger.error("app_login wa connect failed: %s", exc)
            return {'status': False, 'message': str(exc)}
        # After connect, not before: action_connect can reset the name.
        if session.name != _WA_LABEL:
            session.write({'name': _WA_LABEL})
        return {'status': True, 'session_id': session.id, 'state': session.status}

    @http.route('/app_login/admin/wa/status', type='json', auth='user', methods=['POST'], csrf=False)
    def wa_status(self, **params):
        denied = self._denied()
        if denied:
            return denied
        session = self._wa_session(params.get('session_id'))
        if not session or not session.exists():
            return {'status': True, 'state': 'none'}
        # Pulls the QR out of the module's in-memory cache into the record; the
        # stored value can lag behind the one actually being displayed.
        try:
            session.action_refresh_status()
        except Exception:
            pass
        qr = ''
        if session.status == 'waiting_qr' and session.qr_image:
            qr = session.qr_image.decode() if isinstance(session.qr_image, bytes) else session.qr_image
        return {
            'status': True,
            'session_id': session.id,
            'state': session.status,
            'phone_number': session.phone_number or '',
            'qr_image': qr or '',          # bare base64 — the caller adds the data: prefix
            'error': session.error_message or '',
        }

    @http.route('/app_login/admin/wa/delete', type='json', auth='user', methods=['POST'], csrf=False)
    def wa_delete(self, **params):
        """Remove the connection from Odoo AND from Neonize.

        The record's own unlink() stops the client but leaves the on-disk session
        credentials behind, so the device stays linked inside Neonize and the
        next connect silently resumes the old session instead of showing a QR.
        Deleting the file is what makes "disconnect" mean it.
        """
        denied = self._denied()
        if denied:
            return denied
        session = self._wa_session(params.get('session_id'))
        if not session or not session.exists():
            return {'status': True}
        db_path = session.db_path

        # Best effort: log the device out so WhatsApp drops it on its side too.
        try:
            from odoo.addons.whatsapp_neonize.models.whatsapp_session import _wa_clients
            client = _wa_clients.get(session.id)
            if client is not None:
                try:
                    client.logout()
                except Exception:
                    pass
        except Exception:
            pass

        try:
            session.unlink()
        except Exception as exc:
            _logger.error("app_login wa delete failed: %s", exc)
            return {'status': False, 'message': str(exc)}

        if db_path:
            # SQLite keeps side files; leaving them behind leaves the session
            # half-alive.
            for path in (db_path, db_path + '-journal', db_path + '-wal', db_path + '-shm'):
                try:
                    if os.path.exists(path):
                        os.remove(path)
                except Exception:
                    pass
        return {'status': True}
