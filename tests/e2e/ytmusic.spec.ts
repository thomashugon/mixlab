// YouTube Music flow on the real Electron app, against the helper's offline fake backend
// (MIXLAB_YTM_FAKE=1): connect, browse, fetch tracks, find them analysed in the library.
// Needs a Python ≥ 3.10 (MIXLAB_PYTHON or python3); skipped otherwise.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const python = process.env.MIXLAB_PYTHON || 'python3';
const pyOk = (() => {
  const r = spawnSync(python, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)']);
  return r.status === 0;
})();

let app: ElectronApplication;
let win: Page;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mixlab-ytm-e2e-'));

test.skip(!pyOk, 'Python ≥ 3.10 introuvable');

test.beforeAll(async () => {
  app = await electron.launch({
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, MIXLAB_USER_DATA: userData, MIXLAB_YTM_FAKE: '1', MIXLAB_YTM_PYTHON: python },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
});
test.afterAll(async () => {
  // The project has unsaved tracks: skip the "save changes?" dialog on close.
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()));
  await app?.close();
});

test('connects with pasted headers, rejecting incomplete ones', async () => {
  await win.getByTestId('ytm-open').click();
  const headers = win.getByTestId('ytm-headers');
  await expect(headers).toBeVisible();
  await headers.fill('accept: */*\nuser-agent: test');
  await win.getByTestId('ytm-connect').click();
  await expect(win.locator('.ytm-note-problem')).toContainText('x-goog-authuser');
  await headers.fill('cookie:\nSAPISID=abc; HSID=1\nx-goog-authuser:\n0');
  await win.getByTestId('ytm-connect').click();
  await expect(win.locator('.modal-subtitle')).toContainText('Compte de test');
  // Liked songs open first.
  await expect(win.getByTestId('ytm-track')).toHaveCount(1);
  await expect(win.getByTestId('ytm-track')).toContainText('Deep Echo');
  expect(fs.readFileSync(path.join(userData, 'ytmusic', 'cookies.txt'), 'utf8')).toContain('SAPISID\tabc');
});

test('fetches a playlist into the library, where the tracks get analysed', async () => {
  await win.getByTestId('ytm-playlist').filter({ hasText: 'Warm-up' }).click();
  await expect(win.getByTestId('ytm-track')).toHaveCount(2);
  await win.getByRole('button', { name: /Tout sélectionner/ }).click();
  await expect(win.getByTestId('ytm-fetch')).toHaveText('Récupérer 2 morceaux');
  await win.getByTestId('ytm-fetch').click();
  await expect(win.locator('[data-testid=library-row]')).toHaveCount(2, { timeout: 60_000 });
  await expect(win.locator('.lib-row.status-ready')).toHaveCount(2, { timeout: 120_000 });
  await expect(win.locator('.lib-row.status-ready').first()).toContainText(/Sunrise Groove|Night Drive/);
  await expect(win.locator('.lib-row.status-ready').first().locator('.chip').first()).toContainText(/1[12]\d/);
  await expect(win.getByTestId('ytm-track').first()).toContainText('Bibliothèque');
  for (const id of ['fk1', 'fk2']) expect(fs.existsSync(path.join(userData, 'ytmusic', 'audio', `${id}.m4a`))).toBe(true);
});

test('searches the catalogue', async () => {
  await win.getByRole('button', { name: 'Rechercher' }).click();
  await win.getByTestId('ytm-search').fill('echo');
  await win.getByTestId('ytm-search').press('Enter');
  await expect(win.getByTestId('ytm-track')).toHaveCount(1);
  await expect(win.getByTestId('ytm-track')).toContainText('Echo Unit');
  await win.screenshot({ path: path.join(root, '.dev', 'ytmusic-browser.png') });
});
