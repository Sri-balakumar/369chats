/** @odoo-module **/
// APP LOGIN > USERS — who may sign in to the mobile app, on what number, and
// where they will be signing in. Changes save as you make them; there is no
// Save button.
//
// The WhatsApp connection and the message wording live in App Login > SETTINGS,
// not here: this screen is about people, that one is about configuration, and
// mixing them meant scrolling past a QR code to reach a phone number.
//
// WHY THIS IS A COMPONENT AND NOT A LIST VIEW
//
// The layout cannot be built from an Odoo list: the login sits UNDER the name in
// one cell, and the country dropdown sits ABOVE a +dial prefix box and the
// number input. A list gives one control per cell. The same conclusion was
// reached once already in app_server_config_kpi; this is not a preference.
//
// WHAT IT TALKS TO
//
// Only /app_login/admin/*, which belong to this module. Nothing here calls
// kra_kpi_module — that is the point of the module existing, and the reason the
// WhatsApp routes are replicated rather than reused.
import { Component, xml, useState, onWillStart, useEffect, useRef } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";

// Two values, backed by a group Odoo already has. KRA's owner/client/developer
// do not exist without KRA.
const ROLES = [
    { key: "user", label: "User" },
    { key: "admin", label: "Admin" },
];

export class AppLoginUsers extends Component {
    static template = xml/* xml */`
        <!-- No max-width or centering: this also renders inside a form sheet,
             where a centred fixed-width block sits oddly against the fields
             above it. -->
        <div class="o_app_login_users w-100 p-3" t-ref="root">

            <div t-if="state.loading" class="text-muted py-5 text-center">Loading…</div>
            <div t-elif="!state.authorized" class="alert alert-warning">
                <t t-esc="state.error"/>
            </div>

            <t t-else="">
            <!-- ── Where these people are signing in ────────────────────── -->
            <!-- The screen that says WHO may sign in should also say WHERE.
                 Read-only: the live server is chosen in App Servers, and a
                 second place to change it is a second place to get it wrong. -->
            <div t-if="state.server.url" class="alert alert-light border d-flex flex-wrap gap-4 py-2">
                <span><i class="fa fa-server me-2 text-muted"/><b t-esc="state.server.url"/></span>
                <span t-if="state.server.db" class="text-muted">
                    Database: <t t-esc="state.server.db"/>
                </span>
                <span t-if="state.server.app_key" class="text-muted">
                    App: <t t-esc="state.server.app_key"/>
                </span>
            </div>
            <div t-else="" class="alert alert-warning py-2">
                <i class="fa fa-exclamation-triangle me-2"/>No live server is configured in
                <b>App Servers</b>, so phones have nowhere to send these logins.
            </div>

            <!-- ── Team members ─────────────────────────────────────────── -->
            <div class="card mb-4" style="border-left: 4px solid #7C7BAD;">
                <div class="card-body pb-2">
                    <div class="d-flex align-items-center justify-content-between mb-3">
                        <h5 class="mb-0">
                            <i class="fa fa-user me-2 text-muted"/>Team Members
                        </h5>
                        <div class="d-flex gap-2">
                            <select class="form-select" style="width: 190px;"
                                    t-on-change="(ev) => this.state.roleFilter = ev.target.value">
                                <option value="">All roles</option>
                                <t t-foreach="ROLES" t-as="r" t-key="r.key">
                                    <option t-att-value="r.key" t-esc="r.label"/>
                                </t>
                            </select>
                        </div>
                    </div>

                    <table class="table table-hover align-middle mb-0">
                        <thead>
                            <tr class="text-muted">
                                <th>Name</th>
                                <th style="width: 130px;">Role</th>
                                <th style="width: 260px;">Mobile (login)</th>
                                <th style="width: 150px;">Last login</th>
                                <th style="width: 140px;">Last device</th>
                                <th style="width: 70px;">Login</th>
                                <th style="width: 110px;">Password</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr t-foreach="visibleUsers" t-as="u" t-key="u.id">
                                <!-- Name with the login beneath. THIS is the cell
                                     a list view cannot produce. -->
                                <td>
                                    <div class="fw-bold" t-esc="u.name"/>
                                    <div class="text-muted small" t-esc="u.login"/>
                                </td>

                                <td>
                                    <select class="form-select form-select-sm"
                                            t-att-data-role="u.role"
                                            t-on-change="(ev) => this.setRole(u, ev)">
                                        <t t-foreach="ROLES" t-as="r" t-key="r.key">
                                            <option t-att-value="r.key" t-esc="r.label"
                                                    t-att-selected="r.key === u.role ? 'selected' : false"/>
                                        </t>
                                    </select>
                                    <div t-if="u._savedRole" class="text-success small">saved</div>
                                </td>

                                <!-- Country above, +dial beside the number. The
                                     country is whatever the person picked in the
                                     app; changing it here changes where their
                                     next code is sent. -->
                                <td>
                                    <select class="form-select form-select-sm mb-1"
                                            t-on-change="(ev) => this.setCountry(u, ev)">
                                        <option value=""
                                                t-att-selected="!u.country_id ? 'selected' : false">
                                            Not set (+<t t-esc="u.dial"/>)
                                        </option>
                                        <t t-foreach="state.countries" t-as="c" t-key="c.id">
                                            <option t-att-value="c.id"
                                                    t-att-selected="c.id === u.country_id ? 'selected' : false">
                                                <t t-esc="c.name"/> (+<t t-esc="c.dial"/>)
                                            </option>
                                        </t>
                                    </select>
                                    <div class="input-group input-group-sm">
                                        <span class="input-group-text">+<t t-esc="u.dial"/></span>
                                        <input type="text" class="form-control"
                                               placeholder="not set"
                                               maxlength="15"
                                               t-att-value="u.mobile"
                                               t-on-change="(ev) => this.setMobile(u, ev)"/>
                                    </div>
                                    <div t-if="u._savedMobile" class="text-success small">saved</div>
                                </td>

                                <td class="small">
                                    <t t-if="u.last_login"><t t-esc="u.last_login"/></t>
                                    <t t-else="">—</t>
                                </td>
                                <td class="small">
                                    <t t-if="u.last_device"><t t-esc="u.last_device"/></t>
                                    <t t-else="">—</t>
                                </td>

                                <td>
                                    <div class="form-check form-switch">
                                        <input class="form-check-input" type="checkbox"
                                               t-att-checked="u.enabled ? 'checked' : false"
                                               t-on-change="() => this.toggleLogin(u)"/>
                                    </div>
                                </td>

                                <td>
                                    <button class="btn btn-sm btn-outline-secondary"
                                            t-on-click="() => this.resetPassword(u)">
                                        <i class="fa fa-key me-1"/>Reset
                                    </button>
                                    <div t-if="u._resetMsg" class="text-success small"
                                         t-esc="u._resetMsg"/>
                                </td>
                            </tr>
                            <tr t-if="!visibleUsers.length">
                                <td colspan="7" class="text-muted text-center py-3">
                                    No users match that role.
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    <div t-if="usersWithoutNumber" class="alert alert-warning py-2 mt-3 mb-0 small">
                        <i class="fa fa-exclamation-triangle me-1"/>
                        <b><t t-esc="usersWithoutNumber"/></b> user(s) have no number. The number is
                        the only way in, so they cannot sign in at all until one is set.
                    </div>
                    <div t-if="duplicateNumbers.length" class="alert alert-danger py-2 mt-2 mb-0 small">
                        <i class="fa fa-exclamation-triangle me-1"/>
                        Two people share a number (<t t-esc="duplicateNumbers.join(', ')"/>).
                        <b>Neither can sign in</b> — an ambiguous number is refused rather than
                        guessed, because guessing would hand someone another person's account.
                    </div>
                </div>
            </div>
            </t>
        </div>
    `;

    setup() {
        this.ROLES = ROLES;
        this.state = useState({
            loading: true,
            authorized: true,
            error: "",
            users: [],
            countries: [],
            roleFilter: "",
            server: {},
        });

        this.rootRef = useRef("root");

        onWillStart(async () => { await this.load(); });

        // Make each role dropdown show the role that is actually stored.
        //
        // `<option t-att-selected>` above is the correct way to express it, and
        // it works — but it depends on the browser's "ask for a reset" behaviour
        // running at the right moment as OWL builds the DOM, which is a lot to
        // rest a permission column on. If it ever does not fire, every row
        // silently falls back to the FIRST option, which is "User" — an admin
        // reading as an ordinary user, and nothing on screen to say otherwise.
        //
        // So set .value explicitly after each render. Cheap, and it makes the
        // displayed role the stored role by construction rather than by
        // inference. The data-role attribute is only here to carry the value.
        useEffect(
            () => {
                const root = this.rootRef.el;
                if (!root) {
                    return;
                }
                for (const sel of root.querySelectorAll("select[data-role]")) {
                    const want = sel.dataset.role || "";
                    if (want && sel.value !== want) {
                        sel.value = want;
                    }
                }
            },
            () => [this.state.users, this.state.roleFilter]
        );
    }

    // ── Derived ──────────────────────────────────────────────────────────
    get visibleUsers() {
        const f = this.state.roleFilter;
        return f ? this.state.users.filter((u) => u.role === f) : this.state.users;
    }

    get usersWithoutNumber() {
        return this.state.users.filter((u) => !u.mobile).length;
    }

    // Surfaced because the server REFUSES an ambiguous number rather than
    // picking one, so the symptom is "this number isn't registered" on a number
    // that plainly is. Without this the cause is invisible.
    get duplicateNumbers() {
        const seen = new Map();
        for (const u of this.state.users) {
            if (!u.mobile) continue;
            const tail = u.mobile.slice(-8);
            seen.set(tail, (seen.get(tail) || 0) + 1);
        }
        return [...seen.entries()].filter(([, n]) => n > 1).map(([tail]) => tail);
    }

    // ── Load ─────────────────────────────────────────────────────────────
    async load() {
        this.state.loading = true;
        try {
            const res = await rpc("/app_login/admin/users", {});
            if (!res || !res.status) {
                this.state.authorized = false;
                this.state.error = res?.message || "Not authorized.";
                return;
            }
            this.state.authorized = true;
            this.state.users = res.users || [];
            this.state.countries = res.countries || [];
            this.state.server = res.server || {};
        } finally {
            this.state.loading = false;
        }
    }

    // A brief tick beside the field. Auto-save with no feedback leaves you
    // unsure whether anything happened.
    _flash(obj, key, value = true) {
        obj[key] = value;
        setTimeout(() => { obj[key] = false; }, 1500);
    }

    _fail(e, fallback) {
        alert(e?.data?.message || e?.message || fallback);
    }

    // ── Per-user writes ──────────────────────────────────────────────────
    async setRole(u, ev) {
        const role = ev.target.value;
        try {
            const res = await rpc("/app_login/admin/set_role", { user_id: u.id, role });
            if (res.status) { u.role = res.role; this._flash(u, "_savedRole"); }
            else { alert(res.message || "Not authorized."); ev.target.value = u.role; }
        } catch (e) {
            this._fail(e, "Failed to save.");
            ev.target.value = u.role;
        }
    }

    async setMobile(u, ev) {
        try {
            const res = await rpc("/app_login/admin/set_mobile",
                { user_id: u.id, mobile: ev.target.value || "" });
            // Show what was STORED, not what was typed: the server strips
            // non-digits, and displaying the raw input would quietly disagree
            // with the database.
            if (res.status) { u.mobile = res.mobile; this._flash(u, "_savedMobile"); }
            else alert(res.message || "Not authorized.");
        } catch (e) { this._fail(e, "Failed to save."); }
    }

    async setCountry(u, ev) {
        const cid = ev.target.value ? parseInt(ev.target.value, 10) : false;
        try {
            const res = await rpc("/app_login/admin/set_country",
                { user_id: u.id, country_id: cid });
            if (res.status) {
                u.country_id = res.country_id;
                // The prefix box reads from this, so it has to move with the
                // country or the two would disagree on screen.
                u.dial = res.dial;
                this._flash(u, "_savedMobile");
            } else alert(res.message || "Not authorized.");
        } catch (e) { this._fail(e, "Failed to save."); }
    }

    async toggleLogin(u) {
        const next = !u.enabled;
        try {
            const res = await rpc("/app_login/admin/toggle_login",
                { user_id: u.id, enabled: next });
            if (res.status) u.enabled = res.enabled;
            else alert(res.message || "Not authorized.");
        } catch (e) { this._fail(e, "Failed to save."); }
    }

    async resetPassword(u) {
        if (!confirm(`Clear the app password for ${u.name}? They sign in with a WhatsApp code and set a new one.`)) {
            return;
        }
        try {
            const res = await rpc("/app_login/admin/reset_password", { user_id: u.id });
            if (res.status) {
                u.has_password = false;
                this._flash(u, "_resetMsg", "✓ Cleared");
            } else alert(res.message || "Not authorized.");
        } catch (e) { this._fail(e, "Failed to reset."); }
    }
}

// Registered TWICE, as the screen this mirrors is:
//
//  * as an action — so "App Login > Users" opens it full-screen;
//  * as a view widget — so it can later be embedded inside a form (the App
//    Server record, say) without a second implementation that can drift.
registry.category("actions").add("app_login_users", AppLoginUsers);
registry.category("view_widgets").add("app_login_users", { component: AppLoginUsers });
