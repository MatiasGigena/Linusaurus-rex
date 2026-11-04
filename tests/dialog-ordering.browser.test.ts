import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture.js";

const source = (panel: "directory" | "diagnostics" | "block") => `
import React from 'react';import {createRoot} from 'react-dom/client';
import {DirectoryDialog} from '/src/components/DirectoryDialog.tsx';
import {DiagnosticsDialog} from '/src/components/services/DiagnosticsDialog.tsx';
import {BlockInspector} from '/src/terminal/BlockInspector.tsx';
import {DEFAULT_SETTINGS} from '/src/shared/types.ts';
import '/src/styles.css';import '/src/advanced.css';import '/src/dialogs.css';
let target,show,nextId=0;const calls=[],requests=[];
const fixture=window.fixture={calls,copied:[],picked:[],closed:0,
 pending(){return requests.filter(request=>!request.settled).map(({id,method,args})=>({id,method,args}));},
 complete(id,value,error){const request=requests.find(request=>request.id===id&&!request.settled);if(!request)throw Error('Missing pending request '+id);request.settled=true;error?request.reject(Error(error)):request.resolve(value);},
 target(value){target(value);},unmount(){show(false);}
};
window.rex={request(method,args){const id=++nextId;calls.push({id,method,args});return new Promise((resolve,reject)=>requests.push({id,method,args,resolve,reject,settled:false}));},writeClipboard:async value=>fixture.copied.push(value)};
function Fixture(){const[current,setTarget]=React.useState({hostId:'one',sessionId:'s',blockId:'a',endpoint:'unix:///first.sock'}),[visible,setVisible]=React.useState(true);target=setTarget;show=setVisible;
 const onClose=()=>{fixture.closed++;setVisible(false);};
 if(!visible)return React.createElement('p',null,'Fixture unmounted');
 if(${JSON.stringify(panel)}==='directory')return React.createElement(DirectoryDialog,{terminalRef:current,endpoint:current.endpoint,mode:'directory',recent:['/recent'],onPick:async value=>{fixture.picked.push(value);},onClose});
 if(${JSON.stringify(panel)}==='diagnostics')return React.createElement(DiagnosticsDialog,{hostId:current.hostId,endpoint:current.endpoint,onClose,onServerAction(){}});
 return React.createElement(BlockInspector,{pane:{id:current.blockId,label:'Block '+current.blockId,rect:[0,0,1,1],creator:'example.plugin'},terminalRef:current,settings:{...DEFAULT_SETTINGS,hosts:[{id:current.hostId,label:'Current',endpoint:current.endpoint||''}]},onFocus(){},onClose});
}createRoot(document.getElementById('root')).render(React.createElement(Fixture));`;
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 45_000 };
interface Pending {
  id: number;
  method: string;
  args: { hostId?: string; blockId?: string; path?: string };
}
async function requests(
  page: Page,
  method: string,
  count: number,
): Promise<Pending[]> {
  const read = () =>
    page.evaluate<Pending[]>(
      `window.fixture.pending().filter(request=>request.method===${JSON.stringify(method)})`,
    );
  await expect.poll(async () => (await read()).length).toBe(count);
  return read();
}
async function complete(
  page: Page,
  id: number,
  value: unknown,
  error?: string,
) {
  await page.evaluate(
    `window.fixture.complete(${id},${JSON.stringify(value) ?? "undefined"},${JSON.stringify(error) ?? "undefined"})`,
  );
}
async function frame(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}
function directory(path: string, name: string) {
  return {
    path,
    home: "/home/user",
    status: "ok",
    entries: [{ name }],
    truncated: false,
  };
}
function status(hostname: string) {
  return {
    api_revision: 10,
    session_count: 1,
    tailscale: {
      state: "running",
      dns_name: hostname + ".example.test",
      tags: [],
    },
  };
}
async function diagnosticsPair(page: Page, index: number, label: string) {
  const infos = await requests(page, "diagnostics", index + 1),
    statuses = await requests(page, "serverAction", index + 1);
  await complete(page, infos[index].id, { marker: label });
  await complete(page, statuses[index].id, status(label));
  return { info: infos[index].id, status: statuses[index].id };
}

test(
  "directory navigation commits only the latest response and keeps newer address drafts",
  options,
  async () => {
    await withBrowserFixture(
      "directory-ordering",
      source("directory"),
      async (page) => {
        await complete(
          page,
          (await requests(page, "listDirectory", 1))[0].id,
          directory("/start/child", "initial"),
        );
        await page
          .getByRole("button", { name: "Home directory", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Parent directory", exact: true })
          .click();
        const [older, newer] = await requests(page, "listDirectory", 2);
        assert.equal(older.args.path, "~");
        assert.equal(newer.args.path, "/start");
        await complete(page, newer.id, directory("/start", "latest"));
        await expect(
          page.getByRole("option", { name: /latest/ }),
        ).toBeVisible();
        await page
          .getByLabel("Directory path", { exact: true })
          .fill("/draft-address");
        await complete(page, older.id, directory("/home/user", "outdated"));
        await frame(page);
        await expect(
          page.getByLabel("Directory path", { exact: true }),
        ).toHaveValue("/draft-address");
        await expect(
          page.getByRole("option", { name: /latest/ }),
        ).toBeVisible();
        await expect(
          page.getByRole("option", { name: /outdated/ }),
        ).toHaveCount(0);
      },
    );
  },
);

test(
  "directory loading and errors belong to the newest request across recent paths and target changes",
  options,
  async () => {
    await withBrowserFixture(
      "directory-request-lifetime",
      source("directory"),
      async (page) => {
        await complete(
          page,
          (await requests(page, "listDirectory", 1))[0].id,
          directory("/start/child", "initial"),
        );
        await page
          .getByRole("button", { name: "Home directory", exact: true })
          .click();
        await page.getByRole("button", { name: "recent", exact: true }).click();
        const [older, newer] = await requests(page, "listDirectory", 2);
        await complete(page, older.id, directory("/home/user", "older"));
        await frame(page);
        await expect(page.getByText("Reading directory…")).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Open terminal here", exact: true }),
        ).toBeDisabled();
        await complete(
          page,
          newer.id,
          undefined,
          "Current directory RPC failed",
        );
        await expect(page.getByRole("alert")).toHaveText(
          "Current directory RPC failed",
        );
        await expect(
          page.getByLabel("Directory path", { exact: true }),
        ).toHaveValue("/start/child");
        await page
          .getByRole("button", { name: "Home directory", exact: true })
          .click();
        const oldHost = (await requests(page, "listDirectory", 1))[0];
        await page.evaluate(
          "window.fixture.target({hostId:'two',sessionId:'other',blockId:'b'})",
        );
        const nextHost = (await requests(page, "listDirectory", 2)).find(
          (request) => request.args.hostId === "two",
        );
        assert.ok(nextHost);
        await complete(
          page,
          nextHost.id,
          directory("/new-host", "current-host"),
        );
        await complete(page, oldHost.id, undefined, "Obsolete host failure");
        await frame(page);
        await expect(
          page.getByLabel("Directory path", { exact: true }),
        ).toHaveValue("/new-host");
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(
          page.getByRole("option", { name: /current-host/ }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Home directory", exact: true })
          .click();
        const final = (await requests(page, "listDirectory", 1))[0];
        await page.evaluate("window.fixture.unmount()");
        await complete(page, final.id, directory("/late", "late"));
        await frame(page);
        await expect(page.getByText("Fixture unmounted")).toBeVisible();
        assert.deepEqual(await page.evaluate("window.fixture.picked"), []);
        assert.equal(await page.evaluate("window.fixture.closed"), 0);
      },
    );
  },
);

test(
  "diagnostics refresh ownership preserves newer reports and drafts and reports only current errors",
  options,
  async () => {
    await withBrowserFixture(
      "diagnostics-ordering",
      source("diagnostics"),
      async (page) => {
        await requests(page, "serverAction", 1);
        await page
          .getByRole("button", { name: "Refresh", exact: true })
          .click();
        await diagnosticsPair(page, 1, "newer");
        await expect(page.getByLabel("Preferred hostname")).toHaveValue(
          "newer",
        );
        await page.getByLabel("Preferred hostname").fill("newer-draft");
        await diagnosticsPair(page, 0, "older");
        await frame(page);
        await expect(page.getByLabel("Preferred hostname")).toHaveValue(
          "newer-draft",
        );
        await page
          .getByRole("button", { name: "Copy report", exact: true })
          .click();
        assert.equal(
          await page.evaluate(
            "JSON.parse(window.fixture.copied.at(-1)).marker",
          ),
          "newer",
        );
        await page
          .getByRole("button", { name: "Refresh", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Refresh", exact: true })
          .click();
        const infos = await requests(page, "diagnostics", 2),
          statuses = await requests(page, "serverAction", 2);
        await complete(page, infos[1].id, { marker: "current" });
        await complete(page, statuses[1].id, status("current"));
        await expect(page.getByLabel("Preferred hostname")).toHaveValue(
          "current",
        );
        await complete(
          page,
          infos[0].id,
          undefined,
          "Obsolete diagnostics failure",
        );
        await complete(page, statuses[0].id, status("old"));
        await frame(page);
        await expect(page.getByRole("alert")).toHaveCount(0);
        await page
          .getByLabel("Preferred hostname")
          .fill("draft-survives-error");
        await page
          .getByRole("button", { name: "Refresh", exact: true })
          .click();
        await complete(
          page,
          (await requests(page, "diagnostics", 1))[0].id,
          undefined,
          "Current diagnostics RPC failed",
        );
        await complete(
          page,
          (await requests(page, "serverAction", 1))[0].id,
          status("irrelevant"),
        );
        await expect(page.getByRole("alert")).toHaveText(
          "Current diagnostics RPC failed",
        );
        await expect(page.getByLabel("Preferred hostname")).toHaveValue(
          "draft-survives-error",
        );
      },
    );
  },
);

test(
  "diagnostics discards the previous host report and ignores its completion after host changes and unmount",
  options,
  async () => {
    await withBrowserFixture(
      "diagnostics-host-lifetime",
      source("diagnostics"),
      async (page) => {
        await diagnosticsPair(page, 0, "first");
        await expect(page.getByLabel("Preferred hostname")).toHaveValue(
          "first",
        );
        await page
          .getByRole("button", { name: "Refresh", exact: true })
          .click();
        const olderInfo = (await requests(page, "diagnostics", 1))[0],
          olderStatus = (await requests(page, "serverAction", 1))[0];
        await page.evaluate(
          "window.fixture.target({hostId:'two',sessionId:'s',blockId:'b'})",
        );
        await requests(page, "serverAction", 2);
        await expect(page.getByLabel("Preferred hostname")).toHaveCount(0);
        const newInfo = (await requests(page, "diagnostics", 2)).find(
          (request) => request.args.hostId === "two",
        );
        const newStatus = (await requests(page, "serverAction", 2)).find(
          (request) => request.args.hostId === "two",
        );
        assert.ok(newInfo && newStatus);
        await complete(page, newInfo.id, { marker: "second" });
        await complete(page, newStatus.id, status("second"));
        await complete(page, olderInfo.id, { marker: "old" });
        await complete(page, olderStatus.id, status("old"));
        await frame(page);
        await expect(page.getByLabel("Preferred hostname")).toHaveValue(
          "second",
        );
        await page
          .getByRole("button", { name: "Refresh", exact: true })
          .click();
        const finalInfo = (await requests(page, "diagnostics", 1))[0],
          finalStatus = (await requests(page, "serverAction", 1))[0];
        await page.evaluate("window.fixture.unmount()");
        await complete(page, finalInfo.id, undefined, "Late failure");
        await complete(page, finalStatus.id, status("late"));
        await frame(page);
        await expect(page.getByText("Fixture unmounted")).toBeVisible();
      },
    );
  },
);

test(
  "block discovery and invocation results remain owned by their current target and method",
  options,
  async () => {
    await withBrowserFixture(
      "block-request-lifetime",
      source("block"),
      async (page) => {
        const older = (await requests(page, "blockInfo", 1))[0];
        await page.evaluate(
          "window.fixture.target({hostId:'one',sessionId:'s',blockId:'b'})",
        );
        const current = (await requests(page, "blockInfo", 2)).find(
          (request) => request.args.blockId === "b",
        );
        assert.ok(current);
        await complete(page, current.id, {
          methods: [{ name: "current" }, { name: "reset" }],
        });
        await expect(page.getByLabel("Server method")).toHaveValue("current");
        await complete(page, older.id, { methods: [{ name: "outdated" }] });
        await frame(page);
        await expect(page.getByLabel("Server method")).toHaveValue("current");
        await page
          .getByRole("button", { name: "Run method", exact: true })
          .click();
        const oldCall = (await requests(page, "callBlock", 1))[0];
        await page.getByLabel("Server method").selectOption("reset");
        await expect(
          page.getByRole("button", { name: "Run method", exact: true }),
        ).toBeEnabled();
        await page
          .getByRole("button", { name: "Run method", exact: true })
          .click();
        const newCall = (await requests(page, "callBlock", 2))[1];
        await complete(page, newCall.id, { method: "reset" });
        await complete(page, oldCall.id, { method: "outdated" });
        await frame(page);
        await expect(page.locator(".block-result pre")).toHaveText(
          '{\n  "method": "reset"\n}',
        );
        await page
          .getByRole("button", { name: "Run method", exact: true })
          .click();
        const previousTarget = (await requests(page, "callBlock", 1))[0];
        await page.evaluate(
          "window.fixture.target({hostId:'two',sessionId:'other',blockId:'c'})",
        );
        await complete(page, (await requests(page, "blockInfo", 1))[0].id, {
          methods: [{ name: "new-target" }],
        });
        await expect(
          page.getByRole("button", { name: "Run method", exact: true }),
        ).toBeEnabled();
        await page.getByLabel("Arguments as JSON").fill('{"draft":true}');
        await complete(
          page,
          previousTarget.id,
          undefined,
          "Previous target RPC failed",
        );
        await frame(page);
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(page.getByLabel("Arguments as JSON")).toHaveValue(
          '{"draft":true}',
        );
        await page
          .getByRole("button", { name: "Run method", exact: true })
          .click();
        const failed = (await requests(page, "callBlock", 1))[0];
        await complete(page, failed.id, undefined, "Current plugin RPC failed");
        await expect(page.getByRole("alert")).toContainText(
          "Current plugin RPC failed",
        );
      },
    );
  },
);

test(
  "changing an endpoint resets request ownership without changing host or block identifiers",
  options,
  async () => {
    for (const panel of ["directory", "diagnostics", "block"] as const) {
      await withBrowserFixture(
        "endpoint-ordering-" + panel,
        source(panel),
        async (page) => {
          const method =
            panel === "directory"
              ? "listDirectory"
              : panel === "diagnostics"
                ? "diagnostics"
                : "blockInfo";
          const previous = (await requests(page, method, 1))[0];
          const previousStatus =
            panel === "diagnostics"
              ? (await requests(page, "serverAction", 1))[0]
              : undefined;
          await page.evaluate(
            "window.fixture.target({hostId:'one',sessionId:'s',blockId:'a',endpoint:'unix:///changed.sock'})",
          );
          const fresh = (await requests(page, method, 2))[1];
          if (panel === "directory") {
            await complete(
              page,
              fresh.id,
              directory("/current-endpoint", "current"),
            );
            await complete(
              page,
              previous.id,
              directory("/old-endpoint", "outdated"),
            );
            await frame(page);
            await expect(page.getByLabel("Directory path")).toHaveValue(
              "/current-endpoint",
            );
          } else if (panel === "diagnostics") {
            const freshStatus = (await requests(page, "serverAction", 2))[1];
            await complete(page, fresh.id, { marker: "current" });
            await complete(page, freshStatus.id, status("current"));
            await complete(page, previous.id, { marker: "outdated" });
            if (previousStatus)
              await complete(page, previousStatus.id, status("outdated"));
            await frame(page);
            await expect(page.getByLabel("Preferred hostname")).toHaveValue(
              "current",
            );
          } else {
            await complete(page, fresh.id, { methods: [{ name: "current" }] });
            await complete(page, previous.id, {
              methods: [{ name: "outdated" }],
            });
            await frame(page);
            await expect(page.getByLabel("Server method")).toHaveValue(
              "current",
            );
          }
        },
      );
    }
  },
);
