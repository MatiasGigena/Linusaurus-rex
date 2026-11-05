import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import type { UpdateState } from "../src/shared/types";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from'react';import{createRoot}from'react-dom/client';
import App from'/src/App.tsx';import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
import'/src/styles.css';import'/src/dialogs.css';import'/src/advanced.css';import'/src/macos.css';
const settings={...structuredClone(DEFAULT_SETTINGS),hosts:[{id:'remote',label:'Remote server',endpoint:'wss://remote.example'}]};
const listeners=new Set(),calls=[];let show,resolveInitial,rejectInitial;
const idle={phase:'idle',currentVersion:'1.0.0',installKind:'development',canApply:false};let current=idle;
const f=window.fixture={calls,waiting:()=>Boolean(resolveInitial),
 emit(state){current=state;for(const listener of listeners)listener({type:'update',state});},
 complete(state){if(!resolveInitial)throw Error('No initial discovery');resolveInitial(state);},
 fail(){if(!rejectInitial)throw Error('No initial discovery');rejectInitial(Error('Discovery unavailable'));},
 unmount(){show(false);},
};
window.rex={getSettings:async()=>settings,setSettings:async next=>next,onClientEvent:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},onCommand:()=>()=>{},windowControl(){},async writeClipboard(){},async readClipboard(){return'';},
 request(method,args){calls.push({method,args});if(method==='updateStatus'){if(!resolveInitial)return new Promise((resolve,reject)=>{resolveInitial=resolve;rejectInitial=reject;});return Promise.resolve(current);}if(method==='setContext')return Promise.resolve();if(method==='status')return Promise.resolve({connected:true});if(method==='listSessions')return Promise.resolve([]);if(method==='keymap')return Promise.resolve({actions:[],bindings:[],modes:[],warnings:[]});throw Error('Unexpected '+method);}
};
function Fixture(){const[visible,setVisible]=React.useState(true);show=setVisible;return visible?React.createElement(App):React.createElement('p',null,'App unmounted');}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
interface UpdateFixture {
  calls: { method: string }[];
  waiting(): boolean;
  emit(state: UpdateState): void;
  complete(state: UpdateState): void;
  fail(): void;
  unmount(): void;
}
interface FixtureWindow {
  fixture: UpdateFixture;
}
const idle: UpdateState = {
  phase: "idle",
  currentVersion: "1.0.0",
  installKind: "development",
  canApply: false,
};
const available: UpdateState = {
  ...idle,
  phase: "available",
  version: "1.2.0",
};
const ready: UpdateState = { ...available, phase: "ready", canApply: true };
const scheduled: UpdateState = { ...available, phase: "scheduled" };
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };

async function loaded(page: Page) {
  await expect(
    page.getByRole("heading", {
      name: "Make room for your next idea.",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as FixtureWindow).fixture.waiting(),
      ),
    )
    .toBe(true);
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
  "actual App update discovery cannot erase a newer ready notification",
  options,
  async () => {
    await withBrowserFixture("app-update-newer-ready", source, async (page) => {
      await loaded(page);
      await page.evaluate(
        (state) => (window as unknown as FixtureWindow).fixture.emit(state),
        ready,
      );
      await expect(page.locator(".client-update-banner")).toContainText(
        "1.2.0 is ready to install",
      );
      await page.evaluate(
        (state) => (window as unknown as FixtureWindow).fixture.complete(state),
        idle,
      );
      await frame(page);
      assert.match(
        (await page.locator(".client-update-banner").allTextContents()).join(
          "",
        ),
        /1\.2\.0 is ready to install/,
        "The old idle read must not erase the newer ready banner",
      );
    });
  },
);

test(
  "actual App update discovery cannot resurrect an offer after a newer idle event",
  options,
  async () => {
    await withBrowserFixture("app-update-newer-idle", source, async (page) => {
      await loaded(page);
      await page.evaluate(
        (state) => (window as unknown as FixtureWindow).fixture.emit(state),
        idle,
      );
      await page.evaluate(
        (state) => (window as unknown as FixtureWindow).fixture.complete(state),
        available,
      );
      await frame(page);
      assert.deepEqual(
        await page.locator(".client-update-banner").allTextContents(),
        [],
        "The old available read must not resurrect a superseded offer",
      );
    });
  },
);

test(
  "current initial update discovery and review routing remain usable",
  options,
  async () => {
    await withBrowserFixture(
      "app-update-current-discovery",
      source,
      async (page) => {
        await loaded(page);
        await page.evaluate(
          (state) =>
            (window as unknown as FixtureWindow).fixture.complete(state),
          available,
        );
        await expect(page.locator(".client-update-banner")).toContainText(
          "1.2.0 is available",
        );
        await page
          .getByRole("button", { name: "Review update", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "Linux services and updates",
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole("tab", { name: "Client updates", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await expect(dialog).toContainText("Remote server");
      },
    );
  },
);

test(
  "initial update discovery failures remain silent and later live notifications remain usable",
  options,
  async () => {
    await withBrowserFixture(
      "app-update-discovery-lifetime",
      source,
      async (page) => {
        await loaded(page);
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.fail(),
        );
        await frame(page);
        await expect(page.getByRole("alert")).toHaveCount(0);
        await page.evaluate(
          (state) => (window as unknown as FixtureWindow).fixture.emit(state),
          scheduled,
        );
        await expect(page.locator(".client-update-banner")).toContainText(
          "will install when idle",
        );
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.unmount(),
        );
        await expect(
          page.getByText("App unmounted", { exact: true }),
        ).toBeVisible();
        const count = await page.evaluate(
          () => (window as unknown as FixtureWindow).fixture.calls.length,
        );
        await page.evaluate(
          (state) => (window as unknown as FixtureWindow).fixture.emit(state),
          ready,
        );
        await frame(page);
        await expect(page.locator(".client-update-banner")).toHaveCount(0);
        assert.equal(
          await page.evaluate(
            () => (window as unknown as FixtureWindow).fixture.calls.length,
          ),
          count,
        );
      },
    );
  },
);

test(
  "held initial update discovery stays quiet after App unmount",
  options,
  async () => {
    await withBrowserFixture(
      "app-update-held-unmount",
      source,
      async (page) => {
        await loaded(page);
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.unmount(),
        );
        await expect(
          page.getByText("App unmounted", { exact: true }),
        ).toBeVisible();
        const count = await page.evaluate(
          () => (window as unknown as FixtureWindow).fixture.calls.length,
        );
        await page.evaluate(
          (state) =>
            (window as unknown as FixtureWindow).fixture.complete(state),
          ready,
        );
        await frame(page);
        await expect(page.locator(".client-update-banner")).toHaveCount(0);
        await expect(
          page.getByText("App unmounted", { exact: true }),
        ).toBeVisible();
        assert.equal(
          await page.evaluate(
            () => (window as unknown as FixtureWindow).fixture.calls.length,
          ),
          count,
        );
      },
    );
  },
);
