import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";
const source = `
import React from'react';import{createRoot}from'react-dom/client';import{OnboardingPane}from'/src/components/workspace/OnboardingPane.tsx';import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
let update;const calls=[],pending=[];let id=0;
window.fixture={calls,change:patch=>update(current=>({...current,...patch})),finish(id,value){const request=pending.find(item=>item.id===id);if(!request)throw Error('Missing request');request.resolve(value);},fail(id){pending.find(item=>item.id===id).reject(new Error('State denied'));}};
window.rex={request(method,args){const current={id:++id,method,args};calls.push(current);return new Promise((resolve,reject)=>pending.push({...current,resolve,reject}));}};
function Fixture(){const[state,setState]=React.useState({blockId:'tutorial',endpoint:'unix:///host.sock',visible:true,mounted:true});update=setState;return state.mounted?React.createElement(OnboardingPane,{pane:{id:state.blockId,label:'Tutorial',rect:[0,0,1,1]},terminalRef:{hostId:'host',sessionId:'session',blockId:state.blockId},settings:{...DEFAULT_SETTINGS,shortcuts:{'command-palette':'Old palette','client.palette.toggle':'Current palette','session-switcher':'Old switch','split-right':'Old split',zoom:'Old zoom','pane.zoom':'',find:'Old search'},hosts:[{id:'host',label:'Host',endpoint:state.endpoint}]},visible:state.visible,focused:true,showHeader:true,onFocus(){},onClose(){},onZoom(){}}):React.createElement('p',null,'Tutorial unmounted');}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
interface OnboardingFixture {
  calls: { id: number; args: { method: string; blockId: string } }[];
  change(patch: {
    blockId?: string;
    endpoint?: string;
    visible?: boolean;
    mounted?: boolean;
  }): void;
  finish(id: number, value: unknown): void;
  fail(id: number): void;
}
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };
async function request(page: Page, method: string, after = 0) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ method, after }) =>
          (
            window as unknown as { fixture: OnboardingFixture }
          ).fixture.calls.find(
            (call) => call.id > after && call.args.method === method,
          )?.id,
        { method, after },
      ),
    )
    .toBeGreaterThan(0);
  return page.evaluate(
    ({ method, after }) =>
      (window as unknown as { fixture: OnboardingFixture }).fixture.calls.find(
        (call) => call.id > after && call.args.method === method,
      )!.id,
    { method, after },
  ) as Promise<number>;
}
async function finish(page: Page, id: number, value: unknown) {
  await page.evaluate(
    ({ id, value }) =>
      (window as unknown as { fixture: OnboardingFixture }).fixture.finish(
        id,
        value,
      ),
    { id, value },
  );
}

test(
  "an older tutorial poll cannot undo a completed step change",
  options,
  async () => {
    await withBrowserFixture("onboarding-poll-order", source, async (page) => {
      const old = await request(page, "state");
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await finish(page, await request(page, "set_step"), {});
      await expect(
        page.getByRole("heading", { name: "Make the terminal yours" }),
      ).toBeVisible();
      await finish(page, old, { step: "welcome" });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      await expect(
        page.getByRole("heading", { name: "Make the terminal yours" }),
      ).toBeVisible();
    });
  },
);

test(
  "tutorial state and failures stay with their target and visibility lifetime",
  options,
  async () => {
    await withBrowserFixture(
      "onboarding-target-lifetime",
      source,
      async (page) => {
        const old = await request(page, "state");
        await page.evaluate(() =>
          (window as unknown as { fixture: OnboardingFixture }).fixture.change({
            blockId: "replacement",
          }),
        );
        const current = await request(page, "state", old);
        await finish(page, current, { step: "shortcuts" });
        await expect(page.locator(".onboarding-page kbd")).toHaveText([
          "Current palette",
          "Old switch",
          "Old split",
          "",
          "Old search",
        ]);
        await expect(
          page.getByRole("heading", {
            name: "Keep your hands on the keyboard",
          }),
        ).toBeVisible();
        await finish(page, old, { step: "appearance" });
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            ),
        );
        await expect(
          page.getByRole("heading", {
            name: "Keep your hands on the keyboard",
          }),
        ).toBeVisible();
        await page.evaluate(() =>
          (window as unknown as { fixture: OnboardingFixture }).fixture.change({
            visible: false,
          }),
        );
        const calls = await page.evaluate(
          () =>
            (window as unknown as { fixture: OnboardingFixture }).fixture.calls
              .length,
        );
        await page.clock.install();
        await page.clock.runFor(4000);
        assert.equal(
          await page.evaluate(
            () =>
              (window as unknown as { fixture: OnboardingFixture }).fixture
                .calls.length,
          ),
          calls,
        );
        await page.evaluate(() =>
          (window as unknown as { fixture: OnboardingFixture }).fixture.change({
            visible: true,
          }),
        );
        const shown = await request(page, "state", current);
        await page.evaluate(
          (id) =>
            (window as unknown as { fixture: OnboardingFixture }).fixture.fail(
              id,
            ),
          shown,
        );
        await expect(page.getByRole("alert")).toHaveText("State denied");
        await page.evaluate(() =>
          (window as unknown as { fixture: OnboardingFixture }).fixture.change({
            mounted: false,
          }),
        );
        await expect(page.getByText("Tutorial unmounted")).toBeVisible();
      },
    );
  },
);

test(
  "newer tutorial polls win and replaced endpoints cannot publish stale failures",
  options,
  async () => {
    await withBrowserFixture(
      "onboarding-read-ownership",
      source,
      async (page) => {
        await page.clock.install();
        const first = await request(page, "state");
        await page.clock.runFor(2000);
        const newer = await request(page, "state", first);
        await finish(page, newer, { step: "appearance" });
        await expect(
          page.getByRole("heading", { name: "Make the terminal yours" }),
        ).toBeVisible();
        await finish(page, first, { step: "welcome" });
        await page.clock.runFor(16);
        await expect(
          page.getByRole("heading", { name: "Make the terminal yours" }),
        ).toBeVisible();
        await page.clock.runFor(2000);
        const oldEndpoint = await request(page, "state", newer);
        await page.evaluate(() =>
          (window as unknown as { fixture: OnboardingFixture }).fixture.change({
            endpoint: "unix:///replacement.sock",
          }),
        );
        const replacement = await request(page, "state", oldEndpoint);
        await finish(page, replacement, { step: "shortcuts" });
        await page.evaluate(
          (id) =>
            (window as unknown as { fixture: OnboardingFixture }).fixture.fail(
              id,
            ),
          oldEndpoint,
        );
        await page.clock.runFor(16);
        await expect(
          page.getByRole("heading", {
            name: "Keep your hands on the keyboard",
          }),
        ).toBeVisible();
        await expect(page.getByRole("alert")).toHaveCount(0);
        await page.clock.runFor(2000);
        const held = await request(page, "state", replacement);
        await page.evaluate(() =>
          (window as unknown as { fixture: OnboardingFixture }).fixture.change({
            mounted: false,
          }),
        );
        await expect(page.getByText("Tutorial unmounted")).toBeVisible();
        await page.evaluate(
          (id) =>
            (window as unknown as { fixture: OnboardingFixture }).fixture.fail(
              id,
            ),
          held,
        );
        await page.clock.runFor(4000);
        assert.equal(
          await page.evaluate(
            () =>
              (window as unknown as { fixture: OnboardingFixture }).fixture
                .calls.length,
          ),
          held,
        );
      },
    );
  },
);
