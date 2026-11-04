import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  createHostSaver,
  HostSaveIncompleteError,
} from "../src/workspace/actions/hostActions";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/types";

const host = {
  id: "remote",
  label: "Remote",
  endpoint: "wss://remote.example",
};
function fixture(t: TestContext) {
  let settings: Settings = structuredClone(DEFAULT_SETTINGS);
  const calls: string[] = [];
  const controls = { credentialFailures: 0, refreshFailures: 0, active: true };
  const credentialFailure = Object.assign(new Error("Keyring locked"), {
    code: "KEYRING_LOCKED",
    method: "setCredentials",
  });
  const readFailure = Object.assign(new Error("Transport read failed"), {
    code: "READ_FAILED",
    method: "status",
  });
  const credentials: unknown[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      rex: {
        async request(method: string, args: unknown) {
          assert.equal(method, "setCredentials");
          calls.push(method);
          credentials.push(args);
          if (controls.credentialFailures-- > 0) throw credentialFailure;
        },
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const save = createHostSaver(
    {
      getSettings: () => settings,
      async saveSettings(next) {
        calls.push("saveSettings");
        settings = next;
        return next;
      },
      async refresh() {
        calls.push("refresh");
        if (controls.refreshFailures-- > 0) throw readFailure;
      },
    },
    (id) => {
      assert.equal(id, host.id);
      calls.push("reconnected");
    },
  );
  return {
    save,
    controls,
    calls,
    credentials,
    credentialFailure,
    readFailure,
    settings: () => settings,
    settingsChanged(next: Settings) {
      settings = next;
    },
  };
}
async function incomplete(operation: Promise<void>) {
  try {
    await operation;
  } catch (failure) {
    assert.ok(failure instanceof HostSaveIncompleteError);
    return failure;
  }
  throw new Error("Expected a partial host-save failure");
}

test("host recovery preserves original causes, advances its stage, and shares only unfinished work", async (t) => {
  const current = fixture(t);
  current.controls.credentialFailures = 1;
  current.controls.refreshFailures = 2;
  const credentials = { token: "private-original-token" };
  const first = await incomplete(current.save(host, credentials));
  assert.equal(first.hostId, host.id);
  assert.equal(first.stage, "credentials");
  assert.equal(first.cause, current.credentialFailure);
  assert.equal(first.code, "KEYRING_LOCKED");
  assert.equal(first.method, "setCredentials");
  assert.equal(JSON.stringify(first).includes(credentials.token), false);
  credentials.token = "subsequent-caller-change";
  current.settingsChanged({ ...current.settings(), fontSize: 24 });
  const second = await incomplete(first.retry());
  assert.equal(second.stage, "refresh");
  assert.equal(second.cause, current.readFailure);
  assert.equal(second.code, "READ_FAILED");
  assert.equal(second.method, "status");
  const third = await incomplete(second.retry());
  assert.equal(third.stage, "refresh");
  assert.equal(third.cause, current.readFailure);
  await Promise.all([third.retry(), third.retry()]);
  const before = [...current.calls];
  await first.retry();
  assert.deepEqual(
    current.calls,
    before,
    "A completed continuation cannot replay any stage",
  );
  assert.deepEqual(current.calls, [
    "saveSettings",
    "setCredentials",
    "setCredentials",
    "reconnected",
    "refresh",
    "refresh",
    "refresh",
  ]);
  assert.deepEqual(current.credentials, [
    { hostId: host.id, token: "private-original-token" },
    { hostId: host.id, token: "private-original-token" },
  ]);
  assert.equal(current.settings().fontSize, 24);
});

for (const stage of ["credentials", "refresh"] as const) {
  for (const lifetime of ["removed", "replaced", "closed"] as const) {
    test(`${stage} host recovery refuses a ${lifetime} target without further work`, async (t) => {
      const current = fixture(t);
      if (stage === "credentials") current.controls.credentialFailures = 1;
      else current.controls.refreshFailures = 1;
      const failed = await incomplete(
        current.save(
          host,
          { token: "private-token" },
          () => current.controls.active,
        ),
      );
      if (lifetime === "closed") current.controls.active = false;
      else
        current.settingsChanged({
          ...current.settings(),
          hosts: current
            .settings()
            .hosts.flatMap((item) =>
              item.id !== host.id
                ? [item]
                : lifetime === "removed"
                  ? []
                  : [{ ...item, endpoint: "wss://replacement.example" }],
            ),
        });
      const before = [...current.calls];
      const obsolete = await incomplete(failed.retry());
      assert.match(
        obsolete.message,
        lifetime === "closed" ? /no longer open/ : /configuration changed/,
      );
      assert.equal(obsolete.stage, stage);
      assert.deepEqual(current.calls, before);
    });
  }
}

test("an inactive host form starts no persistence and two-argument saves without credentials still succeed", async (t) => {
  const current = fixture(t);
  await assert.rejects(
    current.save(host, undefined, () => false),
    /no longer open/,
  );
  assert.deepEqual(current.calls, []);
  await current.save(host);
  assert.deepEqual(current.calls, ["saveSettings", "reconnected", "refresh"]);
});
