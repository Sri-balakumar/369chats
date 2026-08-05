import json
import logging

import requests

from odoo import models, fields, api
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

# Split, not one number. A wrong address should fail while the admin is still
# looking at the screen, but a server that is merely SLOW deserves the patience —
# and one combined timeout cannot express both. Connect covers "is anything
# there", read covers "how long it thinks about it".
#
# Measured on this deployment: a real https lookup is ~5s cold (DNS + TLS) and
# ~2s warm; a refused port costs 2s regardless, which is Windows retransmitting
# the SYN and not something a timeout can shorten.
_CONNECT_TIMEOUT = 5
_READ_TIMEOUT = 10
_LIST_TIMEOUT = (_CONNECT_TIMEOUT, _READ_TIMEOUT)


class AppServerConfig(models.Model):
    """Where one mobile app should send its requests.

    One row per app. `app_key` is what the app itself sends — it is a contract
    with a shipped binary, so renaming a key silently breaks every installed
    copy of that app until they are rebuilt. Treat it as permanent.

    `client_url` is what the DEVICE should call, which is not always the address
    this record was edited from: an admin may be on an internal hostname while
    phones come in over the public domain. Hence a stored value rather than
    reading the request's own host.
    """
    _name = 'app.server.config'
    _description = 'Mobile App Server Configuration'
    _order = 'app_key'
    _rec_name = 'app_key'

    app_key = fields.Char(
        string='App Key', required=True, index=True,
        help="The identifier the app sends, e.g. '369chats' or 'kpi'. This is a "
             "contract with a shipped app — renaming it breaks every installed "
             "copy until they are rebuilt.")
    name = fields.Char(
        string='App Name',
        help="Human label for this list. Not used by the app.")
    client_url = fields.Char(
        string='Client URL',
        help="The address DEVICES should call, e.g. https://odoo.example.com. "
             "Leaving it empty switches the app off: /app/resolve then answers "
             "'not configured' and phones show 'contact your admin'.")
    # The dropdown the admin actually uses. Points at app.server.db rows, which
    # are (re)filled from the target server whenever client_url is entered.
    client_db_id = fields.Many2one(
        'app.server.db', string='Database',
        domain="[('server_url', '=', client_url)]",
        help="Picked from the databases found on the server above.")
    # What /app/resolve reads. Kept as a plain Char on purpose: the endpoint
    # works today and must not be disturbed by how the value gets chosen. It is
    # ALSO the manual escape hatch when the target has database listing turned
    # off (list_db = False) and there is nothing to put in the dropdown.
    client_db = fields.Char(
        string='Database name',
        help="The database devices should use. Leave empty to answer with the "
             "database this record lives in.")
    # Whether the last fetch found anything, so the form can show the dropdown or
    # fall back to the text box. Not for the app — purely a UI hint.
    # NOT readonly=True, and that is load-bearing rather than an oversight.
    #
    # A model-level readonly field is EXCLUDED from what the web client sends on
    # save. These are filled in by the onchange below, so marking them readonly
    # meant every one of them was written in the form, shown on screen, and then
    # silently dropped on the way to the database — leaving NULL behind. That
    # turned db_checked_url into a permanent disagreement with client_url, which
    # the form reads as "a lookup is running" and spins for ever.
    #
    # They are invisible in the view instead, which is the honest way to say "not
    # yours to type in": nobody can reach them, and what the onchange puts there
    # survives a save.
    db_options = fields.Char(string='Databases found', copy=False)
    # What happened on the last fetch, shown under the field. Two fields rather
    # than one so the form can colour a failure red without a JS widget.
    db_status = fields.Char(string='Status', copy=False)
    db_failed = fields.Boolean(string='Lookup failed', copy=False)
    # The URL the status above was computed FOR — which is how the form knows a
    # lookup is in flight without polling anything.
    #
    # Odoo writes a typed value into the record locally and only THEN fires the
    # onchange, so for the whole duration of that call the record holds the new
    # URL while this field still holds the old one. That gap IS the loading
    # state, and the spinner is drawn from it. Nothing else can tell you: an
    # onchange is server-side and offers the client no progress at all.
    db_checked_url = fields.Char(string='Status is for', copy=False)

    # `is_live`, NOT `active`. `active` is a magic field name in Odoo: the web
    # client hides those records from every list unless you go looking for them,
    # so switching one server on made the previous row DISAPPEAR — which reads as
    # "my old setup was deleted". Setting active_test=False on the action did not
    # reliably override it either.
    #
    # A plain boolean has no such behaviour: every row always shows, and the
    # toggle means exactly what it says.
    is_live = fields.Boolean(
        string='Active', default=True, copy=False,
        help="The server apps are pointed at right now. Only one can be on; "
             "switching one on switches the others off.")
    # Kept so archiving still exists as a concept, but never used by the UI and
    # always true, so nothing is hidden from the list.
    active = fields.Boolean(string='Archived (unused)', default=True)

    # NOT a plain unique(app_key). An archived row keeps its key under a SQL
    # unique constraint, so replacing a server would be impossible: you could
    # never create the new row while the old one still existed. The rule that
    # actually matters is "one ACTIVE row per app", enforced in Python below —
    # only one server can be live for an app at a time, but its history can sit
    # archived beside it.

    # Deliberately NO @api.constrains raising on a duplicate key. A constraint
    # fires during create(), before the code below has had a chance to stand the
    # old row down — so adding a replacement would be refused rather than taking
    # over, which is the opposite of what is wanted. The invariant is maintained
    # by making the new row win, not by rejecting it.

    def unlink(self):
        """Refuse to delete the server the apps are currently pointed at.

        Deleting it would leave /app/resolve with no answer for that app, and
        every device would start getting "not configured" on its next launch —
        with nothing on screen to explain why. Switching to another server first
        is the deliberate step that makes that safe.
        """
        live = self.filtered('is_live')
        if live:
            raise UserError(
                "%s is the server your apps are using right now, so it cannot be "
                "deleted.\n\nSwitch another server on first — that stands this one "
                "down — and then delete it."
                % (live[0].app_key or 'This row'))
        return super().unlink()

    def action_make_live(self):
        """Switch this server on, and everything else off, then RELOAD.

        The reload is the point. A plain toggle in the list writes one row and
        the client re-reads only that row, so the siblings this switches off
        server-side kept showing as ON until the page was refreshed — which
        looked exactly like the rule not working.
        """
        self.ensure_one()
        self.write({'is_live': True})
        return {'type': 'ir.actions.client', 'tag': 'reload'}

    def _deactivate_siblings(self):
        """Exactly ONE row is live at a time. Switching one on switches the rest
        off.

        Note this is deliberately GLOBAL, not per app_key: turning a row on is
        treated as "this is the server we are on now", and leaving another row
        lit alongside it invites the question of which one is real. The archived
        rows keep their settings, so switching back is one toggle.

        The consequence, stated plainly: a SECOND app cannot be configured at the
        same time as the first — activating its row stands the other down, and
        the app whose row went inactive gets "not configured" from /app/resolve.
        If two apps ever need to resolve at once, this is the method to relax
        (search on app_key as well) and nothing else has to change.
        """
        for rec in self:
            if not rec.is_live:
                continue
            others = self.search([('id', '!=', rec.id), ('is_live', '=', True)])
            if others:
                others.write({'is_live': False})

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._deactivate_siblings()
        return records

    def write(self, vals):
        res = super().write(vals)
        # Only when this write could have made a row live — otherwise every edit
        # would re-run the search for nothing.
        if vals.get('is_live') or 'app_key' in vals:
            self._deactivate_siblings()
        return res

    # ------------------------------------------------------------------ #
    # Loading the database list from the target server                    #
    # ------------------------------------------------------------------ #
    @api.model
    def _normalize_url(self, url):
        """Add a scheme if one is missing, and drop the trailing slash.

        WHICH scheme matters more than it looks. This value is handed to every
        phone, so guessing `http://` for a typed `krakpi.alphalize.com` points a
        whole company at plaintext against a server that offered TLS — a silent
        downgrade from a typo-level convenience, and nothing on screen says so.

        So: a bare public-looking hostname gets **https**. An address with an
        explicit port, a bare IP, or a single-label name like `localhost` gets
        http, because those are the development and LAN cases, where TLS is
        usually not set up and https would simply fail.

        Typing the scheme yourself always wins — this only fills in a blank.
        """
        u = (url or '').strip()
        if not u:
            return ''
        if not u.startswith(('http://', 'https://')):
            host = u.split('/', 1)[0]
            looks_local = (
                ':' in host                                   # explicit port
                or host.replace('.', '').isdigit()            # bare IPv4
                or '.' not in host                            # localhost, myserver
            )
            u = ('http://' if looks_local else 'https://') + u
        return u.rstrip('/')

    @api.model
    def _fetch_databases(self, url):
        """Ask a remote Odoo which databases it has.

        Done SERVER-side on purpose. The browser calling another Odoo directly
        would be a cross-origin request and get blocked, so the fetch has to
        happen here. Mirrors the app (api/odooApi.js `fetchDatabases`): JSON-RPC
        POST first, plain GET as the fallback, since which one answers depends on
        the remote server's version and settings.

        Reachable only by system administrators (see ir.model.access), which is
        what makes it acceptable for this server to fetch an admin-supplied URL.
        """
        base = self._normalize_url(url)
        if not base:
            raise UserError("Enter the server URL first.")

        endpoint = base + '/web/database/list'
        body = {'jsonrpc': '2.0', 'method': 'call', 'params': {}}
        # ONE session for both attempts. The POST and the GET below go to the
        # same host, and without a session the fallback pays for a second DNS
        # lookup and a second TLS handshake — which on this deployment is the
        # difference between roughly two seconds and roughly five. Per call
        # rather than module-level: a Session is not documented as thread-safe,
        # and Odoo serves this from a worker pool.
        session = requests.Session()
        try:
            res = session.post(
                endpoint, json=body, timeout=_LIST_TIMEOUT,
                headers={'Content-Type': 'application/json'})
            data = res.json()
            if data.get('error'):
                msg = (data['error'].get('data') or {}).get('message') or 'Database listing is disabled'
                raise UserError("%s said: %s" % (base, msg))
            result = data.get('result')
            if isinstance(result, list) and result:
                return result
            if isinstance(result, dict) and result.get('databases'):
                return result['databases']
        except UserError:
            raise
        except (requests.RequestException, ValueError, json.JSONDecodeError) as exc:
            _logger.info("database list POST failed for %s: %s", base, exc)

        # Fallback: some deployments answer the plain GET but not the RPC.
        try:
            res = session.get(endpoint, timeout=_LIST_TIMEOUT)
            data = res.json()
            if isinstance(data, list) and data:
                return data
            if isinstance(data, dict) and data.get('result'):
                return data['result']
        except (requests.RequestException, ValueError, json.JSONDecodeError) as exc:
            _logger.info("database list GET failed for %s: %s", base, exc)
            raise UserError(
                "Could not reach %s.\n\nCheck the address is right and that this "
                "server can see it." % base)

        raise UserError(
            "%s did not return any databases.\n\nDatabase listing may be turned "
            "off there (list_db = False), in which case type the name by hand."
            % base)

    @api.model
    def _cache_databases(self, url, names):
        """Store the fetched names so the dropdown has real records to offer.

        Created here, during the onchange, so the list is available BEFORE the
        record is saved — otherwise entering a URL and immediately picking a
        database would not be possible. Discarding the form afterwards leaves
        cache rows behind; harmless, and the unique(server_url, name) constraint
        keeps them from accumulating.
        """
        Db = self.env['app.server.db'].sudo()
        existing = Db.search([('server_url', '=', url)])
        have = set(existing.mapped('name'))
        missing = [n for n in names if n not in have]
        if missing:
            Db.create([{'name': n, 'server_url': url} for n in missing])
        # Drop names the server no longer has, so the dropdown cannot offer a
        # database that has since been deleted or renamed.
        gone = existing.filtered(lambda r: r.name not in names)
        if gone:
            gone.unlink()
        return Db.search([('server_url', '=', url)])

    @api.onchange('client_url')
    def _onchange_client_url(self):
        """Enter the URL and the databases load by themselves — the same two
        steps as the app's setup screen, with no button to press.

        Odoo fires an onchange when the field is COMMITTED (focus leaves it),
        not per keystroke, so this is one network call per address typed rather
        than one per character.

        A failure must NOT raise. Raising inside an onchange rejects the edit,
        so a half-typed address would fight the admin for the field. A warning
        reports it and lets them carry on.
        """
        if not self.client_url:
            self.db_options = False
            self.db_status = False
            self.db_failed = False
            self.db_checked_url = False
            self.client_db_id = False
            return None

        # Normalise first, so what is typed and what apps are later told cannot
        # drift over a trailing slash or a missing scheme.
        url = self._normalize_url(self.client_url)
        self.client_url = url

        # ALREADY ANSWERED. Same address as the status on file, and the names are
        # still cached — so there is nobody to ask. Reaching across the network
        # again costs two to three seconds and comes back with what is already on
        # the screen.
        #
        # This is not a rare case. Normalisation alone produces it: typing the
        # address with a trailing slash, or without the scheme, is a different
        # string to Odoo and fires this method, and only here does it turn out to
        # be the same server. Retyping the same address, or editing it and
        # changing your mind, does the same.
        #
        # `db_failed` is checked because a failure must stay retryable — the
        # server being down for a minute should not mean the address is written
        # off until it is retyped from scratch. To re-read a server that has
        # since GAINED a database, clear the field and enter it again: that
        # blanks db_checked_url below, so the next entry is a genuine lookup.
        if url == (self.db_checked_url or '') and not self.db_failed:
            cached = self.env['app.server.db'].sudo().search_count(
                [('server_url', '=', url)])
            if cached:
                return None

        try:
            names = self._fetch_databases(url)
        except UserError as exc:
            # Shown in red on the form AND as a popup. The popup is easy to
            # dismiss and forget; the red line stays until it is fixed.
            self.db_options = False
            self.client_db_id = False
            self.db_failed = True
            self.db_status = str(exc).split('\n')[0]
            # Set on the FAILURE path too. Forgetting it here would leave the
            # spinner turning for ever on exactly the case that needs the error
            # read — a wrong address.
            self.db_checked_url = url
            return {'warning': {
                'title': "Couldn't load databases",
                'message': str(exc),
            }}

        rows = self._cache_databases(url, names)
        self.db_options = ', '.join(names)
        self.db_failed = False
        self.db_status = "%d database%s found — choose one below." % (
            len(names), '' if len(names) == 1 else 's')
        self.db_checked_url = url

        # Deliberately does NOT pick one, not even when the server offers only a
        # single database. Choosing the database is the admin's decision and it
        # decides where every phone connects — silently filling it in invites
        # saving a value nobody actually looked at.
        #
        # The one thing carried over is a choice already made: if the previous
        # selection still exists on this server it is kept, so re-entering the
        # same URL does not throw away work.
        if self.client_db and self.client_db in names:
            self.client_db_id = rows.filtered(lambda r: r.name == self.client_db)[:1]
        else:
            self.client_db_id = False
            self.client_db = False
        return None

    @api.onchange('client_db_id')
    def _onchange_client_db_id(self):
        """Mirror the dropdown into the plain field the app endpoint reads."""
        if self.client_db_id:
            self.client_db = self.client_db_id.name

    @api.model
    def _resolve(self, app_key, fallback_db=None):
        """Return {url, db} for `app_key`, or None when it is not configured.

        A BLANK Client URL means not configured, full stop. It used to fall back
        to whatever host the request arrived on, which seemed helpful — a row
        created but not filled in still answered something. In practice it made
        the field look broken: clearing the URL changed nothing, because the
        anchor simply answered with its own address. An admin emptying that field
        is switching the app off, and it has to behave that way.

        The DATABASE still falls back to the caller's own, which is not the same
        thing: an empty database is genuinely ambiguous rather than a decision,
        and on a single-database server it is the only possible answer.
        """
        key = (app_key or '').strip()
        if not key:
            return None
        # is_live MUST be in the domain. It used to rely on Odoo's magic `active`
        # field filtering switched-off rows out automatically; `is_live` is a
        # plain boolean and gets no such help, so without this an app could be
        # handed a server that had been switched off.
        row = self.sudo().search(
            [('app_key', '=', key), ('is_live', '=', True)], limit=1)
        if not row:
            return None
        url = (row.client_url or '').strip().rstrip('/')
        if not url:
            return None
        # The dropdown is consulted as well as the text field, and deliberately.
        # They are kept in step by an onchange, but only while the form is open —
        # and a saved row has already been found holding a chosen database in the
        # dropdown and nothing in the text field. Reading one and not the other
        # meant a row that looked correct on screen answered as if no database
        # had been picked. Whichever of the two is filled in is what the admin
        # chose.
        db = (row.client_db or '').strip() or (row.client_db_id.name or '').strip()
        return {
            'url': url,
            'db': db or fallback_db or '',
        }
