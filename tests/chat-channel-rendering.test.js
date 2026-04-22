import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const htmlPath = path.resolve(import.meta.dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

describe('Chat channel rendering hooks', () => {
  it('renders explicit unread-row and divider hooks for chat messages', () => {
    expect(html).toContain('chat-post-unread');
    expect(html).toContain('chat-post-divider');
  });

  it('keeps the load-more control wired to the shared visibility getter', () => {
    expect(html).toContain('showMainFeedLoadMoreControl');
  });

  it('keeps focus and unread styling on the same chat row binding', () => {
    expect(html).toMatch(/chat-post-focused[\s\S]*chat-post-unread/);
  });

  it('adds dispatch-to-flow actions to every chat message surface', () => {
    const matches = html.match(/Dispatch to flow/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("openChatThreadFlowDispatch(msg.record_id, 'main_feed')");
    expect(html).toContain("openChatThreadFlowDispatch($store.chat.getThreadParentMessage()?.record_id, 'thread_parent')");
    expect(html).toContain("openChatThreadFlowDispatch(reply.record_id, 'thread_reply')");
  });

  it('renders the dedicated chat-thread dispatch modal hooks', () => {
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-modal"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-flow-select"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-preview"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-submit"');
  });
});
