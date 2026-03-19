export const FLIGHT_DECK_APP_TITLE = 'Wingman: Flight Deck';

function buildSectionTitle(label) {
  return `${label} - ${FLIGHT_DECK_APP_TITLE}`;
}

export function buildFlightDeckDocumentTitle({
  section = 'chat',
  channelLabel = '',
  folderLabel = '',
  docTitle = '',
} = {}) {
  const nextSection = String(section || 'chat').trim().toLowerCase();
  const nextChannelLabel = String(channelLabel || '').trim();
  const nextFolderLabel = String(folderLabel || '').trim();
  const nextDocTitle = String(docTitle || '').trim();

  switch (nextSection) {
    case 'status':
      return buildSectionTitle('Notifications');
    case 'tasks':
      return buildSectionTitle('Tasks');
    case 'calendar':
      return buildSectionTitle('Calendar');
    case 'schedules':
      return buildSectionTitle('Schedules');
    case 'docs':
      if (nextDocTitle) return buildSectionTitle(`Docs | ${nextDocTitle}`);
      if (nextFolderLabel) return buildSectionTitle(`Docs | ${nextFolderLabel}`);
      return buildSectionTitle('Docs');
    case 'people':
      return buildSectionTitle('People');
    case 'scopes':
      return buildSectionTitle('Scopes');
    case 'settings':
      return buildSectionTitle('Settings');
    case 'chat':
    default:
      if (nextChannelLabel) return buildSectionTitle(`Chat | ${nextChannelLabel}`);
      return buildSectionTitle('Chat');
  }
}
