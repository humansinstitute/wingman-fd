/**
 * Tests for flow editor hydration after hard refresh.
 *
 * Bug: flow cards render correctly after reload, but clicking "Edit"
 * opens a blank editor because init() ran once at mount time (before
 * editingFlowId was set) and the form fields were never re-populated.
 *
 * These tests verify:
 * 1. buildFlowEditorForm produces correct form state from a flow object
 * 2. buildFlowEditorForm returns empty defaults when no flow is found
 * 3. All key fields (title, description, steps, scope_id) survive the round-trip
 * 4. Steps array is deep-cloned (mutations don't leak back to source)
 */

import { describe, it, expect } from 'vitest';
import { buildFlowEditorForm } from '../src/flows-manager.js';

const SAMPLE_FLOW = {
  record_id: 'flow-1',
  owner_npub: 'npub_owner',
  title: 'Outreach Email',
  description: 'Generate an outreach email for a potential website customer for Off Piste.',
  steps: [
    { step_number: 1, title: 'Review target site', instruction: 'Look up the prospect website and summarise key points.', approval_mode: 'manual', whitelist_approvers: null, artifacts_expected: [] },
    { step_number: 2, title: 'Generate Email', instruction: 'Draft a personalised outreach email.', approval_mode: 'auto', whitelist_approvers: null, artifacts_expected: [] },
  ],
  next_flow_id: null,
  scope_id: 'scope-websites',
  scope_l1_id: 'scope-websites',
  scope_l2_id: null,
  scope_l3_id: null,
  scope_l4_id: null,
  scope_l5_id: null,
  group_ids: [],
  sync_status: 'synced',
  record_state: 'active',
  version: 1,
  created_at: '2026-04-01T10:00:00.000Z',
  updated_at: '2026-04-01T10:00:00.000Z',
};

describe('buildFlowEditorForm', () => {
  it('populates all fields from a flow object', () => {
    const form = buildFlowEditorForm(SAMPLE_FLOW, null);

    expect(form.formTitle).toBe('Outreach Email');
    expect(form.formDescription).toBe(SAMPLE_FLOW.description);
    expect(form.formSteps).toHaveLength(2);
    expect(form.formSteps[0].title).toBe('Review target site');
    expect(form.formSteps[1].title).toBe('Generate Email');
    expect(form.formNextFlowId).toBeNull();
    expect(form.formScopeId).toBe('scope-websites');
  });

  it('returns empty defaults when flow is null/undefined', () => {
    const form = buildFlowEditorForm(null, 'fallback-scope');

    expect(form.formTitle).toBe('');
    expect(form.formDescription).toBe('');
    expect(form.formSteps).toEqual([]);
    expect(form.formNextFlowId).toBeNull();
    expect(form.formScopeId).toBe('fallback-scope');
  });

  it('returns empty defaults when flow is an empty object', () => {
    const form = buildFlowEditorForm({}, null);

    expect(form.formTitle).toBe('');
    expect(form.formDescription).toBe('');
    expect(form.formSteps).toEqual([]);
    expect(form.formNextFlowId).toBeNull();
    expect(form.formScopeId).toBeNull();
  });

  it('falls back to selectedBoardId when flow has no scope_id', () => {
    const flowNoScope = { ...SAMPLE_FLOW, scope_id: null };
    const form = buildFlowEditorForm(flowNoScope, 'board-123');

    expect(form.formScopeId).toBe('board-123');
  });

  it('prefers flow.scope_id over selectedBoardId', () => {
    const form = buildFlowEditorForm(SAMPLE_FLOW, 'board-other');

    expect(form.formScopeId).toBe('scope-websites');
  });

  it('deep-clones steps so mutations do not leak to source', () => {
    const form = buildFlowEditorForm(SAMPLE_FLOW, null);

    form.formSteps[0].title = 'MUTATED';
    expect(SAMPLE_FLOW.steps[0].title).toBe('Review target site');
  });

  it('preserves step detail fields through the round-trip', () => {
    const form = buildFlowEditorForm(SAMPLE_FLOW, null);
    const step = form.formSteps[0];

    expect(step.step_number).toBe(1);
    expect(step.instruction).toBe('Look up the prospect website and summarise key points.');
    expect(step.approval_mode).toBe('manual');
    expect(step.whitelist_approvers).toBeNull();
    expect(step.artifacts_expected).toEqual([]);
  });

  it('preserves next_flow_id when set', () => {
    const flowWithNext = { ...SAMPLE_FLOW, next_flow_id: 'flow-2' };
    const form = buildFlowEditorForm(flowWithNext, null);

    expect(form.formNextFlowId).toBe('flow-2');
  });
});

describe('flow round-trip: create → persist shape → editor hydration', () => {
  it('simulates create → Dexie row → editor reopen', () => {
    // Simulate what createFlow writes to Dexie
    const localRow = {
      record_id: 'flow-new',
      owner_npub: 'npub_owner',
      title: 'New Pipeline',
      description: 'A multi-step pipeline.',
      steps: [
        { step_number: 1, title: 'Step A', instruction: 'Do A', approval_mode: 'manual', whitelist_approvers: null, artifacts_expected: [] },
      ],
      next_flow_id: null,
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
      shares: [],
      group_ids: [],
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: '2026-04-01T10:00:00.000Z',
      updated_at: '2026-04-01T10:00:00.000Z',
    };

    // Simulate sanitizeForStorage round-trip (JSON parse/stringify)
    const persisted = JSON.parse(JSON.stringify(localRow));

    // Now simulate editor opening after hard refresh
    const form = buildFlowEditorForm(persisted, null);

    expect(form.formTitle).toBe('New Pipeline');
    expect(form.formDescription).toBe('A multi-step pipeline.');
    expect(form.formSteps).toHaveLength(1);
    expect(form.formSteps[0].title).toBe('Step A');
    expect(form.formScopeId).toBe('scope-1');
  });
});
