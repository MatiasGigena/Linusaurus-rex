import assert from "node:assert/strict";
import { test } from "node:test";
import type { MessageBoxReturnValue } from "electron";
import {
  ExternalLinks,
  type ExternalLinkEffects,
} from "../electron/features/external-links.js";
import {
  DesktopNotifications,
  type NativeNotice,
} from "../electron/client/desktop-notifications.js";
import { DEFAULT_SETTINGS, type ClientEvent } from "../src/shared/types.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

test("application links respect consent while ordinary web links open directly", async () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.appLinks = "ask";
  const opened: string[] = [];
  let answer = 2;
  let confirmations = 0;
  let saves = 0;
  const effects: ExternalLinkEffects = {
    confirm: async (options) => {
      confirmations++;
      assert.match(options.detail || "", /Target: vscode:\/\/project/);
      return { response: answer, checkboxChecked: false };
    },
    open: async (url) => {
      opened.push(url);
    },
  };
  const links = new ExternalLinks(
    () => settings,
    async (value) => {
      saves++;
      return value;
    },
    effects,
  );
  await links.open("vscode://project/file");
  assert.deepEqual(opened, []);
  answer = 0;
  await links.open("vscode://project/file");
  await links.open("https://example.com/docs");
  assert.deepEqual(opened, [
    "vscode://project/file",
    "https://example.com/docs",
  ]);
  assert.equal(confirmations, 2);
  assert.equal(saves, 0, "Open once must not persist trust");
});

test("always-allow merges current preferences and persists before opening the application", async () => {
  let settings = structuredClone(DEFAULT_SETTINGS);
  settings.appLinks = "ask";
  const answer = deferred<MessageBoxReturnValue>();
  const persisted = deferred<void>();
  const saving = deferred<void>();
  const opened: string[] = [];
  let confirmations = 0;
  const links = new ExternalLinks(
    () => settings,
    async (value) => {
      settings = value;
      saving.resolve();
      await persisted.promise;
      return value;
    },
    {
      confirm: () => {
        confirmations++;
        return answer.promise;
      },
      open: async (url) => {
        opened.push(url);
      },
    },
  );
  const opening = links.open("vscode://project/file");
  settings = {
    ...settings,
    clientLabel: "Changed while confirming",
    trustedLinks: ["ssh://server"],
  };
  answer.resolve({ response: 1, checkboxChecked: false });
  await saving.promise;
  assert.deepEqual(
    opened,
    [],
    "The application cannot open before trust is saved",
  );
  assert.equal(settings.clientLabel, "Changed while confirming");
  assert.deepEqual(settings.trustedLinks, ["ssh://server", "vscode://project"]);
  persisted.resolve();
  await opening;
  await links.open("vscode://project/another-file");
  assert.deepEqual(opened, [
    "vscode://project/file",
    "vscode://project/another-file",
  ]);
  assert.equal(confirmations, 1, "A saved target must not prompt again");
});

test("link persistence and OS-open failures propagate without opening after a failed save", async () => {
  const settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    appLinks: "ask" as const,
  };
  const saveFailure = new Error("Preferences are read-only");
  const openFailure = new Error("No desktop application registered");
  let opens = 0;
  const links = new ExternalLinks(
    () => settings,
    async () => {
      throw saveFailure;
    },
    {
      confirm: async () => ({ response: 1, checkboxChecked: false }),
      open: async () => {
        opens++;
        throw openFailure;
      },
    },
  );
  await assert.rejects(
    links.open("vscode://project/file"),
    (error) => error === saveFailure,
  );
  assert.equal(opens, 0);
  await assert.rejects(
    links.open("https://example.com/"),
    (error) => error === openFailure,
  );
  assert.equal(opens, 1);
});

class ControlledNotice implements NativeNotice {
  shown = false;
  closed = false;
  private listeners = new Map<"click" | "close", (() => void)[]>();
  on(event: "click" | "close", listener: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener]);
  }
  emit(event: "click" | "close") {
    for (const listener of this.listeners.get(event) || []) listener();
  }
  show() {
    this.shown = true;
  }
  close() {
    this.closed = true;
    this.emit("close");
  }
}
type Notice = Extract<ClientEvent, { type: "notification" }>;
type NoticeActions = ConstructorParameters<typeof DesktopNotifications>[2];
function notificationFixture(name: string) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  const host = {
    id: name,
    label: "Test server",
    endpoint: "unix:///notices.sock",
  };
  settings.hosts = [host];
  const created: {
    notice: ControlledNotice;
    options: { title: string; body: string; silent: boolean };
  }[] = [];
  let supported = true;
  const make = () => {
    const windowEvents: string[] = [];
    const selected: Parameters<NoticeActions["select"]>[0][] = [];
    const serverSettings: string[] = [];
    let destroyed = false;
    const manager = new DesktopNotifications(
      {
        isDestroyed: () => destroyed,
        isMinimized: () => true,
        show: () => {
          windowEvents.push("show");
        },
        restore: () => {
          windowEvents.push("restore");
        },
        focus: () => {
          windowEvents.push("focus");
        },
      },
      () => settings,
      {
        select: (value) => {
          selected.push(value);
        },
        openServerSettings: async (host) => {
          serverSettings.push(host.label);
        },
      },
      {
        supported: () => supported,
        create: (options) => {
          const notice = new ControlledNotice();
          created.push({ notice, options });
          return notice;
        },
      },
    );
    return {
      manager,
      windowEvents,
      selected,
      serverSettings,
      destroy: () => {
        destroyed = true;
      },
    };
  };
  const event: Notice = {
    type: "notification",
    id: name,
    hostId: host.id,
    sessionId: "session",
    windowId: "tab",
    blockId: "pane",
    title: "Build complete",
    body: "All checks passed",
    kind: "done",
  };
  return {
    settings,
    host,
    created,
    make,
    event,
    unsupported: () => {
      supported = false;
    },
  };
}

test("native notifications deduplicate across windows and route pane versus Tailscale clicks", () => {
  const current = notificationFixture("shared-notice-fixture");
  const first = current.make();
  const second = current.make();
  try {
    first.manager.show(current.event);
    second.manager.show(current.event);
    assert.equal(
      current.created.length,
      1,
      "One server event must produce one desktop notification",
    );
    assert.deepEqual(current.created[0].options, {
      title: "Build complete",
      body: "All checks passed",
      silent: true,
    });
    assert.equal(current.created[0].notice.shown, true);
    current.created[0].notice.emit("click");
    assert.deepEqual(first.windowEvents, ["show", "restore", "focus"]);
    assert.deepEqual(first.selected, [
      {
        hostId: current.host.id,
        sessionId: "session",
        windowId: "tab",
        blockId: "pane",
      },
    ]);
    assert.deepEqual(second.selected, []);
    const tailscale: Notice & { source: string } = {
      ...current.event,
      title: "Sign in to Tailscale",
      source: "tailscale",
    };
    second.manager.show(tailscale);
    current.settings.hosts = [
      { ...current.host, label: "Current server label" },
    ];
    current.created[1].notice.emit("click");
    assert.deepEqual(second.serverSettings, ["Current server label"]);
    assert.deepEqual(second.selected, []);
    first.manager.dispose();
    assert.equal(current.created[0].notice.closed, true);
    assert.equal(
      current.created[1].notice.closed,
      false,
      "One window cannot close another window's notification",
    );
  } finally {
    first.manager.dispose();
    second.manager.dispose();
  }
});

test("closed, cleared, endpoint-replaced and disposed notifications cannot act on stale targets", () => {
  const current = notificationFixture("revoked-notice-fixture");
  const { manager, selected, windowEvents } = current.make();
  try {
    manager.show(current.event);
    manager.clearHost(current.host.id);
    current.created[0].notice.emit("click");
    assert.equal(current.created[0].notice.closed, true);
    manager.show({ ...current.event, title: "Second completion" });
    current.settings.hosts = [
      { ...current.host, endpoint: "unix:///replacement.sock" },
    ];
    current.created[1].notice.emit("click");
    manager.clearHost(current.host.id);
    manager.show({ ...current.event, title: "Third completion" });
    current.created[2].notice.emit("close");
    current.created[2].notice.emit("click");
    manager.show({ ...current.event, title: "Fourth completion" });
    manager.dispose();
    current.created[3].notice.emit("click");
    manager.show({ ...current.event, title: "Must never open" });
    assert.equal(current.created.length, 4);
    assert.deepEqual(selected, []);
    assert.deepEqual(windowEvents, []);
    assert.equal(current.created[3].notice.closed, true);
  } finally {
    manager.dispose();
  }
});

test("notification policy and native support are checked before creating desktop notices", () => {
  const current = notificationFixture("notice-policy-fixture");
  const target = current.make();
  try {
    current.settings.notifications.desktopEnabled = false;
    target.manager.show(current.event);
    current.settings.notifications.desktopEnabled = true;
    current.settings.notifications.done = false;
    target.manager.show(current.event);
    current.settings.notifications.done = true;
    current.unsupported();
    target.manager.show(current.event);
    assert.deepEqual(current.created, []);
  } finally {
    target.manager.dispose();
  }
});
