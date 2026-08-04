"""One-time codes for creating an account.

Keyed by PHONE NUMBER, not by user, because at this point there is no user — that
is the entire difference from `app.login.otp`, and the reason the two cannot share
a table. Issuing a code retires the subject's earlier ones, so one table would
mean asking to sign up silently killing somebody's pending sign-in code.

This is the riskier of the two. A sign-in code goes to a number an admin entered;
this one goes to a number a stranger typed. That makes the endpoint a way to send
WhatsApp messages to arbitrary people, which is both a nuisance to them and the
behaviour that gets an unofficial WhatsApp session banned. Hence tighter limits
here than on the sign-in side, and a company toggle that ships off.
"""

import re

from odoo import api, fields, models


class AppSignupOtp(models.Model):
    _name = 'app.signup.otp'
    _inherit = ['app.otp.mixin']
    _description = 'App Sign-Up Code'

    phone = fields.Char(string='Phone', required=True, index=True)

    # Stricter than sign-in: a person signing in owns the phone already, whereas
    # every message sent from here lands on a number nobody has verified.
    _MIN_INTERVAL_SECONDS = 60
    _MAX_PER_HOUR = 3

    @api.model
    def _key(self, mobile):
        """Digits only, so the same number written three ways is one subject."""
        return re.sub(r'\D', '', mobile or '')

    def _subject_domain(self, subject):
        return [('phone', '=', self._key(subject))]

    def _subject_vals(self, subject):
        return {'phone': self._key(subject)}
