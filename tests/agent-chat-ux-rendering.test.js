import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const htmlPath = path.resolve(import.meta.dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

describe('Agent Chat UX rendering hooks', () => {
  it('renders the trigger inspection summary card in settings', () => {
    expect(html).toContain('agent-chat-trigger-summary-card');
    expect(html).toContain('agentChatTriggerValidationHeadline()');
    expect(html).toContain('Passive inspection for any saved workspace Agent Chat record');
    expect(html).toContain('Run Current-Actor Check');
    expect(html).toContain('signed-in actor');
    expect(html).not.toContain('Save Agent Chat Rule');
    expect(html).not.toContain('Enable Agent Chat routing for this workspace');
  });

  it('renders operator diagnostics on the trigger surface', () => {
    expect(html).toContain('agentChatOperatorWarnings.length');
    expect(html).toContain('agentChatDiagnosticsScopeNote');
    expect(html).toContain('agent-chat-trigger-operator-card');
    expect(html).toContain('Passive Diagnostics');
    expect(html).toContain('Tower only exposes wrapped-key inspection for the signed-in actor');
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
