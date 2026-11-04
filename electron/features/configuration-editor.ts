import type { Host } from "../../src/shared/types.js";
import { attestLocalRex, type LocalRexIdentity } from "../server-management/local-attestation.js";
import { readConfig, writeConfig } from "./config.js";
import { record, string } from "../validation.js";

interface ConfigurationBackend {
  control(host: Host): Promise<{ endpoint: string }>;
  callMethod(
    host: Host,
    method: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
}
type Attest = (endpoint: string, pid: number) => Promise<LocalRexIdentity>;

/** Server paths become local editor targets only after binding the server to its Unix listener. */
export class ConfigurationEditor {
  constructor(
    private backend: ConfigurationBackend,
    private attest: Attest = attestLocalRex,
  ) {}

  async info(
    host: Host,
  ): Promise<{
    path: string;
    editable: boolean;
    content?: string;
    [key: string]: unknown;
  }> {
    const keymap = record(
      await this.backend.callMethod(host, "client.keymap", {}),
    );
    const config = record(keymap.config);
    const path = string(config.path, "configuration path");
    const { endpoint } = await this.backend.control(host);
    let editable = false;
    try {
      const status = record(
        await this.backend.callMethod(host, "server.status", {}),
      );
      if (typeof status.pid === "number") {
        await this.attest(endpoint, status.pid);
        editable = true;
      }
    } catch {
      // Remote servers and Unix proxies can report paths, but cannot grant local file access.
    }
    return {
      ...config,
      path,
      editable,
      ...(editable ? { content: await readConfig(path) } : {}),
    };
  }

  async write(host: Host, content: string): Promise<void> {
    const info = await this.info(host);
    if (!info.editable)
      throw new Error(
        "Edit remote Rex configuration on its host, then use Reload Config.",
      );
    await writeConfig(info.path, content);
  }
}
