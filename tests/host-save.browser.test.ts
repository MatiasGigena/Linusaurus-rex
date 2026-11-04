import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from'react';import{createRoot}from'react-dom/client';
import{HostDialog}from'/src/components/HostDialog.tsx';
import{createHostSaver}from'/src/workspace/actions/hostActions.ts';
import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
import'/src/styles.css';import'/src/dialogs.css';
let settings=structuredClone(DEFAULT_SETTINGS),rerender,show,completeCredential;
const f=window.fixture={calls:[],credentialFailures:0,refreshFailures:0,settingsFailures:0,failedAcknowledgements:0,holdCredentials:false,closed:0,
 state:()=>structuredClone(settings),
 external(){settings={...settings,fontSize:23,hosts:[...settings.hosts,{id:'other',label:'Other',endpoint:'wss://other.example'}]};rerender();},
 replaceEndpoint(){settings={...settings,hosts:settings.hosts.map(host=>host.label==='New remote'?{...host,endpoint:'wss://replacement.example'}:host)};rerender();},
 completeCredential(){if(!completeCredential)throw Error('No held credentials');completeCredential();},
};
window.rex={async request(method,args){f.calls.push({method,args});if(method!=='setCredentials')throw Error('Unexpected '+method);if(f.holdCredentials)await new Promise(resolve=>{completeCredential=resolve;});if(f.credentialFailures-->0)throw Object.assign(Error('Keyring unavailable'),{code:'KEYRING_LOCKED',method});}};
function Fixture(){const[,update]=React.useState(0),[visible,setVisible]=React.useState(true);rerender=()=>update(version=>version+1);show=setVisible;
const save=createHostSaver({getSettings:()=>settings,async saveSettings(next){f.calls.push({method:'saveSettings',hostIds:next.hosts.map(host=>host.id)});if(f.settingsFailures-->0)throw Error('Preferences disk unavailable');settings=next;rerender();if(f.failedAcknowledgements-->0)throw Error('Preferences acknowledgement unavailable');return next;},async refresh(){f.calls.push({method:'refresh'});if(f.refreshFailures-->0)throw Object.assign(Error('Workspace read unavailable'),{code:'READ_FAILED',method:'status'});}},hostId=>f.calls.push({method:'reconnected',hostId}));
return React.createElement(React.Fragment,null,React.createElement('pre',{id:'saved-hosts'},JSON.stringify(settings.hosts)),visible?React.createElement(HostDialog,{onSave:(...args)=>save(...args),onClose(){f.closed++;show(false);}}):React.createElement('p',null,'Host dialog closed'));}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
interface HostSaveFixture {
  calls: { method: string; args?: { hostId: string }; hostIds?: string[] }[];
  credentialFailures: number;
  refreshFailures: number;
  settingsFailures: number;
  failedAcknowledgements: number;
  holdCredentials: boolean;
  closed: number;
  state(): {
    fontSize: number;
    hosts: { id: string; label: string; endpoint: string }[];
  };
  external(): void;
  replaceEndpoint(): void;
  completeCredential(): void;
}
interface FixtureWindow {
  fixture: HostSaveFixture;
}
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };
async function draft(page: Page) {
  await page.getByLabel("Display name", { exact: true }).fill("New remote");
  await page
    .getByLabel("Rex endpoint or account@host")
    .fill("wss://remote.example");
  await page
    .getByLabel("Optional HTTP gateway authentication")
    .selectOption("token");
  await page.getByLabel("Access token", { exact: true }).fill("fixture-token");
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const fixture = (window as unknown as FixtureWindow).fixture;
    return { ...fixture.state(), calls: fixture.calls, closed: fixture.closed };
  });
}
async function frame(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test(
  "credential recovery retains one committed host and skips settings across repeated failures and new saver renders",
  options,
  async () => {
    await withBrowserFixture("host-save-credentials", source, async (page) => {
      await draft(page);
      await page.evaluate(() => {
        (window as unknown as FixtureWindow).fixture.credentialFailures = 2;
      });
      const submit = page.locator(".dialog-actions .button-primary");
      await submit.click();
      await expect(page.getByRole("alert")).toContainText(
        "Keyring unavailable",
      );
      await expect(submit).toHaveText("Retry credential storage");
      await expect(
        page.getByLabel("Display name", { exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByLabel("Optional HTTP gateway authentication"),
      ).toBeDisabled();
      await page.evaluate(() =>
        (window as unknown as FixtureWindow).fixture.external(),
      );
      await submit.click();
      await expect(page.getByRole("alert")).toContainText(
        "Keyring unavailable",
      );
      await submit.click();
      await expect(
        page.getByText("Host dialog closed", { exact: true }),
      ).toBeVisible();
      const state = await snapshot(page);
      assert.equal(
        state.hosts.filter((host) => host.label === "New remote").length,
        1,
        "Recovery must retain one saved draft identity",
      );
      assert.equal(
        state.calls.filter((call) => call.method === "saveSettings").length,
        1,
      );
      const credentials = state.calls.filter(
        (call) => call.method === "setCredentials",
      );
      assert.equal(credentials.length, 3);
      assert.equal(
        new Set(credentials.map((call) => call.args?.hostId)).size,
        1,
      );
      assert.equal(
        state.calls.filter((call) => call.method === "reconnected").length,
        1,
      );
      assert.equal(
        state.calls.filter((call) => call.method === "refresh").length,
        1,
      );
      assert.equal(state.fontSize, 23);
      assert.ok(state.hosts.some((host) => host.id === "other"));
    });
  },
);

test(
  "refresh recovery repeats reads only after credentials and reconnect already completed",
  options,
  async () => {
    await withBrowserFixture("host-save-refresh", source, async (page) => {
      await draft(page);
      await page.evaluate(() => {
        (window as unknown as FixtureWindow).fixture.refreshFailures = 2;
      });
      const submit = page.locator(".dialog-actions .button-primary");
      await submit.click();
      await expect(page.getByRole("alert")).toContainText(
        "Workspace read unavailable",
      );
      await page.evaluate(() =>
        (window as unknown as FixtureWindow).fixture.external(),
      );
      await submit.click();
      await expect(page.getByRole("alert")).toContainText(
        "Workspace read unavailable",
      );
      await submit.click();
      await expect(
        page.getByText("Host dialog closed", { exact: true }),
      ).toBeVisible();
      const state = await snapshot(page);
      assert.deepEqual(
        ["saveSettings", "setCredentials", "reconnected", "refresh"].map(
          (method) =>
            state.calls.filter((call) => call.method === method).length,
        ),
        [1, 1, 1, 3],
        "Completed stages must not replay on a refresh retry",
      );
      assert.equal(
        state.hosts.filter((host) => host.label === "New remote").length,
        1,
      );
      assert.equal(state.fontSize, 23);
    });
  },
);

for (const phase of ["credentials", "refresh"] as const)
  test(
    `committed ${phase} recovery refuses an endpoint replacement instead of creating another host`,
    options,
    async () => {
      await withBrowserFixture("host-save-endpoint", source, async (page) => {
        await draft(page);
        await page.evaluate((phase) => {
          const fixture = (window as unknown as FixtureWindow).fixture;
          if (phase === "credentials") fixture.credentialFailures = 1;
          else fixture.refreshFailures = 1;
        }, phase);
        const submit = page.locator(".dialog-actions .button-primary");
        await submit.click();
        await expect(page.getByRole("alert")).toContainText(
          phase === "credentials"
            ? "Keyring unavailable"
            : "Workspace read unavailable",
        );
        const before = await snapshot(page);
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.replaceEndpoint(),
        );
        await submit.click();
        await frame(page);
        const after = await snapshot(page);
        assert.equal(
          after.calls.length,
          before.calls.length,
          "Obsolete recovery must start no settings, credential, reconnect or refresh work",
        );
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(page.getByRole("alert")).toContainText("changed");
      });
    },
  );

test(
  "closing a host form while credentials are held prevents reconnect and refresh follow-up",
  options,
  async () => {
    await withBrowserFixture("host-save-unmount", source, async (page) => {
      await draft(page);
      await page.evaluate(() => {
        (window as unknown as FixtureWindow).fixture.holdCredentials = true;
      });
      await page.locator(".dialog-actions .button-primary").click();
      await expect
        .poll(async () =>
          (await snapshot(page)).calls.some(
            (call) => call.method === "setCredentials",
          ),
        )
        .toBe(true);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(
        page.getByText("Host dialog closed", { exact: true }),
      ).toBeVisible();
      await page.evaluate(() =>
        (window as unknown as FixtureWindow).fixture.completeCredential(),
      );
      await frame(page);
      const state = await snapshot(page);
      assert.deepEqual(
        state.calls.filter((call) =>
          ["reconnected", "refresh"].includes(call.method),
        ),
        [],
        "Closed form must not continue the connection stages",
      );
      assert.equal(state.closed, 1);
    });
  },
);

test(
  "a preferences rejection leaves the draft editable and retries its stable ID with the new values",
  options,
  async () => {
    await withBrowserFixture(
      "host-save-editable-retry",
      source,
      async (page) => {
        await draft(page);
        await page.evaluate(() => {
          (window as unknown as FixtureWindow).fixture.settingsFailures = 1;
        });
        const submit = page.locator(".dialog-actions .button-primary");
        await submit.click();
        await expect(page.getByRole("alert")).toHaveText(
          "Preferences disk unavailable",
        );
        await expect(submit).toHaveText("Save and connect");
        await expect(
          page.getByLabel("Display name", { exact: true }),
        ).toBeEnabled();
        await page
          .getByLabel("Display name", { exact: true })
          .fill("Edited remote");
        await page
          .getByLabel("Rex endpoint or account@host")
          .fill("wss://edited.example");
        await submit.click();
        await expect(
          page.getByText("Host dialog closed", { exact: true }),
        ).toBeVisible();
        const state = await snapshot(page);
        const attempts = state.calls.filter(
          (call) => call.method === "saveSettings",
        );
        assert.equal(attempts.length, 2);
        assert.equal(attempts[0].hostIds?.at(-1), attempts[1].hostIds?.at(-1));
        assert.equal(
          state.hosts.filter((host) => host.label === "New remote").length,
          0,
        );
        assert.ok(
          state.hosts.some(
            (host) =>
              host.label === "Edited remote" &&
              host.endpoint === "wss://edited.example",
          ),
        );
      },
    );
  },
);

test(
  "an ambiguous preferences acknowledgement may resubmit but cannot duplicate the stable host identity",
  options,
  async () => {
    await withBrowserFixture(
      "host-save-acknowledgement-retry",
      source,
      async (page) => {
        await draft(page);
        await page.evaluate(() => {
          (window as unknown as FixtureWindow).fixture.failedAcknowledgements =
            1;
        });
        const submit = page.locator(".dialog-actions .button-primary");
        await submit.click();
        await expect(page.getByRole("alert")).toHaveText(
          "Preferences acknowledgement unavailable",
        );
        assert.equal(
          (await snapshot(page)).hosts.filter(
            (host) => host.label === "New remote",
          ).length,
          1,
        );
        await submit.click();
        await expect(
          page.getByText("Host dialog closed", { exact: true }),
        ).toBeVisible();
        const state = await snapshot(page);
        assert.equal(
          state.hosts.filter((host) => host.label === "New remote").length,
          1,
        );
        assert.equal(
          state.calls.filter((call) => call.method === "saveSettings").length,
          2,
        );
        assert.equal(
          state.calls.filter((call) => call.method === "setCredentials").length,
          1,
        );
      },
    );
  },
);
