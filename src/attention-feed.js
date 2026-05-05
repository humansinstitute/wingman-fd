export const ATTENTION_LANE_ORDER = Object.freeze([
  {
    id: 'needs_you',
    label: 'Needs You',
    description: 'Mentions, approvals, and work waiting on your decision.',
  },
  {
    id: 'changed_work',
    label: 'Changed Work',
    description: 'Tasks, docs, and threads that moved recently.',
  },
  {
    id: 'agent_updates',
    label: 'Agent Updates',
    description: 'Reports and agent-owned work worth scanning.',
  },
  {
    id: 'due_next',
    label: 'Due / Next',
    description: 'Ready and active work in the current board.',
  },
]);

const TERMINAL_TASK_STATES = new Set(['done', 'complete', 'completed', 'archived', 'cancelled']);
const ACTIVE_TASK_STATES = new Set(['ready', 'in_progress', 'review', 'blocked']);

function compactText(parts = []) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' · ');
}

function truncateText(value, max = 140) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}...`;
}

function timestampOf(record = {}) {
  const raw = record.updatedAt
    || record.updated_at
    || record.generated_at
    || record.created_at
    || record.createdAt
    || record.timestamp
    || '';
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function isoOf(record = {}) {
  return record.updatedAt
    || record.updated_at
    || record.generated_at
    || record.created_at
    || record.createdAt
    || '';
}

function isLive(record = {}) {
  return record && record.record_state !== 'deleted';
}

function taskScopeId(task = {}) {
  return task.scope_id
    ?? task.scope_l5_id
    ?? task.scope_l4_id
    ?? task.scope_l3_id
    ?? task.scope_l2_id
    ?? task.scope_l1_id
    ?? null;
}

function taskLabel(task = {}) {
  const state = String(task.state || '').trim();
  if (!state) return 'Task';
  return state
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function mentionsViewer(item = {}, viewerNpub = '') {
  const npub = String(viewerNpub || '').trim();
  if (!npub) return false;
  const haystack = `${item.title || ''} ${item.subtitle || ''} ${item.body || ''} ${item.description || ''}`;
  return haystack.includes(npub) || haystack.includes(`@${npub}`) || haystack.includes(`nostr:${npub}`);
}

function makeRecentItem(item = {}, lane, overrides = {}) {
  const updatedAt = isoOf(item);
  return {
    id: `${lane}:${item.id || item.recordId || item.record_id || item.title}`,
    lane,
    kind: item.recordTypeKey || item.recordType || 'record',
    severity: overrides.severity || 'normal',
    icon: overrides.icon || iconForRecentItem(item),
    title: truncateText(overrides.title || item.title || 'Untitled update', 88),
    subtitle: truncateText(overrides.subtitle || item.subtitle || '', 150),
    reason: overrides.reason || item.recordType || 'Updated',
    updatedAt,
    updatedTs: item.updatedTs || timestampOf(item),
    actorNpub: item.senderNpub || item.actorNpub || null,
    section: item.section,
    recordType: item.recordType,
    recordTypeKey: item.recordTypeKey,
    recordId: item.recordId,
    focusRecordId: item.focusRecordId,
    channelId: item.channelId,
    threadId: item.threadId,
    docType: item.docType,
    boardScopeId: item.boardScopeId,
    actionLabel: overrides.actionLabel || actionLabelForSection(item.section),
  };
}

function iconForRecentItem(item = {}) {
  if (item.recordTypeKey === 'chat') return 'chat';
  if (item.recordTypeKey === 'comment') return 'comment';
  if (item.recordTypeKey === 'task') return 'task';
  if (item.recordTypeKey === 'doc' || item.recordTypeKey === 'folder') return 'doc';
  if (item.recordTypeKey === 'report') return 'report';
  if (item.recordTypeKey === 'flow') return 'flow';
  return 'activity';
}

function actionLabelForSection(section) {
  if (section === 'chat') return 'Open thread';
  if (section === 'docs') return 'Open doc';
  if (section === 'tasks') return 'Open task';
  if (section === 'status') return 'Open report';
  if (section === 'flows') return 'Open flow';
  if (section === 'schedules') return 'Open schedule';
  return 'Open';
}

function pushUnique(groups, seen, item) {
  if (!item?.id || !groups[item.lane]) return;
  const key = `${item.lane}:${item.section || ''}:${item.recordId || ''}:${item.focusRecordId || ''}:${item.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  groups[item.lane].push(item);
}

function buildApprovalItem(approval = {}) {
  const updatedAt = isoOf(approval);
  return {
    id: `approval:${approval.record_id}`,
    lane: 'needs_you',
    kind: 'approval',
    severity: 'high',
    icon: 'approval',
    title: truncateText(approval.title || 'Untitled approval', 88),
    subtitle: truncateText(approval.brief || approval.recommendation || '', 150),
    reason: approval.approval_mode === 'agent' ? 'Agent review waiting' : 'Approval waiting',
    updatedAt,
    updatedTs: timestampOf(approval),
    recordId: approval.record_id,
    section: 'approvals',
    actionLabel: 'Review',
  };
}

function buildTaskItem(task = {}, lane, options = {}) {
  const updatedAt = isoOf(task);
  return {
    id: `${lane}:task:${task.record_id}`,
    lane,
    kind: 'task',
    severity: options.severity || (String(task.state || '') === 'blocked' ? 'high' : 'normal'),
    icon: 'task',
    title: truncateText(task.title || 'Untitled task', 88),
    subtitle: truncateText(task.description || '', 150),
    reason: options.reason || taskLabel(task),
    updatedAt,
    updatedTs: timestampOf(task),
    actorNpub: task.assigned_to_npub || null,
    section: 'tasks',
    recordType: 'Task',
    recordTypeKey: 'task',
    recordId: task.record_id,
    boardScopeId: taskScopeId(task),
    actionLabel: 'Open task',
  };
}

function sortItems(items = []) {
  return [...items].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    if (severityDelta) return severityDelta;
    return (right.updatedTs || 0) - (left.updatedTs || 0);
  });
}

function severityRank(severity) {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

export function buildAttentionFeed(input = {}) {
  const groups = Object.fromEntries(ATTENTION_LANE_ORDER.map((lane) => [lane.id, []]));
  const seen = new Set();
  const viewerNpub = String(input.session?.npub || input.viewerNpub || '').trim();
  const agentNpub = String(input.defaultAgentNpub || input.botNpub || '').trim();
  const tasks = (input.tasks || []).filter(isLive);
  const recentChanges = (input.statusRecentChanges || []).filter(Boolean);

  for (const approval of input.pendingApprovals || []) {
    if (!isLive(approval)) continue;
    pushUnique(groups, seen, buildApprovalItem(approval));
  }

  for (const task of tasks) {
    const state = String(task.state || '').trim();
    if (TERMINAL_TASK_STATES.has(state)) continue;
    if (task.assigned_to_npub && task.assigned_to_npub === viewerNpub) {
      pushUnique(groups, seen, buildTaskItem(task, 'needs_you', {
        reason: state === 'review' ? 'Ready for your review' : 'Assigned to you',
        severity: state === 'blocked' || state === 'review' ? 'high' : 'medium',
      }));
      continue;
    }
    if (task.owner_npub && task.owner_npub === viewerNpub && state === 'review') {
      pushUnique(groups, seen, buildTaskItem(task, 'needs_you', {
        reason: 'Work you created is in review',
        severity: 'high',
      }));
      continue;
    }
    if (agentNpub && task.assigned_to_npub === agentNpub && ACTIVE_TASK_STATES.has(state)) {
      pushUnique(groups, seen, buildTaskItem(task, 'agent_updates', {
        reason: state === 'review' ? 'Agent work in review' : 'Agent work active',
        severity: state === 'blocked' ? 'high' : 'normal',
      }));
    }
  }

  for (const task of (input.boardScopedTasks || tasks).filter(isLive)) {
    const state = String(task.state || '').trim();
    if (!ACTIVE_TASK_STATES.has(state)) continue;
    pushUnique(groups, seen, buildTaskItem(task, 'due_next', {
      reason: taskLabel(task),
      severity: state === 'blocked' ? 'high' : 'normal',
    }));
  }

  for (const item of recentChanges) {
    if (item.recordTypeKey === 'comment' && mentionsViewer(item, viewerNpub)) {
      pushUnique(groups, seen, makeRecentItem(item, 'needs_you', {
        reason: 'You were mentioned',
        severity: 'high',
        icon: 'mention',
      }));
      continue;
    }
    if (item.recordTypeKey === 'chat' && mentionsViewer(item, viewerNpub)) {
      pushUnique(groups, seen, makeRecentItem(item, 'needs_you', {
        reason: 'Message mentions you',
        severity: 'high',
        icon: 'mention',
      }));
      continue;
    }
    if (item.recordTypeKey === 'report') {
      pushUnique(groups, seen, makeRecentItem(item, 'agent_updates', {
        reason: 'Report updated',
        icon: 'report',
      }));
      continue;
    }
    if (item.recordTypeKey === 'chat' || item.recordTypeKey === 'comment') {
      pushUnique(groups, seen, makeRecentItem(item, 'changed_work', {
        reason: item.recordTypeKey === 'chat' ? 'New message' : 'New comment',
      }));
      continue;
    }
    if (['task', 'doc', 'folder', 'flow'].includes(item.recordTypeKey)) {
      pushUnique(groups, seen, makeRecentItem(item, 'changed_work', {
        reason: `${item.recordType || 'Record'} updated`,
      }));
    }
  }

  return ATTENTION_LANE_ORDER.map((lane) => ({
    ...lane,
    items: sortItems(groups[lane.id]).slice(0, input.maxItemsPerLane || 6),
  }));
}

export function summarizeAttentionFeed(groups = []) {
  const count = groups.reduce((sum, group) => sum + (group.items?.length || 0), 0);
  if (count === 0) return 'Nothing needs attention in this window.';
  const needsYou = groups.find((group) => group.id === 'needs_you')?.items?.length || 0;
  if (needsYou > 0) return `${needsYou} item${needsYou === 1 ? '' : 's'} need your attention.`;
  return compactText(groups
    .filter((group) => group.items?.length)
    .map((group) => `${group.items.length} ${group.label.toLowerCase()}`));
}
