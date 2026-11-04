import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SettingsStore, validateSettings } from '../electron/settings.js';
import { DEFAULT_SETTINGS } from '../src/shared/types.js';

test('preferences survive restart and returned objects cannot mutate saved settings', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'linusaurus-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'nested', 'settings.json');
  const store = new SettingsStore(path);
  await store.load();
  const preference = { ...structuredClone(DEFAULT_SETTINGS), fontSize: 32, sidebarCollapsed: true };
  await store.set(preference);
  const returned = store.get();
  returned.hosts[0].label = 'Modified outside the store';
  const reopened = new SettingsStore(path);
  await reopened.load();
  assert.deepEqual(reopened.get(), preference);
  assert.equal(store.get().hosts[0].label, DEFAULT_SETTINGS.hosts[0].label);
});

test('concurrent preference updates leave the last requested value on disk', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'linusaurus-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'settings.json');
  const store = new SettingsStore(path);
  const updates = [14, 20, 18, 32].map((fontSize) => ({ ...structuredClone(DEFAULT_SETTINGS), fontSize }));
  await Promise.all(updates.map((value) => store.set(value)));
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), updates.at(-1));
  assert.deepEqual(store.get(), updates.at(-1));
});

test('invalid settings cannot replace working preferences', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'linusaurus-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'settings.json');
  const store = new SettingsStore(path);
  await store.set(DEFAULT_SETTINGS);
  for (const invalid of [
    { ...DEFAULT_SETTINGS, fontSize: 100 },
    { ...DEFAULT_SETTINGS, sidebarCollapsed: 'yes' },
    { ...DEFAULT_SETTINGS, hosts: [] },
    { ...DEFAULT_SETTINGS, hosts: [DEFAULT_SETTINGS.hosts[0], DEFAULT_SETTINGS.hosts[0]] },
    { ...DEFAULT_SETTINGS, hosts: [{ id: 'bad\0host', label: 'Bad', endpoint: '' }] },
  ]) await assert.rejects(store.set(invalid));
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), DEFAULT_SETTINGS);
});

test('macOS theme names are accepted and unknown theme names are rejected', () => {
  const chosen = validateSettings({ ...DEFAULT_SETTINGS, theme: 'macos-light', lightTheme: 'macos-light', darkTheme: 'macos' });
  assert.equal(chosen.theme, 'macos-light');
  assert.equal(chosen.lightTheme, 'macos-light');
  assert.equal(chosen.darkTheme, 'macos');
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, theme: 'aqua' }));
});

test('removing a host removes a stale selection and strips unknown fields', () => {
  const result = validateSettings({
    ...DEFAULT_SETTINGS,
    lastSelection: { hostId: 'removed', sessionId: 'old-session', windowId: 'old-window' },
    arbitraryCommand: 'not a saved setting',
  });
  assert.equal(result.lastSelection, undefined);
  assert.equal('arbitraryCommand' in result, false);
});

test('corrupt settings fall back to defaults and can be replaced', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'linusaurus-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.method(console, 'warn', () => {});
  const path = join(directory, 'settings.json');
  await writeFile(path, '{ invalid json');
  const store = new SettingsStore(path);
  await store.load();
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  await store.set({ ...DEFAULT_SETTINGS, fontSize: 18 });
  const reopened = new SettingsStore(path);
  await reopened.load();
  assert.equal(reopened.get().fontSize, 18);
});
