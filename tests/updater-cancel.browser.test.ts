import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";
const source = `
import React from'react';import{createRoot}from'react-dom/client';import{ClientUpdatesPanel}from'/src/components/services/ClientUpdatesPanel.tsx';import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
const listeners=new Set(),calls=[];const available={currentVersion:'1.0.0',version:'1.1.0',installKind:'appimage',phase:'available',canApply:false};
window.fixture={calls,failCancel:true,finish(){window.fixture.resolveDownload({...available,phase:'ready',canApply:true});}};
window.rex={onClientEvent:callback=>{listeners.add(callback);return()=>listeners.delete(callback);},request(method,args){calls.push({method,args});if(method==='updateStatus')return Promise.resolve(available);if(method==='downloadUpdate'){for(const listener of listeners)listener({type:'update',state:{...available,phase:'downloading',bytes:1,total:4}});return new Promise(resolve=>{window.fixture.resolveDownload=resolve;});}if(method==='cancelUpdate'){if(window.fixture.failCancel)return Promise.reject(new Error('Cancel temporarily failed'));return Promise.resolve({...available,phase:'idle'});}throw new Error('Unexpected '+method);}};
createRoot(document.getElementById('root')).render(React.createElement(ClientUpdatesPanel,{settings:DEFAULT_SETTINGS,onSave:async settings=>settings,onClose(){},active:true}));
`;
interface UpdateFixture {
  calls: { method: string }[];
  failCancel: boolean;
  finish(): void;
}
test(
  "a dialog-started download can be cancelled before it settles, retried after a cancel error, and never resurrected by its late result",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
  async () => {
    await withBrowserFixture(
      "updates-cancel-inflight",
      source,
      async (page) => {
        await page
          .getByRole("button", {
            name: "Download verified update",
            exact: true,
          })
          .click();
        await expect(page.getByRole("status")).toHaveText(
          "downloading · 1.1.0",
        );
        const cancel = page.getByRole("button", {
          name: "Cancel update",
          exact: true,
        });
        await expect(cancel).toBeEnabled();
        await cancel.click();
        await expect(page.getByRole("alert")).toHaveText(
          "Cancel temporarily failed",
        );
        await expect(cancel).toBeEnabled();
        await page.evaluate(() => {
          (window as unknown as { fixture: UpdateFixture }).fixture.failCancel =
            false;
        });
        await cancel.click();
        await expect(page.getByRole("status")).toHaveText("idle · 1.1.0");
        await expect(cancel).toBeDisabled();
        await expect(
          page.getByRole("button", { name: "Check for updates", exact: true }),
        ).toBeDisabled();
        await page.evaluate(() =>
          (window as unknown as { fixture: UpdateFixture }).fixture.finish(),
        );
        await expect(
          page.getByRole("button", { name: "Check for updates", exact: true }),
        ).toBeEnabled();
        await expect(page.getByRole("status")).toHaveText("idle · 1.1.0");
        await expect(
          page.getByRole("button", {
            name: "Install and relaunch",
            exact: true,
          }),
        ).toBeDisabled();
        assert.deepEqual(
          await page.evaluate(() =>
            (window as unknown as { fixture: UpdateFixture }).fixture.calls.map(
              (call) => call.method,
            ),
          ),
          ["updateStatus", "downloadUpdate", "cancelUpdate", "cancelUpdate"],
        );
      },
    );
  },
);
