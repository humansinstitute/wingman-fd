import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const indexPath = path.resolve(import.meta.dirname, '..', 'index.html');
const indexContent = fs.readFileSync(indexPath, 'utf-8');

describe('task predecessor rendering', () => {
  it('renders the shared state badge inside predecessor rows', () => {
    expect(indexContent).toContain('class="badge task-predecessor-state"');
    expect(indexContent).toContain(':class="`state-${pred.state}`"');
    expect(indexContent).toContain('x-text="$store.chat.formatState(pred.state)"');
  });
});
