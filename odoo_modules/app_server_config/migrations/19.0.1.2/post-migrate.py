"""Backfill db_checked_url on rows that existed before it did.

The form reads "client_url differs from db_checked_url" as "a lookup is running
right now" and draws a spinner. A new column is NULL everywhere, so without this
every existing row would open with a spinner that never stops — on a server that
is configured perfectly well.

Set to the URL each row already has: the status shown beside it was, in fact,
computed for that URL. Rows with no URL keep NULL, which is also right — nothing
has been checked, and there is nothing to check.

A migrations/ script, NOT the post_init_hook: `post_init_hook` runs on INSTALL
only and is silently skipped by `-u`, so an upgrade would leave every row exactly
as broken as before. That has caught us once already on this module.
"""


def migrate(cr, version):
    cr.execute("""
        UPDATE app_server_config
           SET db_checked_url = client_url
         WHERE COALESCE(client_url, '') <> ''
           AND db_checked_url IS NULL
    """)
