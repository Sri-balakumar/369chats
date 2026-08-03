from odoo import models, fields


class AppServerDb(models.Model):
    """A database discovered on a target server — the rows the dropdown offers.

    This exists because Odoo resolves `Selection` options at the MODEL level, not
    per record: a Selection field cannot offer "the databases *this row's* server
    happens to have". A Many2one pointing at real records can, so the fetched
    names are kept here.

    It is a CACHE, not configuration. Nothing here is authoritative — the target
    server is. Rows are (re)created whenever a URL is entered, and a stale row for
    a server that no longer exists is harmless: it simply stops being offered once
    the URL is re-entered and the fresh list comes back.
    """
    _name = 'app.server.db'
    _description = 'Database Found On An App Server'
    _order = 'name'

    name = fields.Char(string='Database', required=True, index=True)
    server_url = fields.Char(string='Server URL', required=True, index=True)

    # Without this, re-entering the same URL would append the same names again
    # every time and the dropdown would fill with duplicates.
    # Odoo 19 dropped `_sql_constraints` and ignores it SILENTLY, so this has to
    # be a models.Constraint to actually exist in the database.
    _server_db_uniq = models.Constraint(
        'unique(server_url, name)',
        'That database is already recorded for this server.',
    )
