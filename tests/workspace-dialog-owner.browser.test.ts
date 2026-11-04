import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import type { PrimaryDialog } from "../src/workspace/dialogs";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from 'react';import{createRoot}from'react-dom/client';
import{useWorkspaceDialogs}from'/src/hooks/useWorkspaceDialogs.ts';
import{WorkspaceDialogHost}from'/src/components/workspace/WorkspaceDialogHost.tsx';
import{WorkspaceReconciliationError}from'/src/core/workspaceOperations.ts';
import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
import'/src/styles.css';import'/src/dialogs.css';import'/src/advanced.css';
let controller,changeSettings,show;let settings={...structuredClone(DEFAULT_SETTINGS),hosts:[{id:'local',label:'Local',endpoint:'unix:///local.sock'},{id:'remote',label:'Remote',endpoint:'wss://remote.example'}]};
const calls=[],history=[],pending=[],owners=new Map();
const status={api_revision:10,session_count:0,tailscale:{state:'stopped',dns_name:'remote.tailnet.example',tags:[]}};
const f=window.fixture={calls,history,formWrites:[],confirmationWrites:0,errors:[],hold:false,
 open(dialog){const owner=controller.open(dialog);if(owner)owners.set(owner.id,owner);return owner?.id;},
 close(id){controller.close(owners.get(id));},
 transition(id){const owner=controller.open({kind:'report',title:'Stale transition',body:'Must never appear'},owners.get(id));return owner?.id;},
 form(){const owner=controller.open({kind:'form',form:{title:'Nested form',description:'Explicitly stacked form',fields:[{name:'label',label:'Label',value:'Initial',required:true}],async submit(values){f.formWrites.push(values);}}});owners.set(owner.id,owner);},
 confirmation(){const owner=controller.open({kind:'confirmation',confirmation:{title:'Nested confirmation',description:'Explicitly stacked confirmation',label:'Apply nested change',async submit(){f.confirmationWrites++;}}});owners.set(owner.id,owner);},
 endpoint(hostId,endpoint){changeSettings(current=>({...current,hosts:current.hosts.map(host=>host.id===hostId?{...host,endpoint}:host)}));},
 held(){return pending.length;},
 finish(success){const operation=pending.shift();if(!operation)throw Error('No held mutation');if(success)operation.resolve();else operation.reject(new WorkspaceReconciliationError(Error('Old inspection failed')));},
 unmount(){show(false);},
 openAfterUnmount(){return controller.open({kind:'report',title:'After unmount',body:'Must never appear'})?.id;}
};
window.rex={onClientEvent:()=>()=>{},getSettings:async()=>settings,setSettings:async value=>value,writeClipboard:async()=>{},readClipboard:async()=>'',async request(method,args){calls.push({method,args,endpoint:settings.hosts.find(host=>host.id===args?.hostId)?.endpoint});
 if(method==='credentialStatus')return{stored:false,secureStorageAvailable:true};
 if(method==='configInfo')return{path:'/config/'+args.hostId+'.lua',content:'-- '+settings.hosts.find(host=>host.id===args.hostId).endpoint,editable:true};
 if(method==='diagnostics')return{client:'Fixture',host:args.hostId};
 if(method==='serverAction')return status;
 if(method==='serverManagement')return{local:false,running:true,canManage:false,reason:'Managed remotely',arguments:[],origins:[]};
 if(method==='updateStatus')return{currentVersion:'1.0.0',installKind:'development',phase:'idle',canApply:false};
 if(method==='listDirectory')return{status:'ok',path:args.path||'/work',entries:[{name:'child'}],truncated:false};
 if(method==='newWindow')return;
 throw Error('Unexpected '+method);
}};
function Fixture(){const dialogState=useWorkspaceDialogs();controller=dialogState.controller;const[current,setSettings]=React.useState(settings);settings=current;changeSettings=setSettings;
 const operations={getSettings:()=>settings,async saveSettings(next){calls.push({method:'saveSettings',args:next});setSettings(next);return next;},async refresh(){calls.push({method:'refresh'});},async mutateHostAndRefresh(hostId,action){return action();},async mutateSession(plan,action){const result=await action();if(f.hold)await new Promise((resolve,reject)=>pending.push({resolve,reject}));return{result,view:{id:plan.sessionId,label:'Session',activeWindowId:'window',windows:[]}};},select(){},async focusPane(){},dismissNotices(){}};
 const observable={primary:dialogState.state.primary?.dialog.kind,primaryId:dialogState.state.primary?.id,formId:dialogState.state.form?.id,confirmationId:dialogState.state.confirmation?.id,modalOpen:dialogState.modalOpen};
 React.useEffect(()=>{history.push(observable);},[dialogState.state]);
 return React.createElement(React.Fragment,null,React.createElement('pre',{id:'dialog-state'},JSON.stringify(observable)),React.createElement(WorkspaceDialogHost,{state:dialogState.state,dialogs:controller,settings,hosts:settings.hosts.map(host=>({...host,connected:true,sessions:[]})),activeHostId:'local',operations,busy:false,commands:[{id:'fixture',label:'Fixture command',run(){}}],saveHost:async()=>{},onError:message=>f.errors.push(message)}));}
function Root(){const[mounted,setMounted]=React.useState(true);show=setMounted;return mounted?React.createElement(Fixture):React.createElement('p',null,'Dialog host unmounted');}
createRoot(document.getElementById('root')).render(React.createElement(Root));
`;
interface OwnerSnapshot {
  primary?: string;
  primaryId?: number;
  formId?: number;
  confirmationId?: number;
  modalOpen: boolean;
}
interface DialogFixture {
  calls: { method: string; args?: Record<string, unknown> }[];
  history: OwnerSnapshot[];
  hold: boolean;
  formWrites: { label: string }[];
  open(dialog: PrimaryDialog): number;
  close(id: number): void;
  transition(id: number): number | undefined;
  form(): void;
  confirmation(): void;
  endpoint(hostId: string, endpoint: string): void;
  held(): number;
  finish(success: boolean): void;
  unmount(): void;
  openAfterUnmount(): number | undefined;
}
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };
const target = { hostId: "remote", sessionId: "session", blockId: "pane" };
async function open(page: Page, dialog: PrimaryDialog) {
  return page.evaluate(
    (dialog) =>
      (window as unknown as { fixture: DialogFixture }).fixture.open(dialog),
    dialog,
  );
}
async function state(page: Page): Promise<OwnerSnapshot> {
  return JSON.parse(await page.locator("#dialog-state").innerText());
}
async function frame(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

for (const kind of ["rename", "confirmation"] as const) {
  test(
    `a server ${kind} opened from diagnostics rejects a replacement endpoint before mutation`,
    options,
    async () => {
      await withBrowserFixture(
        `server-${kind}-endpoint-owner`,
        source,
        async (page) => {
          await open(page, { kind: "diagnostics", hostId: "remote" });
          await page
            .getByRole("button", {
              name: kind === "rename" ? "Rename host…" : "Disable serving…",
              exact: true,
            })
            .click();
          assert.equal(
            (await state(page)).primary,
            undefined,
            "the originating diagnostics is replaced by its deferred action",
          );
          const owner =
            kind === "rename"
              ? (await state(page)).formId
              : (await state(page)).confirmationId;
          await page.evaluate(() =>
            (window as unknown as { fixture: DialogFixture }).fixture.endpoint(
              "remote",
              "wss://replacement.example",
            ),
          );
          await frame(page);
          assert.equal(
            kind === "rename"
              ? (await state(page)).formId
              : (await state(page)).confirmationId,
            owner,
            "the independent action slot survives the primary view's endpoint change",
          );
          if (kind === "rename")
            await page
              .getByRole("textbox", { name: "Hostname", exact: true })
              .fill("original-server-name");
          await page
            .getByRole("button", {
              name: kind === "rename" ? "Save" : "Apply change",
              exact: true,
            })
            .click();
          await frame(page);
          const writes = await page.evaluate(() =>
            (
              window as unknown as { fixture: DialogFixture }
            ).fixture.calls.filter(
              (call) =>
                call.method === "serverAction" &&
                call.args?.action !== "status",
            ),
          );
          assert.deepEqual(
            writes,
            [],
            "the original diagnostic action cannot be sent to the replacement server",
          );
          await expect(page.getByRole("alert")).toContainText(
            "host configuration changed",
          );
        },
      );
    },
  );
}

test(
  "primary dialog kinds replace each other and settings transitions publish one replacement",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-dialog-exclusivity",
      source,
      async (page) => {
        await expect
          .poll(async () => (await state(page)).modalOpen)
          .toBe(false);
        const settingsOwner = await open(page, {
          kind: "settings",
          tab: "hosts",
        });
        await expect(
          page.getByRole("dialog", { name: "Settings", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Connect another host", exact: true })
          .click();
        await expect(
          page.getByRole("dialog", {
            name: "Connect another host",
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(1);
        assert.notEqual((await state(page)).primaryId, settingsOwner);
        assert.deepEqual(
          await page.evaluate(() =>
            (
              window as unknown as { fixture: DialogFixture }
            ).fixture.history.map((item) => item.primary ?? "none"),
          ),
          ["none", "settings", "host"],
        );
        const transitions: [PrimaryDialog, string][] = [
          [{ kind: "configuration", hostId: "remote" }, "Rex configuration"],
          [{ kind: "diagnostics", hostId: "remote" }, "Connection diagnostics"],
          [{ kind: "pairing", hostId: "remote" }, "Connect another device"],
          [
            { kind: "services", hostId: "remote", tab: "server" },
            "Linux services and updates",
          ],
          [
            { kind: "directory", choice: { mode: "directory", ref: target } },
            "Open directory",
          ],
          [
            { kind: "report", title: "Fixture report", body: "Report content" },
            "Fixture report",
          ],
          [{ kind: "palette", scope: "all" }, "Command palette"],
        ];
        for (const [dialog, title] of transitions) {
          await open(page, dialog);
          await expect(
            page.getByRole("dialog", { name: title, exact: true }),
          ).toBeVisible();
          await expect(page.getByRole("dialog")).toHaveCount(1);
          assert.equal((await state(page)).primary, dialog.kind);
        }
        await open(page, { kind: "settings", tab: "server" });
        await page
          .getByRole("button", { name: "Connection diagnostics", exact: true })
          .click();
        await expect(
          page.getByRole("dialog", {
            name: "Connection diagnostics",
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(1);
        assert.equal((await state(page)).primary, "diagnostics");
        assert.deepEqual(
          await page.evaluate(() =>
            (window as unknown as { fixture: DialogFixture }).fixture.calls
              .filter((call) => call.method === "diagnostics")
              .map((call) => call.args?.hostId),
          ),
          ["remote", "local"],
        );
      },
    );
  },
);

test(
  "explicit forms and confirmations stack without replacing the primary owner",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-dialog-stacking",
      source,
      async (page) => {
        const primary = await open(page, {
          kind: "report",
          title: "Underlying report",
          body: "Keep this report",
        });
        await page.evaluate(() => {
          const fixture = (window as unknown as { fixture: DialogFixture })
            .fixture;
          fixture.form();
          fixture.confirmation();
        });
        await expect(page.getByRole("dialog")).toHaveCount(3);
        assert.equal((await state(page)).primaryId, primary);
        const confirmation = page.getByRole("dialog", {
          name: "Nested confirmation",
          exact: true,
        });
        await confirmation
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(2);
        const form = page.getByRole("dialog", {
          name: "Nested form",
          exact: true,
        });
        await form.getByLabel("Label", { exact: true }).fill("Updated");
        await form.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(1);
        await expect(
          page.getByRole("dialog", { name: "Underlying report", exact: true }),
        ).toBeVisible();
        assert.deepEqual(
          await page.evaluate(
            () =>
              (window as unknown as { fixture: DialogFixture }).fixture
                .formWrites,
          ),
          [{ label: "Updated" }],
        );
        assert.equal((await state(page)).primaryId, primary);
        await page.getByRole("button", { name: "Done", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect
          .poll(async () => (await state(page)).modalOpen)
          .toBe(false);
      },
    );
  },
);

for (const success of [true, false]) {
  test(
    `same-target directory replacement ignores its predecessor's pending ${success ? "success" : "committed failure"}`,
    options,
    async () => {
      await withBrowserFixture(
        `workspace-dialog-directory-${success}`,
        source,
        async (page) => {
          await page.evaluate(() => {
            (window as unknown as { fixture: DialogFixture }).fixture.hold =
              true;
          });
          const choice: PrimaryDialog = {
            kind: "directory",
            choice: { mode: "directory", ref: target },
          };
          const previous = await open(page, choice);
          const pick = page.getByRole("button", {
            name: "Open terminal here",
            exact: true,
          });
          await expect(pick).toBeEnabled();
          await pick.click();
          await expect(
            page.getByRole("button", { name: "Opening…", exact: true }),
          ).toBeDisabled();
          await expect
            .poll(() =>
              page.evaluate(() =>
                (
                  window as unknown as { fixture: DialogFixture }
                ).fixture.held(),
              ),
            )
            .toBe(1);
          const replacement = await open(page, choice);
          assert.notEqual(replacement, previous);
          await expect(pick).toBeEnabled();
          await page
            .getByRole("textbox", { name: "Directory path", exact: true })
            .fill("/replacement/draft");
          await page.evaluate(
            (success) =>
              (window as unknown as { fixture: DialogFixture }).fixture.finish(
                success,
              ),
            success,
          );
          await frame(page);
          await expect(
            page.getByRole("dialog", { name: "Open directory", exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole("textbox", { name: "Directory path", exact: true }),
          ).toHaveValue("/replacement/draft");
          await expect(pick).toBeEnabled();
          await expect(page.getByRole("alert")).toHaveCount(0);
          assert.equal((await state(page)).primaryId, replacement);
          assert.deepEqual(
            await page.evaluate(() =>
              (window as unknown as { fixture: DialogFixture }).fixture.calls
                .filter((call) => call.method === "newWindow")
                .map((call) => call.args),
            ),
            [
              {
                hostId: "remote",
                sessionId: "session",
                label: "work",
                cwd: "/work",
              },
            ],
          );
          await page.evaluate(
            (id) =>
              (window as unknown as { fixture: DialogFixture }).fixture.close(
                id,
              ),
            previous,
          );
          assert.equal(
            await page.evaluate(
              (id) =>
                (
                  window as unknown as { fixture: DialogFixture }
                ).fixture.transition(id),
              previous,
            ),
            undefined,
          );
          await frame(page);
          assert.equal((await state(page)).primaryId, replacement);
        },
      );
    },
  );
}

test(
  "host-scoped transitions keep their target and endpoint changes remount only that view",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-dialog-host-target",
      source,
      async (page) => {
        await open(page, { kind: "pairing", hostId: "remote" });
        await page
          .getByRole("button", { name: "Remote access settings", exact: true })
          .click();
        await expect(
          page.getByRole("dialog", {
            name: "Connection diagnostics",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Rename host…", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(1);
        await page
          .getByRole("textbox", { name: "Hostname", exact: true })
          .fill("remote-renamed");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        assert.deepEqual(
          await page.evaluate(() =>
            (window as unknown as { fixture: DialogFixture }).fixture.calls
              .filter((call) => call.method === "serverAction")
              .map((call) => call.args),
          ),
          [
            { hostId: "remote", action: "status" },
            { hostId: "remote", action: "status" },
            {
              hostId: "remote",
              action: "tailscale.rename",
              args: { hostname: "remote-renamed" },
            },
          ],
        );
        const owner = await open(page, {
          kind: "configuration",
          hostId: "remote",
        });
        const editor = page.getByRole("textbox", {
          name: "Lua configuration",
          exact: true,
        });
        await expect(editor).toHaveValue("-- wss://remote.example");
        await editor.fill("Unsaved old endpoint content");
        await page.evaluate(() =>
          (window as unknown as { fixture: DialogFixture }).fixture.endpoint(
            "remote",
            "wss://replacement.example",
          ),
        );
        await expect(editor).toHaveValue("-- wss://replacement.example");
        assert.equal((await state(page)).primaryId, owner);
        assert.deepEqual(
          await page.evaluate(() =>
            (window as unknown as { fixture: DialogFixture }).fixture.calls
              .filter((call) => call.method === "configInfo")
              .map((call) => call.args?.hostId),
          ),
          ["remote", "remote"],
        );
      },
    );
  },
);

test(
  "unmounting the real hook revokes retained dialog actions",
  options,
  async () => {
    await withBrowserFixture(
      "workspace-dialog-disposal",
      source,
      async (page) => {
        const owner = await open(page, {
          kind: "report",
          title: "Owned report",
          body: "Before unmount",
        });
        await expect(
          page.getByRole("dialog", { name: "Owned report", exact: true }),
        ).toBeVisible();
        await page.evaluate(() =>
          (window as unknown as { fixture: DialogFixture }).fixture.unmount(),
        );
        await expect(page.getByText("Dialog host unmounted")).toBeVisible();
        const publications = await page.evaluate(
          () =>
            (window as unknown as { fixture: DialogFixture }).fixture.history
              .length,
        );
        assert.equal(
          await page.evaluate(() =>
            (
              window as unknown as { fixture: DialogFixture }
            ).fixture.openAfterUnmount(),
          ),
          undefined,
        );
        await page.evaluate(
          (id) =>
            (window as unknown as { fixture: DialogFixture }).fixture.close(id),
          owner,
        );
        await frame(page);
        assert.equal(
          await page.evaluate(
            () =>
              (window as unknown as { fixture: DialogFixture }).fixture.history
                .length,
          ),
          publications,
        );
        await expect(page.getByRole("dialog")).toHaveCount(0);
      },
    );
  },
);
