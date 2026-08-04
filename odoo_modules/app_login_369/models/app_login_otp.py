"""One-time codes for signing in.

Also holds `app.otp.mixin`, the behaviour shared with sign-up codes.

WHY THESE ARE HARDER THAN THE ONES KRA ALREADY HAS. kra_kpi_module issues a
4-digit code with no attempt cap and no throttle, on a public route. As a
password-reset path — reachable only by someone who already knows a registered
number, and which still ends in a password — that is thin but survivable. Here
the code IS the front door: guess it and you are signed in as that person. Four
digits is ten thousand tries against a five-minute window with nothing counting
them, which a script finishes long before the code expires.

So: six digits, a cap that BURNS the code rather than merely rejecting a guess,
and a limit on how often one can be asked for.
"""

import logging
import secrets
from datetime import timedelta

from odoo import api, fields, models

_logger = logging.getLogger(__name__)


class AppOtpMixin(models.AbstractModel):
    _name = 'app.otp.mixin'
    _description = 'One-Time Code Behaviour'
    _order = 'create_date desc, id desc'

    code = fields.Char(string='Code', required=True)
    expires_at = fields.Datetime(string='Expires At')
    used = fields.Boolean(string='Used', default=False)
    # Counted per code, not per subject, so a fresh code starts with a fresh
    # budget — otherwise one mistyped digit an hour ago would poison the next
    # legitimate attempt.
    attempts = fields.Integer(string='Failed Attempts', default=0)

    _DIGITS = 6
    _TTL_MINUTES = 5
    # The 6th wrong guess burns the code. Five is comfortably more than a person
    # mistyping and far fewer than a script needs.
    _MAX_ATTEMPTS = 5
    _MIN_INTERVAL_SECONDS = 30
    _MAX_PER_HOUR = 5

    # --- Subclasses say what a "subject" is -------------------------------- #
    def _subject_domain(self, subject):
        raise NotImplementedError

    def _subject_vals(self, subject):
        raise NotImplementedError

    @api.model
    def ttl_minutes(self):
        return self._TTL_MINUTES

    @api.model
    def issue(self, subject):
        """Create a code for `subject`.

        Returns `(code, None)` or `(None, retry_after_seconds)`. The caller sends
        the code by WhatsApp and must never put it in an API response — except
        under the developer switch, which says exactly why that is unsafe.
        """
        now = fields.Datetime.now()
        domain = self._subject_domain(subject)
        recent = self.sudo().search(
            domain + [('create_date', '>=', now - timedelta(hours=1))])

        # Two separate limits: one stops a fast retry loop, the other stops a
        # slow one. Both matter — a message every 30 seconds all day is still
        # abuse, and for sign-up it is abuse aimed at somebody else's phone.
        if len(recent) >= self._MAX_PER_HOUR:
            oldest = min(recent.mapped('create_date'))
            wait = int((oldest + timedelta(hours=1) - now).total_seconds())
            return None, max(wait, 1)
        if recent:
            newest = max(recent.mapped('create_date'))
            elapsed = (now - newest).total_seconds()
            if elapsed < self._MIN_INTERVAL_SECONDS:
                return None, int(self._MIN_INTERVAL_SECONDS - elapsed) or 1

        # Asking for a new code retires the old one, so a message that arrives
        # late cannot be used after a newer one was requested.
        self.sudo().search(domain + [('used', '=', False)]).write({'used': True})
        # Expired rows for this subject are dead weight; clearing them here
        # avoids needing a cron for something this small.
        self.sudo().search(
            domain + [('create_date', '<', now - timedelta(days=1))]).unlink()

        code = str(secrets.randbelow(10 ** self._DIGITS)).zfill(self._DIGITS)
        vals = dict(self._subject_vals(subject))
        vals.update({
            'code': code,
            'expires_at': now + timedelta(minutes=self._TTL_MINUTES),
        })
        self.sudo().create(vals)
        return code, None

    @api.model
    def verify(self, subject, code):
        """True when `code` is this subject's live code. Single use.

        The record is found by SUBJECT and the code compared in Python with
        `compare_digest`, rather than searching for the code itself. Searching by
        code would make the database index answer "does this code exist" — a
        question no caller should be able to ask — and would leak timing.
        """
        code = (code or '').strip()
        if not code:
            return False
        rec = self.sudo().search(
            self._subject_domain(subject) + [
                ('used', '=', False),
                ('expires_at', '>=', fields.Datetime.now()),
            ], limit=1)
        if not rec:
            return False
        if secrets.compare_digest(rec.code or '', code):
            rec.used = True
            return True

        # Wrong. Count it, and burn the code once the budget is gone — merely
        # rejecting the guess would leave the code alive for the next one, which
        # is the whole weakness being fixed.
        rec.attempts += 1
        if rec.attempts >= self._MAX_ATTEMPTS:
            rec.used = True
            _logger.warning(
                "app_login: code burned after %s failed attempts (%s)",
                rec.attempts, self._name)
        return False


class AppLoginOtp(models.Model):
    """A sign-in code, belonging to a user who already exists."""
    _name = 'app.login.otp'
    _inherit = ['app.otp.mixin']
    _description = 'App Sign-In Code'

    user_id = fields.Many2one(
        'res.users', string='User', required=True, index=True, ondelete='cascade')

    def _subject_domain(self, subject):
        return [('user_id', '=', subject.id)]

    def _subject_vals(self, subject):
        return {'user_id': subject.id}
