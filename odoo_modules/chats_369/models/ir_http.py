"""Tell the web client where the websocket actually lives.

Odoo does not serve /websocket from the normal HTTP port. It is served by the
*evented* (gevent) process on `gevent_port`, and the standard deployment hides
that behind a reverse proxy which forwards /websocket across. This install has no
proxy, so `bus.parameters` — which defaults to `window.origin` — points the
browser at the HTTP port, where /websocket returns 404 and the bus never connects.

The symptom is nasty: everything else works, so the web client looks healthy while
being silently non-realtime. Calls are the visible casualty, because every
`call_*` event is bus-only and nothing else can carry them.

So publish the real websocket origin in session_info and let the client patch
`bus.parameters` with it (see static/src/chat_app/bus_origin.js). Sent by the
server because the port is deployment config; a hardcoded client is a client that
breaks the day a proxy IS put in front.

If a proxy is ever added, drop `chats_369.gevent_url` back to an empty
ir.config_parameter and the client falls back to window.origin on its own.
"""

from odoo import api, models
from odoo.tools import config


class IrHttp(models.AbstractModel):
    _inherit = "ir.http"

    @api.model
    def _chats_369_ws_origin(self):
        """Origin the websocket should be opened against, or '' to use the page's.

        An explicit `chats_369.gevent_url` override wins, so a proxied or
        differently-hosted deployment can point this anywhere without a code
        change. Otherwise derive it from the request host + the configured
        gevent_port.
        """
        from odoo.http import request
        param = self.env['ir.config_parameter'].sudo().get_param('chats_369.gevent_url')
        if param:
            return param.rstrip('/')
        if not request:
            return ''
        port = config.get('gevent_port') or 8072
        host = (request.httprequest.host or '').split(':')[0]
        if not host:
            return ''
        return '%s://%s:%s' % (request.httprequest.scheme, host, port)

    def session_info(self):
        info = super().session_info()
        info['chats_369_ws_origin'] = self._chats_369_ws_origin()
        return info

    @api.model
    def get_frontend_session_info(self):
        info = super().get_frontend_session_info()
        info['chats_369_ws_origin'] = self._chats_369_ws_origin()
        return info
