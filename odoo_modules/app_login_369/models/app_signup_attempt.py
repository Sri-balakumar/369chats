"""A record of everyone who tried to create their own account.

The plan could have said "we log it" and stopped, and that would have been
useless: Odoo's log file is not a review mechanism, because nobody opens it. With
self sign-up switched on, somebody has to be able to answer "who let themselves
in last week, and what was refused" without reading a server log — otherwise an
unexpected account is discovered by noticing a stranger in the users list.

So every attempt lands here, accepted or not, and the module's menu shows it.
This is also where the global daily ceiling is counted from.
"""

from datetime import timedelta

from odoo import api, fields, models

# A circuit breaker, not a business rule. Normal onboarding is a handful of
# people; hundreds in a day means either the toggle was left on or somebody found
# the endpoint. Either way, stopping is the right answer.
_MAX_CREATED_PER_DAY = 50


class AppSignupAttempt(models.Model):
    _name = 'app.signup.attempt'
    _description = 'App Sign-Up Attempt'
    _order = 'create_date desc, id desc'
    _rec_name = 'phone'

    phone = fields.Char(string='Number', index=True, readonly=True)
    name = fields.Char(string='Name Given', readonly=True)
    outcome = fields.Selection([
        ('code_sent', 'Code sent'),
        ('created', 'Account created'),
        ('bad_code', 'Wrong or expired code'),
        ('throttled', 'Throttled'),
        ('signup_off', 'Refused — sign-up is off'),
        ('exists', 'Refused — number already registered'),
        ('capped', 'Refused — daily limit reached'),
        ('send_failed', 'Code could not be sent'),
    ], string='Outcome', index=True, readonly=True)
    device = fields.Char(string='Device', readonly=True)
    ip = fields.Char(string='IP', index=True, readonly=True)
    user_id = fields.Many2one(
        'res.users', string='Created User', readonly=True, ondelete='set null')

    @api.model
    def log(self, phone, outcome, name=None, device=None, ip=None, user=None):
        """Record one attempt. Never raises — auditing must not break signing up."""
        try:
            return self.sudo().create({
                'phone': (phone or '')[:32],
                'name': (name or '')[:120] or False,
                'outcome': outcome,
                'device': (device or '')[:120] or False,
                'ip': (ip or '')[:64] or False,
                'user_id': user.id if user else False,
            })
        except Exception:
            return self.browse()

    @api.model
    def daily_cap_reached(self):
        """True when today's accepted sign-ups have hit the ceiling."""
        since = fields.Datetime.now() - timedelta(days=1)
        made = self.sudo().search_count([
            ('outcome', '=', 'created'), ('create_date', '>=', since)])
        return made >= _MAX_CREATED_PER_DAY

    @api.model
    def ip_cap_reached(self, ip, limit=10):
        """True when one address has made too many attempts in a day.

        Counts ATTEMPTS, not successes: a script that keeps getting the code
        wrong is exactly what this is meant to stop, and it never succeeds at
        all.
        """
        if not ip:
            return False
        since = fields.Datetime.now() - timedelta(days=1)
        return self.sudo().search_count([
            ('ip', '=', ip), ('create_date', '>=', since)]) >= limit
