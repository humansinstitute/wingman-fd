import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { buildSectionUrl, parseRouteLocation } from '../src/route-helpers.js';

const appPath = path.resolve(import.meta.dirname, '..', 'src', 'app.js');
const appSource = fs.readFileSync(appPath, 'utf-8');
const originalWindow = globalThis.window;

function extractMethodBody(methodName) {
  const signature = `${methodName}(`;
  const start = appSource.indexOf(signature);
  if (start < 0) {
    throw new Error(`Unable to locate method body for ${methodName}`);
  }
  const bodyStart = appSource.indexOf('{', start);
  if (bodyStart < 0) {
    throw new Error(`Unable to locate opening brace for ${methodName}`);
  }

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let index = bodyStart; index < appSource.length; index += 1) {
    const char = appSource[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (!inDouble && !inTemplate && char === '\'' ) {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inTemplate && char === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && char === '`') {
      inTemplate = !inTemplate;
      continue;
    }
    if (inSingle || inDouble || inTemplate) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return appSource.slice(bodyStart + 1, index);
      }
    }
  }

  throw new Error(`Unable to extract method body for ${methodName}`);
}

const buildTaskUrl = new Function(
  'buildSectionUrl',
  'parseRouteLocation',
  `return function(taskId) {${extractMethodBody('buildTaskUrl')}};`,
)(buildSectionUrl, parseRouteLocation);

afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

describe('buildTaskUrl', () => {
  it('builds canonical workspace task links for copied task URLs', () => {
    globalThis.window = {
      location: new URL('http://localhost/demo/chat?channelid=chan-1&workspacekey=wk-1'),
    };

    const store = {
      currentWorkspaceSlug: 'demo',
      currentWorkspaceKey: 'wk-1',
      selectedBoardId: 'scope-fallback',
      tasks: [
        { record_id: 'task-42', scope_id: 'scope-1' },
      ],
    };

    expect(buildTaskUrl.call(store, 'task-42'))
      .toBe('http://localhost/demo/tasks?scopeid=scope-1&taskid=task-42&workspacekey=wk-1');
  });
});
