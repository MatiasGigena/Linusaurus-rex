import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from 'react';import{createRoot}from'react-dom/client';
import{FormDialog,ConfirmDialog}from'/src/components/WorkspaceDialogs.tsx';
import{WorkspaceReconciliationError}from'/src/core/workspaceOperations.ts';
import'/src/styles.css';import'/src/dialogs.css';
const fixture=window.fixture={writes:0,reads:0,closed:0,kind:'form',committed:true,readFailure:false};
function Fixture(){const[version,setVersion]=React.useState(0);fixture.open=(kind,committed)=>{fixture.kind=kind;fixture.committed=committed;setVersion(value=>value+1);};
const submit=async()=>{fixture.writes++;throw fixture.committed?new WorkspaceReconciliationError(new Error('inspection denied')):new Error('write denied');};
const props={key:version,onClose:()=>fixture.closed++,onRefresh:async()=>{fixture.reads++;if(fixture.readFailure)throw new Error('refresh denied');}};
return fixture.kind==='form'?React.createElement(FormDialog,{...props,busy:false,form:{title:'Create session',fields:[{name:'label',label:'Session label',value:'New'}],submit}}):React.createElement(ConfirmDialog,{...props,confirmation:{title:'Close session',label:'Apply closure',description:'An owned session',submit}});}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
for (const kind of ["form", "confirmation"] as const) {
  test(
    `${kind} recovery after a committed write cannot replay the mutation`,
    { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
    async () => {
      await withBrowserFixture(
        `workspace-${kind}-recovery`,
        source,
        async (page) => {
          await page.evaluate(
            ({ kind }) => {
              (
                window as unknown as {
                  fixture: { open(kind: string, committed: boolean): void };
                }
              ).fixture.open(kind, true);
            },
            { kind },
          );
          const submit = page.getByRole("button", {
            name: kind === "form" ? "Save" : "Apply closure",
            exact: true,
          });
          await submit.click();
          await expect(page.getByRole("alert")).toContainText(
            "change completed",
          );
          await expect(submit).toBeDisabled();
          if (kind === "form") {
            await page.getByLabel("Session label").fill("Another name");
            await page.getByLabel("Session label").press("Enter");
          }
          assert.equal(await page.evaluate("window.fixture.writes"), 1);
          await page.evaluate("window.fixture.readFailure=true");
          await page
            .getByRole("button", { name: "Refresh workspace", exact: true })
            .click();
          await expect(page.getByRole("alert")).toContainText("refresh denied");
          await expect(submit).toBeDisabled();
          await page.evaluate("window.fixture.readFailure=false");
          await page
            .getByRole("button", { name: "Refresh workspace", exact: true })
            .click();
          await expect
            .poll(() => page.evaluate("window.fixture.closed"))
            .toBe(1);
          assert.equal(await page.evaluate("window.fixture.reads"), 2);
          assert.equal(await page.evaluate("window.fixture.writes"), 1);
        },
      );
    },
  );
  test(
    `${kind} ordinary write rejection permits an explicit retry`,
    { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
    async () => {
      await withBrowserFixture(
        `workspace-${kind}-retry`,
        source,
        async (page) => {
          await page.evaluate(
            ({ kind }) => {
              (
                window as unknown as {
                  fixture: { open(kind: string, committed: boolean): void };
                }
              ).fixture.open(kind, false);
            },
            { kind },
          );
          const submit = page.getByRole("button", {
            name: kind === "form" ? "Save" : "Apply closure",
            exact: true,
          });
          await submit.click();
          await expect(page.getByRole("alert")).toHaveText("write denied");
          await expect(submit).toBeEnabled();
          await submit.click();
          await expect
            .poll(() => page.evaluate("window.fixture.writes"))
            .toBe(2);
          assert.equal(await page.evaluate("window.fixture.reads"), 0);
        },
      );
    },
  );
}
