import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  prepareRelease,
  packages,
  ownershipMarker,
  assertOwnedDraft,
  verifyReleaseAssets,
  publishRelease,
  type ReleaseMetadata,
  type ReleaseAsset,
} from "../scripts/release-assets.mjs";
const execute = promisify(execFile);
const tag = "v1.2.3",
  sha = "a".repeat(40);
const checksum = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-release-"));
  await writeFile(
    join(directory, "Linusaurus Rex-1.2.3.AppImage"),
    "AppImage fixture",
  );
  await writeFile(
    join(directory, "linusaurus-rex_1.2.3_amd64.deb"),
    "Debian fixture",
  );
  return directory;
}
function remoteAsset(name: string, bytes: string | Buffer): ReleaseAsset {
  return {
    name,
    size: Buffer.byteLength(bytes),
    digest: `sha256:${checksum(bytes)}`,
    state: "uploaded",
  };
}

test("release CLI normalizes the actual space-containing AppImage before creating portable SHA sums", async () => {
  const directory = await fixture();
  try {
    await execute(process.execPath, [
      resolve("scripts/release-assets.mjs"),
      "prepare",
      directory,
      tag,
    ]);
    const records = await packages(directory);
    assert.equal(records[0].name, "Linusaurus-Rex-1.2.3-x86_64.AppImage");
    assert.ok(records.every((record) => !record.name.includes(" ")));
    await execute("bash", ["-c", "sha256sum --check SHA256SUMS"], {
      cwd: directory,
    });
    assert.equal(records[0].sha256, checksum("AppImage fixture"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("remote proof rejects Github filename normalization, changed digests and a mismatched uploaded manifest", async () => {
  const directory = await fixture();
  try {
    const records = await prepareRelease(directory, tag),
      manifest = await readFile(join(directory, "SHA256SUMS"), "utf8");
    const release: ReleaseMetadata = {
      tag_name: tag,
      draft: true,
      body: ownershipMarker(tag, sha),
      assets: [
        ...records.map((record) => ({
          name: record.name,
          size: record.size,
          digest: `sha256:${record.sha256}`,
          state: "uploaded",
        })),
        remoteAsset("SHA256SUMS", manifest),
      ],
    };
    assert.equal(verifyReleaseAssets(release, manifest, records), true);
    assert.throws(
      () =>
        verifyReleaseAssets(
          {
            ...release,
            assets: release.assets.map((asset, index) =>
              index === 0
                ? {
                    ...asset,
                    name: asset.name.replace(
                      "Linusaurus-Rex",
                      "Linusaurus.Rex",
                    ),
                  }
                : asset,
            ),
          },
          manifest,
          records,
        ),
      /mismatch/,
    );
    assert.throws(
      () =>
        verifyReleaseAssets(
          {
            ...release,
            assets: release.assets.map((asset, index) =>
              index === 0
                ? { ...asset, digest: "sha256:" + "0".repeat(64) }
                : asset,
            ),
          },
          manifest,
          records,
        ),
      /mismatch/,
    );
    assert.throws(
      () =>
        verifyReleaseAssets(
          release,
          manifest.replace("Linusaurus-Rex", "Renamed-Rex"),
          records,
        ),
      /mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("published and unrelated drafts are refused before any Github mutation", async () => {
  const directory = await fixture();
  try {
    await prepareRelease(directory, tag);
    for (const release of [
      {
        tag_name: tag,
        draft: false,
        body: ownershipMarker(tag, sha),
        assets: [],
      },
      {
        tag_name: tag,
        draft: true,
        body: "Maintainer draft notes",
        assets: [],
      },
    ]) {
      const calls: string[][] = [];
      await assert.rejects(
        publishRelease({
          directory,
          tag,
          sha,
          gh: async (args) => {
            calls.push(args);
            return JSON.stringify(release);
          },
        }),
        /immutable|not owned/,
      );
      assert.deepEqual(
        calls.map((args) => args[0]),
        ["api"],
      );
    }
    assert.throws(
      () =>
        assertOwnedDraft(
          {
            tag_name: tag,
            draft: true,
            body: ownershipMarker(tag, "b".repeat(40)),
            assets: [],
          },
          tag,
          sha,
        ),
      /not owned/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("owned draft retries reuse verified completed bytes and upload only missing files before proof-gated publication", async () => {
  const directory = await fixture();
  try {
    await prepareRelease(directory, tag);
    const image = "Linusaurus-Rex-1.2.3-x86_64.AppImage";
    const uploaded = new Map<string, Buffer>([
      [image, Buffer.from("older valid archive of the same commit")],
    ]);
    const release: ReleaseMetadata = {
      tag_name: tag,
      draft: true,
      body: ownershipMarker(tag, sha),
      assets: [remoteAsset(image, uploaded.get(image)!)],
      html_url: "https://example.test/release",
    };
    const calls: string[][] = [];
    const gh = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "api") return JSON.stringify(release);
      if (args[1] === "download") {
        const name = args[args.indexOf("--pattern") + 1];
        await writeFile(
          args[args.indexOf("--output") + 1],
          uploaded.get(name)!,
        );
        return "";
      }
      if (args[1] === "upload") {
        const path = args[3],
          name = basename(path);
        assert.equal(
          uploaded.has(name),
          false,
          "No completed asset may be overwritten",
        );
        const bytes = await readFile(path);
        uploaded.set(name, bytes);
        release.assets.push(remoteAsset(name, bytes));
        return "";
      }
      if (args[1] === "edit") {
        verifyReleaseAssets(
          release,
          uploaded.get("SHA256SUMS")!.toString(),
          await packages(directory),
        );
        release.draft = false;
        return "";
      }
      throw new Error(`Unexpected GH operation: ${args.join(" ")}`);
    };
    await publishRelease({ directory, tag, sha, gh });
    assert.equal(release.draft, false);
    assert.equal(
      await readFile(join(directory, image), "utf8"),
      "older valid archive of the same commit",
    );
    assert.equal(
      calls.some(
        (args) => args.includes("--clobber") || args[1] === "delete-asset",
      ),
      false,
    );
    assert.equal(calls.filter((args) => args[1] === "upload").length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed empty starter upload in an owned draft is retryable without replacing completed assets", async () => {
  const directory = await fixture();
  try {
    await prepareRelease(directory, tag);
    const records = await packages(directory),
      uploaded = new Map<string, Buffer>();
    const release: ReleaseMetadata = {
      tag_name: tag,
      draft: true,
      body: ownershipMarker(tag, sha),
      assets: [{ name: records[0].name, size: 0, state: "starter" }],
    };
    const removed: string[] = [];
    const gh = async (args: string[]) => {
      if (args[0] === "api") return JSON.stringify(release);
      if (args[1] === "delete-asset") {
        removed.push(args[3]);
        release.assets = release.assets.filter(
          (asset) => asset.name !== args[3],
        );
        return "";
      }
      if (args[1] === "upload") {
        const name = basename(args[3]),
          bytes = await readFile(args[3]);
        assert.equal(uploaded.has(name), false);
        uploaded.set(name, bytes);
        release.assets.push(remoteAsset(name, bytes));
        return "";
      }
      if (args[1] === "download") {
        await writeFile(
          args[args.indexOf("--output") + 1],
          uploaded.get(args[args.indexOf("--pattern") + 1])!,
        );
        return "";
      }
      if (args[1] === "edit") {
        release.draft = false;
        return "";
      }
      throw new Error("Unexpected operation");
    };
    await publishRelease({ directory, tag, sha, gh });
    assert.deepEqual(removed, [records[0].name]);
    assert.equal(release.draft, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "the actual published v0.3.0 API metadata and corrected manifest satisfy the remote proof",
  { skip: !process.env.PUBLISHED_RELEASE_DIR },
  async () => {
    const response = await fetch(
      "https://api.github.com/repos/MatiasGigena/Linusaurus-rex/releases/tags/v0.3.0",
    );
    assert.ok(response.ok);
    const release = (await response.json()) as ReleaseMetadata;
    const directory = process.env.PUBLISHED_RELEASE_DIR!;
    const manifest = await readFile(join(directory, "SHA256SUMS"), "utf8");
    assert.equal(
      verifyReleaseAssets(release, manifest, await packages(directory)),
      true,
    );
  },
);

test("a new draft is created with commit ownership and remains unpublished if GitHub changes an uploaded name", async () => {
  const directory = await fixture();
  try {
    await prepareRelease(directory, tag);
    let release: ReleaseMetadata | undefined;
    const uploaded = new Map<string, Buffer>();
    let published = false;
    const gh = async (args: string[]) => {
      if (args[0] === "api") {
        if (args[1].includes("releases?"))
          return JSON.stringify(release ? [release] : []);
        if (!release)
          throw Object.assign(new Error("Release not found"), {
            stderr: "HTTP 404",
          });
        return JSON.stringify(release);
      }
      if (args[1] === "create") {
        const body = await readFile(
          args[args.indexOf("--notes-file") + 1],
          "utf8",
        );
        assert.ok(body.includes(ownershipMarker(tag, sha)));
        release = { tag_name: tag, draft: true, body, assets: [] };
        return "";
      }
      if (args[1] === "upload") {
        const name = basename(args[3]),
          bytes = await readFile(args[3]);
        uploaded.set(name, bytes);
        const remote = remoteAsset(name, bytes);
        if (name.endsWith(".AppImage"))
          remote.name = name.replace("Linusaurus-Rex", "Linusaurus.Rex");
        release!.assets.push(remote);
        return "";
      }
      if (args[1] === "download") {
        await writeFile(
          args[args.indexOf("--output") + 1],
          uploaded.get(args[args.indexOf("--pattern") + 1])!,
        );
        return "";
      }
      if (args[1] === "edit") {
        published = true;
        return "";
      }
      throw new Error("Unexpected operation");
    };
    await assert.rejects(
      publishRelease({ directory, tag, sha, gh }),
      /mismatch/,
    );
    assert.equal(published, false);
    assert.equal(release!.draft, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("draft creation and uploads succeed when the tag route stays404 and authenticated page2 contains the draft", async () => {
  const directory = await fixture();
  try {
    await prepareRelease(directory, tag);
    let release: ReleaseMetadata | undefined;
    const calls: string[][] = [],
      uploaded = new Map<string, Buffer>(),
      unrelated = { tag_name: "v9.9.9", draft: false, assets: [] };
    const gh = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "api") {
        if (args[1].includes("/releases/tags/"))
          throw Object.assign(new Error("Not Found"), { stderr: "HTTP 404" });
        if (args[1].endsWith("releases?per_page=100&page=1"))
          return JSON.stringify(Array.from({ length: 100 }, () => unrelated));
        if (args[1].endsWith("releases?per_page=100&page=2"))
          return JSON.stringify(release ? [release] : []);
        throw new Error(`Unexpected API route: ${args[1]}`);
      }
      if (args[1] === "create") {
        const body = await readFile(
          args[args.indexOf("--notes-file") + 1],
          "utf8",
        );
        release = {
          tag_name: tag,
          draft: true,
          body,
          assets: [],
          html_url:
            "https://github.com/MatiasGigena/Linusaurus-rex/releases/tag/untagged-draft",
        };
        return "";
      }
      if (args[1] === "upload") {
        const name = basename(args[3]),
          bytes = await readFile(args[3]);
        assert.equal(uploaded.has(name), false);
        uploaded.set(name, bytes);
        release!.assets.push(remoteAsset(name, bytes));
        return "";
      }
      if (args[1] === "download") {
        await writeFile(
          args[args.indexOf("--output") + 1],
          uploaded.get(args[args.indexOf("--pattern") + 1])!,
        );
        return "";
      }
      if (args[1] === "edit") {
        verifyReleaseAssets(
          release!,
          uploaded.get("SHA256SUMS")!.toString(),
          await packages(directory),
        );
        release!.draft = false;
        return "";
      }
      throw new Error(`Unexpected GH operation: ${args.join(" ")}`);
    };
    assert.equal(
      await publishRelease({ directory, tag, sha, gh }),
      `https://github.com/MatiasGigena/Linusaurus-rex/releases/tag/${tag}`,
    );
    assert.equal(release?.draft, false);
    assert.equal(calls.filter((args) => args[1] === "create").length, 1);
    assert.ok(
      calls.filter((args) => args[0] === "api" && args[1].endsWith("&page=2"))
        .length > 1,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("authenticated draft discovery refuses duplicate exact tags, malformed pages and API failures before mutation", async () => {
  const directory = await fixture();
  try {
    await prepareRelease(directory, tag);
    const owned = {
        tag_name: tag,
        draft: true,
        body: ownershipMarker(tag, sha),
        assets: [],
      },
      other = { ...owned, tag_name: "v8.8.8" };
    for (const scenario of [
      {
        pages: [
          [{ ...owned }, ...Array.from({ length: 99 }, () => other)],
          [{ ...owned }],
        ],
        message: /Multiple/,
      },
      { pages: [{}], message: /invalid release list/ },
      { pages: [[null]], message: /invalid release metadata/ },
      {
        pages: [[{ tag_name: tag, draft: true }]],
        message: /invalid release metadata/,
      },
      {
        pages: [[...Array.from({ length: 101 }, () => other)]],
        message: /invalid release list/,
      },
      {
        pages: [[{ ...owned, body: "Maintainer notes" }]],
        message: /not owned/,
      },
      { pages: [[{ ...owned, draft: false }]], message: /immutable/ },
    ]) {
      let page = 0;
      await assert.rejects(
        publishRelease({
          directory,
          tag,
          sha,
          gh: async (args) => {
            assert.equal(
              args[0],
              "api",
              "Invalid discovery must not mutate GitHub",
            );
            if (args[1].includes("/tags/"))
              throw Object.assign(new Error("Not Found"), {
                stderr: "HTTP 404",
              });
            assert.equal(
              args[1],
              `repos/MatiasGigena/Linusaurus-rex/releases?per_page=100&page=${page + 1}`,
            );
            return JSON.stringify(scenario.pages[page++]);
          },
        }),
        scenario.message,
      );
    }
    for (const code of [401, 403, 500]) {
      let count = 0;
      await assert.rejects(
        publishRelease({
          directory,
          tag,
          sha,
          gh: async (args) => {
            count++;
            assert.equal(args[0], "api");
            throw Object.assign(new Error(`HTTP ${code}`), {
              stderr: `HTTP ${code}`,
            });
          },
        }),
        new RegExp(`HTTP ${code}`),
      );
      assert.equal(
        count,
        1,
        "Only an actual tag HTTP404 may invoke draft list fallback",
      );
    }
    let pages = 0;
    await assert.rejects(
      publishRelease({
        directory,
        tag,
        sha,
        gh: async (args) => {
          assert.equal(args[0], "api");
          if (args[1].includes("/tags/"))
            throw Object.assign(new Error("Not Found"), { stderr: "HTTP 404" });
          pages++;
          return JSON.stringify(Array.from({ length: 100 }, () => other));
        },
      }),
      /bounded 100-page/,
    );
    assert.equal(pages, 100);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
