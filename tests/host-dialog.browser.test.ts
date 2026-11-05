import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {HostDialog} from '/src/components/HostDialog.tsx';
import '/src/styles.css';import '/src/dialogs.css';
const requests=[],saves=[];let setHost,setVisible;
window.fixture={requests,saves,closed:0,saveError:undefined,
 complete(method,hostId,value,error){const item=requests.find(item=>item.method===method&&item.args.hostId===hostId&&!item.settled);if(!item)throw Error('No pending '+method+' for '+hostId);item.settled=true;error?item.reject(Error(error)):item.resolve(value);},
 showHost(host){setHost(host);setVisible(true);},unmount(){setVisible(false);}
};
window.rex={request(method,args){return new Promise((resolve,reject)=>requests.push({method,args,resolve,reject,settled:false}));}};
function Fixture(){const[host,changeHost]=React.useState({id:'one',label:'Remote one',endpoint:'https://one.example'});const[visible,show]=React.useState(true);setHost=changeHost;setVisible=show;return visible?React.createElement(HostDialog,{host,onSave:async(host,credentials)=>{saves.push({host,credentials});if(window.fixture.saveError)throw Error(window.fixture.saveError);},onClose(){window.fixture.closed++;show(false);}}):React.createElement('p',null,'Host dialog closed');}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
interface HostFixture {
  fixture: {
    complete(
      method: string,
      hostId: string,
      value?: unknown,
      error?: string,
    ): void;
    showHost(
      host: { id: string; label: string; endpoint: string } | undefined,
    ): void;
    unmount(): void;
    saveError?: string;
    saves: {
      host: {
        id: string;
        label: string;
        endpoint: string;
        startupCommand?: string;
      };
      credentials?: { username?: string; password?: string; token?: string };
    }[];
    requests: { method: string; args: { hostId: string }; settled: boolean }[];
    closed: number;
  };
}
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };
async function complete(
  page: Page,
  hostId: string,
  status: { stored: boolean; secureStorageAvailable: boolean },
) {
  await page.evaluate(
    ({ hostId, status }) =>
      (window as unknown as HostFixture).fixture.complete(
        "credentialStatus",
        hostId,
        status,
      ),
    { hostId, status },
  );
}

test(
  "credential discovery distinguishes pending, failed, present and absent status and reports save/forget failures",
  options,
  async () => {
    await withBrowserFixture("host-discovery", source, async (page) => {
      await expect(page.getByRole("status")).toHaveText(
        "Checking saved credentials and system keyring…",
      );
      await expect(
        page.getByText("No credentials are saved for this host."),
      ).toHaveCount(0);
      await expect(
        page.getByRole("option", {
          name: "Keep saved credentials",
          exact: true,
        }),
      ).toHaveCount(0);
      await page.evaluate(() =>
        (window as unknown as HostFixture).fixture.complete(
          "credentialStatus",
          "one",
          undefined,
          "Keyring lookup failed",
        ),
      );
      await expect(page.getByRole("alert")).toContainText(
        "Saved credentials could not be checked: Keyring lookup failed",
      );
      await expect(
        page.getByText("No credentials are saved for this host."),
      ).toHaveCount(0);
      await expect(
        page.getByRole("option", {
          name: "Keep authentication unchanged",
          exact: true,
        }),
      ).toHaveCount(1);
      await page
        .getByRole("button", { name: "Retry credential check", exact: true })
        .click();
      await expect(page.getByRole("status")).toBeVisible();
      await complete(page, "one", {
        stored: true,
        secureStorageAvailable: true,
      });
      await expect(
        page.getByText("Credentials saved separately from preferences"),
      ).toBeVisible();
      await expect(
        page.getByRole("option", {
          name: "Keep saved credentials",
          exact: true,
        }),
      ).toHaveCount(1);
      await page
        .getByLabel("Rex endpoint or account@host")
        .fill("https://changed.example");
      await expect(
        page.getByText("Credentials saved separately from preferences"),
      ).toHaveCount(0);
      await expect(
        page.getByRole("option", {
          name: "Keep saved credentials",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Save the new endpoint to check its saved credentials."),
      ).toBeVisible();
      await page
        .getByLabel("Rex endpoint or account@host")
        .fill("https://one.example");
      await expect(
        page.getByText("Credentials saved separately from preferences"),
      ).toBeVisible();
      await page.getByRole("button", { name: "Forget", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Forgetting…", exact: true }),
      ).toBeDisabled();
      await page.evaluate(() =>
        (window as unknown as HostFixture).fixture.complete(
          "removeCredentials",
          "one",
          undefined,
          "Credentials file is read-only",
        ),
      );
      await expect(page.getByRole("alert")).toHaveText(
        "Credentials file is read-only",
      );
      await expect(
        page.getByText("Credentials saved separately from preferences"),
      ).toBeVisible();
      await page.getByRole("button", { name: "Forget", exact: true }).click();
      await page.evaluate(() =>
        (window as unknown as HostFixture).fixture.complete(
          "removeCredentials",
          "one",
        ),
      );
      await expect(
        page.getByText("No credentials are saved for this host."),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Forget", exact: true }),
      ).toHaveCount(0);
      await page
        .getByLabel("Optional HTTP gateway authentication")
        .selectOption("basic");
      await page.getByLabel("Username", { exact: true }).fill("gateway-user");
      await page
        .getByLabel("Password", { exact: true })
        .fill("gateway-password");
      await page
        .getByLabel("Display name", { exact: true })
        .fill("  Renamed remote  ");
      await page.getByLabel("Startup program").selectOption("custom");
      await page
        .getByLabel("Startup command for this host")
        .fill("/usr/bin/fish --login");
      await page.evaluate(
        () =>
          ((window as unknown as HostFixture).fixture.saveError =
            "Gateway rejected the credentials"),
      );
      await page
        .getByRole("button", { name: "Save and connect", exact: true })
        .click();
      await expect(page.getByRole("alert")).toHaveText(
        "Gateway rejected the credentials",
      );
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Save and connect", exact: true }),
      ).toBeEnabled();
      await page.evaluate(() => {
        (window as unknown as HostFixture).fixture.saveError = undefined;
      });
      await page
        .getByRole("button", { name: "Save and connect", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const state = await page.evaluate(() => {
        const fixture = (window as unknown as HostFixture).fixture;
        return { saved: fixture.saves.at(-1), closed: fixture.closed };
      });
      assert.deepEqual(state.saved, {
        host: {
          id: "one",
          label: "Renamed remote",
          endpoint: "https://one.example",
          startupCommand: "/usr/bin/fish --login",
        },
        credentials: { username: "gateway-user", password: "gateway-password" },
      });
      assert.equal(state.closed, 1);
    });
  },
);

test(
  "credential discovery reports an unavailable keyring without claiming pending credentials are absent",
  options,
  async () => {
    await withBrowserFixture("host-keyring", source, async (page) => {
      await expect(page.getByRole("status")).toBeVisible();
      await complete(page, "one", {
        stored: false,
        secureStorageAvailable: false,
      });
      await expect(
        page.getByText("No credentials are saved for this host."),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Unlock or enable a system keyring before saving credentials.",
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("option", {
          name: "Keep saved credentials",
          exact: true,
        }),
      ).toHaveCount(0);
      await page
        .getByLabel("Optional HTTP gateway authentication")
        .selectOption("token");
      await page
        .getByLabel("Access token", { exact: true })
        .fill("gateway-token");
      await page.evaluate(
        () =>
          ((window as unknown as HostFixture).fixture.saveError =
            "A secure desktop secret store is required to save credentials."),
      );
      await page
        .getByRole("button", { name: "Save and connect", exact: true })
        .click();
      await expect(page.getByRole("alert")).toHaveText(
        "A secure desktop secret store is required to save credentials.",
      );
    });
  },
);

test(
  "credential status and forget completions cannot update another host or an unmounted form",
  options,
  async () => {
    await withBrowserFixture("host-status-lifetime", source, async (page) => {
      await expect(page.getByRole("status")).toBeVisible();
      await page.evaluate(() =>
        (window as unknown as HostFixture).fixture.showHost({
          id: "two",
          label: "Remote two",
          endpoint: "https://two.example",
        }),
      );
      await expect(
        page.getByLabel("Display name", { exact: true }),
      ).toHaveValue("Remote two");
      await complete(page, "one", {
        stored: true,
        secureStorageAvailable: true,
      });
      await expect(page.getByRole("status")).toBeVisible();
      await expect(
        page.getByText("Credentials saved separately from preferences"),
      ).toHaveCount(0);
      await complete(page, "two", {
        stored: true,
        secureStorageAvailable: true,
      });
      await page.getByRole("button", { name: "Forget", exact: true }).click();
      await page.evaluate(() =>
        (window as unknown as HostFixture).fixture.showHost({
          id: "three",
          label: "Remote three",
          endpoint: "https://three.example",
        }),
      );
      await expect(
        page.getByLabel("Display name", { exact: true }),
      ).toHaveValue("Remote three");
      await page.evaluate(() =>
        (window as unknown as HostFixture).fixture.complete(
          "removeCredentials",
          "two",
        ),
      );
      await expect(page.getByRole("status")).toBeVisible();
      await expect(
        page.getByText("No credentials are saved for this host."),
      ).toHaveCount(0);
      await page.evaluate(() =>
        (window as unknown as HostFixture).fixture.unmount(),
      );
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const calls = await page.evaluate(
        () => (window as unknown as HostFixture).fixture.requests.length,
      );
      await complete(page, "three", {
        stored: false,
        secureStorageAvailable: false,
      });
      assert.equal(
        await page.evaluate(
          () => (window as unknown as HostFixture).fixture.requests.length,
        ),
        calls,
      );
      await expect(page.getByText("Host dialog closed")).toBeVisible();
    });
  },
);
