import logging

_logger = logging.getLogger(__name__)


def post_init_hook(env):
    """Carry existing rows over from `active` to `is_live`.

    `is_live` replaced `active` as the on/off switch, because `active` is a magic
    field name in Odoo and the web client hides those rows from the list — so
    switching servers made the previous one appear to vanish.

    A new boolean defaults to True for every existing row, which would leave ALL
    servers switched on at once. This copies the old value across, then forces
    `active` true so nothing stays hidden.

    Written to run on any upgrade, not just the first install: it is idempotent,
    and the columns are only touched while the old one still holds meaning.
    """
    cr = env.cr
    cr.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'app_server_config'
           AND column_name IN ('active', 'is_live')
    """)
    cols = {r[0] for r in cr.fetchall()}
    if not {'active', 'is_live'} <= cols:
        return

    # Only meaningful the first time, when every is_live is still the default.
    cr.execute("SELECT count(*) FROM app_server_config WHERE is_live IS NOT TRUE")
    if cr.fetchone()[0]:
        _logger.info("app_server_config: is_live already set, leaving it alone")
    else:
        cr.execute("UPDATE app_server_config SET is_live = active")
        _logger.info("app_server_config: copied active -> is_live for %s rows", cr.rowcount)

    # Nothing may stay archived, or it drops out of the list again.
    cr.execute("UPDATE app_server_config SET active = TRUE WHERE active IS NOT TRUE")

    # If that left more than one live row, keep the newest and stand the rest
    # down - the one-live-at-a-time rule has to hold after a migration too.
    cr.execute("SELECT id FROM app_server_config WHERE is_live ORDER BY id DESC")
    live = [r[0] for r in cr.fetchall()]
    if len(live) > 1:
        cr.execute("UPDATE app_server_config SET is_live = FALSE WHERE id != %s", (live[0],))
        _logger.info("app_server_config: kept id=%s live, switched off %s others",
                     live[0], len(live) - 1)
