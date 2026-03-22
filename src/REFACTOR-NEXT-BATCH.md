# Refactor Next Batch — app.js Extraction Plan

**Current state:** `src/app.js` is 6149 lines. Eight mixins already extracted:
`triggers-manager.js`, `storage-image-manager.js`, `audio-recording-manager.js`,
`channels-manager.js`, `scopes-manager.js`, `task-board-state.js`, `docs-manager.js`,
plus shared `utils/state-helpers.js` and `utils/naming.js`.

---

## Candidate 1: `chat-message-manager.js` (~530 lines)

**Lines:** ~3439–3693, 5914–6124
**Contains:**
- `applyMessages`, `refreshMessages`, `patchMessageLocal`, `setMessageSyncStatus`
- `sendMessage`, `sendThreadReply`, `deleteActiveThread`
- Thread lifecycle: `openThread`, `closeThread`, `cycleThreadSize`, `showMoreThreadMessages`, `getThreadParentMessage`, `getThreadReplyCount`
- Chat preview truncation: `isChatMessageExpanded`, `isChatMessageTruncated`, `toggleChatMessageExpanded`, `syncChatPreviewState`, `scheduleChatPreviewMeasurement`
- Scroll anchoring: `scheduleChatFeedScrollToBottom`, `scheduleThreadRepliesScrollToBottom`
- Composer autosize: `autosizeComposer`, `scheduleComposerAutosize`
- `createBotDm`, `deleteSelectedChannel`

**Why extract:** Largest remaining cohesive feature block. All methods operate on `messages`, `activeThreadId`, and the chat composer. Clear seam — depends on channel selection but otherwise self-contained.

**State it reads:** `messages`, `channels`, `selectedChannelId`, `activeThreadId`, `threadInput`, `messageInput`, `messageAudioDrafts`, `threadAudioDrafts`, `expandedChatMessageIds`, `truncatedChatMessageIds`, `focusMessageId`, `threadVisibleReplyCount`, `threadSize`, `pendingChatScrollToLatest`, `pendingThreadScrollToLatest`, `messageImageUploadCount`, `threadImageUploadCount`

**Getters to include:** `selectedChannel`, `mainFeedMessages`, `threadMessages`, `resolvedThreadVisibleReplyCount`, `visibleThreadMessages`, `hiddenThreadReplyCount`, `hasMoreThreadMessages`

---

## Candidate 2: `workspace-manager.js` (~700 lines)

**Lines:** ~857–1788 (workspace display helpers through `createWorkspaceBootstrap`)
**Contains:**
- Workspace display: `getWorkspaceByOwner`, `getWorkspaceDisplayEntry`, `getWorkspaceName`, `getWorkspaceMeta`, `getWorkspaceStorageBackendUrl`, `getWorkspaceAvatar`, `getWorkspaceInitials`
- Workspace switcher: `toggleWorkspaceSwitcherMenu`, `closeWorkspaceSwitcherMenu`, `handleWorkspaceSwitcherSelect`
- Workspace list: `mergeKnownWorkspaces`, `hydrateKnownWorkspaceProfiles`, `ensureWorkspaceProfileHydrated`
- Workspace profile editing: `syncWorkspaceProfileDraft`, `markWorkspaceProfileDirty`, `handleWorkspaceProfileField`, `handleWorkspaceAvatarSelection`, `clearWorkspaceAvatarDraft`, `resetWorkspaceProfileDraft`
- Workspace settings row: `applyWorkspaceSettingsRow`, `refreshWorkspaceSettings`, `getWorkspaceSettingsGroupNpub`, `getWorkspaceSettingsGroupRef`
- Workspace CRUD: `selectWorkspace`, `removeWorkspace`, `loadRemoteWorkspaces`, `tryRecoverWorkspace`, `createWorkspaceBootstrap`, `openWorkspaceBootstrapModal`, `closeWorkspaceBootstrapModal`, `updateWorkspaceBootstrapPrompt`, `fetchBackendServiceNpub`
- Workspace settings persistence: `persistWorkspaceSettings`, `saveWorkspaceProfile`, `uploadWorkspaceAvatarFile`, `saveHarnessSettings`

**Computed getters:** `workspaceOwnerNpub`, `currentWorkspace`, `activeWorkspaceOwnerNpub`, `currentWorkspaceName`, `currentWorkspaceMeta`, `currentWorkspaceBackendUrl`, `currentWorkspaceBackendName`, `currentWorkspaceAvatarUrl`, `currentWorkspaceInitials`, `currentWorkspaceGroups`, `memberPrivateGroup`, `memberPrivateGroupNpub`, `memberPrivateGroupRef`, `isWorkspaceSwitching`

**Why extract:** Second-largest block, highly self-contained. All methods revolve around `knownWorkspaces`, `currentWorkspaceOwnerNpub`, and workspace profile fields. The only cross-cutting dependency is `session` and `backendUrl`.

---

## Candidate 3: `sync-manager.js` (~400 lines)

**Lines:** ~2983–3376
**Contains:**
- Sync lifecycle: `getSyncCadenceMs`, `stopBackgroundSync`, `scheduleBackgroundSync`, `ensureBackgroundSync`, `backgroundSyncTick`
- Sync execution: `performSync`, `syncNow`, `refreshSyncStatus`, `checkForStaleness`
- Sync session UI: `updateSyncSession`, `syncProgressLabel`, `syncProgressPercent`, `lastSyncTimeLabel`
- Task family backfill: `ensureTaskFamilyBackfill`
- Repair/restore: `restoreFamiliesFromSuperBased`, `pullFamiliesFromBackend`, `refreshStateForFamilies`, `restoreSelectedFamiliesFromSuperBased`
- Sync quarantine: `refreshSyncQuarantine`, `dismissSyncQuarantineIssue`, `retrySyncQuarantineIssue`, `deleteLocalQuarantinedRecord`
- Repair UI: `isRepairFamilySelected`, `toggleRepairFamily`, `selectAllRepairFamilies`, `clearRepairFamilies`, `repairFamilyOptions`, `hasSyncQuarantine`, `syncQuarantineFamilyLabel`, `syncQuarantineRecordLabel`, `formatSyncQuarantineTimestamp`

**Why extract:** Clean subsystem boundary — sync is an operational concern separate from feature state. Only touches `session`, `backendUrl`, `workspaceOwnerNpub`, and `syncSession`/`syncStatus` state. The visibility handler and timer are self-contained.

---

## Candidate 4: `people-profiles-manager.js` (~200 lines)

**Lines:** ~3887–4005, 1055–1158
**Contains:**
- Profile resolution: `resolveChatProfile`, `getCachedPerson`, `getSenderName`, `getSenderIdentity`, `getSenderAvatar`
- Address book: `rememberPeople`, `refreshAddressBook`, `applyAddressBookPeople`
- People search/suggestions: `findPeopleSuggestions`, `findGroupMemberSuggestions`, `mapGroupDraftMembers`, `consumeGroupMemberQuery`
- Computed: `groupMemberSuggestions`, `editGroupMemberSuggestions`, `taskAssigneeSuggestions`, `defaultAgentSuggestions`, `defaultAgentLabel`, `docShareSuggestions`

**Why extract:** Cross-cutting concern used by chat, tasks, docs, and groups. Extracting it removes scattered profile logic from the main file and creates a reusable identity layer.

---

## Candidate 5: `connect-settings-manager.js` (~300 lines)

**Lines:** ~2637–2896
**Contains:**
- Connection settings: `saveConnectionSettings`, `connectToPreset`, `toggleCvmSync`
- Connect modal (two-step): `openConnectModal`, `closeConnectModal`, `connectToHost`, `connectManualHost`, `connectByo`, `loadConnectWorkspaces`, `connectSelectWorkspace`, `connectCreateWorkspace`, `connectWithToken`, `connectGoBack`
- Known hosts: `addKnownHost`, `mergedHostsList`
- Agent connect: `showAgentConnect`, `closeAgentConnect`, `copyAgentConfig`, `copyId`
- Settings: `saveSettings`, `selectDefaultAgent`, `clearDefaultAgent`, `handleDefaultAgentInput`, `handleHarnessInput`

**Why extract:** All connection/settings UI flows are grouped together. Depends only on `session`, `backendUrl`, `superbasedTokenInput`, and workspace list. Clean modal lifecycle.

---

## Recommended extraction order

1. **`workspace-manager.js`** — largest block, most self-contained, decouples workspace lifecycle from everything else
2. **`chat-message-manager.js`** — second largest, removes the biggest feature block
3. **`sync-manager.js`** — operational concern, clean boundary
4. **`people-profiles-manager.js`** — cross-cutting, simplifies remaining code
5. **`connect-settings-manager.js`** — settings/connection flows, clean modal lifecycle

After these five extractions, `app.js` should drop from ~6149 lines to roughly ~3900 lines, with the remaining code being: init/lifecycle (~200), auth (~150), routing/navigation (~200), task CRUD (~600), schedule CRUD (~300), inline image paste (~250), @mentions (~200), doc browser operations (~350), groups modal (~100), and computed getters/state declarations (~550).
