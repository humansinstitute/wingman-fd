import { isTaskUnscoped, matchesTaskBoardScope } from './task-board-scopes.js';

const UNSCOPED_BOARD_ID = '__unscoped__';
const ALL_BOARD_ID = '__all__';
const RECENT_BOARD_ID = '__recent__';

/**
 * Collect all ancestor directory IDs for a set of matched items by walking
 * up the parent_directory_id chain using a directory lookup map.
 */
function collectAncestorDirIds(matchedItems, dirMap) {
  const ancestors = new Set();
  for (const item of matchedItems) {
    let parentId = item.parent_directory_id;
    while (parentId && !ancestors.has(parentId)) {
      ancestors.add(parentId);
      const parent = dirMap.get(parentId);
      parentId = parent?.parent_directory_id ?? null;
    }
  }
  return ancestors;
}

/**
 * Filter documents and directories by the selected board scope.
 * Returns { documents, directories } arrays with deleted items excluded.
 *
 * Directories are included when they match the scope themselves OR when
 * they are ancestors of a matched document or directory.
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

  const matchesScope = (item) =>
    matchesTaskBoardScope(item, selectedBoardScope, scopesMap, { includeDescendants: true });

  const matchedDocs = liveDocs.filter(matchesScope);
  const directlyMatchedDirs = liveDirs.filter(matchesScope);

  // Build a lookup for walking parent chains
  const dirMap = new Map();
  for (const dir of liveDirs) dirMap.set(dir.record_id, dir);

  // Collect ancestors of matched docs AND matched directories
  const ancestorIds = collectAncestorDirIds([...matchedDocs, ...directlyMatchedDirs], dirMap);

  const filteredDirs = liveDirs.filter((dir) =>
    matchesScope(dir) || ancestorIds.has(dir.record_id),
  );

  return { documents: matchedDocs, directories: filteredDirs };
}
