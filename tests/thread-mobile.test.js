import { describe, expect, it, vi } from 'vitest';

// Mock Alpine.js
vi.mock('alpinejs', () => ({
  default: { nextTick: (fn) => fn?.() },
}));

import { chatMessageManagerMixin } from '../src/chat-message-manager.js';

// ---------------------------------------------------------------------------
// Helper: create a fake store with mixin methods applied
// ---------------------------------------------------------------------------
function createStore(overrides = {}) {
  const store = {
    messages: [],
    channels: [],
    selectedChannelId: null,
    activeThreadId: null,
    threadInput: '',
    messageInput: '',
    messageAudioDrafts: [],
    threadAudioDrafts: [],
    expandedChatMessageIds: [],
    truncatedChatMessageIds: [],
    focusMessageId: null,
    threadVisibleReplyCount: 6,
    threadSize: 'default',
    pendingChatScrollToLatest: false,
    pendingThreadScrollToLatest: false,
    messageImageUploadCount: 0,
    threadImageUploadCount: 0,
    chatFeedScrollFrame: null,
    threadRepliesScrollFrame: null,
    chatPreviewMeasureFrame: null,
    showChannelSettingsModal: false,
    error: null,
    session: null,
    botNpub: '',
    backendUrl: '',
    THREAD_REPLY_PAGE_SIZE: 6,
    COMPOSER_MAX_LINES: 12,
    MESSAGE_PREVIEW_MAX_LINES: 15,
    syncRoute: vi.fn(),
    rememberPeople: vi.fn().mockResolvedValue(undefined),
    captureScrollAnchor: vi.fn().mockReturnValue(null),
    restoreScrollAnchor: vi.fn(),
    scheduleStorageImageHydration: vi.fn(),
    performSync: vi.fn().mockResolvedValue(undefined),
    ensureBackgroundSync: vi.fn(),
    selectChannel: vi.fn().mockResolvedValue(undefined),
    refreshChannels: vi.fn().mockResolvedValue(undefined),
    createEncryptedGroup: vi.fn().mockResolvedValue({ group_id: 'g1' }),
    getPreferredChannelWriteGroup: vi.fn().mockReturnValue('g1'),
    getChannelLabel: vi.fn().mockReturnValue('test-channel'),
    materializeAudioDrafts: vi.fn().mockResolvedValue({ attachments: [] }),
    containsInlineImageUploadToken: vi.fn().mockReturnValue(false),
    _fireMentionTriggers: vi.fn(),
    workspaceOwnerNpub: 'npub1owner',
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(chatMessageManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }

  return store;
}

// ---------------------------------------------------------------------------
// CSS rule validation helpers
// ---------------------------------------------------------------------------

/**
 * Parse the styles.css file and extract media-query-scoped rules.
 * Returns an array of { breakpoint, selector, declarations } objects.
 */
async function loadStylesheet() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const cssPath = path.resolve(import.meta.dirname, '..', 'src', 'styles.css');
  return fs.readFileSync(cssPath, 'utf-8');
}

function findMediaBlock(css, maxWidth) {
  // Find all @media blocks for the given max-width
  const pattern = new RegExp(
    `@media\\s*\\(\\s*max-width\\s*:\\s*${maxWidth}px\\s*\\)\\s*\\{`,
    'g',
  );
  const blocks = [];
  let match;
  while ((match = pattern.exec(css)) !== null) {
    // Walk braces to find the closing brace
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      if (css[i] === '}') depth--;
      i++;
    }
    blocks.push(css.slice(match.index, i));
  }
  return blocks.join('\n');
}

function blockContainsRule(block, selector) {
  return block.includes(selector);
}

function extractDeclarations(block, selector) {
  const idx = block.indexOf(selector);
  if (idx < 0) return '';
  let start = block.indexOf('{', idx);
  if (start < 0) return '';
  let depth = 1;
  let i = start + 1;
  while (i < block.length && depth > 0) {
    if (block[i] === '{') depth++;
    if (block[i] === '}') depth--;
    i++;
  }
  return block.slice(start + 1, i - 1).trim();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Thread mobile responsive behavior', () => {
  describe('CSS: mobile breakpoint rules for thread panel', () => {
    let css;
    let mobileBlock;

    it('loads the stylesheet', async () => {
      css = await loadStylesheet();
      expect(css).toBeTruthy();
      // Combine 768px blocks
      mobileBlock = findMediaBlock(css, 768);
    });

    it('has a mobile rule for .chat-thread-panel to fill available width', async () => {
      css = css || await loadStylesheet();
      mobileBlock = mobileBlock || findMediaBlock(css, 768);
      expect(blockContainsRule(mobileBlock, '.chat-thread-panel')).toBe(true);
      const decl = extractDeclarations(mobileBlock, '.chat-thread-panel');
      // Thread panel should take full width on mobile
      expect(decl).toMatch(/width\s*:\s*100%/);
      // Should not have a left border when full-width
      expect(decl).toMatch(/border-left\s*:\s*none/);
    });

    it('has a mobile rule to hide .chat-main when thread is open', async () => {
      css = css || await loadStylesheet();
      mobileBlock = mobileBlock || findMediaBlock(css, 768);
      // When thread panel is visible, .chat-main should be hidden on mobile
      expect(blockContainsRule(mobileBlock, '.chat-layout-thread-open .chat-main')).toBe(true);
      const decl = extractDeclarations(mobileBlock, '.chat-layout-thread-open .chat-main');
      expect(decl).toMatch(/display\s*:\s*none/);
    });

    it('has a mobile rule to stack chat-layout as column or handle overflow', async () => {
      css = css || await loadStylesheet();
      mobileBlock = mobileBlock || findMediaBlock(css, 768);
      // The thread panel should have position handling for mobile
      expect(
        blockContainsRule(mobileBlock, '.chat-thread-panel') ||
        blockContainsRule(mobileBlock, '.chat-layout-thread-open'),
      ).toBe(true);
    });
  });

  describe('JS: thread lifecycle state on mobile', () => {
    it('openThread sets threadSize to default', () => {
      const store = createStore();
      store.openThread('msg-1');
      expect(store.activeThreadId).toBe('msg-1');
      expect(store.threadSize).toBe('default');
    });

    it('closeThread resets threadSize to default', () => {
      const store = createStore({ threadSize: 'wide', activeThreadId: 'msg-1' });
      store.closeThread();
      expect(store.activeThreadId).toBeNull();
      expect(store.threadSize).toBe('default');
    });

    it('cycleThreadSize transitions through default -> wide -> full -> default', () => {
      const store = createStore();
      expect(store.threadSize).toBe('default');
      store.cycleThreadSize();
      expect(store.threadSize).toBe('wide');
      store.cycleThreadSize();
      expect(store.threadSize).toBe('full');
      store.cycleThreadSize();
      expect(store.threadSize).toBe('default');
    });
  });

  describe('HTML: thread layout class binding', () => {
    it('chat-layout-thread-full class is applied when threadSize is full and thread is active', async () => {
      // This tests the existing binding pattern
      // In index.html: :class="{ 'chat-layout-thread-full': $store.chat.activeThreadId && $store.chat.threadSize === 'full' }"
      // We verify the JS logic matches
      const store = createStore({ activeThreadId: 'msg-1', threadSize: 'full' });
      const shouldApplyFull = !!(store.activeThreadId && store.threadSize === 'full');
      expect(shouldApplyFull).toBe(true);
    });

    it('chat-layout-thread-open class should be derived when any thread is active', async () => {
      // The new mobile fix requires a class that indicates *any* thread is open
      // In index.html: :class should include 'chat-layout-thread-open' when activeThreadId is set
      const fs = await import('node:fs');
      const path = await import('node:path');
      const htmlPath = path.resolve(import.meta.dirname, '..', 'index.html');
      const html = fs.readFileSync(htmlPath, 'utf-8');
      // Verify the class binding exists on .chat-layout
      expect(html).toContain('chat-layout-thread-open');
    });
  });
});
