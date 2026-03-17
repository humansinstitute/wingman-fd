import { describe, expect, it } from 'vitest';
import { commentBelongsToDocBlock } from '../src/doc-comment-anchors.js';

describe('document comment anchoring', () => {
  it('keeps a comment visible when its anchor line falls within a block after document edits', () => {
    const block = {
      start_line: 26,
      end_line: 29,
    };
    const comment = {
      parent_comment_id: null,
      anchor_line_number: 29,
      record_state: 'active',
    };

    expect(commentBelongsToDocBlock(comment, block)).toBe(true);
  });

  it('does not attach a comment to unrelated blocks', () => {
    const block = {
      start_line: 31,
      end_line: 31,
    };
    const comment = {
      parent_comment_id: null,
      anchor_line_number: 29,
      record_state: 'active',
    };

    expect(commentBelongsToDocBlock(comment, block)).toBe(false);
  });

  it('ignores deleted comments and threaded replies for block badges', () => {
    const block = {
      start_line: 97,
      end_line: 104,
    };

    expect(commentBelongsToDocBlock({
      parent_comment_id: 'root-1',
      anchor_line_number: 100,
      record_state: 'active',
    }, block)).toBe(false);

    expect(commentBelongsToDocBlock({
      parent_comment_id: null,
      anchor_line_number: 100,
      record_state: 'deleted',
    }, block)).toBe(false);
  });
});
