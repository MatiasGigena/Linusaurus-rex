import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { withBrowserFixture } from "./browser-fixture.js";

const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {PairDeviceDialog} from '/src/components/services/PairDeviceDialog.tsx';
import {ConfigurationDialog} from '/src/components/services/ConfigurationDialog.tsx';
import {BlockInspector} from '/src/terminal/BlockInspector.tsx';
import {DEFAULT_SETTINGS} from '/src/shared/types.ts';
import '/src/styles.css';import '/src/advanced.css';import '/src/dialogs.css';
const fixture=window.fixture={calls:[],status:{tailscale:{state:'NeedsLogin',auth_url:'https://login.example/authorize'}},config:{path:'/remote/init.lua',content:'-- original',editable:false},methods:{methods:[{name:'echo',description:'Echo arguments'},{name:'reset'}]},closed:0,reloaded:0,managed:0};
window.rex={request:async(method,args)=>{
 fixture.calls.push({method,args});
 if(method==='serverAction'){if(fixture.statusError)throw Error(fixture.statusError);return fixture.status;}
 if(method==='configInfo'){if(fixture.configError)throw Error(fixture.configError);return fixture.config;}
 if(method==='writeConfig'){if(fixture.writeError)throw Error(fixture.writeError);return;}
 if(method==='reloadConfig'){if(fixture.reloadError)throw Error(fixture.reloadError);return;}
 if(method==='blockInfo'){if(fixture.methodsError)throw Error(fixture.methodsError);return fixture.methods;}
 if(method==='callBlock'){if(fixture.callError)throw Error(fixture.callError);if(fixture.holdCall)return new Promise(resolve=>fixture.finishCall=resolve);return {answer:42};}
 if(method==='openExternal'||method==='pickPath')return null;
 throw Error('Unexpected bridge method '+method);
},writeClipboard:async text=>{if(fixture.clipboardError)throw Error(fixture.clipboardError);fixture.copied=text;}};
function Fixture(){const [panel,setPanel]=React.useState({name:'',version:0});
 fixture.open=(name)=>setPanel(previous=>({name,version:previous.version+1}));
 const close=()=>{fixture.closed++;setPanel(previous=>({...previous,name:''}));};
 const props={key:panel.version,onClose:close};
 if(panel.name==='pair')return React.createElement(PairDeviceDialog,{...props,hostId:'h',endpoint:fixture.endpoint,onManage:()=>fixture.managed++});
 if(panel.name==='config')return React.createElement(ConfigurationDialog,{...props,hostId:'h',onReload:()=>fixture.reloaded++});
 if(panel.name==='block')return React.createElement(BlockInspector,{...props,pane:{id:'b',label:'Example',rect:[0,0,1,1],creator:'example.plugin'},terminalRef:{hostId:'h',sessionId:'s',blockId:'b'},settings:DEFAULT_SETTINGS,onFocus:()=>fixture.focused=true});
 return React.createElement('p',null,'Choose a fixture');
}createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;

test(
  "pairing shows availability, creates real QR codes, and reports bridge failures",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
  async () => {
    await withBrowserFixture("pairing-behavior", source, async (page) => {
      await page.evaluate("window.fixture.open('pair')");
      await expect(
        page.getByText(/Remote address is NeedsLogin/),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Remote access settings" })
        .click();
      assert.equal(await page.evaluate("window.fixture.managed"), 1);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      assert.deepEqual(await page.evaluate("window.fixture.calls.at(-1)"), {
        method: "openExternal",
        args: { url: "https://login.example/authorize" },
      });
      await page.evaluate(
        "window.fixture.status={tailscale:{state:'Running',https:{state:'ready',url:'https://rex.example/'}}}",
      );
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      const image = page.getByAltText(
        "QR code containing the Rex server's HTTPS address",
      );
      await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/);
      await page.getByRole("button", { name: "Copy address" }).click();
      assert.equal(
        await page.evaluate("window.fixture.copied"),
        "https://rex.example/",
      );
      await page.evaluate(
        "window.fixture.clipboardError='Clipboard unavailable'",
      );
      await page.getByRole("button", { name: "Copy address" }).click();
      await expect(page.getByText("Clipboard unavailable")).toBeVisible();
      await page.evaluate("window.fixture.statusError='Server unavailable'");
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(
        page.getByText("Server unavailable", { exact: true }),
      ).toBeVisible();
      await expect(image).toHaveCount(0);
      await page.evaluate(
        "window.fixture.statusError='';window.fixture.status={tailscale:{https:{url:{invalid:true}}}};",
      );
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Remote access settings" }),
      ).toBeVisible();
    });
  },
);

test(
  "configuration UI respects read-only access and preserves edits after save failure",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
  async () => {
    await withBrowserFixture("configuration-behavior", source, async (page) => {
      await page.evaluate("window.fixture.open('config')");
      const editor = page.getByRole("textbox", { name: "Lua configuration" });
      await expect(editor).toHaveValue("-- original");
      assert.equal(await editor.getAttribute("readonly"), "");
      await expect(
        page.getByRole("button", { name: "Save and reload" }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Copy config path" }).click();
      assert.equal(
        await page.evaluate("window.fixture.copied"),
        "/remote/init.lua",
      );
      await page.evaluate(
        "window.fixture.clipboardError='Clipboard access failed'",
      );
      await page.getByRole("button", { name: "Copy config path" }).click();
      await expect(page.getByRole("alert")).toHaveText(
        "Clipboard access failed",
      );
      await page.evaluate("window.fixture.clipboardError=''");
      await page.getByRole("button", { name: "Reload from disk" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      assert.equal(await page.evaluate("window.fixture.reloaded"), 1);
      await page.evaluate(
        "window.fixture.config.editable=true;window.fixture.open('config')",
      );
      await expect(editor).toHaveValue("-- original");
      await editor.fill("-- modified");
      await page.evaluate("window.fixture.writeError='Permission denied'");
      await page.getByRole("button", { name: "Save and reload" }).click();
      await expect(page.getByRole("alert")).toHaveText("Permission denied");
      await expect(editor).toHaveValue("-- modified");
      await page.evaluate("window.fixture.writeError=''");
      await page.getByRole("button", { name: "Save and reload" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      assert.deepEqual(await page.evaluate("window.fixture.calls.slice(-2)"), [
        {
          method: "writeConfig",
          args: { hostId: "h", content: "-- modified" },
        },
        { method: "reloadConfig", args: { hostId: "h" } },
      ]);
      await page.evaluate(
        "window.fixture.configError='Configuration unavailable';window.fixture.open('config')",
      );
      await expect(page.getByRole("alert")).toHaveText(
        "Configuration unavailable",
      );
    });
  },
);

test(
  "block inspector validates arguments, awaits results, exports JSON and surfaces RPC errors",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
  async () => {
    await withBrowserFixture(
      "block-inspector-behavior",
      source,
      async (page) => {
        await page.evaluate("window.fixture.open('block')");
        await expect(page.getByLabel("Server method")).toHaveValue("echo");
        const args = page.getByLabel("Arguments as JSON");
        await args.fill("{broken");
        await page.getByRole("button", { name: "Run method" }).click();
        await expect(page.getByRole("alert")).toBeVisible();
        assert.equal(
          await page.evaluate(
            "window.fixture.calls.filter(call=>call.method==='callBlock').length",
          ),
          0,
        );
        await args.fill('{"hello":"world"}');
        await page.evaluate("window.fixture.holdCall=true");
        await page.getByRole("button", { name: "Run method" }).click();
        await expect(
          page.getByRole("button", { name: "Running…" }),
        ).toBeDisabled();
        assert.deepEqual(await page.evaluate("window.fixture.calls.at(-1)"), {
          method: "callBlock",
          args: {
            hostId: "h",
            sessionId: "s",
            blockId: "b",
            method: "echo",
            args: { hello: "world" },
          },
        });
        await page.evaluate("window.fixture.finishCall({answer:42})");
        await expect(page.locator(".block-result pre")).toHaveText(
          '{\n  "answer": 42\n}',
        );
        await page.getByRole("button", { name: "Save JSON" }).click();
        assert.deepEqual(await page.evaluate("window.fixture.calls.at(-1)"), {
          method: "pickPath",
          args: {
            save: true,
            content: '{\n  "answer": 42\n}',
            defaultPath: "rex-block-result.json",
          },
        });
        await page.getByLabel("Server method").selectOption("reset");
        await expect(args).toHaveValue("{}");
        await expect(page.locator(".block-result")).toHaveCount(0);
        await page.evaluate(
          "window.fixture.callError='Plugin rejected the request'",
        );
        await page.getByRole("button", { name: "Run method" }).click();
        await expect(page.getByRole("alert")).toContainText(
          "Plugin rejected the request",
        );
        await page.evaluate(
          "window.fixture.methodsError='Method discovery failed'",
        );
        await page
          .getByRole("button", { name: "Reload block methods" })
          .click();
        await expect(page.getByRole("alert")).toContainText(
          "Method discovery failed",
        );
      },
    );
  },
);
