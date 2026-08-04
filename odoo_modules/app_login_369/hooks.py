"""Seed this module's login fields from kra_kpi_module's, where KRA exists.

WHY A HOOK AND NOT A MIGRATION. `post_init_hook` runs on INSTALL; a
`migrations/<version>/` script runs on UPGRADE, when the module version changes.
19.0.1.0 is this module's first version, so nothing can ever upgrade *to* it —
a migration folder here would be dead code that looks like a safety net. Install
is the only moment that exists, so this is a hook.

That leaves one real gap: someone installing KRA *after* this module would never
be seeded. Rather than pretend a migration covers it, `seed_from_kra` is
idempotent and re-runnable from a button in App Login > Settings.

WHY THE COLUMN CHECK. This module must install on an Odoo that has never carried
kra_kpi_module — that is the whole reason it exists. So KRA's columns are looked
for rather than assumed, and finding none is the ordinary case, not a failure.

WHAT IS NOT COPIED: the password hash. Both use Odoo's crypt context so it would
technically transfer, but carrying a credential across the boundary we just drew
to separate the two is not worth it. Everyone is marked must-change and sets
their own on first sign-in — which now costs one WhatsApp code, not an admin's
afternoon.
"""

import logging

_logger = logging.getLogger(__name__)


def seed_from_kra(cr):
    """Copy KRA's numbers and login flags across. Returns (seeded, locked_out).

    Idempotent: only ever fills a BLANK app_login_mobile, so re-running never
    overwrites a number an admin has since corrected on the App Login screen.
    """
    cr.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'res_users'
           AND column_name IN ('kpi_mobile_number', 'kpi_app_login_enabled')
    """)
    present = {row[0] for row in cr.fetchall()}

    seeded = 0
    if 'kpi_mobile_number' in present:
        # Digits only, matching what res.users.write() stores — otherwise the
        # suffix lookup that finds a user at sign-in would miss these rows.
        cr.execute(r"""
            UPDATE res_users
               SET app_login_mobile = regexp_replace(kpi_mobile_number, '\D', '', 'g')
             WHERE kpi_mobile_number IS NOT NULL
               AND kpi_mobile_number <> ''
               AND (app_login_mobile IS NULL OR app_login_mobile = '')
        """)
        seeded = cr.rowcount

        if 'kpi_app_login_enabled' in present:
            cr.execute("""
                UPDATE res_users
                   SET app_login_enabled = kpi_app_login_enabled
                 WHERE app_login_enabled IS NOT TRUE
                   AND kpi_app_login_enabled IS TRUE
            """)

        # Nobody carries a password across, so everybody sets one.
        cr.execute("""
            UPDATE res_users SET app_login_must_change = TRUE
             WHERE app_login_mobile IS NOT NULL AND app_login_mobile <> ''
               AND (app_login_password_hash IS NULL OR app_login_password_hash = '')
        """)
        _logger.info("app_login_369: seeded %s numbers from kra_kpi_module", seeded)
    else:
        _logger.info("app_login_369: no kra_kpi_module columns — nothing to seed")

    # Who will silently fail to sign in. Worth naming, because the number is now
    # the ONLY way in: a user without one is locked out, not merely untidy.
    cr.execute("""
        SELECT login FROM res_users
         WHERE active IS TRUE AND share IS NOT TRUE
           AND (app_login_mobile IS NULL OR app_login_mobile = '')
    """)
    locked_out = [row[0] for row in cr.fetchall()]
    if locked_out:
        _logger.warning(
            "app_login_369: %s active users have NO app login number and cannot "
            "sign in until one is set (App Login > Users): %s",
            len(locked_out), ', '.join(locked_out))
    return seeded, locked_out


def post_init_hook(env):
    seed_from_kra(env.cr)
