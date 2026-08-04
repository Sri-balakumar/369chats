"""The app-login half of a user: their number, their permission, their password.

These fields are this module's OWN. They deliberately do not reuse
kra_kpi_module's `kpi_mobile_number` / `kpi_app_login_enabled`, because the whole
point of this module is to work on an Odoo that has never heard of KRA.

Where KRA is also installed, migrations/ seeds these from KRA's fields once, and
after that the two are independent. Editing a number in KRA's Login Management
will NOT reach the app. This module's Users screen is the only place app login is
managed — say so to whoever administers the system, because a number changed in
the wrong screen fails silently and looks like the app is broken.
"""

import logging
import re

from odoo import api, fields, models

_logger = logging.getLogger(__name__)

# How many trailing digits must match for a typed number to find its user.
# Enough to be unambiguous in a company, loose enough to tolerate a stored
# number that carries a country code when the typed one does not (or vice versa).
_MATCH_DIGITS = 8


def normalize_msisdn(local, dial):
    """Compose the sendable `<dial><local>` number.

    THE STORED NUMBER IS ALWAYS LOCAL DIGITS. That is a contract, not a guess:
    the Users screen draws a `+91` prefix box beside a local number box, and the
    app sends the chosen country separately from the digits typed. So this
    simply joins the two.

    It deliberately does NOT try to detect a number that already carries its
    country code, which the earlier length-based version did. Without a
    per-country digit length there is no safe test: a real Indian mobile can
    begin "91", so "already starts with the dial code" would strip two digits
    off a perfectly good local number and send the code to a stranger. Trusting
    the contract is correct; guessing is silently wrong.

    Leading trunk zeros go, since they are a domestic dialling convention and
    never part of an international number.
    """
    digits = re.sub(r'\D', '', str(local or ''))
    dial = re.sub(r'\D', '', str(dial or '')) or '91'
    if not digits:
        return ''
    return dial + digits.lstrip('0')


class ResUsers(models.Model):
    _inherit = 'res.users'

    app_login_mobile = fields.Char(
        string='App Mobile Number', index=True,
        help="The number this person types to sign in. Stored as digits only.")
    app_login_enabled = fields.Boolean(
        string='App Login Allowed', default=False,
        help="Off means this person cannot sign in to the mobile app at all, "
             "whatever their number or password. Switching it off is how you "
             "revoke access without deleting the user.")
    app_login_password_hash = fields.Char(
        string='App Password Hash', copy=False, groups='base.group_system',
        help="Hashed app password. Never the Odoo login password — see "
             "_app_login_set_password.")
    app_login_must_change = fields.Boolean(
        string='Must Change App Password', default=False, copy=False)
    app_login_country_id = fields.Many2one(
        'res.country', string='App Login Country',
        help="Overrides the company dial code for this person, so someone in "
             "Oman gets +968 while everyone else stays on the company default.")
    app_login_last_at = fields.Datetime(string='Last App Login', readonly=True)
    app_login_last_device = fields.Char(string='Last App Device', readonly=True)

    # ---- Keep the stored number to bare digits ---------------------------- #
    # Normalising once on the way in means the lookup can ask the database for a
    # suffix match instead of reading every user and comparing in Python. It also
    # removes the whole class of "it didn't match because someone typed spaces".
    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('app_login_mobile'):
                vals['app_login_mobile'] = re.sub(r'\D', '', vals['app_login_mobile'])
        return super().create(vals_list)

    def write(self, vals):
        if vals.get('app_login_mobile'):
            vals['app_login_mobile'] = re.sub(r'\D', '', vals['app_login_mobile'])
        return super().write(vals)

    # ---- Lookup ------------------------------------------------------------ #
    @api.model
    def _app_login_find_by_mobile(self, mobile):
        """The user who signs in with `mobile`, or an empty recordset.

        Matches on the last 8 digits so a stored +91 number still answers a
        locally-typed one.

        AMBIGUITY IS REFUSED, NOT GUESSED. If two users somehow carry the same
        number, picking one would mean handing somebody another person's
        account — so nobody is returned and the problem is logged loudly. A
        locked-out admin is recoverable; the wrong session is not.
        """
        digits = re.sub(r'\D', '', mobile or '')
        if len(digits) < _MATCH_DIGITS:
            return self.browse()
        tail = digits[-_MATCH_DIGITS:]
        # Archived users are excluded BEFORE the ambiguity check, not after: an
        # old archived account holding the same number must not block the live
        # person who now has it, which is exactly what happens when someone
        # leaves and their number is reissued.
        found = self.sudo().search([('app_login_mobile', '=like', '%' + tail)])
        if len(found) > 1:
            _logger.error(
                "app_login: %s active users share the number ending %s (ids %s) — "
                "refusing to sign anyone in until it is fixed",
                len(found), tail, found.ids)
            return self.browse()
        return found

    # ---- Password ---------------------------------------------------------- #
    def _app_login_set_password(self, raw):
        """Hash and store the app password.

        Uses Odoo's own crypt context, so the hashing is as strong as Odoo's.

        It does NOT also write `res.users.password`, and that is the difference
        from kra_kpi_module's version, which syncs the two on purpose so one
        credential opens both the app and the Odoo backend. A standalone app
        login has no business rewriting someone's Odoo credentials — a person
        who only ever uses the phone should not have their backend password
        silently changed under them.
        """
        self.ensure_one()
        raw = (raw or '').strip()
        if not raw:
            return
        self.sudo().write({
            'app_login_password_hash': self._crypt_context().hash(raw),
            'app_login_must_change': False,
        })

    def _app_login_check_password(self, raw):
        """True when `raw` matches the stored hash."""
        self.ensure_one()
        stored = self.sudo().app_login_password_hash
        if not stored or not raw:
            return False
        try:
            return bool(self._crypt_context().verify(raw, stored))
        except Exception:
            # A malformed hash must read as "wrong password", not as a 500 that
            # tells an attacker they found something interesting.
            return False

    def _app_login_state(self):
        """disabled | needs_setup | ready — what the login screen should do next."""
        self.ensure_one()
        if not self.app_login_enabled:
            return 'disabled'
        if not self.sudo().app_login_password_hash or self.app_login_must_change:
            return 'needs_setup'
        return 'ready'

    # ---- Device lock -------------------------------------------------------- #
    def _app_login_device_owner(self, setup_uid):
        """Name of the account this device belongs to when it is not this user.

        A device set up by hand records the uid that did it and sends it back as
        `setup_uid`. Only that person may sign in there. Absent or zero means the
        device was never bound — a shared company phone — and the check is
        skipped.
        """
        self.ensure_one()
        try:
            setup_uid = int(setup_uid or 0)
        except (TypeError, ValueError):
            setup_uid = 0
        if not setup_uid or self.id == setup_uid:
            return None
        owner = self.sudo().browse(setup_uid)
        if not owner.exists():
            return 'another account'
        return owner.name or owner.login or 'another account'

    # ---- Number format ------------------------------------------------------ #
    def _app_login_dial(self):
        """This person's dial code, from the country THEY chose in the app.

        Falls back to '91' rather than raising or returning nothing: this is
        read while composing a WhatsApp message, and a user with no country set
        yet (everyone seeded from KRA, until they sign in once) must still be
        reachable. The fallback is a guess; the moment they pick a country on
        their phone it is replaced with the real answer.
        """
        self.ensure_one()
        code = self.app_login_country_id.phone_code
        return str(code) if code else '91'

    def _app_login_remember_country(self, country_id):
        """Store the country the person picked in the app.

        This is the "saved and reflected on the module" half: whatever they
        choose on their phone is what the Users screen shows afterwards. Only
        writes on an actual change, so an ordinary sign-in is a read.
        """
        self.ensure_one()
        try:
            country_id = int(country_id or 0)
        except (TypeError, ValueError):
            return
        if country_id and country_id != self.app_login_country_id.id:
            self.sudo().write({'app_login_country_id': country_id})

    # ---- Role ---------------------------------------------------------------- #
    # Two values, backed by a group Odoo already has. KRA's owner/client/
    # developer do not exist without KRA, and inventing a second permission
    # system to hold one bit is not worth the maintenance.
    def _app_login_role(self):
        self.ensure_one()
        return 'admin' if self.has_group('base.group_system') else 'user'

    def _app_login_set_role(self, role):
        self.ensure_one()
        group = self.env.ref('base.group_system')
        if role == 'admin':
            self.sudo().write({'group_ids': [(4, group.id)]})
        else:
            self.sudo().write({'group_ids': [(3, group.id)]})
        return self._app_login_role()

    def action_app_login_reset_password(self):
        """Admin clears someone's app password (the Users form button).

        Clears rather than setting a default. kra seeds `1111` and nags until it
        is changed, which only made sense when a password was the only way in —
        a shared default password is a real one until somebody gets around to
        replacing it. Here the person signs in with a WhatsApp code and sets
        their own, so there is never a guessable interval.
        """
        for user in self:
            user.sudo().write({
                'app_login_password_hash': False,
                'app_login_must_change': True,
            })
        return True

    # ---- Sign in ------------------------------------------------------------ #
    def _app_login_record_signin(self, device):
        """Stamp the last-login columns the Users screen shows."""
        self.ensure_one()
        self.sudo().write({
            'app_login_last_at': fields.Datetime.now(),
            'app_login_last_device': (device or '')[:120],
        })
