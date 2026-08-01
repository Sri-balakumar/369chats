{
    "name": "369Chats",
    "version": "1.0",
    "author": "Alphalize",
    "category": "Discuss",
    "summary": "Company WhatsApp-style chat for the mobile app (number-login identity).",
    # Two clients share this module: the OWL backend client in static/src (see
    # "assets" below) and the React Native app, which talks to the same JSON API.
    #
    # Depends on kra_kpi_module for the app-login user fields (kpi_mobile_number,
    # kpi_app_login_enabled), the Expo push-token store (kpi.push.token) and the
    # KRA role groups used by _chat_role().
    "depends": ["base", "web", "bus", "kra_kpi_module"],

    "data": [
        "security/ir.model.access.csv",
        "security/chats_rules.xml",
        "data/chat_cron.xml",
        "views/chat_views.xml",
    ],

    "assets": {
        "web.assets_backend": [
            # Must load BEFORE chat_app.js: it replaces the bus.parameters service
            # so the websocket targets Odoo's evented port, and bus_service reads
            # that at startup. Loaded after the fact, the socket is already dialling
            # the wrong port.
            "chats_369/static/src/chat_app/bus_origin.js",
            "chats_369/static/src/chat_app/chat_app.js",
            "chats_369/static/src/chat_app/chat_app.scss",
        ],
    },

    "installable": True,
    # Standalone app: shows its own "369Chats" icon in the Apps grid.
    "application": True,
}
