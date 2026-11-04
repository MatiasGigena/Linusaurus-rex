import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNavigationHosts,
  buildActivityFeed,
} from "../src/workspace/presentation";
import {
  DEFAULT_SETTINGS,
  type SessionView,
  type ProgramActivity,
} from "../src/shared/types";

const host = {
  id: "h",
  label: "Host",
  endpoint: "",
  connected: true,
  sessions: [{ id: "s", label: "Session" }],
};
const view: SessionView = {
  id: "s",
  label: "Session",
  activeWindowId: "w",
  windows: [
    {
      id: "w",
      label: "Shell",
      focusedBlockId: "b",
      panes: [{ id: "b", label: "Shell", rect: [0, 0, 1, 1] }],
    },
  ],
};
const views = { "h/s": view };
const activities: ProgramActivity[] = [
  { id: "idle", state: "idle" },
  { id: "work", state: "working" },
  { id: "blocked", state: "blocked" },
];
const metadata = {
  "h/s/b": { activities, program: "fish", cwd: "/tmp/project" },
};

test("navigation titles use live metadata and respect per-state tab notification settings", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.preferGeneratedTitles = true;
  settings.notifications.channels.blocked.tabs = false;
  settings.notifications.channels.working.tabs = true;
  const navigation = buildNavigationHosts([host], views, metadata, settings);
  const tab = navigation[0].sessions[0].windows[0];
  assert.equal(tab.label, "fish project");
  assert.equal(tab.activity?.state, "working");
  assert.equal(tab.program, "fish");
  assert.deepEqual(tab.icons, ["fish"]);
  assert.equal(
    view.windows[0].panes[0].program,
    undefined,
    "presentation must not mutate server snapshots",
  );
});

test("activity feed hides idle work and can group processes or prioritize attention", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.notifications.includeIdle = false;
  settings.notifications.eachProcess = false;
  assert.deepEqual(
    buildActivityFeed([host], views, metadata, settings, "session").map(
      (item) => item.activity.id,
    ),
    ["blocked"],
  );
  settings.notifications.eachProcess = true;
  assert.deepEqual(
    buildActivityFeed([host], views, metadata, settings, "priority").map(
      (item) => item.activity.id,
    ),
    ["blocked", "work"],
  );
  settings.notifications.includeIdle = true;
  assert.deepEqual(
    buildActivityFeed([host], views, metadata, settings, "priority").map(
      (item) => item.activity.id,
    ),
    ["blocked", "work", "idle"],
  );
});
