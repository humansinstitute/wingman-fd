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

  it('adds Get it done actions to every chat message surface', () => {
    const matches = html.match(/Get it done/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('data-chat-get-it-done="true"');
    expect(html).toContain('data-source-surface="main_feed"');
    expect(html).toContain('data-source-surface="thread_parent"');
    expect(html).toContain('data-source-surface="thread_reply"');
  });

  it('renders the chat Get it done modal hooks', () => {
    expect(html).toContain('data-testid="chat-get-it-done-modal"');
    expect(html).toContain('data-testid="chat-get-it-done-title"');
    expect(html).toContain('data-testid="chat-get-it-done-assignee"');
    expect(html).toContain('chatGetItDoneAssigneeSuggestions');
    expect(html).toContain('selectChatGetItDoneAssignee');
    expect(html).toContain('data-testid="chat-get-it-done-output-type"');
    expect(html).toContain('data-testid="chat-get-it-done-scope"');
    expect(html).toContain('chatGetItDoneScopeSuggestions');
    expect(html).toContain('selectChatGetItDoneScope');
    expect(html).toContain('data-testid="chat-get-it-done-submit"');
  });

  it('renders the dedicated chat-thread dispatch modal hooks', () => {
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-modal"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-flow-select"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-scope-select"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-launch-notes"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-preview"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-regenerate"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-stale-warning"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-submit"');
    expect(html).toContain('<dt>Clicked message</dt>');
    expect(html).toContain('<dt>Canonical thread</dt>');
    expect(html).toContain('<dt>Thread messages</dt>');
    expect(html).toContain('<dt>Source surface</dt>');
  });
});
