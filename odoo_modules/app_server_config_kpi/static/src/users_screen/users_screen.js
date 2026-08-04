/** @odoo-module **/
// USERS — the App Servers app's own view of app-login credentials: per-user
// mobile number, role, login on/off, PIN reset, plus last login / last device
// and the WhatsApp sender used to deliver reset codes. Changes save as you make
// them; there is no Save button.
//
// WHY THIS EXISTS AS A COMPONENT
//
// This layout cannot be built from an Odoo list view: the login sits UNDER the
// name in one cell, and the country dropdown sits ABOVE a +91 prefix box and the
// number input. A list gives one control per cell, so an earlier attempt looked
// nothing like the real thing.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It defines no data of its own. Every write goes through kra_kpi_module's
// EXISTING /kpi_user_access/* routes, which is what stops a copied UI from
// becoming a copied source of truth: this screen and Login Management (Non-odoo)
// edit the same res.users fields, so an edit in either shows in the other. If
// this ever grows its own storage, that property is lost — don't.
//
// kra_kpi_module itself is not modified. Its routes are called; its files are
// not touched.
import { Component, xml, useState, onWillStart, onWillUnmount } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";

const ROLES = [
    { key: "developer", label: "User" },
    { key: "client", label: "Client" },
    { key: "admin", label: "Admin" },
];

export class AppServerUsers extends Component {
    static template = xml/* xml */`
        <!-- No max-width or centering: this renders INSIDE a form sheet most of
             the time, where a centred fixed-width block would sit oddly against
             the fields above it. -->
        <div class="o_app_server_users w-100">

            <!-- ── Team members ─────────────────────────────────────────── -->
            <div class="card mb-4" style="border-left: 4px solid #7C7BAD;">
                <div class="card-body pb-2">
                    <div class="d-flex align-items-center justify-content-between mb-3">
                        <h5 class="mb-0">
                            <i class="fa fa-user me-2 text-muted"/>Team Members
                        </h5>
                        <select class="form-select" style="width: 190px;"
                                t-on-change="(ev) => this.state.roleFilter = ev.target.value">
                            <option value="">All roles</option>
                            <t t-foreach="ROLES" t-as="r" t-key="r.key">
                                <option t-att-value="r.key" t-esc="r.label"/>
                            </t>
                        </select>
                    </div>

                    <div t-if="state.loading" class="text-muted py-4 text-center">Loading…</div>
                    <div t-elif="!state.authorized" class="alert alert-warning mb-0">
                        You need the KRA/KPI admin role to manage app logins.
                    </div>

                    <table t-else="" class="table table-hover align-middle mb-0">
                        <thead>
                            <tr class="text-muted">
                                <th>Name</th>
                                <th style="width: 130px;">Role</th>
                                <th style="width: 250px;">Mobile (login)</th>
                                <th style="width: 150px;">Last login</th>
                                <th style="width: 140px;">Last device</th>
                                <th style="width: 70px;">Login</th>
                                <th style="width: 110px;">Password</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr t-foreach="visibleUsers" t-as="u" t-key="u.id">
                                <!-- Name with the login beneath it. THIS is the
                                     cell a list view cannot produce. -->
                                <td>
                                    <div class="fw-bold" t-esc="u.name"/>
                                    <div class="text-muted small" t-esc="u.login"/>
                                </td>

                                <td>
                                    <select class="form-select form-select-sm"
                                            t-att-value="u.role"
                                            t-on-change="(ev) => this.setRole(u, ev)">
                                        <t t-foreach="ROLES" t-as="r" t-key="r.key">
                                            <option t-att-value="r.key" t-esc="r.label"
                                                    t-att-selected="r.key === u.role ? 'selected' : false"/>
                                        </t>
                                    </select>
                                    <div t-if="u._savedRole" class="text-success small">saved</div>
                                </td>

                                <!-- Country above, +91 prefix beside the number. -->
                                <td>
                                    <select class="form-select form-select-sm mb-1"
                                            t-on-change="(ev) => this.setCountry(u, ev)">
                                        <option value="" t-att-selected="!u.country_id ? 'selected' : false">
                                            Default (+<t t-esc="state.dial"/>)
                                        </option>
                                        <t t-foreach="state.countries" t-as="c" t-key="c.id">
                                            <option t-att-value="c.id"
                                                    t-att-selected="c.id === u.country_id ? 'selected' : false">
                                                <t t-esc="c.name"/> (+<t t-esc="c.phone_code"/>)
                                            </option>
                                        </t>
                                    </select>
                                    <div class="input-group input-group-sm">
                                        <span class="input-group-text">+<t t-esc="u.dial"/></span>
                                        <input type="text" class="form-control"
                                               placeholder="not set"
                                               t-att-value="u.mobile"
                                               t-att-maxlength="u.mobile_length"
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
                </div>
            </div>

            <!-- ── WhatsApp sender for reset codes ──────────────────────── -->
            <div class="card mb-4" t-if="state.authorized">
                <div class="card-body">
                    <h5 class="mb-1"><i class="fa fa-whatsapp me-2 text-success"/>Password-reset sender</h5>
                    <div class="text-muted small mb-3">
                        The WhatsApp account that sends reset codes to users.
                    </div>

                    <div t-if="state.wa_state === 'connected'" class="d-flex align-items-center gap-3">
                        <span class="badge text-bg-success">Connected</span>
                        <span t-if="state.wa_phone">+<t t-esc="state.wa_phone"/></span>
                        <button class="btn btn-sm btn-outline-danger" t-on-click="waDisconnect">
                            Disconnect
                        </button>
                    </div>

                    <div t-elif="state.wa_state === 'waiting_qr'">
                        <img t-if="state.wa_qr" t-att-src="state.wa_qr"
                             style="width: 220px; height: 220px; border: 1px solid #dee2e6; border-radius: 8px;"/>
                        <div t-else="" class="text-muted">Waiting for a QR code…</div>
                        <div class="text-muted small mt-2">
                            1. Open WhatsApp on the sender phone.<br/>
                            2. Settings → Linked Devices → Link a Device.<br/>
                            3. Scan this QR code.
                        </div>
                    </div>

                    <button t-else="" class="btn btn-sm btn-primary" t-on-click="waConnect">
                        Connect a WhatsApp number
                    </button>
                </div>
            </div>

            <!-- ── Reset message template ───────────────────────────────── -->
            <div class="card" t-if="state.authorized">
                <div class="card-body">
                    <h5 class="mb-1">Reset message</h5>
                    <div class="text-muted small mb-2">
                        Sent with the code. <code>{code}</code>, <code>{name}</code>,
                        <code>{app}</code> and <code>{minutes}</code> are filled in.
                    </div>
                    <textarea class="form-control mb-2" rows="4"
                              t-att-value="state.otp_template"
                              t-on-change="(ev) => this.state.otp_template = ev.target.value"/>
                    <button class="btn btn-sm btn-primary me-2" t-on-click="saveOtpTemplate">Save</button>
                    <button class="btn btn-sm btn-link" t-on-click="resetOtpTemplate">Restore default</button>
                    <span t-if="state.savedOtp" class="text-success small ms-2">saved</span>
                </div>
            </div>
        </div>
    `;

    setup() {
        this.ROLES = ROLES;
        this.state = useState({
            loading: true,
            authorized: true,
            users: [],
            countries: [],
            dial: "",
            otp_template: "",
            otp_default: "",
            savedOtp: false,
            roleFilter: "",
            wa_state: "none",
            wa_session_id: 0,
            wa_phone: "",
            wa_qr: "",
        });
        this._waTimer = null;

        onWillStart(async () => {
            await this.load();
        });
        // A poll left running after the screen closes keeps hitting the server
        // for a QR nobody is looking at.
        onWillUnmount(() => this.stopWaPolling());
    }

    get visibleUsers() {
        const f = this.state.roleFilter;
        return f ? this.state.users.filter((u) => u.role === f) : this.state.users;
    }

    async load() {
        this.state.loading = true;
        try {
            const res = await rpc("/kpi_user_access/get", {});
            if (!res || !res.status) {
                this.state.authorized = false;
                return;
            }
            this.state.authorized = true;
            this.state.users = res.users || [];
            this.state.countries = res.countries || [];
            this.state.dial = res.dial || "";
            this.state.otp_template = res.otp_template || "";
            this.state.otp_default = res.otp_default || "";
            this.state.wa_state = res.wa_state || "none";
            this.state.wa_session_id = res.wa_session_id || 0;
            this.state.wa_phone = res.wa_phone || "";
            if (this.state.wa_state === "waiting_qr" && this.state.wa_session_id) {
                this.startWaPolling();
            }
        } finally {
            this.state.loading = false;
        }
    }

    // Brief "saved" tick beside a field. Auto-save with no feedback leaves the
    // user unsure whether anything happened.
    _flash(obj, key, value = true) {
        obj[key] = value;
        setTimeout(() => { obj[key] = false; }, 1500);
    }

    async setRole(u, ev) {
        const role = ev.target.value;
        try {
            const res = await rpc("/kpi_user_access/set_role", { user_id: u.id, role });
            if (res.status) { u.role = res.role || role; this._flash(u, "_savedRole"); }
            else { alert(res.message || "Not authorized."); ev.target.value = u.role; }
        } catch (e) {
            alert(e?.data?.message || "Failed to save.");
            ev.target.value = u.role;
        }
    }

    async setMobile(u, ev) {
        // The server strips non-digits; mirroring that here keeps what is shown
        // identical to what was stored.
        const num = (ev.target.value || "").replace(/\D/g, "");
        try {
            const res = await rpc("/kpi_user_access/set_mobile", { user_id: u.id, mobile: num });
            if (res.status) { u.mobile = res.mobile; this._flash(u, "_savedMobile"); }
            else alert(res.message || "Not authorized.");
        } catch (e) {
            alert(e?.data?.message || "Failed to save.");
        }
    }

    async setCountry(u, ev) {
        const cid = ev.target.value ? parseInt(ev.target.value, 10) : false;
        try {
            const res = await rpc("/kpi_user_access/set_country", { user_id: u.id, country_id: cid });
            if (res.status) {
                u.country_id = res.country_id || false;
                // The dial code and the digit cap both come from the country, so
                // they are refreshed together or the field would accept the
                // wrong length.
                if (res.dial !== undefined) u.dial = res.dial;
                if (res.mobile_length !== undefined) u.mobile_length = res.mobile_length;
                this._flash(u, "_savedMobile");
            } else alert(res.message || "Not authorized.");
        } catch (e) {
            alert(e?.data?.message || "Failed to save.");
        }
    }

    async toggleLogin(u) {
        const next = !u.enabled;
        try {
            const res = await rpc("/kpi_user_access/toggle_login", { user_id: u.id, enabled: next });
            if (res.status) u.enabled = next;
            else alert(res.message || "Not authorized.");
        } catch (e) {
            alert(e?.data?.message || "Failed to save.");
        }
    }

    async resetPassword(u) {
        if (!confirm(`Reset the app PIN for ${u.name}? They will have to set a new one on next sign-in.`)) {
            return;
        }
        try {
            const res = await rpc("/kpi_user_access/reset_password", { user_id: u.id });
            if (res.status) { u.has_password = true; this._flash(u, "_resetMsg", "✓ Reset to 1111"); }
            else alert(res.message || "Not authorized.");
        } catch (e) {
            alert(e?.data?.message || "Failed to reset.");
        }
    }

    async saveOtpTemplate() {
        try {
            await rpc("/kpi_user_access/set_otp_message", { template: this.state.otp_template });
            this._flash(this.state, "savedOtp");
        } catch (e) {
            alert(e?.data?.message || "Failed to save.");
        }
    }

    async resetOtpTemplate() {
        try {
            await rpc("/kpi_user_access/set_otp_message", { template: "" });
            this.state.otp_template = this.state.otp_default;
            this._flash(this.state, "savedOtp");
        } catch (e) {
            alert(e?.data?.message || "Failed to save.");
        }
    }

    // ── WhatsApp sender ──────────────────────────────────────────────────
    startWaPolling() {
        this.stopWaPolling();
        // Fast, because a WhatsApp QR expires quickly — a slow poll shows one
        // that has already gone stale.
        this._waTimer = setInterval(async () => {
            try {
                const r = await rpc("/kpi_wa_server/status", { session_id: this.state.wa_session_id });
                if (r && r.status) {
                    this.state.wa_state = r.state;
                    this.state.wa_qr = r.qr_image || "";
                    this.state.wa_phone = r.phone_number || this.state.wa_phone;
                    if (r.state === "connected") this.stopWaPolling();
                }
            } catch (e) { /* transient - the next tick tries again */ }
        }, 2000);
    }

    stopWaPolling() {
        if (this._waTimer) { clearInterval(this._waTimer); this._waTimer = null; }
    }

    async waConnect() {
        try {
            const r = await rpc("/kpi_wa_server/connect", {});
            if (r && r.status) {
                this.state.wa_session_id = r.session_id;
                this.state.wa_state = r.state || "waiting_qr";
                this.startWaPolling();
            } else alert(r?.message || "Could not start a session.");
        } catch (e) {
            alert(e?.data?.message || "Could not start a session.");
        }
    }

    async waDisconnect() {
        if (!confirm("Disconnect the reset-code sender? Password resets will stop being delivered.")) {
            return;
        }
        try {
            const r = await rpc("/kpi_wa_server/delete", { session_id: this.state.wa_session_id });
            if (r && r.status) {
                this.stopWaPolling();
                this.state.wa_state = "none";
                this.state.wa_qr = "";
                this.state.wa_phone = "";
            }
        } catch (e) {
            alert(e?.data?.message || "Failed to disconnect.");
        }
    }
}

// Registered TWICE, on purpose:
//
//  * as an action  — so "App Servers > Users" can open it as a full screen;
//  * as a view widget — so it can be embedded INSIDE the App Server form, which
//    is where it is actually wanted: the users sit at the bottom of the server
//    record, not behind a button that navigates away.
//
// Same component either way, so the two can never look different.
registry.category("actions").add("app_server_users", AppServerUsers);
registry.category("view_widgets").add("app_server_users", {
    component: AppServerUsers,
});
