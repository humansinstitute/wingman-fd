export function normalizeStorageGroupIds(groupIds = []) {
  return [...new Set(
    (groupIds || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
}

export function resolveStorageOwnership({ ownerGroupId = null, accessGroupIds = [] } = {}) {
  const normalizedAccessGroupIds = normalizeStorageGroupIds(accessGroupIds);
  const normalizedOwnerGroupId = String(ownerGroupId || '').trim() || normalizedAccessGroupIds[0] || null;

  if (!normalizedOwnerGroupId) {
    return {
      ownerGroupId: null,
      accessGroupIds: normalizedAccessGroupIds,
    };
  }

  return {
    ownerGroupId: normalizedOwnerGroupId,
    accessGroupIds: normalizedAccessGroupIds.includes(normalizedOwnerGroupId)
      ? normalizedAccessGroupIds
      : [normalizedOwnerGroupId, ...normalizedAccessGroupIds],
  };
}

export function buildStoragePrepareBody({
  ownerNpub,
  ownerGroupId = null,
  accessGroupIds = [],
  isPublic = false,
  contentType,
  sizeBytes = null,
  fileName = null,
} = {}) {
  const body = {
    owner_npub: String(ownerNpub || '').trim(),
    content_type: String(contentType || '').trim() || 'application/octet-stream',
  };

  const resolved = resolveStorageOwnership({ ownerGroupId, accessGroupIds });
  if (resolved.ownerGroupId) body.owner_group_id = resolved.ownerGroupId;
  if (resolved.accessGroupIds.length > 0) body.access_group_ids = resolved.accessGroupIds;
  if (isPublic === true) body.is_public = true;

  if (Number.isFinite(Number(sizeBytes))) body.size_bytes = Number(sizeBytes);

  const normalizedFileName = String(fileName || '').trim();
  if (normalizedFileName) body.file_name = normalizedFileName;

  return body;
}
