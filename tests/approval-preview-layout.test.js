import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const indexContent = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf-8');
const stylesContent = fs.readFileSync(path.resolve(__dirname, '../src/styles.css'), 'utf-8');

describe('approval preview layout', () => {
  it('auto-loads preview content at the laptop breakpoint', () => {
    expect(indexContent).toContain('window.innerWidth >= 820');
  });

  it('uses a three-column approval preview layout from the laptop breakpoint upward', () => {
    expect(stylesContent).toContain('@media (min-width: 820px)');
    expect(stylesContent).toContain('grid-template-columns: 20% minmax(0, 1fr) 20%;');
  });
});
