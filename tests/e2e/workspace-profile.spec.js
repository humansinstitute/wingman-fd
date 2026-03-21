import fs from 'node:fs';
import path from 'node:path';

import { test, expect } from 'playwright/test';

function readFirstEnvValue(candidates) {
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.filePath)) continue;
    const lines = fs.readFileSync(candidate.filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.startsWith(`${candidate.key}=`)) continue;
      const value = line.slice(candidate.key.length + 1).trim();
      if (value) return value;
    }
  }
  return '';
}

function resolveTestingNsec() {
  return String(
    process.env.PLAYWRIGHT_TEST_NSEC
    || process.env.TESTING_NSEC
    || readFirstEnvValue([
      {
        filePath: '/Users/mini/code/wingmanbefree/wingman-tower/.env',
        key: 'COWORKER_APP_NSEC',
      },
      {
        filePath: '/Users/mini/code/wingmanbefree/sb-publisher/.env',
        key: 'SB_PUBLISHER_NSEC',
      },
    ])
    || ''
  ).trim();
}

const testingNsec = resolveTestingNsec();
const avatarFixturePath = path.resolve('tests/e2e/fixtures/workspace-avatar.svg');

async function loginWithSecret(page, nsec) {
  await page.goto('/');
  await page.locator('details.auth-advanced summary').click();
  await page.locator('input[name="secret"]').fill(nsec);
  await page.getByRole('button', { name: 'BYO Nsec' }).click();
  await expect(page.locator('.auth-error:visible')).toHaveCount(0);
}

async function createWorkspace(page, workspaceName) {
  const bootstrapModal = page.locator('.modal').filter({ hasText: 'Create Workspace' });
  if (await bootstrapModal.isVisible().catch(() => false)) {
    await bootstrapModal.locator('input[placeholder="Wingmen"]').fill(workspaceName);
    await bootstrapModal.locator('textarea[placeholder="Optional description"]').fill('Playwright workspace bootstrap');
    await bootstrapModal.getByRole('button', { name: 'Create workspace' }).click();
    return;
  }

  const workspaceTrigger = page.locator('.sidebar-workspace-trigger');
  await expect(workspaceTrigger).toBeVisible();
  await workspaceTrigger.click();
  await page.getByRole('button', { name: 'Add workspace...' }).click();

  const connectModal = page.locator('.modal').filter({ hasText: 'Connect to SuperBased' });
  await expect(connectModal).toBeVisible();
  await connectModal.locator('.connect-host-row').first().click();

  const selectModal = page.locator('.modal').filter({ hasText: 'Select Workspace' });
  await expect(selectModal).toBeVisible();
  await selectModal.locator('input[placeholder="My workspace"]').fill(workspaceName);
  await selectModal.locator('input[placeholder=""]').fill('Playwright workspace bootstrap');
  await selectModal.getByRole('button', { name: 'Create workspace' }).click();
}

async function openWorkspaceSettings(page) {
  await page.locator('.sidebar-nav li').filter({ hasText: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace' })).toBeVisible();
}

test.describe('workspace profile', () => {
  test.skip(!testingNsec, 'No testing nsec found in PLAYWRIGHT_TEST_NSEC, TESTING_NSEC, or /wingmanbefree env files.');

  test('logs in, creates a workspace, and updates the name and avatar', async ({ page }) => {
    const workspaceName = `PW Workspace ${Date.now()}`;
    const renamedWorkspace = `${workspaceName} Updated`;

    await loginWithSecret(page, testingNsec);
    await createWorkspace(page, workspaceName);

    await expect(page.locator('.auth-error:visible')).toHaveCount(0);
    await expect(page.locator('.error-text:visible')).toHaveCount(0);
    await expect(page.locator('.sidebar-workspace-name')).toContainText(workspaceName);

    await openWorkspaceSettings(page);

    const workspaceNameInput = page.locator('#workspace-name-input');
    await expect(workspaceNameInput).toHaveValue(workspaceName);
    await workspaceNameInput.fill(renamedWorkspace);
    await page.locator('#workspace-description-input').fill('Updated by Playwright');
    await page.locator('.workspace-avatar-settings-input').setInputFiles(avatarFixturePath);

    const saveButton = page.getByRole('button', { name: 'Save workspace' });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.locator('.error-text:visible')).toHaveCount(0);
    await expect(saveButton).toBeDisabled();
    await expect(page.locator('.sidebar-workspace-name')).toContainText(renamedWorkspace);

    await page.reload();
    await expect(page.locator('.sidebar-workspace-name')).toContainText(renamedWorkspace);

    await openWorkspaceSettings(page);
    await expect(page.locator('#workspace-name-input')).toHaveValue(renamedWorkspace);
    await expect(page.locator('.workspace-avatar-settings-preview')).toHaveCount(1);
    await expect(page.locator('.workspace-avatar-settings-preview').first()).toBeVisible();
  });
});
