export function filterSelectableTaskIds(taskIds = [], isParentTask = () => false) {
  return [...new Set((taskIds || [])
    .map((taskId) => String(taskId || '').trim())
    .filter((taskId) => taskId && !isParentTask(taskId)))];
}

export function getSelectableColumnTaskIds(tasks = [], isParentTask = () => false) {
  return filterSelectableTaskIds((tasks || []).map((task) => task?.record_id), isParentTask);
}

export function toggleColumnTaskSelection(selectedTaskIds = [], columnTaskIds = []) {
  const selectedSet = new Set(selectedTaskIds || []);
  const columnIds = [...new Set(columnTaskIds || [])];
  if (columnIds.length === 0) return [...selectedSet];
  const allSelected = columnIds.every((id) => selectedSet.has(id));
  if (allSelected) {
    return [...selectedSet].filter((id) => !columnIds.includes(id));
  }
  return [...new Set([...selectedSet, ...columnIds])];
}
