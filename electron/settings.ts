import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS, type Settings, type Host } from '../src/shared/types.js';

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
export function string(value: unknown, name: string, max = 4096, allowNul = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowNul && value.includes('\0'))) throw new Error(`Invalid ${name}`);
  return value;
}
export function identifier(value: unknown, name: string): string {
  const result = string(value, name, 256);
  if (!result) throw new Error(`Missing ${name}`);
  return result;
}
export function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}

export function validateSettings(value: unknown): Settings {
  const input = record(value);
  if (!Array.isArray(input.hosts) || !input.hosts.length || input.hosts.length > 32) throw new Error('Add between 1 and 32 hosts');
  const hosts = input.hosts.map((value): Host => {
    const host = record(value);
    return { id: identifier(host.id, 'host ID'), label: identifier(host.label, 'host label'), endpoint: string(host.endpoint, 'host endpoint') };
  });
  if (new Set(hosts.map((host) => host.id)).size !== hosts.length) throw new Error('Host IDs must be unique');
  const fontSize = integer(input.fontSize, 'font size', 10, 32);
  const fontFamily = identifier(input.fontFamily, 'font family');
  if (typeof input.sidebarCollapsed !== 'boolean') throw new Error('Invalid sidebar setting');
  let lastSelection: Settings['lastSelection'];
  if (input.lastSelection !== undefined) {
    const selection = record(input.lastSelection);
    const hostId = identifier(selection.hostId, 'selected host');
    if (hosts.some((host) => host.id === hostId)) lastSelection = {
      hostId, sessionId: identifier(selection.sessionId, 'selected session'), windowId: string(selection.windowId, 'selected tab', 256),
    };
  }
  return { hosts, fontSize, fontFamily, sidebarCollapsed: input.sidebarCollapsed, ...(lastSelection ? { lastSelection } : {}) };
}

export class SettingsStore {
  private value: Settings = structuredClone(DEFAULT_SETTINGS);
  private writeQueue = Promise.resolve();
  constructor(private readonly path: string) {}
  async load(): Promise<void> {
    try { this.value = validateSettings(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Settings could not be loaded; using defaults:', (error as Error).message);
    }
  }
  get(): Settings { return structuredClone(this.value); }
  async set(value: unknown): Promise<Settings> {
    const settings = validateSettings(value);
    const write = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
      this.value = settings;
    });
    this.writeQueue = write.catch(() => {});
    await write;
    return this.get();
  }
}

