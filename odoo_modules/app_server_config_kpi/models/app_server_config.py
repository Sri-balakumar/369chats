from odoo import models, fields, api


class AppServerConfig(models.Model):
    """Adds the user list to the App Servers form.

    Extends OUR model (app.server.config). kra_kpi_module is depended on so its
    fields can be rendered, but nothing in it is modified — no fields are added
    to res.users and none of its models are inherited.
    """
    _inherit = 'app.server.config'

    # Not stored, and not per-record: every server row shows the same people,
    # because the users belong to this Odoo, not to a row. Storing it would
    # invent an ownership that does not exist and would go stale the moment a
    # user was added.
    #
    # The point is not the set — it is reaching kpi_mobile_number without
    # leaving the screen. The form makes the FIELD readonly and the LINES
    # editable, so edits write straight through to res.users.
    user_ids = fields.Many2many(
        'res.users', string='Users', compute='_compute_user_ids',
        help="Everyone who can sign in to the apps. Editing a number here is the "
             "same as editing it in Login Management — there is only one field.")

    @api.depends_context('uid')
    def _compute_user_ids(self):
        # Internal users only: portal/public accounts have no app login, and
        # listing them would just be noise to scroll past.
        users = self.env['res.users'].sudo().search(
            [('share', '=', False), ('active', '=', True)], order='name')
        for rec in self:
            rec.user_ids = users
