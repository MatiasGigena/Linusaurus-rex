import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../src/shared/types.js";
import { applyPreferences } from "../electron/settings/preferences.js";
import {
  validateHosts,
  validateLastSelection,
} from "../electron/settings/hosts.js";
import { validateNotifications } from "../electron/settings/notifications.js";
import {
  validateRecentPaths,
  validateShortcuts,
  validateTrustedLinks,
} from "../electron/settings/histories.js";
import { validateTheme } from "../electron/settings/themes.js";

test("host settings keep account selectors but refuse embedded passwords and stale selections", () => {
  const host = {
    id: "remote",
    label: "Build server",
    endpoint: "https://account@rex.example",
    startupCommand: "",
    websocketOrigins: ["https://client.example"],
  };
  const [saved] = validateHosts([host]);
  assert.equal(saved.endpoint, host.endpoint);
  assert.equal(saved.startupCommand, "");
  assert.deepEqual(saved.websocketOrigins, ["client.example"]);
  assert.throws(
    () =>
      validateHosts([
        { ...host, endpoint: "https://account:secret@rex.example" },
      ]),
    /credentials separately/,
  );
  assert.throws(
    () => validateHosts([{ ...host, websocketOrigins: ["*"] }]),
    /specific host/,
  );
  assert.equal(
    validateLastSelection(
      { hostId: "removed", sessionId: "s", windowId: "w" },
      [saved],
    ),
    undefined,
  );
  assert.deepEqual(
    validateLastSelection({ hostId: saved.id, sessionId: "", windowId: "" }, [
      saved,
    ]),
    { hostId: saved.id, sessionId: "", windowId: "" },
  );
  assert.throws(
    () =>
      validateLastSelection(
        { hostId: saved.id, sessionId: "", windowId: "w" },
        [saved],
      ),
    /empty host selection/,
  );
});

test("legacy notification choices migrate to desktop channels without disabling independent tab and badge channels", () => {
  const before = structuredClone(DEFAULT_SETTINGS.notifications);
  const migrated = validateNotifications({ blocked: false, working: true });
  assert.equal(migrated.blocked, true);
  assert.equal(migrated.channels.blocked.desktop, false);
  assert.equal(migrated.channels.blocked.tabs, before.channels.blocked.tabs);
  assert.equal(migrated.channels.blocked.badge, before.channels.blocked.badge);
  const explicit = validateNotifications({
    blocked: false,
    channels: { blocked: { desktop: true, tabs: false } },
  });
  assert.equal(explicit.blocked, false);
  assert.equal(explicit.channels.blocked.desktop, true);
  assert.equal(explicit.channels.blocked.tabs, false);
  assert.throws(
    () => validateNotifications({ channels: { blocked: { desktop: "yes" } } }),
    /notification desktop/,
  );
  assert.throws(
    () => validateNotifications({ position: "elsewhere" }),
    /position/,
  );
  migrated.channels.blocked.desktop = true;
  assert.deepEqual(DEFAULT_SETTINGS.notifications, before);
});

test("history and shortcut boundaries preserve disabled bindings and keep arbitrary host keys as data", () => {
  assert.deepEqual(
    validateShortcuts({ "command-palette": "", "new-window": "Ctrl+Shift+T" }),
    { "client.palette.toggle": "", "client.tab.new": "Ctrl+Shift+T" },
  );
  assert.throws(
    () => validateShortcuts({ "new-window": "bad\0shortcut" }),
    /shortcut/,
  );
  const input = JSON.parse('{"__proto__":["/tmp/project"]}');
  const history = validateRecentPaths(input);
  assert.equal(Object.getPrototypeOf(history), Object.prototype);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(history, "__proto__")?.value,
    ["/tmp/project"],
  );
  assert.throws(
    () => validateRecentPaths({ local: Array(21).fill("/tmp") }),
    /at most 20/,
  );
  assert.throws(
    () => validateRecentPaths({ local: ["/tmp\0escape"] }),
    /recent path/,
  );
  assert.deepEqual(
    validateTrustedLinks(["ssh://rex.example", "ssh://rex.example", "mailto:"]),
    ["ssh://rex.example", "mailto:"],
  );
  assert.throws(
    () => validateTrustedLinks(["https://rex.example"]),
    /trusted application target/,
  );
  assert.throws(
    () => validateTrustedLinks(["ssh://rex.example/specific-path"]),
    /trusted application target/,
  );
});

test("scalar preferences distinguish fractions from integer controls and reject non-finite or invisible client labels", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  applyPreferences(
    { interfaceZoom: 1.15, fontSize: 18, sidebarCollapsed: true },
    settings,
  );
  assert.equal(settings.interfaceZoom, 1.15);
  assert.equal(settings.fontSize, 18);
  assert.equal(settings.sidebarCollapsed, true);
  for (const input of [
    { interfaceZoom: NaN },
    { interfaceZoom: Infinity },
    { fontSize: 18.5 },
    { clientLabel: "invisible\nlabel" },
    { fontFamily: "   " },
  ]) {
    assert.throws(() =>
      applyPreferences(input, structuredClone(DEFAULT_SETTINGS)),
    );
  }
});

test("saved palettes and preference colors accept valid CSS hex widths and reject five or seven digits", () => {
  for (const color of ["#abc", "#abcd", "#AABBCC", "#aabbccdd"]) {
    assert.deepEqual(validateTheme({ background: color }), {
      background: color,
    });
    const settings = structuredClone(DEFAULT_SETTINGS);
    applyPreferences(
      { highlightColor: color, selectionForeground: color },
      settings,
    );
    assert.equal(settings.highlightColor, color);
  }
  for (const color of ["#12345", "#1234567"]) {
    assert.throws(
      () => validateTheme({ background: color }),
      /custom theme color/,
    );
    assert.throws(
      () =>
        applyPreferences(
          { highlightColor: color },
          structuredClone(DEFAULT_SETTINGS),
        ),
      /highlightColor/,
    );
  }
});
