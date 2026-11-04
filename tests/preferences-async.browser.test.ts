import assert from "node:assert/strict";
import { test } from "node:test";
import { expect, type Page } from "@playwright/test";
import type { Settings } from "../src/shared/types.js";
import { withBrowserFixture } from "./browser-fixture.js";

function source(kind: "themes" | "agents") {
  return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeLibrary } from '/src/components/preferences/ThemeLibrary.tsx';
import { AgentIntegrations } from '/src/components/preferences/AgentIntegrations.tsx';
import { DEFAULT_SETTINGS } from '/src/shared/types.ts';
import '/src/styles.css';import '/src/advanced.css';import '/src/dialogs.css';
const fixture=window.fixture={calls:[],pending:[],changes:[],errors:[]};
window.rex={request(method,args){
 fixture.calls.push({method,args});
 if(method==='integrationsStatus')return Promise.resolve({output:'Initially installed'});
 return new Promise((resolve,reject)=>fixture.pending.push({method,resolve,reject}));
}};
function Fixture(){
 const [draft,setDraft]=React.useState(structuredClone(DEFAULT_SETTINGS));
 const [error,setError]=React.useState();
 const [owner,setOwner]=React.useState(0),[open,setOpen]=React.useState(true);
 fixture.draft=()=>draft;
 fixture.replace=()=>{setOwner(value=>value+1);setOpen(true);setError(undefined);};
 fixture.close=()=>setOpen(false);
 fixture.fillLibrary=count=>setDraft(previous=>({...previous,fontSize:30,themeLibrary:Array.from({length:count},(_,index)=>({id:'external-'+index,name:'External '+index,colors:{background:'#123456'}})),lightThemeId:'',darkThemeId:''}));
 return React.createElement(React.Fragment,null,
  React.createElement('label',null,'Draft font size',React.createElement('input',{type:'number',value:draft.fontSize,onChange:event=>setDraft(previous=>({...previous,fontSize:Number(event.target.value)}))})),
  error&&React.createElement('p',{role:'alert'},error),
  open&&(${JSON.stringify(kind)}==='themes'
   ?React.createElement(ThemeLibrary,{key:owner,settings:draft,onChange:next=>{fixture.changes.push(next);setDraft(next);},onError:message=>{fixture.errors.push(message??null);setError(message);}})
   :React.createElement(AgentIntegrations,{key:owner,letAgentsNameSessions:draft.letAgentsNameSessions,onSessionNamingChange:value=>setDraft(previous=>({...previous,letAgentsNameSessions:value}))}))
 );
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
}

type FixtureWindow = Window & {
  fixture: {
    calls: { method: string; args: Record<string, unknown> }[];
    pending: {
      method: string;
      resolve(value: unknown): void;
      reject(error: Error): void;
    }[];
    changes: Settings[];
    errors: (string | null)[];
    draft(): Settings;
    replace(): void;
    close(): void;
    fillLibrary(count: number): void;
  };
};

async function finish(
  page: Page,
  index: number,
  result?: unknown,
  error?: string,
) {
  await page.evaluate(
    async ({ index, result, error }) => {
      const pending = (window as unknown as FixtureWindow).fixture.pending[
        index
      ];
      if (!pending) throw new Error(`Missing held request ${index}`);
      if (error) pending.reject(new Error(error));
      else pending.resolve(result);
      // Flush promise delivery and its React render, including ignored stale results.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    },
    { index, result, error },
  );
}

const options = {
  skip: process.env.TERMINAL_UI_TEST !== "1",
  timeout: 30_000,
};
const colors = { background: "#abcdef", foreground: "#102030" };

test(
  "held theme import merges the current draft and retains its intended appearance",
  options,
  async () => {
    await withBrowserFixture(
      "theme-import-current",
      source("themes"),
      async (page) => {
        await page
          .getByRole("button", { name: "Import light palette…", exact: true })
          .click();
        await page.getByLabel("Draft font size").fill("22");
        await page
          .getByRole("button", {
            name: "Save current dark palette",
            exact: true,
          })
          .click();
        await page
          .getByLabel("Theme name Saved dark", { exact: true })
          .fill("Imported light");
        await page
          .getByRole("button", { name: "Rename Saved dark", exact: true })
          .click();
        const previous = await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.draft(),
        );
        assert.equal(previous.themeLibrary.length, 1);
        await finish(page, 0, colors);
        const current = await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.draft(),
        );
        assert.equal(
          current.fontSize,
          22,
          "The delayed import must preserve intervening preferences",
        );
        assert.equal(
          current.themeLibrary.length,
          2,
          "The delayed import must retain intervening saved themes",
        );
        assert.deepEqual(current.themeLibrary[0], previous.themeLibrary[0]);
        assert.equal(current.darkThemeId, previous.darkThemeId);
        assert.equal(current.themeLibrary[1].name, "Imported light 2");
        assert.equal(current.lightThemeId, current.themeLibrary[1].id);
        assert.deepEqual(current.themeLibrary[1].colors, colors);
      },
    );
  },
);

test(
  "held theme import validates the latest library capacity without replacing the draft",
  options,
  async () => {
    await withBrowserFixture(
      "theme-import-capacity",
      source("themes"),
      async (page) => {
        await page
          .getByRole("button", { name: "Import dark palette…", exact: true })
          .click();
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.fillLibrary(64),
        );
        await expect(page.getByRole("listitem")).toHaveCount(64);
        await finish(page, 0, colors);
        const current = await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.draft(),
        );
        assert.equal(current.themeLibrary.length, 64);
        assert.equal(current.fontSize, 30);
        assert.equal(
          await page.evaluate(
            () => (window as unknown as FixtureWindow).fixture.changes.length,
          ),
          0,
        );
        await expect(page.getByRole("alert")).toContainText(
          "The library has 64 themes",
        );
        await expect(
          page.getByRole("button", {
            name: "Import dark palette…",
            exact: true,
          }),
        ).toBeEnabled();
      },
    );
  },
);

test(
  "replaced theme editors cannot publish stale imports or errors into the current owner",
  options,
  async () => {
    await withBrowserFixture(
      "theme-import-owner",
      source("themes"),
      async (page) => {
        const importDark = () =>
          page
            .getByRole("button", { name: "Import dark palette…", exact: true })
            .click();
        await importDark();
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.replace(),
        );
        await importDark();
        await finish(page, 1, undefined, "Current picker failed");
        await expect(page.getByRole("alert")).toHaveText(
          "Current picker failed",
        );
        await finish(page, 0, colors);
        assert.equal(
          await page.evaluate(
            () => (window as unknown as FixtureWindow).fixture.changes.length,
          ),
          0,
        );
        await expect(page.getByRole("alert")).toHaveText(
          "Current picker failed",
        );

        await importDark();
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.replace(),
        );
        await importDark();
        await finish(page, 3, undefined, "Replacement picker failed");
        await finish(page, 2, undefined, "Old picker failed");
        await expect(page.getByRole("alert")).toHaveText(
          "Replacement picker failed",
        );
        await importDark();
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.close(),
        );
        await expect(
          page.getByRole("button", {
            name: "Import dark palette…",
            exact: true,
          }),
        ).toHaveCount(0);
        await finish(page, 4, undefined, "Closed picker failed");
        await expect(page.getByRole("alert")).toHaveText(
          "Replacement picker failed",
        );
        assert.equal(
          await page.evaluate(() =>
            (window as unknown as FixtureWindow).fixture.errors.includes(
              "Old picker failed",
            ),
          ),
          false,
        );
        assert.equal(
          await page.evaluate(() =>
            (window as unknown as FixtureWindow).fixture.errors.includes(
              "Closed picker failed",
            ),
          ),
          false,
        );
      },
    );
  },
);

test(
  "agent preview responses cannot restore an apply token after choices change",
  options,
  async () => {
    await withBrowserFixture(
      "agent-preview-intent",
      source("agents"),
      async (page) => {
        const preview = page.getByRole("button", {
          name: "Preview install / update",
          exact: true,
        });
        await preview.click();
        await page
          .getByRole("checkbox", { name: "Codex", exact: true })
          .uncheck();
        await finish(page, 0, {
          previewId: "old-agent-choice",
          output: "Old agent choices",
        });
        await expect(
          page.getByRole("button", {
            name: "Apply these changes",
            exact: true,
          }),
        ).toHaveCount(0);
        await preview.click();
        await finish(page, 1, {
          previewId: "current-choice",
          output: "Current agent choices",
        });
        await page
          .getByRole("button", { name: "Apply these changes", exact: true })
          .click();
        const requests = await page.evaluate(
          () => (window as unknown as FixtureWindow).fixture.calls,
        );
        assert.deepEqual(
          requests
            .filter((call) => call.method === "integrationsPreview")
            .at(-1)?.args.agents,
          ["claude", "opencode", "pi"],
        );
        assert.deepEqual(requests.at(-1), {
          method: "integrationsApply",
          args: { previewId: "current-choice" },
        });
        await finish(page, 2, { output: "Applied current choices" });
        await expect(page.getByLabel("Agent integration status")).toHaveText(
          "Applied current choices",
        );

        await preview.click();
        await page
          .getByRole("switch", {
            name: "Let agents name sessions",
            exact: true,
          })
          .check();
        await finish(page, 3, {
          previewId: "old-naming-choice",
          output: "Old naming choice",
        });
        await expect(
          page.getByRole("button", {
            name: "Apply these changes",
            exact: true,
          }),
        ).toHaveCount(0);
      },
    );
  },
);

test(
  "obsolete agent failures cannot interrupt a newer preview or its apply completion",
  options,
  async () => {
    await withBrowserFixture(
      "agent-preview-owner",
      source("agents"),
      async (page) => {
        const preview = page.getByRole("button", {
          name: "Preview install / update",
          exact: true,
        });
        await preview.click();
        await page
          .getByRole("switch", {
            name: "Let agents name sessions",
            exact: true,
          })
          .check();
        await expect(preview).toBeEnabled();
        await preview.click();
        await finish(page, 0, undefined, "Obsolete preview failed");
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(preview).toBeDisabled();
        await finish(page, 1, {
          previewId: "latest",
          output: "Latest naming choices",
        });
        await page
          .getByRole("button", { name: "Apply these changes", exact: true })
          .click();
        await finish(page, 2, { output: "Applied latest naming choices" });
        await expect(page.getByLabel("Agent integration status")).toHaveText(
          "Applied latest naming choices",
        );
        const lastPreview = await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.calls
            .filter((call) => call.method === "integrationsPreview")
            .at(-1),
        );
        assert.equal(lastPreview?.args.letAgentsNameSessions, true);
        await preview.click();
        await page.evaluate(() =>
          (window as unknown as FixtureWindow).fixture.replace(),
        );
        await preview.click();
        await finish(page, 3, undefined, "Unmounted preview failed");
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(preview).toBeDisabled();
        await finish(page, 4, {
          previewId: "replacement",
          output: "Replacement preview",
        });
        await expect(
          page.getByRole("button", {
            name: "Apply these changes",
            exact: true,
          }),
        ).toBeEnabled();
      },
    );
  },
);
