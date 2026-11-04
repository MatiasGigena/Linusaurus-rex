import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const source = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsDialog } from '/src/components/preferences/SettingsDialog.tsx';
import { ProgramIcon } from '/src/components/ProgramIcon.tsx';
import { ActivePaneHighlight } from '/src/components/ActivePaneHighlight.tsx';
import { DEFAULT_SETTINGS } from '/src/shared/types.ts';
import '/src/styles.css';import '/src/advanced.css';import '/src/dialogs.css';
const palette={background:'#102030',foreground:'#e0e0e0',blue:'#4477bb',palette200:'#123456'};
let saved, reopen, move, animation, icon;const integrationCalls=[];
window.rex={request:async(method,args)=>{if(method==='importTheme')return window.fixture.nextImport;if(method.startsWith('integrations'))integrationCalls.push({method,args});if(method==='integrationsStatus')return {output:'Installed integrations'};if(method==='integrationsPreview')return {previewId:'preview',output:'Reviewed integration change',steps:[]};if(method==='integrationsApply')return {output:'Applied integration change',steps:[]};throw new Error('Unexpected request: '+method);}};
function Fixture(){
 const [settings,setSettings]=React.useState({...structuredClone(DEFAULT_SETTINGS),customDarkTheme:palette});
 const [open,setOpen]=React.useState(true),[rect,setRect]=React.useState([0,0,.5,1]),[mode,setMode]=React.useState('move'),[shell,setShell]=React.useState('theme');
 reopen=()=>setOpen(true);move=setRect;animation=setMode;icon=setShell;
 return React.createElement(React.Fragment,null,
  React.createElement('div',{id:'highlight-stage',style:{position:'absolute',left:20,top:20,width:400,height:200}},React.createElement(ActivePaneHighlight,{rect,animation:mode})),
  React.createElement('div',{id:'shell-stage'},React.createElement(ProgramIcon,{program:'bash',shellTheme:shell})),
  open&&React.createElement(SettingsDialog,{settings,onSave:async next=>{saved=next;setSettings(next);return next;},onClose:()=>setOpen(false),onAddHost(){},onEditHost(){},onConfig(){},onDiagnostics(){},onNativeServices(){window.fixture.nativeServices=true;}})
 );
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
for(const [key,value]of Object.entries({'--shell-background':'#102030','--shell-foreground':'#123456','--green':'#56ab78'}))document.documentElement.style.setProperty(key,value);
window.fixture={integrationCalls,nextImport:{background:'#eeeeee',foreground:'#223344'},saved:()=>saved,reopen:()=>reopen(),move:rect=>move(rect),animation:mode=>animation(mode),icon:mode=>icon(mode)};
`;

test(
  "named themes and remaining appearance controls work through the settings UI",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
  async () => {
    const server = await createServer({
      configFile: false,
      root: process.cwd(),
      cacheDir: "node_modules/.vite-interface-test",
      optimizeDeps: {
        include: [
          "react",
          "react-dom/client",
          "react/jsx-runtime",
          "lucide-react",
        ],
      },
      plugins: [
        react(),
        {
          name: "interface-fixture",
          resolveId(id) {
            if (id === "\0interface-fixture") return id;
          },
          load(id) {
            if (id === "\0interface-fixture") return source;
          },
          configureServer(vite) {
            vite.middlewares.use("/interface-fixture", (request, response) => {
              response.setHeader("Content-Type", "text/html");
              void vite
                .transformIndexHtml(
                  request.url || "/interface-fixture",
                  '<html><body><div id="root"></div><script type="module" src="/@id/__x00__interface-fixture"></script></body></html>',
                )
                .then((html) => response.end(html));
            });
          },
        },
      ],
      server: {
        host: "127.0.0.1",
        port: 0,
        watch: {
          ignored: ["**/dist/**", "**/dist-electron/**", "**/release/**"],
        },
      },
    });
    await server.listen();
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
    });
    const page = await browser.newPage({
      viewport: { width: 1300, height: 1000 },
    });
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const address = server.httpServer!.address() as { port: number };
      await page.goto(`http://127.0.0.1:${address.port}/interface-fixture`);
      await page.getByLabel("Saved dark theme").waitFor();
      assert.equal(
        await page.getByLabel("Saved dark theme").inputValue(),
        "legacy-dark",
      );
      await page.getByLabel("Theme name Imported dark").fill("Night");
      await page
        .getByRole("button", { name: "Rename Imported dark", exact: true })
        .click();
      await page.getByLabel("Theme name Night").waitFor();
      await page
        .getByRole("button", { name: "Import light palette…", exact: true })
        .click();
      await page.getByLabel("Theme name Imported light").waitFor();
      await page
        .getByLabel("Saved dark theme")
        .selectOption({ label: "Night" });
      await page
        .getByLabel("Shell icon theme", { exact: true })
        .selectOption("accent");
      await page.getByLabel("Tint interface with terminal theme").check();
      await page
        .getByLabel("Active pane highlight animation")
        .selectOption("move");
      await page
        .getByLabel("Fade inactive pane elements")
        .selectOption("surfaces");
      await page.getByRole("button", { name: "Terminal", exact: true }).click();
      await page.getByLabel("Force theme palette for RGB text").check();
      await page
        .getByLabel("Cursor effect", { exact: true })
        .selectOption("comet");
      await page
        .getByRole("button", { name: "Save settings", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      const settings = await page.evaluate(() =>
        (window as any).fixture.saved(),
      );
      assert.equal(settings.themeLibrary.length, 2);
      assert.deepEqual(
        settings.themeLibrary.find(
          (theme: any) => theme.id === settings.darkThemeId,
        ).name,
        "Night",
      );
      assert.equal(
        settings.themeLibrary.find(
          (theme: any) => theme.id === settings.darkThemeId,
        ).colors.palette200,
        "#123456",
      );
      assert.equal(
        settings.themeLibrary.find(
          (theme: any) => theme.id === settings.lightThemeId,
        ).name,
        "Imported light",
      );
      assert.equal(settings.shellIconTheme, "accent");
      assert.equal(settings.tintInterface, true);
      assert.equal(settings.highlightAnimation, "move");
      assert.equal(settings.inactivePaneFadeTarget, "surfaces");
      assert.equal(settings.forceThemePalette, true);
      assert.equal(settings.cursorEffect, "comet");
      await page.evaluate(() => (window as any).fixture.move([0.5, 0, 0.5, 1]));
      const highlight = page.locator(".active-pane-highlight");
      await expect
        .poll(
          async () => {
            const moved = await highlight.boundingBox();
            return Boolean(
              moved &&
              Math.abs(moved.x - 220) < 1 &&
              Math.abs(moved.width - 200) < 1,
            );
          },
          { message: "moving highlight must follow its target pane" },
        )
        .toBe(true);
      await page.evaluate(() => (window as any).fixture.animation("fade"));
      await expect(highlight).toHaveAttribute("data-visible", "true");
      // Observe the transition as it happens instead of sampling its 85ms hidden phase.
      const hidden = await page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const highlight = document.querySelector(".active-pane-highlight")!;
            const observer = new MutationObserver(() => {
              if (highlight.getAttribute("data-visible") !== "false") return;
              observer.disconnect();
              resolve(true);
            });
            observer.observe(highlight, {
              attributes: true,
              attributeFilter: ["data-visible"],
            });
            (window as any).fixture.move([0, 0, 0.5, 1]);
          }),
      );
      assert.equal(hidden, true);
      await expect(highlight).toHaveAttribute("data-visible", "true");
      await expect
        .poll(async () => Math.round((await highlight.boundingBox())?.x ?? -1))
        .toBe(20);
      assert.equal(
        await page
          .locator("#shell-stage svg")
          .evaluate((element) => getComputedStyle(element).color),
        "rgb(18, 52, 86)",
      );
      await page.evaluate(() => (window as any).fixture.icon("accent"));
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector("#shell-stage svg")!)
            .color === "rgb(86, 171, 120)",
      );
      await page.evaluate(() => (window as any).fixture.reopen());
      await page
        .getByRole("button", { name: "Delete Night", exact: true })
        .click();
      assert.equal(await page.getByLabel("Saved dark theme").inputValue(), "");
      await page.getByRole("button", { name: "Agents", exact: true }).click();
      await expect(page.getByLabel("Agent integration status")).toHaveText(
        "Installed integrations",
      );
      await page
        .getByRole("button", { name: "Preview install / update", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Apply these changes", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("switch", { name: "Let agents name sessions", exact: true })
        .check();
      await expect(
        page.getByRole("button", { name: "Apply these changes", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "Preview install / update", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Apply these changes", exact: true })
        .click();
      await expect(page.getByLabel("Agent integration status")).toHaveText(
        "Applied integration change",
      );
      const integrationCalls = await page.evaluate(
        () => (window as any).fixture.integrationCalls,
      );
      assert.equal(integrationCalls.at(-2).args.letAgentsNameSessions, true);
      assert.equal(integrationCalls.at(-1).method, "integrationsApply");
      await page
        .getByRole("button", { name: "Save settings", exact: true })
        .click();
      const removed = await page.evaluate(() =>
        (window as any).fixture.saved(),
      );
      assert.equal(removed.themeLibrary.length, 1);
      assert.equal(removed.darkThemeId, "");
      assert.ok(removed.lightThemeId);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await server.close();
    }
  },
);
