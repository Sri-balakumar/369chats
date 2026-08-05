/** @odoo-module **/
// The button on the App Server form that goes to App Login ▸ Users.
//
// WHY THIS IS NOT `<button type="action">`
//
// It was, and it landed you on the right screen while leaving you inside App
// Servers: the breadcrumb still read "App Servers / Servers / …" and the top bar
// still said App Servers. Which is what it looked like — a users list belonging
// to the server module — when the point is that there is one users screen and it
// lives in App Login.
//
// HOW IT GOES THERE
//
// `menu.selectMenu()` — the web client's own "a menu was clicked" path, which
// clears the breadcrumb and moves the top bar to the right app at the moment the
// action is ready. Using it rather than hand-rolling doAction + setCurrentMenu
// means this button behaves identically to clicking App Login in the navbar,
// including whatever that does next year.
//
// A plain <a href="/odoo/action-…"> would also work and is one line, but it is a
// full reload of the web client and silently discards an unsaved edit to the URL
// field — the field an admin is most likely to be part-way through when they
// reach for this button.
import { Component, xml } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { standardWidgetProps } from "@web/views/widgets/standard_widget_props";
import { useService } from "@web/core/utils/hooks";

// By xmlid, not by id, so a database where the ids differ still finds it.
const USERS_MENU_XMLID = "app_login_369.menu_app_login_users";
const USERS_ACTION = "app_login_369.action_app_login_users_screen";

export class AppLoginLink extends Component {
    static template = xml/* xml */`
        <button type="button" class="btn btn-secondary" t-on-click="open">
            <i class="fa fa-users me-1"/>App Login Users
        </button>
    `;
    static props = { ...standardWidgetProps };

    setup() {
        this.action = useService("action");
        this.menu = useService("menu");
    }

    async open() {
        const target = this.menu.getAll().find((m) => m.xmlid === USERS_MENU_XMLID);
        if (target) {
            await this.menu.selectMenu(target);
            return;
        }
        // The menu is hidden from this user, or its xmlid moved. Still open the
        // screen — losing the top-bar highlight is a far smaller failure than a
        // button that does nothing.
        await this.action.doAction(USERS_ACTION, { clearBreadcrumbs: true });
    }
}

registry.category("view_widgets").add("app_login_link", { component: AppLoginLink });
