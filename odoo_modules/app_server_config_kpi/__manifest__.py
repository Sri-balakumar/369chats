{
    "name": "App Server Config — User Numbers",
    "version": "1.0",
    "author": "Alphalize",
    "category": "Technical",
    "summary": "Adds the mobile-number user list to the App Servers screen.",
    # A BRIDGE, and nothing else.
    #
    # app_server_config is deliberately generic (base + web only) so it can be
    # installed on any Odoo, for any app. Mobile numbers are kpi_mobile_number on
    # res.users, which belongs to kra_kpi_module — referencing that field from
    # the core would force EVERY installation to carry kra_kpi_module and destroy
    # the reusability the split exists for. So the users list lives here instead,
    # and is installed only where both sides are already present.
    #
    # This module MODIFIES NOTHING inside kra_kpi_module. It depends on it in
    # order to render fields that module defines; it adds no fields to res.users,
    # inherits none of its models, and changes none of its files.
    #
    # The list is a VIEW onto res.users, not a copy: it edits the same
    # kpi_mobile_number that "Login Management (Non-odoo)" edits and that
    # /kpi_app/login_check reads. Change a number in either screen and the other
    # shows it — nothing is duplicated, so nothing can drift.
    "depends": ["app_server_config", "kra_kpi_module"],

    "data": [
        "views/app_server_config_kpi_views.xml",
    ],

    "assets": {
        "web.assets_backend": [
            "app_server_config_kpi/static/src/users_screen/users_screen.js",
        ],
    },

    "installable": True,
    "application": False,
    # Installs itself as soon as both sides are present, which is what a bridge
    # should do — there is no reason to have both and not want the list.
    "auto_install": True,
}
