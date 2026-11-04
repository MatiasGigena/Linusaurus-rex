import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

export interface HostCredentials {
  username?: string;
  password?: string;
  token?: string;
}
export interface CredentialCipher {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}

/** Secrets never enter settings.json or a renderer read API. */
export class CredentialsStore {
  private values: Record<string, string> = Object.create(null);
  private queue = Promise.resolve();
  constructor(
    private path: string,
    private cipher: CredentialCipher,
  ) {}
  async load() {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Invalid credential storage.");
      const values: Record<string, string> = Object.create(null);
      for (const [id, value] of Object.entries(parsed)) {
        if (typeof value !== "string" || value.length >= 64 * 1024)
          throw new Error("Invalid encrypted credential entry.");
        values[id] = value;
      }
      this.values = values;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Saved Rex credentials could not be loaded. Repair the credential file before saving changes.",
          { cause },
        );
      this.values = Object.create(null);
    }
  }
  async status(hostId: string) {
    return {
      stored: Boolean(this.values[hostId]),
      secureStorageAvailable: await this.cipher.available(),
    };
  }
  async get(hostId: string): Promise<HostCredentials | undefined> {
    if (!this.values[hostId]) return undefined;
    if (!(await this.cipher.available()))
      throw new Error(
        "The desktop secret store is locked or unavailable. Unlock it before connecting.",
      );
    try {
      return validateCredentials(
        JSON.parse(
          await this.cipher.decrypt(Buffer.from(this.values[hostId], "base64")),
        ),
      );
    } catch (cause) {
      throw new Error(
        "Saved credentials could not be unlocked. Re-enter them in host settings.",
        { cause },
      );
    }
  }
  async set(hostId: string, credentials: HostCredentials) {
    const value = validateCredentials(credentials);
    if (!(await this.cipher.available()))
      throw new Error(
        "A secure desktop secret store is required to save credentials. Enable a keyring, then try again.",
      );
    const encrypted = (
      await this.cipher.encrypt(JSON.stringify(value))
    ).toString("base64");
    await this.update(hostId, encrypted);
  }
  async remove(hostId: string) {
    await this.update(hostId, undefined);
  }
  private update(hostId: string, value: string | undefined) {
    const write = this.queue.then(async () => {
      const next: Record<string, string> = Object.assign(
        Object.create(null),
        this.values,
      );
      if (value === undefined) delete next[hostId];
      else next[hostId] = value;
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, this.path);
      this.values = next;
    });
    this.queue = write.catch(() => {});
    return write;
  }
}

/** Share initialization without allowing a failed read to poison future attempts. */
export class CredentialsStoreCache {
  private stores = new Map<string, Promise<CredentialsStore>>();
  get(path: string, cipher: CredentialCipher): Promise<CredentialsStore> {
    const existing = this.stores.get(path);
    if (existing) return existing;
    const store = new CredentialsStore(path, cipher);
    const pending = store.load().then(() => store);
    this.stores.set(path, pending);
    void pending.catch(() => {
      if (this.stores.get(path) === pending) this.stores.delete(path);
    });
    return pending;
  }
}

export function validateCredentials(value: unknown): HostCredentials {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid host credentials.");
  const input = value as Record<string, unknown>;
  const result: HostCredentials = {};
  for (const key of ["username", "password", "token"] as const) {
    if (input[key] === undefined || input[key] === "") continue;
    if (
      typeof input[key] !== "string" ||
      input[key].length > 8192 ||
      /[\0\r\n]/.test(input[key])
    )
      throw new Error(`Invalid credential ${key}.`);
    result[key] = input[key];
  }
  if (!result.password && !result.token)
    throw new Error("Enter a password or access token.");
  if (result.password && !result.username)
    throw new Error("A username is required with a password.");
  if (result.password && result.token)
    throw new Error("Use either password authentication or a token.");
  return result;
}
