import { WorkspaceDialogController } from "../src/workspace/dialogs.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalActionName,
  configuredShortcutEntries,
} from "../src/shared/actions.js";
import { buildPaletteCommands } from "../src/workspace/palette.js";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";

test("palette labels and execution share canonical copy/paste names while retaining saved shortcut keys", () => {
  const settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    shortcuts: { copy: "Ctrl+Alt+C", paste: "" },
  };
  const dispatched: string[] = [];
  const build = () =>
    buildPaletteCommands({
      palette: "all",
      settings,
      keymaps: {},
      activeHostId: undefined,
      navHosts: [],
      dispatch: (name) => {
        dispatched.push(name);
      },
      execute: async () => {},
      select: () => {},
      dialogs: new WorkspaceDialogController(),
    });
  let commands = build();
  const copy = commands.find((command) => command.id === "client.copy");
  const paste = commands.find((command) => command.id === "client.paste");
  assert.ok(copy);
  assert.ok(paste);
  assert.equal(copy.shortcut, "Ctrl+Alt+C");
  assert.equal(paste.shortcut, "");
  copy.run();
  paste.run();
  assert.deepEqual(dispatched, ["client.copy", "client.paste"]);
  Object.assign(settings.shortcuts, {
    "client.copy": "",
    "client.paste": "Super+V",
  });
  commands = build();
  assert.equal(
    commands.find((command) => command.id === "client.copy")?.shortcut,
    "",
  );
  assert.equal(
    commands.find((command) => command.id === "client.paste")?.shortcut,
    "Super+V",
  );
  assert.deepEqual(configuredShortcutEntries(settings.shortcuts), [
    ["client.copy", ""],
    ["client.paste", "Super+V"],
  ]);
  const reversed = Object.fromEntries(
    Object.entries(settings.shortcuts).reverse(),
  );
  assert.equal(
    configuredShortcutEntries(reversed).find(
      ([name]) => name === "client.copy",
    )?.[1],
    "",
  );
});

test("legacy command compatibility cannot resolve inherited object properties as actions", () => {
  assert.equal(canonicalActionName("copy"), "client.copy");
  assert.equal(canonicalActionName("paste"), "client.paste");
  assert.equal(canonicalActionName("client.paste"), "client.paste");
  for (const name of ["constructor", "toString", "__proto__", "server.future"])
    assert.equal(canonicalActionName(name), name);
});
