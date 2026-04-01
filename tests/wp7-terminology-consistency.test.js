import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * WP7 Terminology Consistency Tests
 *
 * Validates that docs and critical inline comments use one consistent
 * vocabulary for: scope-as-auth, shares vs payloads, signer roles,
 * and SSE advisory transport semantics.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function readFile(filePath) {
  return fs.readFileSync(path.join(REPO_ROOT, filePath), 'utf8');
}

function fileExists(filePath) {
  return fs.existsSync(path.join(REPO_ROOT, filePath));
}

// ---------------------------------------------------------------------------
// 1. Scope is NOT an authorization primitive
// ---------------------------------------------------------------------------

describe('WP7: scope is not an authorization primitive', () => {
  it('canonical contract explicitly states scope is not auth', () => {
    const doc = readFile('docs/contract/group-signer-share-contract.md');
    expect(doc).toMatch(/scope.*not.*authorization primitive/is);
  });

  it('ARCHITECTURE.md does not describe scope as an auth mechanism', () => {
    const doc = readFile('ARCHITECTURE.md');
    // Scope should not be described as controlling access or authorization
    const scopeLines = doc.split('\n').filter((l) => /scope/i.test(l));
    for (const line of scopeLines) {
      expect(line).not.toMatch(/scope.*authoriz|scope.*access.*control|scope.*grant/i);
    }
  });

  it('design.md does not describe scope as an auth mechanism', () => {
    const doc = readFile('design.md');
    const scopeLines = doc.split('\n').filter((l) => /scope/i.test(l));
    for (const line of scopeLines) {
      expect(line).not.toMatch(/scope.*authoriz|scope.*access.*control|scope.*grant/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Shares vs group_payloads — consistent two-layer vocabulary
// ---------------------------------------------------------------------------

describe('WP7: shares vs group_payloads two-layer model', () => {
  it('canonical contract uses "stable policy metadata" for shares', () => {
    const doc = readFile('docs/contract/group-signer-share-contract.md');
    expect(doc).toMatch(/shares.*stable.*policy.*metadata/is);
  });

  it('canonical contract uses "encrypted delivery" for group_payloads', () => {
    const doc = readFile('docs/contract/group-signer-share-contract.md');
    expect(doc).toMatch(/group_payloads.*encrypted.*delivery/is);
  });

  it('group-scopes-review uses consistent layer names', () => {
    const doc = readFile('docs/design/group-scopes-review.md');
    // Should reference group_payloads as DB/transport/crypto layer
    expect(doc).toMatch(/group.payloads.*DB.*transport|group.payloads.*crypto/is);
    // Should reference shares as app-level layer
    expect(doc).toMatch(/shares.*app.level/is);
  });

  it('group-scopes-review share shape uses group_id as canonical ref', () => {
    const doc = readFile('docs/design/group-scopes-review.md');
    // The shares shape in Section 2.2 should have group_id as the primary ref
    // per WP2 normalization (not just group_npub)
    const sharesSection = doc.split('### 2.2')[1]?.split('###')[0] || '';
    expect(sharesSection).toMatch(/group_id/);
  });

  it('group-scopes-review uses owner_payload not owner_ciphertext for API-layer references', () => {
    const doc = readFile('docs/design/group-scopes-review.md');
    // References to data inside the encrypted blob should use "owner_ciphertext" (DB column)
    // References to the API-layer concept should use "owner_payload"
    // The lifecycle section should not mix API and DB terms for the same concept
    const lifecycleSection = doc.split('## 4')[1]?.split('## 5')[0] || '';
    // DB storage context: owner_ciphertext is correct for Tower storage rows
    // But the sync flow description should use owner_payload for the outbound shape
    // Check that the record creation step uses the transport term
    if (lifecycleSection.includes('syncs to Tower:')) {
      const syncLine = lifecycleSection.split('\n').find((l) => l.includes('syncs to Tower'));
      // Should say "owner_payload" in the sync context, not "owner_ciphertext"
      expect(syncLine).toMatch(/owner_payload/);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Signer roles — consistent three-role vocabulary
// ---------------------------------------------------------------------------

describe('WP7: signer roles use consistent vocabulary', () => {
  it('canonical contract names all three roles', () => {
    const doc = readFile('docs/contract/group-signer-share-contract.md');
    expect(doc).toContain('Real user identity');
    expect(doc).toContain('Workspace session key');
    expect(doc).toMatch(/Current group epoch key/);
  });

  it('write proof is attributed to group epoch key, not NIP-98', () => {
    const doc = readFile('docs/contract/group-signer-share-contract.md');
    // The contract should make clear that the write proof signer is the group epoch key
    expect(doc).toMatch(/write proof.*group epoch key|group epoch key.*write proof/is);
  });

  it('group-scopes-review write proof description is accurate', () => {
    const doc = readFile('docs/design/group-scopes-review.md');
    // Should NOT say "NIP-98 signed by group's current npub" for write proofs
    // because the write proof is a NIP-98 token but the signer is the group epoch key,
    // not the workspace session key. Saying "NIP-98 signed by group" is ambiguous.
    const writeSection = doc.split('NON-OWNER WRITE')[1]?.split('CLIENT-SIDE')[0] || '';
    // The write proof should reference "group epoch key" or "group's current epoch key"
    // and should not say "NIP-98 signed by group's current npub" which conflates protocols
    expect(writeSection).not.toMatch(/NIP-98 signed by group/i);
  });

  it('Tower CLAUDE.md uses "rotating crypto identity" not "write-proof identity"', () => {
    const doc = readFile('wingman-tower/claude.md');
    // group_npub description should say "rotating crypto identity" (canonical)
    // not "write-proof identity" (which is only one of its uses)
    expect(doc).toMatch(/group_npub.*rotating crypto/i);
  });

  it('Tower agents.md uses "rotating crypto identity" not "write-proof identity"', () => {
    const doc = readFile('wingman-tower/agents.md');
    expect(doc).toMatch(/group_npub.*rotating crypto/i);
  });
});

// ---------------------------------------------------------------------------
// 4. SSE advisory transport semantics
// ---------------------------------------------------------------------------

describe('WP7: SSE advisory transport semantics', () => {
  it('WP4 decision log documents SSE as advisory', () => {
    const doc = readFile('docs/log/wp4-sse-sync-messaging-contract.md');
    expect(doc).toMatch(/advisory/i);
    expect(doc).toMatch(/visibility.*enforced.*pull/i);
  });

  it('canonical contract describes SSE as advisory transport', () => {
    const doc = readFile('docs/contract/group-signer-share-contract.md');
    expect(doc).toMatch(/SSE.*advisory/i);
  });

  it('sse-hub.ts header comment includes "advisory" qualifier', () => {
    const src = readFile('wingman-tower/src/sse-hub.ts');
    // The module-level comment should note that events are advisory
    expect(src).toMatch(/advisory/i);
  });

  it('stream.ts header comment includes "advisory" qualifier', () => {
    const src = readFile('wingman-tower/src/routes/stream.ts');
    // The module-level comment should note that SSE is advisory
    expect(src).toMatch(/advisory/i);
  });

  it('SSE source files clarify visibility is enforced on pull, not emission', () => {
    const hubSrc = readFile('wingman-tower/src/sse-hub.ts');
    const streamSrc = readFile('wingman-tower/src/routes/stream.ts');
    // If the source mentions visibility enforcement, it should clarify it happens
    // on pull (GET /api/v4/records), not at SSE emission time.
    for (const src of [hubSrc, streamSrc]) {
      if (/enforce.*visibility|visibility.*enforce/i.test(src)) {
        expect(src).toMatch(/pull|GET.*records|emission/i);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. owner_payload terminology consistency
// ---------------------------------------------------------------------------

describe('WP7: owner_payload envelope term retired', () => {
  it('canonical contract does not use "owner-payload envelope"', () => {
    const doc = readFile('docs/contract/group-signer-share-contract.md');
    // Should use "owner_payload" directly, not "owner-payload envelope"
    expect(doc).not.toMatch(/owner.payload envelope/i);
  });
});

// ---------------------------------------------------------------------------
// 6. can_write vs write field naming is annotated
// ---------------------------------------------------------------------------

describe('WP7: can_write vs write field naming', () => {
  it('contract doc JSON shape uses can_write (matching DB column)', () => {
    const doc = readFile('docs/contract/group-signer-share-contract.md');
    // The canonical group_payloads JSON shape should use can_write
    expect(doc).toContain('"can_write"');
  });

  it('GroupPayloadInput in types.ts has a comment about write vs can_write', () => {
    const src = readFile('wingman-tower/src/types.ts');
    // The JSDoc on GroupPayloadInput should note that "write" maps to "can_write" in the DB
    expect(src).toMatch(/write.*can_write|can_write.*write/is);
  });
});

// ---------------------------------------------------------------------------
// 7. Glossary disambiguation pairs in canonical contract
// ---------------------------------------------------------------------------

describe('WP7: glossary disambiguation pairs', () => {
  let doc;
  function getDoc() {
    if (!doc) doc = readFile('docs/contract/group-signer-share-contract.md');
    return doc;
  }

  it('has a glossary section', () => {
    expect(getDoc()).toMatch(/## \d+\. Glossary/);
  });

  it('disambiguates group_id vs group_npub', () => {
    expect(getDoc()).toMatch(/group_id.*vs.*group_npub|group_id.*group_npub/is);
  });

  it('disambiguates shares vs group_payloads', () => {
    expect(getDoc()).toMatch(/shares.*vs.*group_payloads|shares.*group_payloads/is);
  });

  it('disambiguates scope-as-organization vs scope-as-auth', () => {
    expect(getDoc()).toMatch(/scope.*organization/is);
    expect(getDoc()).toMatch(/scope.*not.*authorization primitive/is);
  });

  it('disambiguates workspace session key vs group epoch key vs real user key', () => {
    expect(getDoc()).toMatch(/workspace session key.*vs.*group epoch key|workspace session key.*group epoch key.*real user key/is);
  });

  it('disambiguates SSE advisory transport vs pull-time enforcement', () => {
    expect(getDoc()).toMatch(/SSE.*advisory.*transport|SSE.*advisory/is);
    expect(getDoc()).toMatch(/pull.*authoritative|pull.*enforcement/is);
  });
});

// ---------------------------------------------------------------------------
// 8. WP7 decision log exists
// ---------------------------------------------------------------------------

describe('WP7: decision log', () => {
  it('WP7 decision log exists', () => {
    expect(fileExists('docs/log/wp7-terminology-cleanup.md')).toBe(true);
  });
});
