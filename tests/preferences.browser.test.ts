import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import type { Settings } from "../src/shared/types";
import { withBrowserFixture } from "./browser-fixture";

const source = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {SettingsDialog} from '/src/components/preferences/SettingsDialog.tsx';
import {DEFAULT_SETTINGS} from '/src/shared/types.ts';
import '/src/styles.css';import '/src/advanced.css';import '/src/dialogs.css';
const fixture=window.fixture={attempts:[],fail:false};
function Fixture(){
 const [settings,setSettings]=React.useState(structuredClone(DEFAULT_SETTINGS));
 const [open,setOpen]=React.useState(true);fixture.reopen=()=>setOpen(true);
 return open?React.createElement(SettingsDialog,{settings,initialTab:'notifications',onClose:()=>setOpen(false),onAddHost(){},onEditHost(){},onConfig(){},onDiagnostics(){},onSave:async draft=>{
  fixture.attempts.push(structuredClone(draft));
  if(fixture.fail)throw Error('Settings could not be saved');
  fixture.saved=structuredClone(draft);setSettings(draft);return draft;
 }}):null;
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;

interface Fixture {
  fixture: {
    saved?: Settings;
    attempts: Settings[];
    fail: boolean;
    reopen(): void;
  };
}

test(
  "notification channel edits survive a failed save without changing other activities or leaking cancelled drafts",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
  async () => {
    await withBrowserFixture(
      "notification-preferences",
      source,
      async (page) => {
        const desktop = page.getByRole("checkbox", {
          name: "blocked: desktop",
          exact: true,
        });
        const tabs = page.getByRole("checkbox", {
          name: "blocked: tabs",
          exact: true,
        });
        const initialDesktop = await desktop.isChecked();
        const initialTabs = await tabs.isChecked();
        await desktop.setChecked(!initialDesktop);
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        assert.equal(
          await page.evaluate(
            () => (window as unknown as Fixture).fixture.attempts.length,
          ),
          0,
        );
        await page.evaluate(() =>
          (window as unknown as Fixture).fixture.reopen(),
        );
        await expect(desktop).toBeChecked({ checked: initialDesktop });
        const otherActivity = await page
          .getByRole("checkbox", { name: "error: desktop", exact: true })
          .isChecked();
        await desktop.setChecked(!initialDesktop);
        await page
          .getByLabel("In-app notification position", { exact: true })
          .selectOption("bottom-left");
        await page
          .getByRole("button", { name: "Terminal", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Notifications", exact: true })
          .click();
        await expect(desktop).toBeChecked({ checked: !initialDesktop });
        await expect(tabs).toBeChecked({ checked: initialTabs });
        await page.evaluate(() => {
          (window as unknown as Fixture).fixture.fail = true;
        });
        await page
          .getByRole("button", { name: "Save settings", exact: true })
          .click();
        await expect(page.getByRole("alert")).toHaveText(
          "Settings could not be saved",
        );
        await expect(desktop).toBeChecked({ checked: !initialDesktop });
        await expect(
          page.getByLabel("In-app notification position", { exact: true }),
        ).toHaveValue("bottom-left");
        await page.evaluate(() => {
          (window as unknown as Fixture).fixture.fail = false;
        });
        await page
          .getByRole("button", { name: "Save settings", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const saved = await page.evaluate(
          () => (window as unknown as Fixture).fixture.saved,
        );
        assert.ok(saved);
        assert.equal(
          saved.notifications.channels.blocked.desktop,
          !initialDesktop,
        );
        assert.equal(saved.notifications.channels.blocked.tabs, initialTabs);
        assert.equal(saved.notifications.channels.error.desktop, otherActivity);
        assert.equal(saved.notifications.position, "bottom-left");
        await page.evaluate(() =>
          (window as unknown as Fixture).fixture.reopen(),
        );
        await expect(desktop).toBeChecked({ checked: !initialDesktop });
        await expect(
          page.getByLabel("In-app notification position", { exact: true }),
        ).toHaveValue("bottom-left");
      },
    );
  },
);

test(
  "preference selects accept listed values and reject injected DOM options",
  { skip: process.env.TERMINAL_UI_TEST !== "1", timeout: 30_000 },
  async () => {
    await withBrowserFixture(
      "preference-select-validation",
      source,
      async (page) => {
        for (const [tab, label, valid] of [
          ["Notifications", "In-app notification position", "bottom-left"],
          ["Appearance", "Theme", "graphite"],
          ["Terminal", "Font style", "italic"],
        ]) {
          await page.getByRole("button", { name: tab, exact: true }).click();
          const select = page.getByLabel(label, { exact: true });
          await select.selectOption(valid);
          await select.evaluate((element) => {
            const option = document.createElement("option");
            option.value = "unknown-option";
            option.textContent = "Unknown option";
            element.append(option);
          });
          await select.selectOption("unknown-option");
        }
        await page
          .getByRole("button", { name: "Save settings", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const saved = await page.evaluate(
          () => (window as unknown as Fixture).fixture.saved,
        );
        assert.ok(saved);
        assert.equal(saved.notifications.position, "bottom-left");
        assert.equal(saved.theme, "graphite");
        assert.equal(saved.fontStyle, "italic");
      },
    );
  },
);
