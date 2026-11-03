import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveCurrentAppImage } from "../electron/features/update-target.js";

test("AppImage mount and extract-and-run identities bind updates to their persistent image", () => {
  for (const appDir of [
    "/tmp/.mount_linusaurus123",
    "/tmp/appimage_extracted_linusaurus123",
  ]) {
    const appImage = "/downloads/Linusaurus-Rex-0.3.0.AppImage";
    assert.equal(
      resolveCurrentAppImage({
        appImage,
        appDir,
        execPath: join(appDir, "linusaurus-rex"),
        appPath: join(appDir, "resources", "app.asar"),
      }),
      appImage,
    );
  }
});

test("inherited foreign AppImage variables never identify a Debian or development executable", () => {
  const foreign = {
    appImage: "/downloads/Foreign.AppImage",
    appDir: "/tmp/.mount_foreign",
  };
  assert.equal(
    resolveCurrentAppImage({
      ...foreign,
      execPath: "/opt/Linusaurus Rex/linusaurus-rex",
      appPath: "/opt/Linusaurus Rex/resources/app.asar",
    }),
    undefined,
  );
  assert.equal(
    resolveCurrentAppImage({
      ...foreign,
      execPath: "/tmp/.mount_foreign/electron",
    }),
    undefined,
  );
  assert.equal(
    resolveCurrentAppImage({
      ...foreign,
      execPath: "/tmp/.mount_foreign/linusaurus-rex",
      development: true,
    }),
    undefined,
  );
  assert.equal(
    resolveCurrentAppImage({
      appImage: foreign.appImage,
      execPath: "/opt/Linusaurus Rex/linusaurus-rex",
    }),
    undefined,
  );
});

test("AppImage identity rejects sibling path prefixes, different app archives and temporary update targets", () => {
  const identity = {
    appImage: "/downloads/Rex.AppImage",
    appDir: "/tmp/mount",
    execPath: "/tmp/mount/linusaurus-rex",
  };
  assert.equal(
    resolveCurrentAppImage({
      ...identity,
      execPath: "/tmp/mount-other/linusaurus-rex",
    }),
    undefined,
  );
  assert.equal(
    resolveCurrentAppImage({
      ...identity,
      appPath: "/tmp/other/resources/app.asar",
    }),
    undefined,
  );
  assert.equal(
    resolveCurrentAppImage({
      ...identity,
      appImage: "/tmp/mount/linusaurus-rex",
    }),
    undefined,
  );
  assert.equal(
    resolveCurrentAppImage({ ...identity, appDir: "relative/mount" }),
    undefined,
  );
  assert.equal(
    resolveCurrentAppImage({ ...identity, appImage: "relative.AppImage" }),
    undefined,
  );
});

test("canonical filesystem identities support legitimate symlinks and reject executable symlink escapes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-target-"));
  try {
    const appDir = join(directory, "actual-app"),
      alias = join(directory, "app-alias"),
      image = join(directory, "current.AppImage"),
      imageAlias = join(directory, "launcher.AppImage");
    await mkdir(join(appDir, "resources"), { recursive: true });
    await writeFile(join(appDir, "resources", "app.asar"), "fixture");
    await writeFile(join(appDir, "linusaurus-rex"), "fixture");
    await writeFile(image, "fixture");
    await symlink(appDir, alias, "dir");
    await symlink(image, imageAlias);
    const canonical = async () => ({
      appImage: await realpath(imageAlias),
      appDir: await realpath(alias),
      execPath: await realpath(join(alias, "linusaurus-rex")),
      appPath: await realpath(join(alias, "resources", "app.asar")),
    });
    assert.equal(resolveCurrentAppImage(await canonical()), image);
    const foreign = join(directory, "foreign", "linusaurus-rex");
    await mkdir(join(directory, "foreign"));
    await writeFile(foreign, "other executable");
    await rm(join(appDir, "linusaurus-rex"));
    await symlink(foreign, join(appDir, "linusaurus-rex"));
    assert.equal(resolveCurrentAppImage(await canonical()), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
