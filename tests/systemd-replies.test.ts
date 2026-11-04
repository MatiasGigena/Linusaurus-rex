import assert from "node:assert/strict";
import { test } from "node:test";
import { SystemdUserServices } from "../electron/server-management/systemd.js";

const unit = "owned-rex.service";
const objectPath = "/org/freedesktop/systemd1/unit/owned_2drex_2eservice";
const unitFields = () => ({
  Id: { data: unit },
  ActiveState: { data: "active" },
  SubState: { data: "running" },
  FragmentPath: { data: "/user/owned-rex.service" },
  DropInPaths: { data: [] },
  TriggeredBy: { data: [] },
  Job: { data: [0, "/"] },
});
function fixture() {
  const responses: Record<string, unknown> = {
    LoadUnit: { data: [objectPath] },
    GetUnitByPID: { data: [objectPath] },
    Id: { data: unit },
    GetAll: { data: [unitFields()] },
    MainPID: { data: 123 },
    Restart: { data: "always" },
    RemainAfterExit: { data: false },
    ExecStart: {
      data: [["/usr/bin/rex", ["/usr/bin/rex", "server", "run"], false]],
    },
  };
  const calls: { executable: string; args: string[] }[] = [];
  let raw: string | undefined;
  let lookupFailure = false;
  let attestations = 0;
  const services = new SystemdUserServices({
    call: async () => {},
    attest: async () => {
      attestations++;
    },
    run: async (executable, args) => {
      calls.push({ executable, args });
      const member = args.includes("LoadUnit")
        ? "LoadUnit"
        : args.includes("GetUnitByPID")
          ? "GetUnitByPID"
          : args.includes("GetAll")
            ? "GetAll"
            : args.at(-1);
      assert.ok(member);
      if (member === "GetUnitByPID" && lookupFailure)
        throw new Error("PID has no unit");
      if (raw !== undefined) return raw;
      return JSON.stringify(responses[member]);
    },
  });
  return {
    services,
    responses,
    calls,
    get attestations() {
      return attestations;
    },
    raw(value: string) {
      raw = value;
    },
    missingUnit() {
      lookupFailure = true;
    },
  };
}

test("systemd inspection rejects malformed manager fields before publishing a manageable snapshot", async () => {
  const invalidProperties: [string, unknown][] = [
    ["LoadUnit", { data: [42] }],
    ["LoadUnit", { data: ["not/an/object/path"] }],
    ["LoadUnit", { data: [objectPath, objectPath] }],
    ["GetAll", { data: [null] }],
    ["GetAll", { data: [{ ...unitFields(), Id: { data: false } }] }],
    ["GetAll", { data: [{ ...unitFields(), ActiveState: "active" }] }],
    [
      "GetAll",
      { data: [{ ...unitFields(), DropInPaths: { data: ["/safe", 1] } }] },
    ],
    [
      "GetAll",
      { data: [{ ...unitFields(), TriggeredBy: { data: "socket.service" } }] },
    ],
    ["GetAll", { data: [{ ...unitFields(), Job: { data: ["0", "/"] } }] }],
    ["GetAll", { data: [{ ...unitFields(), Job: { data: [0, "relative"] } }] }],
    ["MainPID", { data: "123" }],
    ["MainPID", { data: -1 }],
    ["MainPID", { data: 1.5 }],
    ["MainPID", { data: [123, 456] }],
    ["RemainAfterExit", { data: "false" }],
    ["Restart", { data: {} }],
    ["ExecStart", { data: "rex server run" }],
    ["ExecStart", { data: [null] }],
    ["ExecStart", { data: [["/usr/bin/rex", "rex server run", false]] }],
    ["ExecStart", { data: [["/usr/bin/rex", ["/usr/bin/rex", 1], false]] }],
    [
      "ExecStart",
      { data: [["/usr/bin/rex", ["/usr/bin/rex", "server", "run"], "false"]] },
    ],
  ];
  for (const [member, value] of invalidProperties) {
    const current = fixture();
    current.responses[member] = value;
    await assert.rejects(
      current.services.inspect(unit),
      /service manager returned an invalid/,
      member,
    );
    assert.ok(current.calls.every((call) => call.executable === "busctl"));
  }
});

test("malformed discovery replies fail closed instead of falling through to direct process management", async () => {
  for (const [member, value] of [
    ["GetUnitByPID", null],
    ["GetUnitByPID", { data: ["wrong path"] }],
    ["Id", { data: {} }],
    ["Id", { data: "../wrong.service" }],
    ["MainPID", { data: "123" }],
  ] as const) {
    const current = fixture();
    current.responses[member] = value;
    await assert.rejects(
      current.services.discover("unix:///owned.sock", 123),
      /owning service cannot be inspected safely/,
    );
    assert.equal(current.attestations, 1);
    assert.ok(
      !current.calls.some((call) => call.args.includes("--system")),
      "A malformed user-manager reply must not be treated as absence",
    );
  }
  const invalidJson = fixture();
  invalidJson.raw("not JSON");
  await assert.rejects(
    invalidJson.services.discover("unix:///owned.sock", 123),
    /owning service cannot be inspected safely.*invalid busctl JSON/,
  );
  const missing = fixture();
  missing.missingUnit();
  assert.equal(
    await missing.services.discover("unix:///owned.sock", 123),
    undefined,
  );
  assert.equal(
    missing.calls.length,
    2,
    "A legitimate missing-unit lookup still checks both managers",
  );
});

test("systemd inspection keeps scalar compatibility and ignores unconsumed future fields", async () => {
  const current = fixture();
  current.responses.MainPID = { data: [123] };
  current.responses.Restart = { data: ["always"] };
  current.responses.RemainAfterExit = { data: [false] };
  current.responses.ExecStart = {
    data: [
      [
        "/usr/bin/rex",
        ["/usr/bin/rex", "server", "run"],
        false,
        0,
        0,
        { future: true },
      ],
    ],
  };
  current.responses.GetAll = {
    data: [{ ...unitFields(), FutureProperty: { data: { nested: true } } }],
  };
  const actual = await current.services.inspect(unit);
  assert.equal(actual.mainPID, 123);
  assert.equal(actual.canManage, true);
  current.responses.ExecStart = { data: [] };
  assert.equal((await current.services.inspect(unit)).canManage, false);
});

test("a valid desktop scope is distinguished from malformed service identity", async () => {
  const current = fixture();
  current.responses.Id = { data: "app-owned-test.scope" };
  assert.equal(
    await current.services.discover("unix:///owned.sock", 123),
    undefined,
  );
  assert.ok(!current.calls.some((call) => call.args.includes("LoadUnit")));
});
