"""The public endpoints a phone talks to before anyone is signed in.

All of them are `auth='public'`, which is not a choice: a device at the login
screen has no session. That is also why each one accepts as little as it can and
answers with as little as it can.

WHAT REPLACES WHAT. These stand in for kra_kpi_module's `/kpi_app/*` routes. The
app calls these instead, and kra's keep working untouched for anything still
using them.

  /kpi_app/config      -> /app_login/config
  /kpi_app/login_check -> /app_login/start   (and it now SENDS the code)
  /kpi_app/login       -> /app_login/password
  (nothing)            -> /app_login/verify  (sign in by code — kra has no such
                                              thing; its otp/verify insists on
                                              setting a password)
  (nothing)            -> /app_login/signup
"""

import logging
import re

from odoo import http
from odoo.http import request

from ..models.res_users import normalize_msisdn

_logger = logging.getLogger(__name__)

# Deliberately the same sentence whether the number is unknown or sign-up is off.
# The two are different internally and identical to a user: in both cases the
# answer is "an admin has to do something".
_NOT_REGISTERED = "This number isn't registered. Contact your admin."


class _SafeDict(dict):
    """Formatting dict that turns an unknown placeholder into empty text.

    The message bodies are admin-editable. A stray {user} in one of them would
    otherwise raise KeyError inside the send and take out signing in for
    everybody — a typo in a cosmetic field must not be able to do that.
    """

    def __missing__(self, key):
        return ''


class AppLogin(http.Controller):

    # ------------------------------------------------------------------ #
    # helpers                                                            #
    # ------------------------------------------------------------------ #
    def _company(self):
        return request.env.company.sudo()

    def _ip(self):
        try:
            return request.httprequest.remote_addr or ''
        except Exception:
            return ''

    def _digits(self, mobile):
        return re.sub(r'\D', '', mobile or '')

    def _country_of(self, params):
        """The res.country the app picked, from an ISO CODE or a raw id.

        The code is the one to use. The app carries its own country list —
        bundled, so the picker on the first screen works before any server has
        been reached — and a bundled list cannot hold res.country ids, because
        those are allocated per database and differ between installations. An id
        that means India here can mean Iceland on the server the app is pointed
        at tomorrow, and nothing would report it: the code would simply send a
        one-time code to the wrong dial code.

        `country_id` is still accepted so an already-installed build keeps
        working against an upgraded server.
        """
        Country = request.env['res.country'].sudo()
        code = (params.get('country_code') or '').strip().upper()
        if code:
            return Country.search([('code', '=', code)], limit=1)
        try:
            cid = int(params.get('country_id') or 0)
        except (TypeError, ValueError):
            cid = 0
        if not cid:
            return Country.browse()
        country = Country.browse(cid)
        return country if country.exists() else Country.browse()

    def _dial_of(self, params):
        """Dial code for the country the app picked, or '91' when it sent none.

        Only needed on the sign-up path: there is no user to ask yet, so the
        app's choice is the only source. The fallback exists so a request from
        an older build still reaches somebody rather than failing silently.
        """
        country = self._country_of(params)
        return str(country.phone_code) if country and country.phone_code else '91'

    def _send_code(self, phone, code, kind, name=''):
        """Send `code` to `phone` over WhatsApp. True when it actually went.

        Returns False rather than raising for every failure mode — no connected
        session, an unsendable number, the library throwing. The caller passes
        that straight back to the app as `sent: false`, because a user staring at
        a code screen waiting for a message that was never sent is the single
        most confusing thing this flow can do.
        """
        company = self._company()
        try:
            minutes = request.env['app.login.otp'].sudo().ttl_minutes()
        except Exception:
            minutes = 5
        body = company.app_login_template(kind).format_map(_SafeDict(
            app=company.name or 'the app',
            name=name or 'there',
            code=code,
            minutes=minutes,
        ))
        session = request.env['whatsapp.session'].sudo().search(
            [('status', '=', 'connected')], limit=1)
        if not session:
            _logger.warning("app_login: no connected WhatsApp session — code not sent")
            return False
        try:
            session.send_message(phone, body)
            return True
        except Exception as exc:
            _logger.warning("app_login: WhatsApp send failed: %s", exc)
            return False

    def _dev_code(self, code):
        """The code, but only while the developer switch is on.

        See res.company.app_login_dev_autofill for why this is dangerous. Logged
        every time so that leaving it on is at least noisy.
        """
        if not self._company().app_login_dev_autofill:
            return {}
        _logger.warning(
            "app_login: DEV AUTO-FILL is ON — a one-time code was returned in an "
            "API response. Anyone who can reach this server can sign in as anyone.")
        return {'dev_code': code}

    def _finalize(self, user, device):
        """Sign the session in as `user` without asking Odoo for a password.

        Mirrors what /web/session/authenticate does after it has checked
        credentials — we have checked our own, by code or by app password.

        THE can_save LINE IS NOT OPTIONAL ON A MULTI-DATABASE SERVER.

        When a request's database is resolved from the `X-Odoo-Database` header —
        which is the only way a phone can name it on a server hosting several
        databases with an empty dbfilter — Odoo marks the session stateless
        (`http.py`: `session.can_save = False  # stateless`) and `_save_session`
        then returns without writing anything. So this method would sign the user
        in for the duration of one request and hand back nothing: the reply
        carried no usable session and the very next call was anonymous, with no
        error anywhere to explain it.

        That flag exists so ordinary stateless API calls do not litter the
        session store, which is right. It does not apply to a route whose entire
        purpose is to establish a session: the code has been verified or the
        password checked, the user is known, and persisting is the point.

        Set here and nowhere else — no other route gains it.
        """
        try:
            request.session['pre_login'] = user.login
            request.session['pre_uid'] = user.id
            request.session.finalize(request.env)
            request.session.db = request.db
            request.session.can_save = True
            request._save_session(request.env)
        except Exception as exc:
            _logger.error("app_login: finalize failed for %s: %s", user.login, exc)
            return False
        user._app_login_record_signin(device)
        return True

    def _signed_in(self, user):
        return {
            'status': True,
            'uid': user.id,
            'name': user.name,
            'login': user.login,
            'must_change': user.app_login_must_change,
        }

    # ------------------------------------------------------------------ #
    # config                                                             #
    # ------------------------------------------------------------------ #
    @http.route('/app_login/config', type='json', auth='public', methods=['POST'], csrf=False)
    def config(self, **params):
        """The country list the app's picker is drawn from.

        It answers with countries and NOTHING ELSE about number format — no dial
        code, no digit count. Both used to come from a company setting that
        existed only because the number field is drawn before anyone has
        identified themselves. Letting the person pick their own country
        answers that properly, and the app defaults the picker from the DEVICE's
        locale, which knows better than a server setting ever could.

        The list is every country Odoo has a dial code for. Sent whole rather
        than searched over the wire: it is a few hundred short rows, it never
        changes between requests, and a picker that has to round-trip to filter
        is worse than one that does not.
        """
        countries = request.env['res.country'].sudo().search_read(
            [('phone_code', '!=', 0)], ['name', 'phone_code'], order='name')
        return {
            'status': True,
            'countries': [
                {'id': c['id'], 'name': c['name'], 'dial': str(c['phone_code'])}
                for c in countries
            ],
            'signup_enabled': self._company().app_login_signup_enabled,
        }

    # ------------------------------------------------------------------ #
    # start — the one decision                                           #
    # ------------------------------------------------------------------ #
    @http.route('/app_login/start', type='json', auth='public', methods=['POST'], csrf=False)
    def start(self, **params):
        """Given a number, decide what happens next and send the code.

        `mode` is one of:
          login   — registered and allowed; a sign-in code has been sent
          signup  — not registered, sign-up is on; a sign-up code has been sent
          blocked — nothing was sent, and `error` says why

        One round trip on purpose. Asking "does this number exist" and then
        "send me a code" would be two calls that can disagree, and it is the
        single decision that makes the app behave the way people expect a
        number-first login to behave.

        It does reveal whether a number is registered, by answering `login`
        versus `signup`. That is unavoidable — the app has to know whether to ask
        for a name — and it is no more than kra's own login_check already told
        anyone who asked.
        """
        company = self._company()
        digits = self._digits(params.get('mobile'))
        # 4-15 local digits: the international range, minus the country code.
        # There is no exact check any more because res.country carries no mobile
        # length, and a table of per-country lengths would be wrong for
        # somewhere eventually. The server decides by whether it matches anyone.
        if not (4 <= len(digits) <= 15):
            return {'status': True, 'mode': 'blocked', 'error': 'Enter your mobile number.'}

        user = request.env['res.users']._app_login_find_by_mobile(digits)

        # ---- known number → sign-in code ---- #
        if user:
            locked_to = user._app_login_device_owner(params.get('setup_uid'))
            if locked_to:
                return {'status': True, 'mode': 'blocked',
                        'error': f"This device is set up for {locked_to}. Contact your admin."}
            if not user.app_login_enabled:
                return {'status': True, 'mode': 'blocked',
                        'error': 'Your login is disabled. Contact your admin.'}
            # Remember the country they picked BEFORE sending, so the code goes
            # to the dial code they actually chose rather than a stale one. This
            # is also what makes their choice show up on the Users screen.
            user._app_login_remember_country(self._country_of(params).id)
            code, retry = request.env['app.login.otp'].issue(user)
            if code is None:
                return {'status': True, 'mode': 'login', 'sent': False,
                        'retry_after': retry,
                        'error': 'A code was just sent. Please wait before asking for another.'}
            sent = self._send_code(
                normalize_msisdn(user.app_login_mobile, user._app_login_dial()),
                code, 'login', user.name)
            out = {'status': True, 'mode': 'login', 'sent': sent, 'name': user.name}
            out.update(self._dev_code(code))
            return out

        # ---- unknown number → sign-up, if it is switched on ---- #
        Attempt = request.env['app.signup.attempt']
        ip = self._ip()
        if not company.app_login_signup_enabled:
            Attempt.log(digits, 'signup_off', ip=ip)
            return {'status': True, 'mode': 'blocked', 'error': _NOT_REGISTERED}
        if Attempt.daily_cap_reached() or Attempt.ip_cap_reached(ip):
            Attempt.log(digits, 'capped', ip=ip)
            # Says nothing about a limit: an attacker learning where the ceiling
            # is only tells them how to sit just under it.
            return {'status': True, 'mode': 'blocked', 'error': _NOT_REGISTERED}

        code, retry = request.env['app.signup.otp'].issue(digits)
        if code is None:
            Attempt.log(digits, 'throttled', ip=ip)
            return {'status': True, 'mode': 'signup', 'sent': False, 'retry_after': retry,
                    'error': 'A code was just sent. Please wait before asking for another.'}
        # No user yet, so the dial code can only come from what the app sent.
        sent = self._send_code(
            normalize_msisdn(digits, self._dial_of(params)),
            code, 'signup')
        Attempt.log(digits, 'code_sent' if sent else 'send_failed', ip=ip)
        out = {'status': True, 'mode': 'signup', 'sent': sent}
        out.update(self._dev_code(code))
        return out

    # ------------------------------------------------------------------ #
    # verify — sign in with a code                                       #
    # ------------------------------------------------------------------ #
    @http.route('/app_login/verify', type='json', auth='public', methods=['POST'], csrf=False)
    def verify(self, **params):
        """Check a sign-in code and sign in. Never touches the password.

        kra's otp/verify cannot do this — it insists on setting a new password
        and refuses to reuse the old one, so it is a reset that logs you in
        rather than a login. It also skips the device lock that its own
        /kpi_app/login enforces; this checks it.
        """
        user = request.env['res.users']._app_login_find_by_mobile(params.get('mobile'))
        if not user:
            return {'status': False, 'error': _NOT_REGISTERED}
        locked_to = user._app_login_device_owner(params.get('setup_uid'))
        if locked_to:
            return {'status': False,
                    'error': f"This device is set up for {locked_to}. Contact your admin."}
        if not user.app_login_enabled:
            return {'status': False, 'error': 'Your login is disabled. Contact your admin.'}
        if not request.env['app.login.otp'].verify(user, params.get('code')):
            return {'status': False, 'error': 'Incorrect or expired code.'}
        if not self._finalize(user, params.get('device')):
            return {'status': False, 'error': 'Login failed. Please try again.'}
        _logger.info("app_login: %s signed in by code", user.login)
        return self._signed_in(user)

    # ------------------------------------------------------------------ #
    # signup — create an account with a code                             #
    # ------------------------------------------------------------------ #
    @http.route('/app_login/signup', type='json', auth='public', methods=['POST'], csrf=False)
    def signup(self, **params):
        """Verify a sign-up code, create the user, and sign them in.

        The new account gets `base.group_user` AND NOTHING ELSE. That is the
        least it can have and still work, and every extra group here would be
        handed out to whoever typed a number. It is still a real internal Odoo
        user, with backend access and a licence seat on Enterprise — which is
        why the toggle exists and ships off.

        Deliberately NOT reusing kra's /kpi_user_access/create: that route is
        auth='user' behind an admin check, correctly, and must stay that way.
        """
        company = self._company()
        Attempt = request.env['app.signup.attempt']
        ip = self._ip()
        digits = self._digits(params.get('mobile'))
        name = (params.get('name') or '').strip()
        password = (params.get('password') or '').strip()
        device = params.get('device')

        if not company.app_login_signup_enabled:
            Attempt.log(digits, 'signup_off', name=name, ip=ip)
            return {'status': False, 'error': _NOT_REGISTERED}
        if not name:
            return {'status': False, 'error': 'Enter your name.'}
        # A password is OPTIONAL here, and that is deliberate.
        #
        # This flow is meant to feel like WhatsApp: type a number, receive a
        # code, type your name, and you are in. WhatsApp never asks for a
        # password, and demanding one at the end of an otherwise password-free
        # sign-up is both a surprise and a second secret to forget.
        #
        # Leaving it blank means no hash is stored, so the code is simply the way
        # in every time — which is what WhatsApp does. The fallback is not lost,
        # only deferred to whoever decides they want it.
        #
        # `app_login_must_change` stays FALSE on this path, unlike an admin
        # password reset. That flag drives a "set a password" nag in the app, and
        # nagging someone about a password they were never asked for reintroduces
        # the thing this removes.
        #
        # A password that IS supplied still has to be a real one: optional is not
        # the same as weak.
        if password and len(password) < 4:
            return {'status': False, 'error': 'Password must be at least 4 characters.'}
        if Attempt.daily_cap_reached():
            Attempt.log(digits, 'capped', name=name, ip=ip)
            return {'status': False, 'error': _NOT_REGISTERED}

        # Re-checked here, not just in start(): two devices can hold codes for
        # the same number, and an admin may have registered it in between.
        if request.env['res.users']._app_login_find_by_mobile(digits):
            Attempt.log(digits, 'exists', name=name, ip=ip)
            return {'status': False,
                    'error': 'This number is already registered. Try signing in.'}
        if not request.env['app.signup.otp'].verify(digits, params.get('code')):
            Attempt.log(digits, 'bad_code', name=name, ip=ip)
            return {'status': False, 'error': 'Incorrect or expired code.'}

        Users = request.env['res.users'].sudo()
        login = digits
        # The number is unique, so this normally runs once. The suffix only
        # matters when an Odoo account already happens to be named by digits.
        suffix = 1
        while Users.with_context(active_test=False).search_count([('login', '=ilike', login)]):
            suffix += 1
            login = '%s-%s' % (digits, suffix)
        # sudo() on the xmlid lookup: this runs as the PUBLIC user, who has no
        # business reading ir.model.data or res.groups, and env.ref() would be
        # access-checked against them.
        group_user = request.env['ir.model.data'].sudo()._xmlid_to_res_id('base.group_user')
        try:
            user = Users.create({
                'name': name,
                'login': login,
                'group_ids': [(6, 0, [group_user])],
                # No `password` key on purpose. This account exists to use the
                # app; leaving the Odoo login password unset means it cannot be
                # used to sign in to the backend directly, which is the least
                # this can grant while still working.
                'app_login_mobile': digits,
                'app_login_enabled': True,
            })
            # The country they picked on their phone becomes the one the Users
            # screen shows, and the one their future codes are sent to.
            user._app_login_remember_country(self._country_of(params).id)
            # No-ops on a blank password (see above), leaving must_change true.
            user._app_login_set_password(password)
        except Exception as exc:
            _logger.error("app_login: signup create failed for %s: %s", digits, exc)
            return {'status': False, 'error': 'Could not create the account. Contact your admin.'}

        Attempt.log(digits, 'created', name=name, device=device, ip=ip, user=user)
        _logger.info("app_login: new self-signup %s (%s) from %s", login, user.id, ip)
        if not self._finalize(user, device):
            # The account exists, so say so rather than implying it failed —
            # they can sign in normally.
            return {'status': True, 'logged_in': False, 'uid': user.id,
                    'name': user.name, 'login': user.login}
        return self._signed_in(user)

    # ------------------------------------------------------------------ #
    # password — the fallback                                            #
    # ------------------------------------------------------------------ #
    @http.route('/app_login/password', type='json', auth='public', methods=['POST'], csrf=False)
    def password(self, **params):
        """Sign in with the app password.

        Kept deliberately. WhatsApp here is a single scanned session, and a login
        that cannot survive it dropping is one that locks out an entire company
        at the moment nobody can do anything about it.
        """
        user = request.env['res.users']._app_login_find_by_mobile(params.get('mobile'))
        if not user:
            return {'status': False, 'error': _NOT_REGISTERED}
        locked_to = user._app_login_device_owner(params.get('setup_uid'))
        if locked_to:
            return {'status': False,
                    'error': f"This device is set up for {locked_to}. Contact your admin."}
        if not user.app_login_enabled:
            return {'status': False, 'error': 'Your login is disabled. Contact your admin.'}
        if not user._app_login_check_password(params.get('password')):
            return {'status': False, 'error': "That password doesn't match this number."}
        if not self._finalize(user, params.get('device')):
            return {'status': False, 'error': 'Login failed. Please try again.'}
        return self._signed_in(user)

    # ------------------------------------------------------------------ #
    # set_password — first-run / change, once signed in                  #
    # ------------------------------------------------------------------ #
    @http.route('/app_login/set_password', type='json', auth='user', methods=['POST'], csrf=False)
    def set_password(self, **params):
        """The signed-in user replaces their own app password."""
        new = (params.get('new_password') or '').strip()
        if len(new) < 4:
            return {'status': False, 'error': 'Password must be at least 4 characters.'}
        user = request.env.user
        if user._app_login_check_password(new):
            return {'status': False,
                    'error': "You can't reuse your old password. Please choose a new one."}
        user._app_login_set_password(new)
        return {'status': True}
