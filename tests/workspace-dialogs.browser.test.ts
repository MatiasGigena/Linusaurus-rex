import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from 'react';import{createRoot}from'react-dom/client';
import{FormDialog,ConfirmDialog}from'/src/components/workspace/WorkspaceDialogs.tsx';
import{WorkspaceReconciliationError}from'/src/core/workspaceOperations.ts';
import'/src/styles.css';import'/src/dialogs.css';
const fixture=window.fixture={writes:0,reads:0,closed:0,kind:'form',committed:true,readFailure:false};
function Fixture(){const[,setVersion]=React.useState(0);fixture.open=(kind,committed)=>{fixture.kind=kind;fixture.committed=committed;setVersion(value=>value+1);};
const submit=async()=>{fixture.writes++;if(fixture.hold)return new Promise((resolve,reject)=>{fixture.release=success=>success?resolve():reject(new WorkspaceReconciliationError(new Error('old inspection denied')));});throw fixture.committed?new WorkspaceReconciliationError(new Error('inspection denied')):new Error('write denied');};
const props={onClose:()=>fixture.closed++,onRefresh:async()=>{fixture.reads++;if(fixture.readFailure)throw new Error('refresh denied');}};
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

for (const [kind, success] of [
  ["form", true],
  ["confirmation", false],
] as const) {
  test(
    `${kind} replacement without a React key ignores its predecessor's deferred ${success ? "success" : "failure"}`,
    { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
    async () => {
      await withBrowserFixture(
        `workspace-${kind}-replacement`,
        source,
        async (page) => {
          await page.evaluate(
            ({ kind }) => {
              const f = (
                window as unknown as {
                  fixture: {
                    open(kind: string, committed: boolean): void;
                    hold: boolean;
                  };
                }
              ).fixture;
              f.open(kind, true);
              f.hold = true;
            },
            { kind },
          );
          const button = page.getByRole("button", {
            name: kind === "form" ? "Save" : "Apply closure",
            exact: true,
          });
          if (kind === "form")
            await page.getByLabel("Session label").fill("Previous draft");
          await button.click();
          await expect(page.getByRole("button", { name: kind === "form" ? "Saving…" : "Applying…", exact: true })).toBeDisabled();
          await page.evaluate(
            ({ kind }) => {
              const f = (
                window as unknown as {
                  fixture: {
                    open(kind: string, committed: boolean): void;
                    hold: boolean;
                  };
                }
              ).fixture;
              f.open(kind, false);
              f.hold = false;
            },
            { kind },
          );
          await expect(button).toBeEnabled();
          if (kind === "form")
            await expect(page.getByLabel("Session label")).toHaveValue("New");
          await page.evaluate(
            (success) =>
              (
                window as unknown as {
                  fixture: { release(success: boolean): void };
                }
              ).fixture.release(success),
            success,
          );
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
          assert.equal(await page.evaluate("window.fixture.closed"), 0);
          await expect(button).toBeEnabled();
          await expect(page.getByRole("alert")).toHaveCount(0);
          await button.click();
          await expect(page.getByRole("alert")).toHaveText("write denied");
          assert.equal(await page.evaluate("window.fixture.writes"), 2);
        },
      );
    },
  );
}
