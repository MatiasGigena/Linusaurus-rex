import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture";
const source = ({
  serverError = "",
  deferPreview = false,
  deferStatus = false,
  initialTab = "server",
} = {}) => `
import React from 'react';import {createRoot} from 'react-dom/client';
import {NativeServicesDialog} from '/src/components/services/NativeServicesDialog.tsx';import {DEFAULT_SETTINGS} from '/src/shared/types.ts';
import '/src/styles.css';import '/src/advanced.css';import '/src/dialogs.css';
const fixture=window.fixture={calls:[],serverError:${JSON.stringify(serverError)},deferPreview:${deferPreview},deferStatus:${deferStatus}};
let server={local:true,running:true,canManage:true,pid:123,sessionCount:4,endpoint:'unix:///owned.sock',arguments:[],origins:['old.example'],service:{unit:'owned-rex.service',scope:'user',activeState:'active',restart:'always',dropInPaths:[],configuredOrigins:['old.example'],canManage:true}};
let update={currentVersion:'1.2.3',installKind:'appimage',phase:'idle',canApply:false};
const listeners=new Set(),previews=new Map();let previewNumber=0;
fixture.emitUpdate=state=>{update=state;for(const listener of listeners)listener({type:'update',state});};
window.rex={onClientEvent:callback=>{listeners.add(callback);return()=>listeners.delete(callback);},request:async(method,args)=>{
 fixture.calls.push({method,args});
 if(method==='serverManagement'){if(fixture.serverError)throw Error(fixture.serverError);return structuredClone(server);}
 if(method==='updateStatus'){if(fixture.deferStatus)return new Promise(resolve=>{fixture.resolveStatus=()=>resolve({currentVersion:'1.2.3',installKind:'appimage',phase:'idle',canApply:false});});return structuredClone(update);}
 if(method==='previewServerOrigins'){const previewId='review-'+(++previewNumber);previews.set(previewId,args.origins);const result={previewId,unit:server.service.unit,path:'/owned/90-linusaurus.conf',before:'[Service]\\nExecStart=old',after:'[Service]\\nExecStart=rex --websocket-origin-pattern='+args.origins.join(','),restartRequired:true};if(fixture.deferPreview)return new Promise(resolve=>{fixture.resolvePreview=()=>resolve(result);});return result;}
 if(method==='applyServerOrigins'){const origins=previews.get(args.previewId);if(!origins)throw Error('Invalid review token');previews.delete(args.previewId);server={...server,service:{...server.service,configuredOrigins:origins},pendingOrigins:origins};return structuredClone(server);}
 if(method==='cancelUpdate'){update={...update,phase:'idle',bytes:undefined,total:undefined};return structuredClone(update);}
 throw Error('Unexpected '+method);
}};
function Fixture(){const[settings,setSettings]=React.useState(DEFAULT_SETTINGS);return React.createElement(NativeServicesDialog,{settings,hostId:settings.hosts[0].id,initialTab:${JSON.stringify(initialTab)},onSave:async value=>{setSettings(value);return value;},onClose(){}});}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
const options = { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 };

test(
  "client update discovery remains usable when server management is unavailable",
  options,
  async () => {
    await withBrowserFixture(
      "service-panel-failures",
      source({ serverError: "Server management unavailable" }),
      async (page) => {
        await expect(page.getByRole("alert")).toHaveText(
          "Server management unavailable",
        );
        await page
          .getByRole("tab", { name: "Client updates", exact: true })
          .click();
        await expect(page.getByText("1.2.3", { exact: true })).toBeVisible();
        await expect(page.getByRole("status")).toHaveText("idle");
        await expect(
          page.getByRole("button", { name: "Check for updates", exact: true }),
        ).toBeEnabled();
        await expect(page.getByRole("alert")).toHaveCount(0);
        await page
          .getByRole("tab", { name: "Rex server", exact: true })
          .click();
        await expect(page.getByRole("alert")).toHaveText(
          "Server management unavailable",
        );
      },
    );
  },
);

test(
  "origin review discards stale in-flight responses and retains the current token across tabs",
  options,
  async () => {
    await withBrowserFixture(
      "service-panel-review",
      source({ deferPreview: true }),
      async (page) => {
        const origins = page.getByRole("textbox", {
          name: "Allowed web origins",
        });
        await expect(origins).toBeEnabled();
        await origins.fill("new.example");
        await page
          .getByRole("button", { name: "Review service override", exact: true })
          .click();
        await expect
          .poll(() => page.evaluate("typeof window.fixture.resolvePreview"))
          .toBe("function");
        await origins.fill("changed.example");
        await page.evaluate("window.fixture.resolvePreview()");
        await expect(
          page.getByRole("button", {
            name: "Review service override",
            exact: true,
          }),
        ).toBeEnabled();
        await expect(
          page.getByRole("region", { name: "Service origin override preview" }),
        ).toHaveCount(0);
        await page.evaluate("window.fixture.deferPreview=false");
        await page
          .getByRole("button", { name: "Review service override", exact: true })
          .click();
        const preview = page.getByRole("region", {
          name: "Service origin override preview",
        });
        await expect(preview).toContainText("changed.example");
        await page
          .getByRole("tab", { name: "Client updates", exact: true })
          .click();
        await expect(preview).toBeHidden();
        await page
          .getByRole("tab", { name: "Rex server", exact: true })
          .click();
        await expect(preview).toBeVisible();
        await expect(origins).toHaveValue("changed.example");
        await preview
          .getByRole("button", { name: "Apply reviewed override", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "Service override saved",
        );
        await expect(preview).toHaveCount(0);
        assert.deepEqual(
          await page.evaluate(
            'window.fixture.calls.filter(call=>call.method==="applyServerOrigins").map(call=>call.args.previewId)',
          ),
          ["review-2"],
        );
        assert.equal(
          await page.evaluate(
            'window.fixture.calls.some(call=>call.method==="serverLifecycle")',
          ),
          false,
        );
      },
    );
  },
);

test(
  "a newer update event wins over an older discovery response without loading server management",
  options,
  async () => {
    await withBrowserFixture(
      "service-update-ordering",
      source({ deferStatus: true, initialTab: "updates" }),
      async (page) => {
        await expect
          .poll(() => page.evaluate("typeof window.fixture.resolveStatus"))
          .toBe("function");
        await page.evaluate(
          'window.fixture.emitUpdate({currentVersion:"1.2.3",installKind:"appimage",phase:"downloading",version:"1.2.4",bytes:32,total:64,canApply:false})',
        );
        await expect(page.getByRole("status")).toHaveText(
          "downloading · 1.2.4",
        );
        await expect(
          page.getByRole("progressbar", { name: "Update download" }),
        ).toHaveAttribute("value", "32");
        await page.evaluate("window.fixture.resolveStatus()");
        await expect(
          page.getByRole("button", { name: "Cancel update", exact: true }),
        ).toBeEnabled();
        await expect(page.getByRole("status")).toHaveText(
          "downloading · 1.2.4",
        );
        assert.equal(
          await page.evaluate(
            'window.fixture.calls.some(call=>call.method==="serverManagement")',
          ),
          false,
        );
        await page
          .getByRole("button", { name: "Cancel update", exact: true })
          .click();
        await expect(page.getByRole("status")).toHaveText("idle · 1.2.4");
        await expect(
          page.getByRole("progressbar", { name: "Update download" }),
        ).toHaveCount(0);
      },
    );
  },
);
