import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve(import.meta.dirname, '..', 'src', 'app.js');
const appSource = fs.readFileSync(appPath, 'utf-8');

function extractMethodBody(methodName) {
  const pattern = new RegExp(`${methodName}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\s*\\},`);
  const match = appSource.match(pattern);
  if (!match) {
    throw new Error(`Unable to locate method body for ${methodName}`);
  }
  return match[1];
}

const openEditingTaskFlowRunStepTask = new Function(
  'flowRunId',
  'stepNumber',
  extractMethodBody('openEditingTaskFlowRunStepTask'),
);

describe('task flow run step navigation method', () => {
  it('opens the resolved sibling task detail for a flow step', () => {
    const store = {
      findEditingTaskFlowRunStepTask: vi.fn(() => ({ record_id: 'task-step-2' })),
      openTaskDetail: vi.fn(),
    };

    openEditingTaskFlowRunStepTask.call(store, 'run-123', 2);

    expect(store.findEditingTaskFlowRunStepTask).toHaveBeenCalledWith('run-123', 2);
    expect(store.openTaskDetail).toHaveBeenCalledWith('task-step-2');
  });

  it('does not navigate when no sibling task exists for the flow step', () => {
    const store = {
      findEditingTaskFlowRunStepTask: vi.fn(() => null),
      openTaskDetail: vi.fn(),
    };

    openEditingTaskFlowRunStepTask.call(store, 'run-123', 9);

    expect(store.findEditingTaskFlowRunStepTask).toHaveBeenCalledWith('run-123', 9);
    expect(store.openTaskDetail).not.toHaveBeenCalled();
  });
});
