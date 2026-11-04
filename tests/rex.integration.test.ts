import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { RexService } from "../electron/rex/service.js";

const local = { id: "local", label: "This computer", endpoint: "" };

// Opt-in: creates one temporary session; cleanup only ever targets its returned ID.
test(
  "installed Rex supports terminal input, alternate screen, resize and session layouts",
  { skip: process.env.REX_INTEGRATION !== "1", timeout: 30_000 },
  async () => {
    const rex = new RexService();
    const cleanup = new RexService();
    let cleanupHost = local;
    let sessionId: string | undefined;
    const readinessDeadline = performance.now() + 25_000;
    try {
      sessionId = await rex.createSession(
        local,
        `linusaurus-verification-${Date.now()}`,
        "/tmp",
      );
      cleanupHost = { ...local, endpoint: (await rex.control(local)).endpoint };
      const view = await rex.inspect(local, sessionId);
      const blockId = view.windows[0].panes[0].id;
      const originalWindow = view.windows[0].id;
      const input = (data: string) =>
        rex.input(local, sessionId!, blockId, data);
      const capture = () => rex.capture(local, sessionId!, blockId);
      const waitFor = async (
        text: string,
        match: "contains" | "line" = "contains",
      ) => {
        // Bound each observation and leave time for cleanup within the 30s test.
        const deadline = Math.min(readinessDeadline, performance.now() + 8_000);
        let screen = "";
        while (performance.now() < deadline) {
          screen = await capture();
          const observed =
            match === "line"
              ? screen
                  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
                  .split(/\r?\n/)
                  .includes(text)
              : screen.includes(text);
          if (observed) return screen;
          await delay(Math.min(50, Math.max(0, deadline - performance.now())));
        }
        throw new Error(
          `Terminal never displayed ${JSON.stringify(text)}. Last capture: ${JSON.stringify(screen)}`,
        );
      };
      await input("printf '\\nREX_OUTPUT_%s\\n' OK\r");
      await waitFor("REX_OUTPUT_OK");
      await input("printf '\\nCWD_%s\\n' \"$PWD\"\r");
      await waitFor("CWD_/tmp");

      // Raw mode proves arrows, Tab and Control-C survive byte-for-byte transport.
      await input(
        'python3 -u -c \'import os,tty,termios; old=termios.tcgetattr(0); tty.setraw(0); print("RAW_"+"READY",flush=True); data=os.read(0,64); termios.tcsetattr(0,termios.TCSADRAIN,old); print("RAW_HEX_"+data.hex(),flush=True)\'\r',
      );
      await waitFor("RAW_READY", "line");
      await input("\x1b[A\t\x03");
      await waitFor("RAW_HEX_1b5b410903");

      const interruptToken = randomUUID();
      const interruptReady = `SLEEP_READY_${interruptToken}`;
      const interruptComplete = `INTERRUPTED_${interruptToken}`;
      // Formatting keeps the complete marker out of echoed command text. The
      // foreground subshell prints it immediately before replacing itself with sleep.
      await input(
        `/bin/sh -c 'printf "\\nSLEEP_READY_%s\\n" ${interruptToken}; exec sleep 30'\r`,
      );
      await waitFor(interruptReady, "line");
      await input("\x03");
      await input(`printf '\\nINTERRUPTED_%s\\n' ${interruptToken}\r`);
      // A non-interrupted sleep cannot execute this command within the poll budget.
      await waitFor(interruptComplete, "line");

      await input(
        "printf '\\033[?1049hALT_SCREEN_%s' OK; read -r ignored; printf '\\033[?1049l'\r",
      );
      const alternate = await waitFor("ALT_SCREEN_OK");
      assert.match(alternate, /\x1b\[\?1049h/);
      await input("\r");
      await waitFor(interruptComplete, "line");
      await rex.resize(local, sessionId, blockId, 92, 28);
      const size = await rex.terminalSize(local, sessionId, blockId);
      assert.equal(size.columns, 92);
      assert.equal(size.rows, 28);

      await rex.renameSession(local, sessionId, "-renamed-verification");
      assert.equal(
        (await rex.inspect(local, sessionId)).label,
        "-renamed-verification",
      );
      await rex.split(local, sessionId, blockId, "right");
      const split = (await rex.inspect(local, sessionId)).windows[0];
      assert.equal(split.panes.length, 2);
      assert.deepEqual(
        split.panes.map((pane) => pane.rect),
        [
          [0, 0, 0.5, 1],
          [0.5, 0, 0.5, 1],
        ],
      );
      await rex.zoom(local, sessionId, blockId);
      assert.equal(
        (await rex.inspect(local, sessionId)).windows[0].panes.length,
        1,
      );
      await rex.zoom(local, sessionId, blockId);
      const addedBlock = split.panes.find((pane) => pane.id !== blockId)!.id;
      await rex.closeBlock(local, sessionId, addedBlock);
      await rex.createWindow(local, sessionId, "-new-window");
      const withWindow = await rex.inspect(local, sessionId);
      assert.equal(withWindow.windows.length, 2);
      const addedWindow = withWindow.windows.find(
        (window) => window.id !== originalWindow,
      )!.id;
      await rex.renameWindow(local, sessionId, addedWindow, "-renamed-window");
      assert.equal(
        (await rex.inspect(local, sessionId)).windows.find(
          (window) => window.id === addedWindow,
        )?.label,
        "-renamed-window",
      );
      await rex.closeWindow(local, sessionId, addedWindow);
      rex.dispose();
      const survivor = new RexService();
      try {
        assert.equal(
          (await survivor.inspect(local, sessionId)).windows.length,
          1,
        );
      } finally {
        survivor.dispose();
      }
    } finally {
      rex.dispose();
      try {
        if (sessionId)
          await cleanup.callMethod(cleanupHost, "session.destroy", {
            session_id: sessionId,
          });
      } finally {
        cleanup.dispose();
      }
    }
  },
);

import { Terminal as GhosttyTerminal } from "khostty-libghostty-vt-wasm/api";

test(
  "installed Rex streams ordered VT, resumes without resets and restores alternate screens",
  { skip: process.env.REX_INTEGRATION !== "1", timeout: 30_000 },
  async () => {
    const rex = new RexService();
    let sessionId: string | undefined;
    let stop: (() => void) | undefined;
    let localTerminal:
      Awaited<ReturnType<typeof GhosttyTerminal.open>> | undefined;
    const frames: { data: string; kind?: string }[] = [];
    const errors: string[] = [];
    try {
      sessionId = await rex.createSession(
        local,
        `linusaurus-stream-${Date.now()}`,
        "/tmp",
      );
      const blockId = (await rex.inspect(local, sessionId)).windows[0].panes[0]
        .id;
      await rex.resize(local, sessionId, blockId, 92, 28);
      localTerminal = await GhosttyTerminal.open({ cols: 92, rows: 28 });
      const terminal = localTerminal;
      const wait = async (condition: () => boolean, label: string) => {
        for (let attempt = 0; attempt < 150; attempt++) {
          if (condition()) return;
          await delay(20);
        }
        throw new Error(`${label}; stream errors: ${errors.join("; ")}`);
      };
      const subscribe = () =>
        rex.subscribe(
          local,
          sessionId!,
          blockId,
          (data, kind, size) => {
            frames.push({ data, kind });
            if (kind === "resize" && size)
              terminal.resize(size.cols, size.rows);
            if (kind === "snapshot") {
              terminal.reset();
              if (size) terminal.resize(size.cols, size.rows);
            }
            if (data) terminal.write(data);
          },
          (error) => errors.push(error),
        );
      stop = subscribe();
      await wait(
        () => frames.some((frame) => frame.kind === "snapshot"),
        "Initial snapshot never arrived",
      );
      await rex.input(
        local,
        sessionId,
        blockId,
        "printf '\\nLIVE_SEQUENCE_%s\\n' ALPHA\r",
      );
      await wait(
        () => terminal.text().includes("LIVE_SEQUENCE_ALPHA"),
        "Live VT never arrived",
      );
      assert.equal(
        frames.filter((frame) => frame.kind === "snapshot").length,
        1,
      );
      assert.ok(
        frames.some(
          (frame) =>
            frame.kind === "output" &&
            frame.data.includes("LIVE_SEQUENCE_ALPHA"),
        ),
      );
      rex.reconnectTerminals();
      await wait(() => errors.length > 0, "Disconnect was not reported");
      await wait(
        () =>
          frames.some((frame) => frame.kind === "output" && frame.data === ""),
        "Stream did not resume",
      );
      await rex.input(
        local,
        sessionId,
        blockId,
        "printf '\\nLIVE_SEQUENCE_%s\\n' BETA\r",
      );
      await wait(
        () => terminal.text().includes("LIVE_SEQUENCE_BETA"),
        "Post-resume output never arrived",
      );
      assert.equal(
        frames.filter((frame) => frame.kind === "snapshot").length,
        1,
        "Resume must not redraw the screen",
      );
      assert.equal(
        (await rex.terminalSize(local, sessionId, blockId)).columns,
        92,
      );

      stop();
      stop = undefined;
      await rex.input(
        local,
        sessionId,
        blockId,
        "printf '\\033[?1049hSTREAM_ALT_%s' READY; read -r ignored; printf '\\033[?1049l'\r",
      );
      for (let attempt = 0; attempt < 60; attempt++) {
        if (
          (await rex.capture(local, sessionId, blockId)).includes(
            "STREAM_ALT_READY",
          )
        )
          break;
        await delay(20);
      }
      stop = subscribe();
      await wait(
        () =>
          terminal.screen === "ALTERNATE" &&
          terminal.text().includes("STREAM_ALT_READY"),
        "Fresh alternate screen was not restored",
      );
      await rex.input(local, sessionId, blockId, "\r");
      await wait(
        () => terminal.screen === "PRIMARY",
        "Alternate screen did not close",
      );
      assert.match(
        terminal.text(),
        /LIVE_SEQUENCE_BETA/,
        "Restoring an alternate screen must preserve its hidden primary buffer",
      );
    } finally {
      stop?.();
      localTerminal?.close();
      if (sessionId)
        await rex.callMethod(local, "session.destroy", {
          session_id: sessionId,
        });
      rex.dispose();
    }
  },
);

test(
  "API 8 compatibility and startup commands work with no rex executable on PATH",
  { skip: process.env.REX_INTEGRATION !== "1", timeout: 20_000 },
  async () => {
    const rex = new RexService({ apiRevisions: { min: 7, max: 8 } });
    const previousPath = process.env.PATH;
    let sessionId: string | undefined;
    try {
      process.env.PATH = "/linusaurus-test/no-programs";
      assert.equal((await rex.status(local)).connected, true);
      assert.equal(
        (await (await rex.control(local)).readyPublic()).api_revision,
        8,
      );
      sessionId = await rex.createSession(
        local,
        `linusaurus-api8-${Date.now()}`,
        "/tmp",
        `/bin/sh -c 'printf "STARTUP_%s\\n" OK; exec /bin/sh'`,
      );
      assert.ok(
        (await rex.sessions(local)).some((session) => session.id === sessionId),
      );
      const blockId = (await rex.inspect(local, sessionId)).windows[0].panes[0]
        .id;
      let screen = "";
      for (let attempt = 0; attempt < 50; attempt++) {
        screen = await rex.capture(local, sessionId, blockId);
        if (screen.includes("STARTUP_OK")) break;
        await delay(20);
      }
      assert.match(screen, /STARTUP_OK/);
    } finally {
      process.env.PATH = previousPath;
      if (sessionId)
        await rex.callMethod(local, "session.destroy", {
          session_id: sessionId,
        });
      rex.dispose();
    }
  },
);
