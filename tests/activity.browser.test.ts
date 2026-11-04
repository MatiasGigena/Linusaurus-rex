import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from 'react';import{createRoot}from'react-dom/client';import{ActivityPanel}from'/src/components/ActivityPanel.tsx';import{NoticeStack}from'/src/components/NoticeStack.tsx';
const selections=[],dismissals=[];let update;
const item=host=>({host:{id:host,label:host+' host'},session:{id:'session',label:'Shared session'},window:{id:'window'},pane:{id:'pane',label:'Shell'},activity:{id:'same-activity',app:host+' agent',state:'blocked',kind:'permission'}});
const notices=[{type:'notification',id:'targeted',hostId:'remote',sessionId:'session',windowId:'window',blockId:'pane',title:'Approval',body:'Inspect remote output',kind:'blocked'},{type:'notification',id:'general',hostId:'remote',title:'Connected',body:'Transport restored',kind:'program'},{type:'notification',id:'dismiss-only',hostId:'other',sessionId:'other-session',title:'Finished',body:'No navigation needed',kind:'done'}];
window.fixture={selections,dismissals,show:()=>update(current=>({...current,open:true})),empty:()=>update(current=>({...current,items:[]}))};
function Fixture(){const[state,setState]=React.useState({open:true,group:'session',filter:false,items:[item('local'),item('remote')],notices});update=setState;const select=(...args)=>selections.push(args);return React.createElement(React.Fragment,null,React.createElement('output',{'aria-label':'Activity controls'},state.group+'/'+state.filter),state.open&&React.createElement(ActivityPanel,{items:state.items,group:state.group,filterSidebar:state.filter,onGroupChange:group=>setState(current=>({...current,group})),onFilterChange:filter=>setState(current=>({...current,filter})),onSelect:select,onClose:()=>setState(current=>({...current,open:false}))}),React.createElement(NoticeStack,{notices:state.notices,position:'bottom-right',onSelect:select,onDismiss:id=>{dismissals.push(id);setState(current=>({...current,notices:current.notices.filter(notice=>notice.id!==id)}));}}));}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
interface ActivityFixture {
  selections: (string | undefined)[][];
  dismissals: string[];
  show(): void;
  empty(): void;
}
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };

test(
  "activity controls, scoped navigation, close and empty state preserve their parent callbacks",
  options,
  async () => {
    await withBrowserFixture("activity-panel", source, async (page) => {
      await page
        .getByRole("combobox", { name: "Group activity" })
        .selectOption("priority");
      await page.getByRole("checkbox", { name: "Filter sidebar" }).check();
      await expect(page.getByLabel("Activity controls")).toHaveText(
        "priority/true",
      );
      await expect(
        page.getByRole("button", { name: /local agent/ }),
      ).toContainText("Needs approval");
      await page.getByRole("button", { name: /remote agent/ }).click();
      await expect(
        page.getByRole("heading", { name: "Program activity" }),
      ).toHaveCount(0);
      assert.deepEqual(
        await page.evaluate(
          () =>
            (window as unknown as { fixture: ActivityFixture }).fixture
              .selections,
        ),
        [["remote", "session", "window", "pane"]],
      );
      await page.evaluate(() => {
        const fixture = (window as unknown as { fixture: ActivityFixture })
          .fixture;
        fixture.empty();
        fixture.show();
      });
      await expect(
        page.getByText("Programs that report their status appear here", {
          exact: false,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Close activity", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Program activity" }),
      ).toHaveCount(0);
    });
  },
);

test(
  "notices navigate only their explicit target and every dismissal removes only that notice",
  options,
  async () => {
    await withBrowserFixture("notice-stack", source, async (page) => {
      await expect(page.locator(".notice-stack")).toHaveClass(
        "notice-stack bottom-right",
      );
      await page
        .getByRole("button", {
          name: /Approval.*Inspect remote output/,
        })
        .click();
      await expect(
        page.getByText("Inspect remote output", { exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", {
          name: /Connected.*Transport restored/,
        })
        .click();
      const remaining = page
        .locator(".program-notice")
        .filter({ hasText: "No navigation needed" });
      await expect(remaining).toBeVisible();
      await remaining
        .getByRole("button", { name: "Dismiss notification", exact: true })
        .click();
      await expect(page.locator(".program-notice")).toHaveCount(0);
      assert.deepEqual(
        await page.evaluate(() => {
          const { selections, dismissals } = (
            window as unknown as { fixture: ActivityFixture }
          ).fixture;
          return { selections, dismissals };
        }),
        {
          selections: [["remote", "session", "window", "pane"]],
          dismissals: ["targeted", "general", "dismiss-only"],
        },
      );
    });
  },
);
