import { app, safeStorage } from "electron";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Host } from "../../src/shared/types.js";
import { CredentialsStoreCache, validateCredentials } from "./credentials.js";

const stores = new CredentialsStoreCache();
const keyFor = (host: Host) =>
  `${host.id}:${createHash("sha256")
    .update(host.endpoint || process.env.REX_SERVER || "local")
    .digest("hex")}`;
function storage() {
  return stores.get(join(app.getPath("userData"), "host-credentials.json"), {
    available: async () =>
      (await safeStorage.isAsyncEncryptionAvailable()) &&
      safeStorage.getSelectedStorageBackend() !== "basic_text",
    encrypt: (value) => safeStorage.encryptStringAsync(value),
    decrypt: async (value) =>
      (await safeStorage.decryptStringAsync(value)).result,
  });
}

/** Endpoint-bound secrets are shared by startup and all window transports. */
export const hostCredentials = {
  get: async (host: Host) => (await storage()).get(keyFor(host)),
  status: async (host: Host) => (await storage()).status(keyFor(host)),
  remove: async (host: Host) => (await storage()).remove(keyFor(host)),
  set: async (host: Host, value: unknown) => {
    if (
      !/^https?:\/\/|^wss?:\/\//i.test(
        host.endpoint || process.env.REX_SERVER || "",
      )
    )
      throw new Error(
        "Use an explicit HTTP(S) endpoint before saving gateway credentials.",
      );
    await (await storage()).set(keyFor(host), validateCredentials(value));
  },
};
