{
    "name": "App Login",
    "version": "19.0.1.0",
    "author": "Alphalize",
    "category": "Technical",
    "summary": "Sign in to a mobile app with a phone number and a WhatsApp code.",
    # WHY THIS EXISTS
    #
    # Signing in used to mean a number plus a password, and every part of that
    # belonged to kra_kpi_module: the number, the permission, the password hash,
    # the country config and the one-time codes. The app could therefore only be
    # deployed next to KRA.
    #
    # This module owns all of it. Type your number, receive a code on WhatsApp,
    # and you are in — and when an admin switches sign-up on, an unrecognised
    # number creates its own account by the same code. The password remains as a
    # fallback, because WhatsApp is a single connected session and a login that
    # cannot survive it dropping is a login that locks out a whole company.
    #
    # DEPENDS ON base + web + whatsapp_neonize, and deliberately NOT on
    # kra_kpi_module. That is the entire point: the app stands alone, and a
    # customer without KRA gets a working login. whatsapp_neonize is here because
    # it is the delivery channel, and it is independent of KRA.
    #
    # Nothing is imported from kra_kpi_module — not the number lookup, not the
    # password check, not the message templates. Where KRA is ALSO installed the
    # two are simply separate: migrations/ seeds this module's fields from KRA's
    # once, and from then on this module's Users screen is the only place app
    # login is managed. Editing a number in KRA's Login Management will not
    # reach the app. That is the price of standing alone, and it is deliberate.
    # app_server_config is base + web only, so it drags nothing in, and the
    # direction is right: the optional module depends on the generic one, never
    # the reverse. It buys two things — the Users screen can show WHERE these
    # people will be signing in, and this module can add a button to the App
    # Server form without app_server_config ever learning this module exists.
    #
    # NOT app_server_config_kpi. That is a bridge and auto_install: modules like
    # it appear and disappear with their dependencies, and a bridge should be a
    # leaf that nothing hangs off.
    "depends": ["base", "web", "whatsapp_neonize", "app_server_config"],

    "data": [
        "security/ir.model.access.csv",
        "views/app_login_views.xml",
    ],

    "assets": {
        "web.assets_backend": [
            "app_login_369/static/src/users_screen/users_screen.js",
            "app_login_369/static/src/settings_screen/settings_screen.js",
            "app_login_369/static/src/app_login_link/app_login_link.js",
        ],
    },

    # Seeds this module's number/enabled fields from KRA's on install, when
    # those columns happen to exist. NOT a migrations/ script: 19.0.1.0 is the
    # first version, so nothing can ever upgrade *to* it and such a script would
    # never run. Re-runnable afterwards from App Login > Settings.
    "post_init_hook": "post_init_hook",

    "installable": True,
    # Its own tile in the Apps grid. The menu holds real day-to-day admin work —
    # who may sign in, and who signed themselves up — which does not belong
    # behind Settings → Technical and its developer-mode requirement.
    "application": True,
}
