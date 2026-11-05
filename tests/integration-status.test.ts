import assert from "node:assert/strict";
import { test } from "node:test";
import { IntegrationManager } from "../electron/features/integrations.js";

test("integration status refuses a malformed harness collection instead of publishing a typed array", async () => {
  for (const harnesses of ["codex", {}, 42, null]) {
    const manager = new IntegrationManager(async () =>
      JSON.stringify({ harnesses }),
    );
    try {
      await assert.rejects(
        manager.status(),
        /integration.*(?:status|response|harness)/i,
      );
    } finally {
      manager.dispose();
    }
  }
});

test("integration status preserves valid future fields and supplies an empty collection for older CLIs", async () => {
  let value: unknown = {
    harnesses: [{ name: "codex", future: true }],
    future: { enabled: true },
  };
  const manager = new IntegrationManager(async () => JSON.stringify(value));
  try {
    assert.deepEqual(await manager.status(), value);
    value = { future: true };
    assert.deepEqual(await manager.status(), { future: true, harnesses: [] });
  } finally {
    manager.dispose();
  }
});
