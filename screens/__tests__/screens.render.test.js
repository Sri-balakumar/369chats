// Render smoke test for the two big chat screens.
//
// components/ui/__tests__/modules.test.js only require()s each module, which
// catches a bad symbol at MODULE-EVALUATION time (a stray Platform.OS inside a
// StyleSheet.create block). It cannot catch the same mistake inside the render
// tree — JSX only dereferences a component identifier when the element is
// constructed. That is how `ScrollView` went missing from ChatListScreen's
// react-native import and took the whole chat list down on device while both
// `npx jest` and `npx expo export` stayed green.
//
// Rendering each screen once closes that gap. The services are mocked because
// the point is that the tree BUILDS, not what the server returns.
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

// Every screen call resolves to something harmless. The shapes that get spread,
// mapped or destructured on mount are spelled out; anything else falls through
// to a generic resolved-{} stub so a newly-used export never fails the test for
// the wrong reason.
jest.mock('../../services/chat', () => {
  const arr = () => jest.fn(() => Promise.resolve([]));
  const base = {
    fetchConversations: jest.fn(() => Promise.resolve({ conversations: [] })),
    fetchLists: arr(),
    fetchMessages: arr(),
    fetchMessagesAround: arr(),
    fetchPinned: arr(),
    searchAll: arr(),
    searchMessages: arr(),
    gmeetStatus: jest.fn(() => Promise.resolve({
      connected: false, hasCreds: false, isAdmin: true,
      triggers: [], scope: 'both', adminOnly: true,
      clientId: '', baseUrl: '', redirectUri: 'http://odoo.test/chat/gmeet/oauth/callback',
    })),
    // Sync helpers. The Proxy below assumes async, so anything that returns a
    // plain value has to be listed here — a Promise rendered inside <Text>
    // throws, which is how this was found.
    gmeetRedirectUri: jest.fn((base, fallback) => fallback || ''),
    gmeetOauthStartUrl: jest.fn((url) => `${url}/chat/gmeet/oauth/start`),
    invalidateGmeetStatus: jest.fn(),
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop === '__esModule') return true;
      if (!(prop in target)) target[prop] = jest.fn(() => Promise.resolve({}));
      return target[prop];
    },
  });
});

jest.mock('../../services/chatRealtime', () => ({
  __esModule: true,
  default: {
    start: jest.fn(),
    stop: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),   // returns the unsubscribe fn
    setActiveConversation: jest.fn(),
    noteMessageId: jest.fn(),
  },
}));

jest.mock('../../services/notifications', () => ({
  __esModule: true,
  fetchUnreadCount: jest.fn(() => Promise.resolve(0)),
}));

const chat = require('../../services/chat');
const ChatListScreen = require('../ChatListScreen').default;
const ChatThreadScreen = require('../ChatThreadScreen').default;
const GmeetSettingsScreen = require('../GmeetSettingsScreen').default;

const noop = () => {};

describe('screen render smoke', () => {
  it('ChatListScreen mounts and reaches the server', async () => {
    render(
      <ChatListScreen
        onOpenChat={noop}
        onNewChat={noop}
        onOpenSearch={noop}
        onOpenStarred={noop}
        onOpenSettings={noop}
        onOpenNotifications={noop}
        onOpenAdmin={noop}
        onOpenGmeet={noop}
        onLogout={noop}
        onOpenHit={noop}
      />,
    );
    // The modals (and their ScrollViews) are built on every render, so getting
    // this far already proves the tree constructs.
    await waitFor(() => expect(chat.fetchConversations).toHaveBeenCalled());
    expect(chat.fetchLists).toHaveBeenCalled();
  });

  it('ChatThreadScreen mounts and reaches the server', async () => {
    render(
      <ChatThreadScreen
        conversation={{ id: 1, title: 'Test chat', isGroup: false, avatarUrl: '' }}
        onBack={noop}
        onOpenInfo={noop}
        onOpenSearch={noop}
        onOpenMedia={noop}
        onOpenStarred={noop}
        onOpenGmeet={noop}
      />,
    );
    await waitFor(() => expect(chat.fetchMessages).toHaveBeenCalled());
  });

  it('GmeetSettingsScreen mounts and reads status', async () => {
    const { findByText } = render(<GmeetSettingsScreen onBack={noop} />);
    await waitFor(() => expect(chat.gmeetStatus).toHaveBeenCalled());
    // The mock reports a disconnected workspace, so the pill must say so.
    expect(await findByText('Not connected')).toBeTruthy();
  });
});
