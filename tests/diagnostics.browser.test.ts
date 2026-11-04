import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture.js";

const validStatus = {
  started_at: "2026-11-04T12:00:00Z",
  api_min_revision: 7,
  api_revision: 10,
  session_count: 2,
  future: { supported: true },
  tailscale: {
    state: "running",
    dns_name: "alpha.example.test",
    control_url: "https://control.example.test",
    allow_tailnet_members: false,
    tags: ["tag:old"],
    account: { login_name: "first@example.test" },
    https: { state: "serving", url: "https://alpha.example.test/" },
  },
};
const source = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DiagnosticsDialog } from '/src/components/DiagnosticsDialog.tsx';
import '/src/styles.css';import '/src/advanced.css';import '/src/dialogs.css';
let status=${JSON.stringify(validStatus)}, report=0;
window.fixture={setStatus(value){status=value;},failures:{},copied:[],actions:[]};
window.rex={
  request:async(method)=>{if(method==='diagnostics')return{clientReport:++report};if(method==='serverAction')return status;if(method==='openExternal'){if(window.fixture.failures.open)throw new Error(window.fixture.failures.open);return;}throw new Error('Unexpected request '+method);},
  writeClipboard:async(value)=>{if(window.fixture.failures.clipboard)throw new Error(window.fixture.failures.clipboard);window.fixture.copied.push(value);},
};
createRoot(document.getElementById('root')).render(React.createElement(DiagnosticsDialog,{hostId:'host',onClose(){},onServerAction(action,args){window.fixture.actions.push({action,args});}}));
`;

type FixtureWindow = Window & {
  fixture: {
    setStatus(value: unknown): void;
    failures: { clipboard?: string; open?: string };
    copied: string[];
    actions: unknown[];
  };
};

test(
  "diagnostics keeps its last valid report on malformed refreshes and recovers atomically",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 45_000 },
  async () => {
    await withBrowserFixture("diagnostics", source, async (page) => {
      const hostname = page.getByLabel("Preferred hostname");
      const control = page.getByLabel("Control server (optional)");
      const tags = page.getByLabel("Tags (optional)");
      const members = page.getByLabel(
        "Allow tailnet members permitted by your tailnet's access rules",
      );
      await expect(hostname).toHaveValue("alpha");
      await expect(control).toHaveValue("https://control.example.test");
      await expect(tags).toHaveValue("tag:old");
      await expect(members).not.toBeChecked();
      await page
        .getByRole("button", { name: "Copy report", exact: true })
        .click();
      const initial = await page.evaluate(() =>
        (window as unknown as FixtureWindow).fixture.copied.at(-1),
      );
      assert.ok(initial);
      assert.deepEqual(JSON.parse(initial).status.future, { supported: true });
      await page
        .getByRole("button", { name: "Copy remote address", exact: true })
        .click();
      assert.equal(
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.copied.at(-1),
        ),
        "https://alpha.example.test/",
      );
      await hostname.fill("draft-kept");

      const malformed = [
        { value: null, field: "status" },
        {
          value: { ...validStatus, api_revision: "ten" },
          field: "api_revision",
        },
        {
          value: { ...validStatus, session_count: [] },
          field: "session_count",
        },
        {
          value: {
            ...validStatus,
            tailscale: { ...validStatus.tailscale, tags: "tag:bad" },
          },
          field: "tailscale.tags",
        },
        {
          value: {
            ...validStatus,
            tailscale: { ...validStatus.tailscale, dns_name: 5 },
          },
          field: "tailscale.dns_name",
        },
        {
          value: {
            ...validStatus,
            tailscale: {
              ...validStatus.tailscale,
              allow_tailnet_members: "false",
            },
          },
          field: "tailscale.allow_tailnet_members",
        },
        {
          value: {
            ...validStatus,
            tailscale: {
              ...validStatus.tailscale,
              account: { login_name: {} },
            },
          },
          field: "tailscale.account.login_name",
        },
        {
          value: {
            ...validStatus,
            tailscale: {
              ...validStatus.tailscale,
              https: { state: "serving", url: {} },
            },
          },
          field: "tailscale.https.url",
        },
      ];
      for (const { value, field } of malformed) {
        await page.evaluate(
          (value) =>
            (window as unknown as FixtureWindow).fixture.setStatus(value),
          value,
        );
        await page
          .getByRole("button", { name: "Refresh", exact: true })
          .click();
        await expect(page.getByRole("alert")).toContainText(
          `invalid server status (${field})`,
        );
        await expect(hostname).toHaveValue("draft-kept");
        await expect(control).toHaveValue("https://control.example.test");
        await expect(tags).toHaveValue("tag:old");
        await expect(members).not.toBeChecked();
      }
      await page
        .getByRole("button", { name: "Copy report", exact: true })
        .click();
      assert.equal(
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.copied.at(-1),
        ),
        initial,
      );

      const refreshed = {
        ...validStatus,
        session_count: 3,
        tailscale: {
          state: "needs_login",
          dns_name: "bravo.example.test",
          control_url: "",
          tags: ["tag:team", "tag:rex"],
          allow_tailnet_members: true,
          account: { login_name: "second@example.test" },
          https: { state: "pending" },
          auth_url: "https://login.example.test/",
        },
      };
      await page.evaluate(
        (value) =>
          (window as unknown as FixtureWindow).fixture.setStatus(value),
        refreshed,
      );
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(hostname).toHaveValue("bravo");
      await expect(control).toHaveValue("");
      await expect(tags).toHaveValue("tag:team, tag:rex");
      await expect(members).toBeChecked();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Continue sign-in", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "Apply access policy / enable…",
          exact: true,
        })
        .click();
      assert.deepEqual(
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.actions.at(-1),
        ),
        {
          action: "tailscale.enable",
          args: {
            allow_tailnet_members: true,
            hostname: "bravo",
            advertise_tags: ["tag:team", "tag:rex"],
          },
        },
      );
      await page.evaluate(() =>
        (window as unknown as FixtureWindow).fixture.setStatus({
          futureStatus: true,
        }),
      );
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(hostname).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
  },
);

test(
  "diagnostics reports clipboard and external-browser failures through its dialog",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
  async () => {
    await withBrowserFixture("diagnostics-actions", source, async (page) => {
      await expect(page.getByLabel("Preferred hostname")).toHaveValue("alpha");
      await page.evaluate(() => {
        (window as unknown as FixtureWindow).fixture.failures.clipboard =
          "Clipboard denied";
      });
      for (const name of ["Copy remote address", "Copy report"]) {
        await page.getByRole("button", { name, exact: true }).click();
        await expect(page.getByRole("alert")).toHaveText("Clipboard denied");
        await page
          .getByRole("button", { name: "Refresh", exact: true })
          .click();
        await expect(page.getByRole("alert")).toHaveCount(0);
      }
      await page.evaluate(
        (value) => {
          const fixture = (window as unknown as FixtureWindow).fixture;
          fixture.failures.open = "Browser unavailable";
          fixture.setStatus(value);
        },
        {
          ...validStatus,
          tailscale: {
            ...validStatus.tailscale,
            auth_url: "https://login.example.test/",
          },
        },
      );
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page
        .getByRole("button", { name: "Continue sign-in", exact: true })
        .click();
      await expect(page.getByRole("alert")).toHaveText("Browser unavailable");
    });
  },
);
