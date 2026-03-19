import { describe, expect, it } from 'vitest';
import { buildFlightDeckDocumentTitle } from '../src/page-title.js';

describe('page title', () => {
  it('builds task and calendar titles', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'tasks' })).toBe('Tasks - Wingman: Flight Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'calendar' })).toBe('Calendar - Wingman: Flight Deck');
  });

  it('builds chat titles with channel context', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'chat' })).toBe('Chat - Wingman: Flight Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'chat', channelLabel: 'WM21' })).toBe('Chat | WM21 - Wingman: Flight Deck');
  });

  it('builds docs titles from folder or document context', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'docs', folderLabel: 'Ops' })).toBe('Docs | Ops - Wingman: Flight Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'docs', docTitle: 'Launch Plan' })).toBe('Docs | Launch Plan - Wingman: Flight Deck');
  });
});
