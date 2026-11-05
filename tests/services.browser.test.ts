import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "@playwright/test";

const source = `import React from 'react';import{createRoot}from'react-dom/client';import{NativeServicesDialog}from'/src/components/services/NativeServicesDialog.tsx';import{DEFAULT_SETTINGS}from'/src/shared/types.ts';
const service={unit:'owned-rex.service',scope:'user',activeState:'active',restart:'always',dropInPaths:[],configuredOrigins:['old.example'],canManage:true};
let state={local:true,running:true,canManage:true,pid:1234,sessionCount:4,endpoint:'unix:///owned.sock',arguments:[],origins:['old.example'],service};const requests=[];
window.fixture={requests,state};window.rex={onClientEvent:()=>()=>{},request:async(method,args)=>{requests.push({method,args});if(method==='serverManagement')return structuredClone(state);if(method==='updateStatus')return{currentVersion:'0.3.0',installKind:'development',phase:'idle',canApply:false};if(method==='previewServerOrigins')return{previewId:'single-use-review',unit:service.unit,path:'/owned/90-linusaurus.conf',before:'[Service]\\nExecStart=old',after:'[Service]\\nExecStart=new '+args.origins.join(','),restartRequired:true};if(method==='applyServerOrigins'){state.service.configuredOrigins=['new.example'];state.pendingOrigins=['new.example'];return structuredClone(state)};throw Error('Unexpected '+method)}};
createRoot(document.getElementById('root')).render(React.createElement(NativeServicesDialog,{settings:DEFAULT_SETTINGS,hostId:DEFAULT_SETTINGS.hosts[0].id,onClose(){},onSave(){throw Error('Service edits must use reviewed backend apply')}}));`;

test(
  "service origin review requires an unchanged preview and applies without restarting active sessions",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30000 },
  async () => {
    const server = await createServer({
      configFile: false,
      root: process.cwd(),
      cacheDir: "node_modules/.vite-services-test",
      plugins: [
        react(),
        {
          name: "services-fixture",
          configureServer(server) {
            server.middlewares.use("/services", (_req, res) => {
              res.setHeader("Content-Type", "text/html");
              res.end(
                '<!doctype html><div id="root"></div><script type="module" src="/fixture.js"></script>',
              );
            });
          },
          resolveId(id) {
            return id === "/fixture.js" ? "\0services-fixture" : undefined;
          },
          load(id) {
            return id === "\0services-fixture" ? source : undefined;
          },
        },
      ],
      server: {
        host: "127.0.0.1",
        port: 0,
        hmr: false,
        watch: null,
      },
    });
    await server.listen();
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}/services`,
      );
      const dialog = page.getByRole("dialog");
      await dialog
        .getByText("owned-rex.service (user)", { exact: true })
        .waitFor();
      assert.equal(
        await dialog
          .getByRole("button", { name: "Restart idle server", exact: true })
          .isDisabled(),
        true,
      );
      const input = dialog.getByRole("textbox", {
        name: "Allowed web origins",
      });
      await input.fill("new.example");
      await dialog
        .getByRole("button", { name: "Review service override", exact: true })
        .click();
      const preview = dialog.getByRole("region", {
        name: "Service origin override preview",
      });
      await preview.waitFor();
      assert.match(await preview.innerText(), /ExecStart=new new.example/);
      await input.fill("changed.example");
      assert.equal(
        await preview.count(),
        0,
        "Editing origins invalidates the reviewed token",
      );
      await input.fill("new.example");
      await dialog
        .getByRole("button", { name: "Review service override", exact: true })
        .click();
      await preview
        .getByRole("button", { name: "Apply reviewed override" })
        .click();
      await dialog
        .getByRole("status")
        .filter({ hasText: "Service override saved" })
        .waitFor();
      assert.equal(await preview.count(), 0);
      const fixture = await page.evaluate(() => (window as any).fixture);
      assert.equal(fixture.state.pid, 1234);
      assert.equal(fixture.state.sessionCount, 4);
      assert.deepEqual(fixture.state.origins, ["old.example"]);
      assert.deepEqual(fixture.state.service.configuredOrigins, [
        "new.example",
      ]);
      assert.deepEqual(
        fixture.requests
          .filter((r: any) => r.method === "applyServerOrigins")
          .map((r: any) => r.args.previewId),
        ["single-use-review"],
      );
      assert.equal(
        fixture.requests.some((r: any) => r.method === "serverLifecycle"),
        false,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await server.close();
    }
  },
);
