import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RexService } from "../electron/rex/service.js";
import { RexControl } from "../electron/rex/control.js";

test("malformed optional saved-host discovery falls back without breaking remote connection", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "linusaurus-discovery-"));
  const previous = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = directory;
  await mkdir(join(directory, "rex"));
  // Presence enables optional discovery; the injected factory owns every connection.
  await writeFile(join(directory, "rex/server.sock"), "");
  try {
    const cases: [string, unknown, string][] = [
      ["non-object", null, "https://build/"],
      ["non-array hosts", { hosts: {} }, "https://build/"],
      ["missing label", { hosts: [{}] }, "https://build/"],
      [
        "non-array endpoints",
        { hosts: [{ label: "build", endpoints: "wss://wrong/" }] },
        "https://build/",
      ],
      [
        "invalid endpoint entry",
        { hosts: [{ label: "build", endpoints: [42] }] },
        "https://build/",
      ],
      [
        "invalid fallback address",
        { hosts: [{ label: "build", address: {} }] },
        "https://build/",
      ],
      [
        "malformed record after matching alias",
        { hosts: [{ label: "build", endpoint: "wss://alias.example/" }, null] },
        "https://build/",
      ],
      ["missing optional hosts", {}, "https://build/"],
      [
        "valid future fields",
        {
          hosts: [
            {
              label: "BUILD",
              endpoints: ["wss://alias.example/"],
              future: true,
            },
          ],
          future: true,
        },
        "wss://alias.example/",
      ],
    ];
    for (const [label, response, expected] of cases)
      await t.test(label, async () => {
        const disposed: string[] = [];
        const service = new RexService({
          controlFactory: (endpoint) =>
            ({
              endpoint,
              connected: true,
              readyPublic: async () => ({
                protocol: "rex.control.v1",
                api_revision: 10,
              }),
              call: async (method: string) =>
                method === "hosts.list" ? response : { version: "test" },
              dispose: () => disposed.push(endpoint),
            }) as unknown as RexControl,
        });
        try {
          const status = await service.status({
            id: "remote",
            label: "Remote",
            endpoint: "build",
          });
          assert.equal(status.connected, true, status.error);
          assert.equal(status.endpoint, expected);
          assert.ok(
            disposed.includes(`unix://${join(directory, "rex/server.sock")}`),
          );
        } finally {
          service.dispose();
        }
      });
  } finally {
    if (previous === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
