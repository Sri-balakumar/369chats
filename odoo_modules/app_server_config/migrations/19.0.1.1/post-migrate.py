import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    """Carry `active` over to `is_live` on an UPGRADE.

    post_init_hook only runs on INSTALL, so an already-installed module upgraded
    with -u never ran it: a brand-new boolean defaults to True for every existing
    row, leaving every server switched on at once. This is the upgrade path.
    """
    if not version:
        return
    cr.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'app_server_config'
           AND column_name IN ('active', 'is_live')
    """)
    if len({r[0] for r in cr.fetchall()}) < 2:
        return

    cr.execute("UPDATE app_server_config SET is_live = active")
    _logger.info("app_server_config: copied active -> is_live for %s rows", cr.rowcount)

    # `active` is unused now and must never hide a row from the list.
    cr.execute("UPDATE app_server_config SET active = TRUE WHERE active IS NOT TRUE")

    # One live row at most - keep the newest if the old data had several.
    cr.execute("SELECT id FROM app_server_config WHERE is_live ORDER BY id DESC")
    live = [r[0] for r in cr.fetchall()]
    if len(live) > 1:
        cr.execute("UPDATE app_server_config SET is_live = FALSE WHERE id != %s", (live[0],))
        _logger.info("kept id=%s live, switched off %s others", live[0], len(live) - 1)
