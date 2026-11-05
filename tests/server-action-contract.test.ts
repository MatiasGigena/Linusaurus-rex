import assert from "node:assert/strict";
import { test } from "node:test";
import { parseServerAction } from "../electron/features/server-action.js";

test("server actions decode only their declared argument families", () => {
  assert.deepEqual(parseServerAction({ action: "status" }), {
    action: "status",
  });
  assert.deepEqual(
    parseServerAction({
      action: "tailscale.rename",
      args: { hostname: " new-name " },
    }),
    {
      action: "tailscale.rename",
      args: { hostname: "new-name" },
    },
  );
  const enable = {
    action: "tailscale.enable",
    args: {
      hostname: "workstation",
      control_url: "https://control.example",
      advertise_tags: ["tag:dev"],
      allow_tailnet_members: false,
    },
  };
  assert.deepEqual(parseServerAction(enable), enable);
  assert.deepEqual(parseServerAction({ action: "tailscale.enable" }), {
    action: "tailscale.enable",
    args: {},
  });
});

test("malformed or contradictory operation arguments are rejected before remote forwarding", () => {
  for (const value of [
    { action: "tailscale.rename" },
    { action: "tailscale.rename", args: {} },
    { action: "tailscale.rename", args: { hostname: " " } },
    { action: "tailscale.rename", args: { hostname: 42 } },
    {
      action: "tailscale.rename",
      args: { hostname: "ok", allow_tailnet_members: true },
    },
    { action: "tailscale.enable", args: { hostname: [] } },
    { action: "tailscale.enable", args: { control_url: {} } },
    { action: "tailscale.enable", args: { allow_tailnet_members: "false" } },
    { action: "tailscale.enable", args: { advertise_tags: ["tag:dev", null] } },
    { action: "tailscale.enable", args: { unknown_option: true } },
    { action: "tailscale.disable", args: { hostname: "contradiction" } },
    { action: "status", args: {} },
    { action: "server.shutdown" },
  ])
    assert.throws(() => parseServerAction(value));
});
