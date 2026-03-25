import { isTaskUnscoped, matchesTaskBoardScope } from './task-board-scopes.js';

const UNSCOPED_BOARD_ID = '__unscoped__';
const ALL_BOARD_ID = '__all__';
const RECENT_BOARD_ID = '__recent__';

/**
 * Filter documents and directories by the selected board scope.
 * Returns { documents, directories } arrays with deleted items excluded.
 */
export function filterDocItemsByScope(documents, directories, selectedBoardId, selectedBoardScope, scopesMap) {
  const liveDocs = documents.filter((d) => d.record_state !== 'deleted');
  const liveDirs = directories.filter((d) => d.record_state !== 'deleted');

  // No scope selected or special "all"/"recent" boards — return everything
  if (!selectedBoardId || selectedBoardId === ALL_BOARD_ID || selectedBoardId === RECENT_BOARD_ID) {
    return { documents: liveDocs, directories: liveDirs };
  }

  if (selectedBoardId === UNSCOPED_BOARD_ID) {
    return {
      documents: liveDocs.filter((doc) => isTaskUnscoped(doc, scopesMap)),
      directories: liveDirs.filter((dir) => isTaskUnscoped(dir, scopesMap)),
    };
  }

  // Specific scope selected but scope object not resolved — return everything
  if (!selectedBoardScope) {
    return { documents: liveDocs, directories: liveDirs };
  }

  return {
    documents: liveDocs.filter((doc) =>
      matchesTaskBoardScope(doc, selectedBoardScope, scopesMap, { includeDescendants: true }),
    ),
    directories: liveDirs.filter((dir) =>
      matchesTaskBoardScope(dir, selectedBoardScope, scopesMap, { includeDescendants: true }),
    ),
  };
}
