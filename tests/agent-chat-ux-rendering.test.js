import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const htmlPath = path.resolve(import.meta.dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

describe('Agent Chat UX rendering hooks', () => {
  it('does not render the retired trigger inspection surface in settings', () => {
    const retiredTriggerClassPrefix = 'agent-chat' + '-trigger';
    const retiredTriggerBindingPrefix = 'agentChat' + 'Trigger';
    expect(html).not.toContain(`${retiredTriggerClassPrefix}-summary-card`);
    expect(html).not.toContain(`${retiredTriggerBindingPrefix}ValidationHeadline()`);
    expect(html).not.toContain('Passive inspection for any saved workspace Agent Chat record');
    expect(html).not.toContain('Run Current-Actor Check');
    expect(html).not.toContain('Save Agent Chat Rule');
    expect(html).not.toContain('Enable Agent Chat routing for this workspace');
    expect(html).not.toContain('agentChatOperatorWarnings.length');
    expect(html).not.toContain('agentChatDiagnosticsScopeNote');
    expect(html).not.toContain(`${retiredTriggerClassPrefix}-operator-card`);
    expect(html).not.toContain('Passive Diagnostics');
    expect(html).not.toContain('Tower only exposes wrapped-key inspection for the signed-in actor');
  });

  it('does not render Agent Chat reply cues in chat', () => {
    expect(html).not.toContain('chat-thread-preview-agent');
    expect(html).not.toContain('threadAgentChatSummary()');
    expect(html).not.toContain('agent-chat-inline-badge');
    expect(html).not.toContain('Agent Chat hint');
    expect(html).not.toContain('Agent Chat replied');
    expect(html).not.toContain('agentChatSelectedChannelRoutingSummary()');
    expect(html).not.toContain('agentChatChannelImpactSummary()');
    expect(html).not.toContain('routeCountLabel');
    expect(html).not.toContain('matching member');
  });
});
