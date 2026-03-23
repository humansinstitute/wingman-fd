export function commentBelongsToDocBlock(comment, block) {
  if (comment?.parent_comment_id) return false;
  if (comment?.record_state === 'deleted') return false;
  const rawAnchor = Number(comment?.anchor_line_number);
  const anchorLine = (!Number.isFinite(rawAnchor) || rawAnchor < 1) ? 1 : rawAnchor;
  const startLine = Number(block?.start_line);
  const endLine = Number(block?.end_line);
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return false;
  return anchorLine >= startLine && anchorLine <= endLine;
}
