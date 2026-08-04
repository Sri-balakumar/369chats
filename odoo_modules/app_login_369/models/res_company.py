"""Company-level settings for the mobile app login.

Everything an admin can change lives here: whether strangers may create their own
account, what the two WhatsApp messages say, which country's dial code the app's
number field should use, and the developer switch that makes testing possible
without a WhatsApp session.
"""

from odoo import api, fields, models

# Written for a SIGN-IN, not a password reset. kra_kpi_module's template says
# "Password Reset ... enter this code to set your new password", which is simply
# untrue of a login code and tells the reader to go looking for a screen that is
# not there. Same {placeholders} as KRA's so text can be moved between them.
DEFAULT_LOGIN_TEMPLATE = (
    "Hi *{name}* 👋\n\n"
    "🔐 *{app}* — Sign In\n\n"
    "Your one-time code is:\n\n"
    "🔢 *{code}*\n\n"
    "⏱️ Expires in {minutes} minutes.\n"
    "Enter it in the app to sign in.\n\n"
    "⚠️ Didn't try to sign in? Ignore this message and tell your admin."
)

# Signup has no name to greet — nobody has told us one yet, and asking for it
# before the number is proven would mean storing details for people who never
# finish. So this template takes no {name}.
DEFAULT_SIGNUP_TEMPLATE = (
    "👋 Welcome to *{app}*\n\n"
    "🔐 Your account setup code is:\n\n"
    "🔢 *{code}*\n\n"
    "⏱️ Expires in {minutes} minutes.\n"
    "Enter it in the app to finish creating your account.\n\n"
    "⚠️ Didn't request this? Ignore this message — no account is created."
)


class ResCompany(models.Model):
    _inherit = 'res.company'

    # --- Sign-up ---------------------------------------------------------- #
    # DEFAULT FALSE, and that is not timidity. With this on, an unrecognised
    # number can create a real internal Odoo user — backend access, and a
    # licence seat on Enterprise — and every attempt sends a WhatsApp message to
    # a number nobody has verified, which is how an unofficial WhatsApp session
    # gets itself banned. Switch it on to onboard people, switch it off after.
    app_login_signup_enabled = fields.Boolean(
        string='Allow Self Sign-Up', default=False,
        help="When on, someone whose number is not registered can create their "
             "own account with a WhatsApp code. When off, they are told to "
             "contact an admin and no message is sent. Leave off unless you are "
             "actively onboarding people — every new account is a real Odoo "
             "user, and every attempt messages an unverified number.")

    # --- Number format ---------------------------------------------------- #
    # --- Number format: DELIBERATELY NOTHING HERE -------------------------- #
    #
    # There used to be a company country, a derived dial code and a fixed digit
    # length. All three are gone, and their absence is the design.
    #
    # They existed because the app draws the number field before it knows who
    # you are, so something had to say what "+__" to show. The right answer to
    # that is the one WhatsApp gives: let the person pick their country, and
    # default the picker from the DEVICE — its locale and SIM — which knows
    # better than any server setting could. So the app asks /app_login/config
    # for the country list and chooses its own default; whatever the person
    # picks is saved on their res.users record and shown on the Users screen.
    #
    # The digit count is gone for a harder reason: res.country carries a
    # phone_code but NO mobile length, so exact per-country validation would
    # mean maintaining a table that is wrong for somewhere eventually. Numbers
    # are accepted at 4-15 local digits and the server decides whether they
    # match anybody — which is also what WhatsApp does.

    # --- Message templates ------------------------------------------------- #
    app_login_code_template = fields.Text(
        string='Sign-In Code Message',
        help="WhatsApp text for a sign-in code. Placeholders: {app} {name} "
             "{code} {minutes}. Leave empty for the built-in wording.")
    app_login_signup_template = fields.Text(
        string='Sign-Up Code Message',
        help="WhatsApp text for a new-account code. Placeholders: {app} {code} "
             "{minutes} — there is no {name}, because nobody has given one yet. "
             "Leave empty for the built-in wording.")

    # --- Developer switch --------------------------------------------------- #
    # Testing the whole flow should not require scanning a QR and nursing a
    # WhatsApp session. While this is on, the code comes back in the API
    # response and the app fills it in for you.
    #
    # UNDERSTAND WHAT IT COSTS. A one-time code means something only because it
    # travels by a channel the person asking cannot read. Put it in the response
    # and there is no second channel left: anyone who can call the endpoint gets
    # the code, and can therefore sign in as anyone. This is a testing
    # affordance and never a delivery route. It ships off, and every use is
    # logged at warning level.
    app_login_dev_autofill = fields.Boolean(
        string='Developer Auto-Fill (INSECURE)', default=False,
        help="TESTING ONLY. Returns the one-time code in the API response so "
             "the app can fill it in without WhatsApp. While this is on ANYONE "
             "WHO CAN REACH THE SERVER CAN SIGN IN AS ANYONE, because the code "
             "no longer travels by a private channel. Never enable in "
             "production.")

    # --- Helpers the controllers use --------------------------------------- #
    def app_login_template(self, kind):
        """The message body for `kind` ('login' or 'signup'), custom or built-in."""
        self.ensure_one()
        if kind == 'signup':
            return self.app_login_signup_template or DEFAULT_SIGNUP_TEMPLATE
        return self.app_login_code_template or DEFAULT_LOGIN_TEMPLATE

