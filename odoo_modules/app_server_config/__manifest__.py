{
    "name": "App Server Config",
    "version": "19.0.1.1",
    "author": "Alphalize",
    "category": "Technical",
    "summary": "Tells mobile apps which server and database to talk to.",
    # WHY THIS EXISTS
    #
    # A mobile app cannot ask a server which server it belongs to — so every app
    # had to be told its URL and database by hand, on every device, before anyone
    # could log in. This module is the one place that answer lives.
    #
    # An app ships knowing ONE fixed address (a domain that does not move) and
    # asks /app/resolve for its current URL + database. Change the row here and
    # every device adopts the new values by itself: no rebuild, no reinstall, no
    # per-device setup.
    #
    # Keyed per app (`app_key`), so 369Chats, the KRA/KPI app and anything built
    # later all resolve independently. A new app is a new ROW, not new code.
    #
    # Deliberately depends on base + web ONLY. It must stay installable on its
    # own, and nothing here may drag in a product module — a chat upgrade must
    # never be able to break provisioning for a different app.
    "depends": ["base", "web"],

    "data": [
        "security/ir.model.access.csv",
        "views/app_server_config_views.xml",
    ],

    "post_init_hook": "post_init_hook",

    "installable": True,
    # Shows its own tile in the Apps grid. Without this the top-level menu is
    # still created but does not surface as an app, which is the whole reason it
    # was moved out of Settings → Technical (that menu needs developer mode).
    "application": True,
}
