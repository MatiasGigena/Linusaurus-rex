import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";

test(
  "desktop runner rejects unknown fixtures and never falls back when Xvfb is unavailable",
  { skip: process.platform !== "linux" },
  () => {
    const script = resolve(import.meta.dirname, "../scripts/test-desktop.mjs");
    const run = (name: string, xvfb: string) =>
      spawnSync(process.execPath, [script, name], {
        env: { ...process.env, XVFB: xvfb },
        encoding: "utf8",
        timeout: 10000,
      });
    const unknown = run("not-a-fixture", "/nonexistent/linusaurus-Xvfb");
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Choose one or more named desktop fixtures/);
    assert.doesNotMatch(unknown.stdout, /RUN desktop/);
    const missing = run("smoke", "/nonexistent/linusaurus-Xvfb");
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Xvfb is required.*ENOENT/);
    assert.match(missing.stderr, /never fall back to your desktop/);
    assert.doesNotMatch(missing.stdout, /RUN desktop/);
    const relative = run("smoke", "Xvfb");
    assert.equal(relative.status, 1);
    assert.match(relative.stderr, /must be an absolute executable path/);
  },
);
