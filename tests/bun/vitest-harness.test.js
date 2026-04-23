import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';

describe('project test harness', () => {
  it('passes the maintained Vitest unit suite', () => {
    const result = spawnSync('bun', ['run', 'test'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
    });

    if (result.status !== 0) {
      throw new Error(
        [
          '`bun run test` failed.',
          '',
          result.stdout.trim(),
          result.stderr.trim(),
        ].filter(Boolean).join('\n'),
      );
    }

    expect(result.status).toBe(0);
  }, 120000);
});
