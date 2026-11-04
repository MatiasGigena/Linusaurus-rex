import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { UpdateState } from "../../src/shared/types.js";

const REPOSITORY = "MatiasGigena/Linusaurus-rex";
const RELEASES = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const MAX_PACKAGE = 512 * 1024 * 1024;
type Asset = { name: string; browser_download_url: string; size: number };
type Release = {
  tag_name: string;
  html_url: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: Asset[];
};
export interface UpdateOptions {
  directory: string;
  version: string;
  appImage?: string;
  development?: boolean;
  architecture?: string;
  fetch?: typeof fetch;
  changed?: (state: UpdateState) => void;
  install?: (path: string, kind: UpdateState["installKind"]) => Promise<void>;
  idle?: () => boolean;
}
export function versionParts(value: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) return;
  return { numbers: match.slice(1, 4).map(Number), pre: match[4] };
}
export function newerVersion(next: string, current: string) {
  const n = versionParts(next),
    c = versionParts(current);
  if (!n || !c) return false;
  for (let i = 0; i < 3; i++)
    if (n.numbers[i] !== c.numbers[i]) return n.numbers[i] > c.numbers[i];
  return Boolean(c.pre && !n.pre);
}
function allowedAsset(url: string) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    !parsed.pathname.startsWith(`/${REPOSITORY}/releases/download/`) ||
    parsed.username ||
    parsed.password
  )
    throw new Error(
      "Update assets must belong to this project’s GitHub releases.",
    );
  return parsed.href;
}
export function selectRelease(
  value: unknown,
  current: string,
  kind: UpdateState["installKind"],
  arch = "x64",
): { release: Release; asset: Asset; checksums: Asset } | undefined {
  const release = value as Release;
  if (
    !release ||
    typeof release.tag_name !== "string" ||
    !Array.isArray(release.assets) ||
    release.draft ||
    release.prerelease ||
    !newerVersion(release.tag_name, current)
  )
    return;
  const architecture = arch === "arm64" ? "arm64" : "x86_64";
  const extension =
    kind === "deb"
      ? new RegExp(`_${arch === "arm64" ? "arm64" : "amd64"}\\.deb$`, "i")
      : new RegExp(`(?:${architecture}|x64)?\\.AppImage$`, "i");
  const asset = release.assets.find(
    (asset) =>
      extension.test(asset.name) &&
      !/arm64/i.test(asset.name) === (arch !== "arm64"),
  );
  if (!asset) throw new Error("This release has no compatible Linux package.");
  if (
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > MAX_PACKAGE
  )
    throw new Error("The release package size is invalid.");
  const checksums = release.assets.find((asset) =>
    /^SHA256SUMS(?:[-_.].*)?$/i.test(asset.name),
  );
  if (!checksums)
    throw new Error("This release has no SHA-256 checksum manifest.");
  allowedAsset(asset.browser_download_url);
  allowedAsset(checksums.browser_download_url);
  if (
    typeof release.html_url !== "string" ||
    !release.html_url.startsWith(`https://github.com/${REPOSITORY}/releases/`)
  )
    throw new Error("The release page is invalid.");
  return { release, asset, checksums };
}
export function checksumFor(manifest: string, name: string) {
  for (const line of manifest.split(/\r?\n/)) {
    const match = /^([a-f\d]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (match && match[2].replace(/^\.\//, "") === name)
      return match[1].toLowerCase();
  }
  throw new Error(
    "The release checksum manifest does not include this package.",
  );
}
export async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function replaceAppImage(
  target: string,
  download: string,
  expected: string,
) {
  const current = await stat(target);
  if (!current.isFile())
    throw new Error("The current AppImage is not a regular file.");
  await access(dirname(target), 2);
  if ((await sha256(download)) !== expected)
    throw new Error("The downloaded package changed after verification.");
  const temporary = join(
      dirname(target),
      `.${basename(target)}.linusaurus-${randomUUID()}.tmp`,
    ),
    backup = `${target}.previous`;
  try {
    await copyFile(download, temporary);
    await chmod(temporary, current.mode | 0o100);
    const backupTemporary = `${backup}.${randomUUID()}.tmp`;
    try {
      await copyFile(target, backupTemporary);
      await rename(backupTemporary, backup);
    } finally {
      await rm(backupTemporary, { force: true });
    }
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
async function limitedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const decoder = new TextDecoder();
  let length = 0,
    text = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    length += chunk.byteLength;
    if (length > limit)
      throw new Error("The update metadata exceeds its size limit.");
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}
export class LinuxUpdateManager {
  private state: UpdateState;
  private selected?: ReturnType<typeof selectRelease>;
  private downloaded?: { path: string; sha: string };
  private controller?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private scheduled = false;
  constructor(private options: UpdateOptions) {
    this.state = {
      phase: "idle",
      currentVersion: options.version,
      installKind: options.development
        ? "development"
        : options.appImage
          ? "appimage"
          : "deb",
      canApply: false,
    };
  }
  status() {
    return structuredClone(this.state);
  }
  private publish(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.options.changed?.(this.status());
    return this.status();
  }
  private async request(url: string) {
    const response = await (this.options.fetch || fetch)(url, {
      signal: AbortSignal.any([
        ...(this.controller ? [this.controller.signal] : []),
        AbortSignal.timeout(
          url.endsWith(".AppImage") || url.endsWith(".deb") ? 120_000 : 20_000,
        ),
      ]),
      redirect: "follow",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Linusaurus-Rex/${this.options.version}`,
      },
    });
    if (response.url && !response.url.startsWith("https://"))
      throw new Error("The update server redirected to an insecure address.");
    if (!response.ok)
      throw new Error(
        response.status === 404
          ? "No published release is available yet."
          : `The release server returned HTTP ${response.status}.`,
      );
    return response;
  }
  /**
   * Release fetch/metadata failures resolve with a published phase="error" state.
   * Rejects while another check/download is active. cancel() publishes its state
   * immediately; this operation resolves to the current state when abort handling
   * settles. Callers must handle both rejection and the returned phase.
   */
  async check() {
    if (this.controller)
      throw new Error("An update operation is already in progress.");
    this.controller = new AbortController();
    this.publish({ phase: "checking", error: undefined });
    try {
      const response = await this.request(RELEASES);
      const text = await limitedText(response, 2 * 1024 * 1024);
      if (text.length > 2 * 1024 * 1024)
        throw new Error("Release metadata is too large.");
      this.selected = selectRelease(
        JSON.parse(text),
        this.options.version,
        this.state.installKind,
        this.options.architecture || process.arch,
      );
      this.downloaded = undefined;
      if (!this.selected)
        return this.publish({
          phase: "current",
          canApply: false,
          version: undefined,
          releaseUrl: undefined,
        });
      return this.publish({
        phase: "available",
        version: this.selected.release.tag_name.replace(/^v/, ""),
        releaseUrl: this.selected.release.html_url,
        canApply: false,
      });
    } catch (error) {
      if (this.controller.signal.aborted) return this.status();
      return this.publish({ phase: "error", error: (error as Error).message });
    } finally {
      this.controller = undefined;
    }
  }
  /**
   * Transfer/verification failures resolve with a published phase="error" state;
   * after cancel() publishes its state, the aborted transfer resolves to the
   * current state when abort handling and cleanup settle. Rejects while a check/
   * download is active, without a selected release, or if cleanup itself fails.
   */
  async download() {
    if (this.controller)
      throw new Error("An update operation is already in progress.");
    if (!this.selected) throw new Error("Check for a compatible update first.");
    this.controller = new AbortController();
    const selected = this.selected;
    let path: string | undefined;
    this.publish({
      phase: "downloading",
      bytes: 0,
      total: selected.asset.size,
      error: undefined,
    });
    try {
      const manifest = await limitedText(
        await this.request(selected.checksums.browser_download_url),
        1024 * 1024,
      );
      if (manifest.length > 1024 * 1024)
        throw new Error("The checksum manifest is too large.");
      const expected = checksumFor(manifest, selected.asset.name);
      const response = await this.request(selected.asset.browser_download_url);
      if (!response.body) throw new Error("The download has no data.");
      await mkdir(this.options.directory, { recursive: true });
      path = join(this.options.directory, basename(selected.asset.name));
      const temporary = `${path}.part`;
      const { open } = await import("node:fs/promises");
      const file = await open(temporary, "w", 0o600);
      let bytes = 0;
      const hash = createHash("sha256");
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          bytes += chunk.byteLength;
          if (bytes > MAX_PACKAGE || bytes > selected.asset.size)
            throw new Error("The update exceeds its advertised size.");
          hash.update(chunk);
          await file.write(chunk);
          this.publish({ bytes });
        }
      } finally {
        await file.close();
      }
      if (bytes !== selected.asset.size || hash.digest("hex") !== expected) {
        await rm(temporary, { force: true });
        throw new Error("The update failed SHA-256/size verification.");
      }
      await rename(temporary, path);
      this.downloaded = { path, sha: expected };
      return this.publish({
        phase: "ready",
        canApply: this.state.installKind !== "development",
        error: undefined,
      });
    } catch (error) {
      if (path) await rm(`${path}.part`, { force: true });
      if (this.controller.signal.aborted) return this.status();
      return this.publish({
        phase: "error",
        canApply: false,
        error: (error as Error).message,
      });
    } finally {
      this.controller = undefined;
    }
  }
  /**
   * Rejects missing downloads, development installs, failed verification, and
   * installation failures. With whenIdle, resolves phase="scheduled" after
   * precondition checks. Later idle install failures publish phase="error";
   * they cannot reject the already settled scheduling call.
   */
  async apply(whenIdle = false) {
    if (!this.downloaded)
      throw new Error("Download and verify an update first.");
    if (this.state.installKind === "development")
      throw new Error("Run the packaged Linux client to install an update.");
    if (whenIdle) {
      this.scheduled = true;
      this.publish({ phase: "scheduled" });
      if (!this.timer)
        this.timer = setInterval(() => {
          if (this.scheduled && this.options.idle?.())
            void this.apply(false).catch((error) =>
              this.publish({ phase: "error", error: (error as Error).message }),
            );
        }, 1000);
      return this.status();
    }
    this.scheduled = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const { path, sha } = this.downloaded;
    if ((await sha256(path)) !== sha)
      throw new Error("The downloaded update is no longer verified.");
    if (this.state.installKind === "appimage") {
      if (!this.options.appImage)
        throw new Error("The current AppImage path is unavailable.");
      await replaceAppImage(this.options.appImage, path, sha);
      await this.options.install?.(this.options.appImage, "appimage");
    } else await this.options.install?.(path, "deb");
    return this.publish({ phase: "ready" });
  }
  /**
   * Requests check/download abortion, clears a scheduled install, and immediately
   * publishes/returns ready when a verified download exists, otherwise idle.
   * Aborted operations settle later with the current published state; this call
   * does not wait for their abort handling or partial-file cleanup.
   */
  cancel() {
    this.controller?.abort();
    this.scheduled = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    return this.publish({
      phase: this.downloaded ? "ready" : "idle",
      error: undefined,
    });
  }
  dispose() {
    this.controller?.abort();
    if (this.timer) clearInterval(this.timer);
  }
}
