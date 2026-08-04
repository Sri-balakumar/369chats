/** @odoo-module **/
// APP LOGIN > SETTINGS — the WhatsApp connection that delivers codes, the
// wording of the two messages, and the two switches that change who can get in.
//
// Changes save as you make them; there is no Save button, which is why the
// header says so. A screen that auto-saves without saying it leaves people
// hunting for a button and unsure whether their edit took.
//
// WHY THIS IS A COMPONENT
//
// The message editors are the reason. Wording is meaningless on its own —
// "{name}" and "*bold*" are not what anybody receives — so each one shows a live
// WhatsApp bubble of the real thing above the box you type in. An Odoo form
// field cannot render that, and without it an admin is editing blind.
import { Component, xml, useState, onWillStart, onWillUnmount, markup } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";

export class AppLoginSettings extends Component {
    static template = xml/* xml */`
        <div class="o_app_login_settings w-100 p-3">

            <div t-if="state.loading" class="text-muted py-5 text-center">Loading…</div>
            <div t-elif="!state.authorized" class="alert alert-warning" t-esc="state.error"/>

            <t t-else="">
            <!-- ── Header ───────────────────────────────────────────────── -->
            <div class="d-flex align-items-start justify-content-between mb-1">
                <div>
                    <h4 class="mb-1">
                        App Login <span class="text-muted fs-6">(Settings)</span>
                    </h4>
                    <div class="text-muted small">
                        The WhatsApp number that sends sign-in and sign-up codes, and what those
                        messages say. Without a connected number, no code reaches anybody.
                    </div>
                </div>
                <span class="badge text-bg-light border">Changes save automatically</span>
            </div>

            <!-- ── WhatsApp sender ──────────────────────────────────────── -->
            <div class="card mb-4" style="border-left: 4px solid #25D366;">
                <div class="card-header bg-white fw-bold">
                    <i class="fa fa-whatsapp me-2 text-success"/>Code sender (WhatsApp)
                </div>
                <div class="card-body">
                    <div class="fw-semibold mb-2">WhatsApp server that sends the codes</div>

                    <t t-if="state.wa.state === 'connected'">
                        <div class="d-flex align-items-center gap-3 flex-wrap">
                            <span class="badge bg-success fs-6">
                                <i class="fa fa-check-circle me-1"/>Connected<t t-if="state.wa.phone">: +<t t-esc="state.wa.phone"/></t>
                            </span>
                            <button class="btn btn-outline-danger btn-sm"
                                    t-att-disabled="state.wa.busy"
                                    t-on-click="() => this.waDelete()">Disconnect</button>
                        </div>
                    </t>

                    <t t-elif="state.wa.state === 'waiting_qr'">
                        <div class="d-flex gap-4 flex-wrap">
                            <div>
                                <!-- The route returns BARE base64 and says so, so
                                     the data: prefix belongs here. Binding the raw
                                     value to src renders nothing — which is what
                                     the older copy of this screen in
                                     app_server_config_kpi does. -->
                                <img t-if="state.wa.qr"
                                     t-att-src="'data:image/png;base64,' + state.wa.qr"
                                     style="width:220px; height:220px; display:block; border:1px solid #dee2e6; border-radius:8px;"
                                     alt="WhatsApp QR"/>
                                <div t-else=""
                                     style="width:220px; height:220px; display:flex; align-items:center; justify-content:center; border:1px solid #dee2e6; border-radius:8px;"
                                     class="text-muted">Generating QR…</div>
                            </div>
                            <div>
                                <ol class="text-muted small mb-2">
                                    <li>Open WhatsApp on the sender phone.</li>
                                    <li>Settings → Linked Devices → Link a Device.</li>
                                    <li>Scan this QR code.</li>
                                </ol>
                                <button class="btn btn-sm btn-link text-danger px-0"
                                        t-att-disabled="state.wa.busy"
                                        t-on-click="() => this.waDelete()">Cancel</button>
                            </div>
                        </div>
                    </t>

                    <t t-else="">
                        <button class="btn btn-success" t-att-disabled="state.wa.busy"
                                t-on-click="() => this.waConnect()">
                            <i class="fa fa-whatsapp me-1"/>Connect a new WhatsApp server
                        </button>
                        <div class="text-muted small mt-2">
                            Connect the WhatsApp number that will send codes to users.
                        </div>
                    </t>

                    <div t-if="state.wa.error"
                         class="alert alert-warning py-1 px-2 mt-2 mb-0 small" t-esc="state.wa.error"/>

                    <!-- One connection per database, shared with anything else
                         that sends WhatsApp. Cheaper to say than to discover by
                         breaking it. -->
                    <div class="text-muted small mt-3">
                        <i class="fa fa-info-circle me-1"/>There is one WhatsApp connection per
                        database. Connecting or disconnecting here affects every module that sends
                        WhatsApp messages, not just app login.
                    </div>
                </div>
            </div>

            <!-- ── Message wording ──────────────────────────────────────── -->
            <t t-foreach="TEMPLATES" t-as="tpl" t-key="tpl.kind">
                <div class="card mb-4">
                    <div class="card-body">
                        <div class="d-flex align-items-center justify-content-between mb-1">
                            <label class="form-label fw-semibold mb-0" t-esc="tpl.label"/>
                            <button class="btn btn-sm btn-outline-secondary"
                                    t-on-click="() => this.resetTemplate(tpl.kind)">
                                <i class="fa fa-undo me-1"/>Reset to default
                            </button>
                        </div>

                        <small class="text-muted d-block mb-1">
                            <i class="fa fa-whatsapp me-1 text-success"/>Preview — exactly what they receive:
                        </small>
                        <div style="background:#dcf8c6; border-radius:12px; padding:12px 14px; max-width:440px; white-space:pre-wrap; font-size:14px; line-height:1.5; box-shadow:0 1px 2px rgba(0,0,0,0.12); color:#111;"
                             t-out="state.previews[tpl.kind]"/>

                        <label class="form-label text-muted small mt-3 mb-1 d-block">Edit the wording:</label>
                        <textarea class="form-control" rows="8" style="font-family: inherit;"
                                  t-att-value="state.templates[tpl.kind]"
                                  t-on-input="(ev) => this.onTemplateInput(tpl.kind, ev)"
                                  t-on-change="(ev) => this.saveTemplate(tpl.kind, ev)"/>
                        <small class="text-muted d-block mt-1">
                            <t t-esc="tpl.hint"/> Wrap words in *stars* for bold — the preview above
                            shows exactly what they'll get.
                            <span t-if="state.savedTpl[tpl.kind]" class="text-success">✓ Saved</span>
                        </small>
                    </div>
                </div>
            </t>

            <!-- ── Switches ─────────────────────────────────────────────── -->
            <div class="card mb-4">
                <div class="card-body">
                    <div class="form-check form-switch mb-1">
                        <input class="form-check-input" type="checkbox" id="app_login_signup"
                               t-att-checked="state.signup_enabled ? 'checked' : false"
                               t-on-change="() => this.setFlag('signup_enabled')"/>
                        <label class="form-check-label fw-semibold" for="app_login_signup">
                            Allow self sign-up
                        </label>
                    </div>
                    <div class="text-muted small">
                        When on, someone whose number is not registered can create their own account
                        with a WhatsApp code. When off, they are told to contact an admin and nothing
                        is sent.
                    </div>
                    <div t-if="state.signup_enabled" class="alert alert-warning py-2 mt-2 mb-0 small">
                        <b>Self sign-up is on.</b> Anyone who can reach this server can create a real
                        Odoo user by entering a phone number and the code sent to it — each one gets
                        backend access and, on Odoo Enterprise, a licence seat. Every attempt also
                        sends a WhatsApp message to a number nobody has verified, which is how a
                        sender gets itself banned. Switch it on to onboard people, then switch it
                        off, and check <b>Sign-Ups</b> for who came in.
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-body">
                    <div class="form-check form-switch mb-1">
                        <input class="form-check-input" type="checkbox" id="app_login_dev"
                               t-att-checked="state.dev_autofill ? 'checked' : false"
                               t-on-change="() => this.setFlag('dev_autofill')"/>
                        <label class="form-check-label fw-semibold text-danger" for="app_login_dev">
                            Developer auto-fill (insecure)
                        </label>
                    </div>
                    <div class="text-muted small">
                        Testing only. Returns the one-time code in the API response so the app can
                        fill it in without WhatsApp.
                    </div>
                    <div t-if="state.dev_autofill" class="alert alert-danger py-2 mt-2 mb-0 small">
                        <b>The login is not secure while this is on.</b> Codes are being returned in
                        API responses, so there is no longer a private channel — anyone who can reach
                        this server can sign in as anyone. Turn it off.
                    </div>
                </div>
            </div>
            </t>
        </div>
    `;

    setup() {
        this.TEMPLATES = [
            {
                kind: "login",
                label: "Sign-in code message (WhatsApp)",
                hint: "Sent to someone who already has an account. Their name, their code and the " +
                      "number of minutes are filled in automatically.",
            },
            {
                kind: "signup",
                label: "Sign-up code message (WhatsApp)",
                hint: "Sent to a number creating a new account. There is no name here — nobody has " +
                      "given one at that point.",
            },
        ];
        this.state = useState({
            loading: true,
            authorized: true,
            error: "",
            app_name: "the app",
            otp_minutes: 5,
            templates: { login: "", signup: "" },
            previews: { login: "", signup: "" },
            savedTpl: { login: false, signup: false },
            signup_enabled: false,
            dev_autofill: false,
            wa: { state: "none", session_id: 0, phone: "", qr: "", error: "", busy: false },
        });
        this._waTimer = null;

        onWillStart(async () => { await this.load(); });
        // A poll left running after the screen closes keeps asking for a QR
        // nobody is looking at.
        onWillUnmount(() => this.stopWaPolling());
    }

    async load() {
        this.state.loading = true;
        try {
            const res = await rpc("/app_login/admin/settings", {});
            if (!res || !res.status) {
                this.state.authorized = false;
                this.state.error = res?.message || "Not authorized.";
                return;
            }
            this.state.authorized = true;
            this.state.app_name = res.app_name || "the app";
            this.state.otp_minutes = res.otp_minutes || 5;
            this.state.templates = res.templates || { login: "", signup: "" };
            this.state.signup_enabled = !!res.signup_enabled;
            this.state.dev_autofill = !!res.dev_autofill;
            for (const kind of ["login", "signup"]) {
                this.state.previews[kind] = this.renderPreview(this.state.templates[kind]);
            }
            Object.assign(this.state.wa, res.wa || {});
            if (this.state.wa.state === "waiting_qr") this.startWaPolling();
        } finally {
            this.state.loading = false;
        }
    }

    _flash(obj, key, value = true) {
        obj[key] = value;
        setTimeout(() => { obj[key] = false; }, 1500);
    }

    // ── Message wording ──────────────────────────────────────────────────
    renderPreview(text) {
        let s = (text || "")
            .split("{name}").join("Aarav Sharma")
            .split("{code}").join("482106")
            .split("{minutes}").join(String(this.state.otp_minutes || 5))
            .split("{app}").join(this.state.app_name || "the app");
        // ESCAPE FIRST, then introduce <b>. The order is load-bearing: this goes
        // through markup() into t-out, so escaping afterwards would strip the
        // tags we just added, and not escaping at all would let anyone editing
        // the wording put live HTML onto this page.
        s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        s = s.replace(/\*([^*\n]+)\*/g, "<b>$1</b>");
        return markup(s);
    }

    onTemplateInput(kind, ev) {
        this.state.templates[kind] = ev.target.value;
        this.state.previews[kind] = this.renderPreview(ev.target.value);
    }

    async _saveTemplate(kind, template) {
        try {
            const res = await rpc("/app_login/admin/set_template", { kind, template });
            if (res.status) {
                this.state.templates[kind] = res.template;
                this.state.previews[kind] = this.renderPreview(res.template);
                this._flash(this.state.savedTpl, kind);
            } else alert(res.message || "Not authorized.");
        } catch (e) {
            alert(e?.data?.message || e?.message || "Failed to save.");
        }
    }

    saveTemplate(kind, ev) { return this._saveTemplate(kind, ev.target.value); }

    // Empty restores the built-in wording rather than writing it in, so the
    // default can be improved later and everyone who never customised it gets
    // the improvement.
    resetTemplate(kind) { return this._saveTemplate(kind, ""); }

    // ── Switches ─────────────────────────────────────────────────────────
    async setFlag(flag) {
        const next = !this.state[flag];
        if (flag === "dev_autofill" && next &&
            !confirm("Turn on developer auto-fill?\n\nOne-time codes will be returned in API responses, so anyone who can reach this server can sign in as anyone. Use it for testing only, and turn it off afterwards.")) {
            // Put the checkbox back — the DOM already flipped it.
            this.state[flag] = false;
            await this.load();
            return;
        }
        try {
            const res = await rpc("/app_login/admin/set_flag", { flag, value: next });
            if (res.status) this.state[flag] = res.value;
            else { alert(res.message || "Not authorized."); await this.load(); }
        } catch (e) {
            alert(e?.data?.message || e?.message || "Failed to save.");
            await this.load();
        }
    }

    // ── WhatsApp sender ──────────────────────────────────────────────────
    startWaPolling() {
        this.stopWaPolling();
        // Fast, because a WhatsApp QR expires quickly and a slow poll shows one
        // that has already gone stale.
        this._waTimer = setInterval(async () => {
            try {
                const r = await rpc("/app_login/admin/wa/status",
                    { session_id: this.state.wa.session_id });
                if (r && r.status) {
                    this.state.wa.state = r.state;
                    this.state.wa.qr = r.qr_image || "";
                    this.state.wa.phone = r.phone_number || this.state.wa.phone;
                    this.state.wa.error = r.error || "";
                    if (r.state === "connected" || r.state === "none") this.stopWaPolling();
                }
            } catch (e) { /* transient — the next tick tries again */ }
        }, 2000);
    }

    stopWaPolling() {
        if (this._waTimer) { clearInterval(this._waTimer); this._waTimer = null; }
    }

    async waConnect() {
        this.state.wa.busy = true;
        this.state.wa.error = "";
        this.state.wa.qr = "";
        try {
            const r = await rpc("/app_login/admin/wa/connect", {});
            if (r && r.status) {
                this.state.wa.session_id = r.session_id;
                this.state.wa.state = r.state || "waiting_qr";
                this.startWaPolling();
            } else {
                this.state.wa.error = r?.message
                    || "Could not start. Check the WhatsApp library is installed on the server.";
            }
        } catch (e) {
            this.state.wa.error = e?.data?.message || e?.message || "Failed to connect.";
        } finally {
            this.state.wa.busy = false;
        }
    }

    async waDelete() {
        if (!confirm("Disconnect the WhatsApp sender?\n\nSign-in and sign-up codes stop being delivered until a number is connected again — for every module that sends WhatsApp on this database, not just app login.")) {
            return;
        }
        this.state.wa.busy = true;
        this.state.wa.error = "";
        try {
            const r = await rpc("/app_login/admin/wa/delete",
                { session_id: this.state.wa.session_id });
            if (r && r.status) {
                this.stopWaPolling();
                Object.assign(this.state.wa, { state: "none", session_id: 0, phone: "", qr: "" });
            } else {
                this.state.wa.error = r?.message || "Could not disconnect.";
            }
        } catch (e) {
            this.state.wa.error = e?.data?.message || e?.message || "Failed to disconnect.";
        } finally {
            this.state.wa.busy = false;
        }
    }
}

registry.category("actions").add("app_login_settings", AppLoginSettings);
