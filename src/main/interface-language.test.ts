import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { StateStore } from './store';
import type { Settings } from '../shared/types';

const directories: string[] = [];
async function directory() {
  const root = await mkdtemp(path.join(tmpdir(), 'macxus-language-'));
  directories.push(root);
  return root;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('persists language changes across launches without changing game storage or market', async () => {
  const root = await directory();
  const store = new StateStore(root, 'darwin');
  await store.load();
  expect(store.settings.language).toBe('en');
  await store.setSettings({ installRoot: '/Volumes/Storage/Games', market: 'IT', language: 'it' });
  const saved = structuredClone(store.settings);
  const reopened = new StateStore(root, 'darwin'); await reopened.load();
  expect(reopened.settings).toEqual(saved);
  await reopened.setSettings({ language: 'en' });
  expect(reopened.settings).toEqual({ ...saved, language: 'en' });
});

it('migrates older profiles and safely falls back from unknown saved languages', async () => {
  const root = await directory();
  for (const language of [undefined, 'fr', null, 12, 'it']) {
    await writeFile(path.join(root, 'launcher-state.json'), JSON.stringify({ games: [], settings: { language, installRoot: '/Volumes/Games', market: 'IT' } }));
    const store = new StateStore(root, 'darwin'); await store.load();
    expect(store.settings.language).toBe(language === 'it' ? 'it' : 'en');
    expect(store.settings.installRoot).toBe('/Volumes/Games');
    expect(store.settings.market).toBe('IT');
  }
});

it('rejects unsupported language writes without changing the saved state', async () => {
  const root = await directory();
  const store = new StateStore(root, 'darwin'); await store.load();
  await store.setSettings({ language: 'it' });
  const before = await readFile(path.join(root, 'launcher-state.json'), 'utf8');
  await expect(store.setSettings({ language: 'fr' as Settings['language'] })).rejects.toThrow('Unsupported interface language');
  expect(await readFile(path.join(root, 'launcher-state.json'), 'utf8')).toBe(before);
  expect(store.settings.language).toBe('it');
});
