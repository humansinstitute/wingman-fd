import { describe, expect, it } from 'vitest';
import { buildFlightDeckDocumentTitle } from '../src/page-title.js';

describe('page title', () => {
  it('builds task titles', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'tasks' })).toBe('Tasks - Wingman: Flight Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'opportunities' })).toBe('Opportunities - Wingman: Flight Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'settings' })).toBe('Setup - Wingman: Flight Deck');
  });

  it('builds chat titles with channel context', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'chat' })).toBe('Chat - Wingman: Flight Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'chat', channelLabel: 'WM21' })).toBe('Chat | WM21 - Wingman: Flight Deck');
  });

  it('falls back to chat titles for removed or unknown sections', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'live' })).toBe('Chat - Wingman: Flight Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'calendar' })).toBe('Chat - Wingman: Flight Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'schedules' })).toBe('Chat - Wingman: Flight Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'scopes' })).toBe('Chat - Wingman: Flight Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'flows' })).toBe('Chat - Wingman: Flight Deck');
  });

  it('builds docs titles from folder or document context', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'docs', folderLabel: 'Ops' })).toBe('Docs | Ops - Wingman: Flight Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'docs', docTitle: 'Launch Plan' })).toBe('Docs | Launch Plan - Wingman: Flight Deck');
  });
});
