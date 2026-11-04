import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/types.js";
import { validateSettings } from "./settings/validation.js";

export class SettingsStore {
  private value: Settings = structuredClone(DEFAULT_SETTINGS);
  private writeQueue = Promise.resolve();
  private listeners = new Set<(settings: Settings) => void>();
  constructor(private readonly path: string) {}
  async load(): Promise<void> {
    try {
      this.value = validateSettings(
        JSON.parse(await readFile(this.path, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn(
          "Settings could not be loaded; using defaults:",
          (error as Error).message,
        );
    }
  }
  get(): Settings {
    return structuredClone(this.value);
  }
  onChange(listener: (settings: Settings) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async set(value: unknown): Promise<Settings> {
    const settings = validateSettings(value);
    const write = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(temporary, this.path);
      this.value = settings;
      for (const listener of this.listeners) listener(this.get());
    });
    this.writeQueue = write.catch(() => {});
    await write;
    return this.get();
  }
}
