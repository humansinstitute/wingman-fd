import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const indexPath = path.resolve(__dirname, '../index.html');
const indexContent = fs.readFileSync(indexPath, 'utf-8');

function findSectionBoundaries(section) {
  const openRe = new RegExp(
    `<template\\s+x-if="\\$store\\.chat\\.navSection\\s*===\\s*'${section}'"\\s*>`,
    'g',
  );
  const ranges = [];
  let match;
  while ((match = openRe.exec(indexContent)) !== null) {
    const start = match.index;
    let depth = 1;
    let cursor = start + match[0].length;
    while (depth > 0 && cursor < indexContent.length) {
      const nextOpen = indexContent.indexOf('<template', cursor);
      const nextClose = indexContent.indexOf('</template>', cursor);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        cursor = nextOpen + 9;
      } else {
        depth--;
        if (depth === 0) {
          ranges.push({ start, end: nextClose + '</template>'.length });
        }
        cursor = nextClose + '</template>'.length;
      }
    }
  }
  return ranges;
}

describe('task flow linkage rendering', () => {
  it('keeps the task flow component inside the task detail section', () => {
    const taskRanges = findSectionBoundaries('tasks');
    expect(taskRanges.length).toBeGreaterThan(0);
    const taskHtml = taskRanges.map((r) => indexContent.slice(r.start, r.end)).join('');

    expect(taskHtml).toContain('task-flow-linkage-wrap');
    expect(taskHtml).toContain('task-flow-summary-btn');
    expect(taskHtml).toContain('task-flow-toggle-btn');
    expect(taskHtml).toContain(":disabled=\"(flowInfo.steps || []).length === 0\"");
    expect(taskHtml).toContain('flowExpanded = !flowExpanded');
  });

  it('renders an inline ordered step list with click navigation for active runs', () => {
    expect(indexContent).toContain('x-show="flowExpanded && (flowInfo.steps || []).length > 0"');
    expect(indexContent).toContain('x-for="step in flowInfo.steps"');
    expect(indexContent).toContain('openEditingTaskFlowRunStepTask');
    expect(indexContent).toContain('findEditingTaskFlowRunStepTask');
    expect(indexContent).toContain('task-flow-step-row-current');
  });
});
