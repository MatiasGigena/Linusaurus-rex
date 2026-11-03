import { Terminal, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { ImageAddon } from "@xterm/addon-image";
import type { LigaturesAddon } from "@xterm/addon-ligatures";
import type { Settings, TerminalRef } from "../shared/types";
import { terminalOptions } from "./themes";
import { TerminalBoundary } from "./boundary";
import { RexUnicodeProvider } from "./unicode";
import { KittyGraphics } from "./kitty";

export interface TerminalRuntime {
  key: string;
  terminal: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  images: ImageAddon;
  kitty: KittyGraphics;
  element: HTMLDivElement;
  mounted: boolean;
  touched: number;
  prompts: IMarker[];
  outputMarkers: { start?: IMarker; end?: IMarker };
  ligatures?: LigaturesAddon;
  serverThemeSignature?: string;
  boundary: TerminalBoundary;
  cursorResetPending?: boolean;
  requestCursorReset?: () => void;
  visibilityChanged?: (visible: boolean) => void;
}

const runtimes = new Map<string, TerminalRuntime>();
const MAX_CACHED_TERMINALS = 32;
export const terminalKey = (ref: TerminalRef): string =>
  JSON.stringify([ref.hostId, ref.sessionId, ref.blockId]);

export function getCachedTerminal(
  ref: TerminalRef,
): TerminalRuntime | undefined {
  return runtimes.get(terminalKey(ref));
}

export function acquireTerminal(
  ref: TerminalRef,
  settings: Settings,
  parent?: HTMLElement,
): TerminalRuntime {
  const key = terminalKey(ref);
  let runtime = runtimes.get(key);
  if (!runtime) {
    const terminal = new Terminal(terminalOptions(settings));
    const fit = new FitAddon();
    const search = new SearchAddon({ highlightLimit: 2000 });
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.unicode.register(new RexUnicodeProvider());
    terminal.unicode.activeVersion = "rex-ghostty";
    const element = document.createElement("div");
    element.className = "terminal-emulator";
    // Xterm measures its font synchronously during open; the grid must already
    // be in the document or FitAddon starts with zero-size character metrics.
    parent?.appendChild(element);
    terminal.open(element);
    const images = new ImageAddon({
      enableSizeReports: false,
      pixelLimit: 16 * 1024 * 1024,
      storageLimit: 64,
      sixelSizeLimit: 24 * 1024 * 1024,
      iipSizeLimit: 24 * 1024 * 1024,
    });
    terminal.loadAddon(images);
    const kitty = new KittyGraphics(terminal, element);
    const prompts: IMarker[] = [];
    const outputMarkers: TerminalRuntime["outputMarkers"] = {};
    terminal.parser.registerOscHandler(133, (data) => {
      const phase = data.split(";", 1)[0];
      if (phase === "A") {
        const marker = terminal.registerMarker();
        if (marker) prompts.push(marker);
        while (prompts.length > 2000) prompts.shift()?.dispose();
      }
      if (phase === "C") {
        outputMarkers.start?.dispose();
        outputMarkers.end?.dispose();
        outputMarkers.start = terminal.registerMarker();
        outputMarkers.end = undefined;
      }
      if (phase === "D") {
        outputMarkers.end?.dispose();
        outputMarkers.end = terminal.registerMarker();
      }
      return true;
    });
    runtime = {
      key,
      terminal,
      fit,
      search,
      images,
      kitty,
      element,
      mounted: true,
      touched: performance.now(),
      prompts,
      outputMarkers,
      boundary: new TerminalBoundary(),
    };
    runtimes.set(key, runtime);
  }
  runtime.mounted = true;
  runtime.touched = performance.now();
  return runtime;
}

export function releaseTerminal(runtime: TerminalRuntime): void {
  runtime.mounted = false;
  runtime.touched = performance.now();
  const unused = [...runtimes.values()]
    .filter((item) => !item.mounted)
    .sort((a, b) => a.touched - b.touched);
  while (runtimes.size > MAX_CACHED_TERMINALS && unused.length) {
    const victim = unused.shift()!;
    runtimes.delete(victim.key);
    victim.kitty.dispose();
    victim.terminal.dispose();
  }
}

export function disposeTerminal(ref: TerminalRef): void {
  const runtime = runtimes.get(terminalKey(ref));
  if (!runtime || runtime.mounted) return;
  runtimes.delete(runtime.key);
  runtime.kitty.dispose();
  runtime.terminal.dispose();
}
