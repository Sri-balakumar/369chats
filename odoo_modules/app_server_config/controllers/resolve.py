import logging

from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)


class AppServerResolve(http.Controller):
    """The one endpoint a freshly installed app can call.

    `auth='public'` is not a choice — the device asking has never logged in and
    has no session. It is also why this endpoint accepts as little as possible.
    """

    @http.route('/app/resolve', type='json', auth='public', methods=['POST'], csrf=False)
    def app_resolve(self, **params):
        """Given an app key, answer with the URL and database it should use.

        Takes NO mobile number, and must not grow one. Every user of a given app
        resolves to the same server, so a number would add nothing — while
        turning this into an oracle for "is this number registered?", which is
        exactly the probe an unauthenticated endpoint should not offer.

        Unknown keys get a flat refusal with no detail: whether a particular app
        key exists is not something a stranger needs to learn.
        """
        app_key = (params.get('app') or '').strip()
        if not app_key:
            return {'status': False, 'error': 'Missing app key.'}

        # Only the DATABASE falls back to this request's own. The URL does not:
        # a blank Client URL is an admin switching the app off, not a gap to
        # paper over. See _resolve.
        fallback_db = request.db or ''

        cfg = request.env['app.server.config'].sudo()._resolve(
            app_key, fallback_db=fallback_db)

        if not cfg or not cfg.get('url'):
            _logger.info("app/resolve: no configuration for app_key=%r", app_key)
            # `configured: False` distinguishes "the admin has switched this off"
            # from "I could not reach the server at all". The app treats them
            # differently: the first clears the stored server, the second keeps
            # the last known one so a network blip does not strand a device.
            return {
                'status': False,
                'configured': False,
                'error': 'This app is not configured on this server.',
            }

        return {'status': True, 'url': cfg['url'], 'db': cfg['db']}
