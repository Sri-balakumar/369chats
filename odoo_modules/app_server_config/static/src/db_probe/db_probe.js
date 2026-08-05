/** @odoo-module **/
// The line under Client URL: a spinner while the databases are being fetched,
// then how many were found — or why none were.
//
// WHY A WIDGET AND NOT TWO <div> ELEMENTS IN THE VIEW
//
// The view language can colour a message that has already arrived, which is what
// this replaced, but it cannot say "a lookup is happening right now". Typing an
// address and tabbing out reaches across the network to another Odoo, which can
// take the full ten-second timeout — and for all of it the form said nothing at
// all, so a slow server and a wrong address looked identical.
//
// HOW IT KNOWS
//
// No polling and no second request. Odoo writes the typed value into the record
// locally and only THEN fires the onchange, so while that call is out the record
// holds the new URL and `db_checked_url` still holds the previous one. The
// disagreement between those two fields is the loading state; when the onchange
// returns it sets `db_checked_url` to the URL it just checked and they agree
// again.
//
// Both fields must be present in the form arch (invisible is fine) or the record
// simply will not carry them.
import { Component, xml } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { standardWidgetProps } from "@web/views/widgets/standard_widget_props";

export class AppServerDbProbe extends Component {
    static template = xml/* xml */`
        <div class="o_app_server_db_probe">
            <div t-if="loading" class="text-muted d-flex align-items-center">
                <span class="spinner-border spinner-border-sm me-2" role="status"/>
                Looking for databases on that server…
            </div>
            <!-- Red, and it STAYS. The onchange also raises a popup, and a popup
                 is dismissed in a second and forgotten; this line is still there
                 when you come back to the form wondering why nothing works. -->
            <div t-elif="failed" class="text-danger fw-bold">
                <i class="fa fa-exclamation-triangle me-1"/>
                <t t-esc="message"/>
            </div>
            <div t-elif="ok" class="text-success">
                <i class="fa fa-check me-1"/>
                <t t-esc="message"/>
            </div>
        </div>
    `;
    static props = { ...standardWidgetProps };

    get data() {
        return this.props.record.data;
    }

    // A URL is entered, the record is being EDITED, and the status on file was
    // computed for a different URL — so a lookup is out.
    //
    // `record.dirty` is what makes this safe. A lookup can only ever be in
    // flight while someone is typing in the form; on a saved or freshly loaded
    // record nothing is happening, whatever the fields say. Without that check,
    // any row whose db_checked_url was empty — every row created before the
    // field existed, and every row saved while it was still marked readonly and
    // therefore silently dropped — opened with a spinner that turned for ever on
    // a server that was configured perfectly well.
    get loading() {
        const url = (this.data.client_url || "").trim();
        if (!url || !this.props.record.dirty) {
            return false;
        }
        return url !== (this.data.db_checked_url || "");
    }

    get failed() {
        return !this.loading && Boolean(this.data.db_failed);
    }

    get ok() {
        return !this.loading && !this.data.db_failed && Boolean(this.data.db_status);
    }

    get message() {
        return this.data.db_status || "";
    }
}

registry.category("view_widgets").add("app_server_db_probe", {
    component: AppServerDbProbe,
    // Named so the record actually carries them. A widget gets no fields
    // automatically, and reading one the view never asked for yields undefined —
    // which here would read as "not loading" and the spinner would never show.
    fieldDependencies: [
        { name: "client_url", type: "char" },
        { name: "db_checked_url", type: "char" },
        { name: "db_status", type: "char" },
        { name: "db_failed", type: "boolean" },
    ],
});
