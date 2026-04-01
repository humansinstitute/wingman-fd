import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * WP1 Contract Tests — Canonical Group, Signer, and Share Contract
 *
 * These tests validate that the canonical contract document exists and
 * makes the three signer/key roles, the shares vs group_payloads
 * distinction, and the group identity model explicitly identifiable
 * by a new engineer reading the repo.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const CONTRACT_PATH = path.join(REPO_ROOT, 'docs', 'contract', 'group-signer-share-contract.md');
const TOWER_TYPES_PATH = path.join(REPO_ROOT, 'wingman-tower', 'src', 'types.ts');
const TOWER_AUTH_PATH = path.join(REPO_ROOT, 'wingman-tower', 'src', 'auth.ts');

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

describe('WP1: canonical contract document', () => {
  let contractDoc;

  it('contract document exists', () => {
    expect(fs.existsSync(CONTRACT_PATH)).toBe(true);
    contractDoc = readFile(CONTRACT_PATH);
  });

  // --- Three signer/key roles are explicitly named ---

  it('defines the real user key role', () => {
    contractDoc = contractDoc || readFile(CONTRACT_PATH);
    expect(contractDoc).toContain('Real user identity');
    expect(contractDoc).toMatch(/bootstrap/i);
    expect(contractDoc).toMatch(/fallback/i);
  });

  it('defines the workspace session key role', () => {
    contractDoc = contractDoc || readFile(CONTRACT_PATH);
    expect(contractDoc).toContain('Workspace session key');
    expect(contractDoc).toMatch(/NIP-98/);
    expect(contractDoc).toMatch(/signature_npub/);
    expect(contractDoc).toMatch(/owner_payload/i);
  });

  it('defines the group epoch key role', () => {
    contractDoc = contractDoc || readFile(CONTRACT_PATH);
    expect(contractDoc).toContain('group epoch key');
    expect(contractDoc).toMatch(/group_payloads/);
    expect(contractDoc).toMatch(/write proof/i);
  });

  // --- Shares vs group_payloads distinction ---

  it('distinguishes shares as stable policy metadata', () => {
    contractDoc = contractDoc || readFile(CONTRACT_PATH);
    expect(contractDoc).toMatch(/shares.*stable.*policy|stable.*policy.*shares/is);
    expect(contractDoc).toMatch(/shares.*must not.*rotating|shares.*should not.*rotating/is);
  });

  it('distinguishes group_payloads as encrypted delivery', () => {
    contractDoc = contractDoc || readFile(CONTRACT_PATH);
    expect(contractDoc).toMatch(/group_payloads.*encrypted.*delivery|encrypted.*delivery.*group_payloads/is);
  });

  // --- Group identity model ---

  it('defines group_id as the stable durable identity', () => {
    contractDoc = contractDoc || readFile(CONTRACT_PATH);
    expect(contractDoc).toMatch(/group_id.*stable|group_id.*durable/is);
  });

  it('defines group_npub as rotating crypto identity', () => {
    contractDoc = contractDoc || readFile(CONTRACT_PATH);
    expect(contractDoc).toMatch(/group_npub.*rotating|group_npub.*epoch/is);
  });

  // --- Provenance fields excluded from canonical access model ---

  it('excludes provenance fields from the canonical access model', () => {
    contractDoc = contractDoc || readFile(CONTRACT_PATH);
    expect(contractDoc).toMatch(/group_kind.*not.*canonical|provenance.*not.*canonical|provenance.*optional/is);
  });

  // --- JSON shapes are specified ---

  it('includes the canonical shares JSON shape', () => {
    contractDoc = contractDoc || readFile(CONTRACT_PATH);
    expect(contractDoc).toContain('"type": "group"');
    expect(contractDoc).toContain('"group_id"');
    expect(contractDoc).toContain('"access"');
  });

  it('includes the canonical group_payloads JSON shape', () => {
    contractDoc = contractDoc || readFile(CONTRACT_PATH);
    expect(contractDoc).toContain('"group_epoch"');
    expect(contractDoc).toContain('"ciphertext"');
    expect(contractDoc).toContain('"can_write"');
  });
});

describe('WP1: Tower types document signer roles', () => {
  let typesContent;

  it('Tower types.ts exists', () => {
    expect(fs.existsSync(TOWER_TYPES_PATH)).toBe(true);
    typesContent = readFile(TOWER_TYPES_PATH);
  });

  it('ResolvedAuth documents signer vs user identity', () => {
    // ResolvedAuth lives in auth.ts — it is the contract boundary for signer resolution
    const authContent = readFile(TOWER_AUTH_PATH);
    expect(authContent).toMatch(/signerNpub/);
    expect(authContent).toMatch(/userNpub/);
    expect(authContent).toMatch(/workspace.*session.*key|session.*key/is);
  });

  it('SyncRecordInput documents write_group_id vs write_group_npub', () => {
    typesContent = typesContent || readFile(TOWER_TYPES_PATH);
    expect(typesContent).toMatch(/write_group_id/);
    expect(typesContent).toMatch(/write_group_npub/);
    // Should have a comment explaining that write_group_id is preferred
    expect(typesContent).toMatch(/prefer.*write_group_id|write_group_id.*prefer|stable.*write_group_id/is);
  });

  it('GroupPayloadInput documents epoch crypto context', () => {
    typesContent = typesContent || readFile(TOWER_TYPES_PATH);
    expect(typesContent).toMatch(/group_epoch/);
    expect(typesContent).toMatch(/group_npub/);
  });

  it('signature_npub is documented as potentially a workspace key', () => {
    typesContent = typesContent || readFile(TOWER_TYPES_PATH);
    // The signature_npub field should explain it may be a workspace session key
    expect(typesContent).toMatch(/signature_npub.*workspace|signature_npub.*session/is);
  });
});
