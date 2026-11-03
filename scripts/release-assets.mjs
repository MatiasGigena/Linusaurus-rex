import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readdir,
  readFile,
  writeFile,
  rename,
  stat,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const REPOSITORY = "MatiasGigena/Linusaurus-rex";
const execute = promisify(execFile);
const safeName = (name) =>
  typeof name === "string" &&
  /^[a-zA-Z0-9._-]+$/.test(name) &&
  name !== "." &&
  name !== "..";
const stableTag = (tag) => /^v\d+\.\d+\.\d+$/.test(tag || "");
export async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function packages(directory) {
  const names = (await readdir(directory))
    .filter((name) => /\.AppImage$|\.deb$/.test(name))
    .sort();
  if (
    names.filter((name) => name.endsWith(".AppImage")).length !== 1 ||
    names.filter((name) => name.endsWith(".deb")).length !== 1
  )
    throw new Error(
      "A release needs exactly one AppImage and one Debian package.",
    );
  const records = [];
  for (const name of names) {
    if (!safeName(name)) throw new Error(`Unsafe release filename: ${name}`);
    const path = join(directory, name),
      info = await stat(path);
    if (!info.isFile() || !info.size)
      throw new Error(`Invalid release package: ${name}`);
    records.push({ name, size: info.size, sha256: await digest(path) });
  }
  return records;
}
export async function writeChecksums(directory) {
  const records = await packages(directory);
  await writeFile(
    join(directory, "SHA256SUMS"),
    records.map((item) => `${item.sha256}  ${item.name}\n`).join(""),
  );
  return records;
}
export async function prepareRelease(directory, tag) {
  if (!stableTag(tag))
    throw new Error("Release tags must use stable vX.Y.Z format.");
  const names = await readdir(directory),
    images = names.filter((name) => name.endsWith(".AppImage"));
  if (images.length !== 1)
    throw new Error("A release needs exactly one AppImage.");
  const image = `Linusaurus-Rex-${tag.slice(1)}-x86_64.AppImage`;
  if (images[0] !== image) {
    if (names.includes(image))
      throw new Error("The normalized AppImage name already exists.");
    await rename(join(directory, images[0]), join(directory, image));
  }
  return writeChecksums(directory);
}
export function ownershipMarker(tag, sha) {
  if (!stableTag(tag) || !/^([a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha || ""))
    throw new Error("Invalid release tag or commit identity.");
  return `<!-- linusaurus-release-ci tag=${tag} commit=${sha} -->`;
}
export function assertOwnedDraft(release, tag, sha) {
  if (!release?.draft)
    throw new Error(
      "Published releases are immutable; no asset changes are allowed.",
    );
  if (
    release.tag_name !== tag ||
    !String(release.body || "")
      .split("\n")
      .includes(ownershipMarker(tag, sha))
  )
    throw new Error(
      "This draft is not owned by this workflow and commit. Inspect it manually before retrying.",
    );
}
function manifestRecords(manifest) {
  const records = new Map();
  for (const line of manifest.split(/\r?\n/).filter(Boolean)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line);
    if (!match || !safeName(match[2]) || records.has(match[2]))
      throw new Error(
        "The checksum manifest contains an unsafe or duplicate filename.",
      );
    records.set(match[2], match[1].toLowerCase());
  }
  return records;
}
export function verifyReleaseAssets(release, manifest, records) {
  const expected = new Map(records.map((item) => [item.name, item]));
  expected.set("SHA256SUMS", {
    name: "SHA256SUMS",
    size: Buffer.byteLength(manifest),
    sha256: createHash("sha256").update(manifest).digest("hex"),
  });
  const assets = release.assets || [];
  if (
    assets.length !== expected.size ||
    new Set(assets.map((asset) => asset.name)).size !== assets.length
  )
    throw new Error(
      "The remote release does not contain exactly the expected assets.",
    );
  for (const asset of assets) {
    const local = expected.get(asset.name);
    if (
      !local ||
      asset.state !== "uploaded" ||
      asset.size !== local.size ||
      asset.digest !== `sha256:${local.sha256}`
    )
      throw new Error(
        `Remote filename, size or digest mismatch: ${asset.name}`,
      );
  }
  const sums = manifestRecords(manifest);
  if (sums.size !== records.length)
    throw new Error("The remote checksum manifest has unexpected entries.");
  for (const record of records)
    if (sums.get(record.name) !== record.sha256)
      throw new Error(
        `Remote manifest does not verify package: ${record.name}`,
      );
  return true;
}
const defaultGh = async (args) =>
  (await execute("gh", args, { maxBuffer: 8 * 1024 * 1024 })).stdout;
export async function publishRelease({ directory, tag, sha, gh = defaultGh }) {
  let records = await packages(directory);
  const marker = ownershipMarker(tag, sha);
  const metadata = async () =>
    JSON.parse(await gh(["api", `repos/${REPOSITORY}/releases/tags/${tag}`]));
  let release;
  try {
    release = await metadata();
  } catch (error) {
    if (!/404/.test(String(error.stderr || error.message))) throw error;
  }
  if (release) assertOwnedDraft(release, tag, sha);
  else {
    const notes = join(directory, `.release-notes-${randomUUID()}.md`);
    try {
      await writeFile(
        notes,
        `${marker}\n\nLinux packages built from commit ${sha}.\n`,
      );
      await gh([
        "release",
        "create",
        tag,
        "--repo",
        REPOSITORY,
        "--verify-tag",
        "--draft",
        "--generate-notes",
        "--title",
        `Linusaurus Rex ${tag.slice(1)}`,
        "--notes-file",
        notes,
      ]);
    } finally {
      await rm(notes, { force: true });
    }
  }
  const download = async (name) => {
    const temporary = join(directory, `.download-${randomUUID()}`);
    try {
      await gh([
        "release",
        "download",
        tag,
        "--repo",
        REPOSITORY,
        "--pattern",
        name,
        "--output",
        temporary,
      ]);
      return temporary;
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  };
  const uploadMissing = async (name, path) => {
    release = await metadata();
    assertOwnedDraft(release, tag, sha);
    const existing = release.assets?.find((asset) => asset.name === name);
    if (existing) {
      if (existing.state !== "starter" || existing.size !== 0)
        throw new Error(`A completed draft asset already exists: ${name}`);
      // A failed empty upload is recoverable; completed assets are never clobbered.
      await gh([
        "release",
        "delete-asset",
        tag,
        name,
        "--repo",
        REPOSITORY,
        "--yes",
      ]);
      release = await metadata();
      assertOwnedDraft(release, tag, sha);
    }
    await gh(["release", "upload", tag, path, "--repo", REPOSITORY]);
  };
  for (const record of records) {
    release = await metadata();
    assertOwnedDraft(release, tag, sha);
    const existing = release.assets?.find(
      (asset) => asset.name === record.name,
    );
    if (existing?.state === "uploaded") {
      if (
        !/^sha256:[a-f0-9]{64}$/.test(existing.digest || "") ||
        !existing.size
      )
        throw new Error(
          `The existing draft asset is not verifiable: ${record.name}`,
        );
      if (
        existing.digest !== `sha256:${record.sha256}` ||
        existing.size !== record.size
      ) {
        // Rebuilds may have different archive timestamps. Reuse the completed bytes
        // from this same commit rather than overwriting an already good upload.
        const temporary = await download(record.name);
        try {
          if (
            (await stat(temporary)).size !== existing.size ||
            `sha256:${await digest(temporary)}` !== existing.digest
          )
            throw new Error(
              `The existing draft asset failed download verification: ${record.name}`,
            );
          await rename(temporary, join(directory, record.name));
        } finally {
          await rm(temporary, { force: true });
        }
      }
    } else await uploadMissing(record.name, join(directory, record.name));
  }
  records = await writeChecksums(directory);
  const localManifest = await readFile(join(directory, "SHA256SUMS"), "utf8");
  release = await metadata();
  assertOwnedDraft(release, tag, sha);
  const sums = release.assets?.find((asset) => asset.name === "SHA256SUMS");
  if (sums?.state === "uploaded") {
    const temporary = await download("SHA256SUMS");
    try {
      if ((await readFile(temporary, "utf8")) !== localManifest)
        throw new Error(
          "The existing completed draft manifest differs. Inspect it manually before retrying.",
        );
    } finally {
      await rm(temporary, { force: true });
    }
  } else await uploadMissing("SHA256SUMS", join(directory, "SHA256SUMS"));
  release = await metadata();
  assertOwnedDraft(release, tag, sha);
  const temporary = await download("SHA256SUMS");
  try {
    verifyReleaseAssets(release, await readFile(temporary, "utf8"), records);
  } finally {
    await rm(temporary, { force: true });
  }
  // Verify still-draft state immediately before publishing; never edit a release
  // another actor has published while this job was uploading.
  release = await metadata();
  assertOwnedDraft(release, tag, sha);
  await gh([
    "release",
    "edit",
    tag,
    "--repo",
    REPOSITORY,
    "--draft=false",
    "--latest",
  ]);
  return release.html_url;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, directory, tag, sha] = process.argv.slice(2);
  if (command === "prepare") await prepareRelease(resolve(directory), tag);
  else if (command === "publish")
    console.log(
      await publishRelease({ directory: resolve(directory), tag, sha }),
    );
  else
    throw new Error(
      "Usage: release-assets.mjs prepare DIR TAG | publish DIR TAG COMMIT",
    );
}
