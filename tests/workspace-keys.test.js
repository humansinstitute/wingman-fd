import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  rows: new Map(),
  logs: [],
  personalEncryptForNpub: vi.fn(),
  personalDecryptFromNpub: vi.fn(),
}));

vi.mock('../src/auth/nostr.js', () => ({
  personalEncryptForNpub: testState.personalEncryptForNpub,
  personalDecryptFromNpub: testState.personalDecryptFromNpub,
}));

vi.mock('../src/db.js', () => ({
  getSharedDb: () => ({
    workspace_keys: {
      put: async (row) => {
        testState.rows.set(row.workspace_owner_npub, { ...row });
      },
      get: async (workspaceOwnerNpub) => testState.rows.get(workspaceOwnerNpub) || null,
      update: async (workspaceOwnerNpub, patch) => {
        const row = testState.rows.get(workspaceOwnerNpub);
        if (row) testState.rows.set(workspaceOwnerNpub, { ...row, ...patch });
      },
      delete: async (workspaceOwnerNpub) => {
        testState.rows.delete(workspaceOwnerNpub);
      },
    },
  }),
}));

vi.mock('../src/logging.js', () => ({
  flightDeckLog: vi.fn((...args) => {
    testState.logs.push(args);
  }),
}));

async function loadWorkspaceKeys() {
  vi.resetModules();
  const workspaceKeys = await import('../src/crypto/workspace-keys.js');
  workspaceKeys.clearActiveWorkspaceKey();
  return workspaceKeys;
}

describe('workspace key library adapter', () => {
  beforeEach(() => {
    testState.rows.clear();
    testState.logs = [];
    testState.personalEncryptForNpub.mockReset();
    testState.personalDecryptFromNpub.mockReset();
    testState.personalEncryptForNpub.mockImplementation(async (npub, plaintext) => `encrypted:${npub}:${plaintext}`);
  });

  it('preserves Flight Deck active-key shape while using workspace-user-key runtime state', async () => {
    const workspaceKeys = await loadWorkspaceKeys();
    const generated = workspaceKeys.generateWorkspaceSessionKey();

    workspaceKeys.setActiveWorkspaceKey({
      ...generated,
      epoch: 2,
      workspaceOwnerNpub: 'npub1service',
      userNpub: 'npub1user',
    }, { registered: false });

    expect(workspaceKeys.getActiveWorkspaceKey()).toMatchObject({
      npub: generated.npub,
      workspaceUserKeyNpub: generated.npub,
      workspaceOwnerNpub: 'npub1service',
      workspaceServiceNpub: 'npub1service',
      userNpub: 'npub1user',
      epoch: 2,
    });
    expect(workspaceKeys.getActiveWorkspaceKeySecret()).toBe(generated.secret);
    expect(workspaceKeys.getActiveWorkspaceKeySecretForAuth()).toBeNull();
    expect(workspaceKeys.exportWorkspaceKeyForWorker()).toMatchObject({
      npub: generated.npub,
      workspaceUserKeyNpub: generated.npub,
      workspaceOwnerNpub: 'npub1service',
      workspaceServiceNpub: 'npub1service',
      userNpub: 'npub1user',
      registered: false,
    });

    workspaceKeys.markWorkspaceKeyRegistered();
    expect(workspaceKeys.isWorkspaceKeyRegistered()).toBe(true);
    expect(workspaceKeys.getActiveWorkspaceKeySecretForAuth()).toBe(generated.secret);
  });

  it('creates encrypted key blobs with canonical and legacy aliases', async () => {
    const workspaceKeys = await loadWorkspaceKeys();
    const generated = workspaceKeys.generateWorkspaceSessionKey();

    const blob = await workspaceKeys.createEncryptedKeyBlob({
      wsKeyNsec: generated.nsec,
      wsKeyNpub: generated.npub,
      wsKeyEpoch: 3,
      workspaceOwnerNpub: 'npub1service',
      userNpub: 'npub1user',
    });

    expect(testState.personalEncryptForNpub).toHaveBeenCalledWith('npub1user', generated.nsec);
    expect(blob).toMatchObject({
      version: 1,
      workspace_service_npub: 'npub1service',
      workspace_owner_npub: 'npub1service',
      workspace_user_key_npub: generated.npub,
      ws_key_npub: generated.npub,
      workspace_user_key_epoch: 3,
      ws_key_epoch: 3,
      encrypted_nsec: `encrypted:npub1user:${generated.nsec}`,
      encrypted_by_npub: 'npub1user',
    });
  });

  it('decrypts legacy cached key blobs into Flight Deck key shape', async () => {
    const workspaceKeys = await loadWorkspaceKeys();
    const generated = workspaceKeys.generateWorkspaceSessionKey();
    testState.personalDecryptFromNpub.mockResolvedValue(generated.nsec);

    const key = await workspaceKeys.decryptKeyBlob({
      version: 1,
      workspace_owner_npub: 'npub1service',
      ws_key_npub: generated.npub,
      ws_key_epoch: 4,
      encrypted_nsec: 'ciphertext',
      encrypted_by_npub: 'npub1user',
      created_at: '2026-04-23T00:00:00.000Z',
    });

    expect(testState.personalDecryptFromNpub).toHaveBeenCalledWith('npub1user', 'ciphertext');
    expect(key).toMatchObject({
      npub: generated.npub,
      workspaceUserKeyNpub: generated.npub,
      workspaceOwnerNpub: 'npub1service',
      workspaceServiceNpub: 'npub1service',
      userNpub: 'npub1user',
      epoch: 4,
    });
  });

  it('bootstraps new keys through library helpers without changing cached row shape', async () => {
    const workspaceKeys = await loadWorkspaceKeys();
    const onRegister = vi.fn();

    const key = await workspaceKeys.bootstrapWorkspaceSessionKey({
      workspaceOwnerNpub: 'npub1service',
      userNpub: 'npub1user',
      onRegister,
    });
    const row = testState.rows.get('npub1service');

    expect(row).toMatchObject({
      workspace_owner_npub: 'npub1service',
      user_npub: 'npub1user',
      ws_key_npub: key.npub,
      ws_key_epoch: 1,
      registered: false,
    });
    expect(row.encrypted_blob).toMatchObject({
      workspace_service_npub: 'npub1service',
      workspace_owner_npub: 'npub1service',
      workspace_user_key_npub: key.npub,
      ws_key_npub: key.npub,
      encrypted_by_npub: 'npub1user',
    });
    expect(onRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_user_key_npub: key.npub,
        ws_key_npub: key.npub,
      }),
      expect.objectContaining({
        npub: key.npub,
        workspaceUserKeyNpub: key.npub,
        userNpub: 'npub1user',
      }),
    );
    expect(workspaceKeys.getActiveWorkspaceKeyNpub()).toBe(key.npub);
  });

  it('keeps cached-key bootstrap readable and preserves registration retry deferral', async () => {
    const workspaceKeys = await loadWorkspaceKeys();
    const generated = workspaceKeys.generateWorkspaceSessionKey();
    testState.personalDecryptFromNpub.mockResolvedValue(generated.nsec);
    testState.rows.set('npub1service', {
      workspace_owner_npub: 'npub1service',
      user_npub: 'npub1user',
      ws_key_npub: generated.npub,
      ws_key_epoch: 5,
      encrypted_blob: {
        version: 1,
        workspace_owner_npub: 'npub1service',
        ws_key_npub: generated.npub,
        ws_key_epoch: 5,
        encrypted_nsec: 'cached-ciphertext',
        encrypted_by_npub: 'npub1user',
        created_at: '2026-04-23T00:00:00.000Z',
      },
      registered: false,
      cached_at: Date.now(),
    });
    const onRegister = vi.fn(async () => {
      throw new Error('tower unavailable');
    });

    const key = await workspaceKeys.bootstrapWorkspaceSessionKey({
      workspaceOwnerNpub: 'npub1service',
      userNpub: 'npub1user',
      onRegister,
    });

    expect(key).toMatchObject({
      npub: generated.npub,
      workspaceOwnerNpub: 'npub1service',
      userNpub: 'npub1user',
      epoch: 5,
    });
    expect(onRegister).toHaveBeenCalledTimes(1);
    expect(workspaceKeys.isWorkspaceKeyRegistered()).toBe(false);
    expect(testState.logs.some((entry) => entry[2] === 'retry registration failed')).toBe(true);
  });
});
