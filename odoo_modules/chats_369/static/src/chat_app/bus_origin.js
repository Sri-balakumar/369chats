/**
 * Point ONLY the bus websocket at Odoo's evented port.
 *
 * THE PROBLEM
 * Odoo does not serve /websocket from the normal HTTP port. It is served by the
 * evented (gevent) process on `gevent_port`, and the standard deployment hides
 * that behind a reverse proxy forwarding /websocket across. This install has no
 * proxy, so the browser dialled the HTTP port, got 404, and the bus never
 * connected. That is silent: chat_app polls every 6s as a safety net, so the web
 * client looked healthy while having no realtime at all. Calls were the visible
 * casualty — every call_* event is bus-only, so the callee simply never rang.
 *
 * WHY NOT JUST OVERRIDE bus.parameters.serverURL
 * That was the first attempt and it is wrong. `serverURL` feeds TWO things:
 * the websocket URL *and* the SharedWorker bundle URL (worker_service.js:24).
 * Moving it wholesale made the browser fetch /bus/websocket_worker_bundle from
 * the evented port too — and because a cross-origin serverURL is loaded through a
 * `data:` URL worker (worker_service.js:25-32), that fetch carries NO cookies.
 * With nine databases and an empty dbfilter, Odoo cannot resolve a database
 * without a session, so the bundle 404s and the bus never starts at all.
 *
 * THE FIX
 * Leave `serverURL` alone, so the worker bundle keeps loading from the page's own
 * origin with its session cookie. Rewrite only the `websocketURL` in the
 * BUS:INITIALIZE_CONNECTION payload. A WebSocket handshake DOES send cookies —
 * they are scoped per host and ignore the port — so the socket authenticates
 * against the evented port normally.
 *
 * `chats_369_ws_origin` comes from session_info (models/ir_http.py) and is empty
 * when a proxy is present or the origin cannot be derived; we then change nothing,
 * so putting a proxy in front later needs no edit here.
 */
import { patch } from "@web/core/utils/patch";
import { session } from "@web/session";
import { WorkerService } from "@bus/services/worker_service";

const origin = ((session && session.chats_369_ws_origin) || "").replace(/\/+$/, "");

if (origin) {
    const wsBase = origin.replace(/^http/i, "ws");

    patch(WorkerService.prototype, {
        send(type, payload) {
            if (type === "BUS:INITIALIZE_CONNECTION" && payload && payload.websocketURL) {
                // Keep the path and query (?version=...) — the server rejects a
                // handshake whose worker version it does not recognise.
                const tail = String(payload.websocketURL).replace(/^wss?:\/\/[^/]+/i, "");
                payload = { ...payload, websocketURL: wsBase + tail };
            }
            return super.send(type, payload);
        },
    });
}
