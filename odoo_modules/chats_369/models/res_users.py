"""res.users — 369Chats presence + privacy.

`chat_last_seen` is stamped on every poll/heartbeat while the chat is open; the
controller derives online (< window) / last-seen from it, honouring the per-user
privacy settings and WhatsApp's reciprocity rule (hide yours -> can't see others').
"""
from datetime import timedelta

from odoo import fields, models

# How long after chat_last_seen a user still counts as "online".
#
# Defined HERE, on the model that owns the field, and imported by the controller —
# it used to be a bare literal in chat_api.py, and _chat_mark_away() below has to
# agree with it exactly. Two copies of this number would drift and the failure
# would be subtle: someone marked away would quietly still read as online.
CHAT_ONLINE_WINDOW = 45


class ResUsers(models.Model):
    _inherit = 'res.users'

    chat_last_seen = fields.Datetime(string='369Chats Last Seen')
    chat_last_seen_privacy = fields.Selection(
        [('everyone', 'Everyone'), ('contacts', 'My contacts'), ('nobody', 'Nobody')],
        string='Last Seen Visible To', default='everyone', required=True)
    chat_online_privacy = fields.Selection(
        [('everyone', 'Everyone'), ('same', 'Same as last seen')],
        string='Online Visible To', default='everyone', required=True)
    # Profile + settings (WhatsApp-style, office-lean)
    chat_about = fields.Char(string='369Chats About', default='Available')
    chat_read_receipts = fields.Boolean(string='Send Read Receipts', default=True)
    chat_notif_messages = fields.Boolean(string='Notify Direct Messages', default=True)
    chat_notif_groups = fields.Boolean(string='Notify Group Messages', default=True)
    chat_notif_sound = fields.Boolean(string='Notification Sound', default=True)
    chat_notif_preview = fields.Boolean(string='Notification Preview', default=True)
    # WhatsApp's "Keep chats archived". ON (the default) means an archived chat
    # STAYS archived when a new message arrives. Turning it off restores the
    # older behaviour where any new message pulls the chat back into the main
    # list — see _chat_unarchive_for, called when a message is delivered.
    chat_keep_archived = fields.Boolean(string='Keep Chats Archived', default=True)
    # Where the "Archived" entry sits in the chat list. Top by default, which is
    # where it is easiest to find; bottom keeps it out of the way once the
    # archive is something you rarely open. Stored per user rather than per
    # device so the app and the web agree.
    chat_archive_at_bottom = fields.Boolean(string='Archived Row At Bottom', default=False)
    # People I have blocked (they can't message me and I can't message them).
    chat_blocked_user_ids = fields.Many2many(
        'res.users', 'chat_block_rel', 'blocker_id', 'blocked_id',
        string='369Chats Blocked Users')

    def _chat_touch_presence(self):
        """Mark the caller active right now (cheap; called from poll/heartbeat)."""
        if self:
            self.sudo().write({'chat_last_seen': fields.Datetime.now()})

    def _chat_mark_away(self):
        """Mark the caller as gone RIGHT NOW rather than waiting out the window.

        Presence is "seen within _ONLINE_WINDOW seconds", so on its own it can only
        lapse: when someone closes the tab or backgrounds the app the server simply
        stops hearing from them and keeps showing them online until the window
        expires. That is up to 45s of lying, which is very visible to the person
        watching.

        Clients call this when they know they are leaving. Backdating past the
        window (rather than clearing the field) keeps `last seen` meaningful — it
        still reads "last seen just now", it just no longer counts as online."""
        if self:
            gone = fields.Datetime.now() - timedelta(seconds=CHAT_ONLINE_WINDOW + 5)
            self.sudo().write({'chat_last_seen': gone})
