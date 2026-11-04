import { useEffect, useRef, useState } from "react";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Copy,
  Maximize2,
  Regex,
  Search,
  TerminalSquare,
  X,
} from "lucide-react";
import type { RexPane, Settings, TerminalRef } from "../shared/types";
import { canonicalActionName } from "../shared/actions";
import {
  acquireTerminal,
  releaseTerminal,
  type TerminalRuntime,
} from "./runtime";
import { registerTerminalInput, type TerminalMenu } from "./input";
import { terminalOptions, terminalServerTheme } from "./themes";
import { applicationLinks, linkProtocol } from "./links";
import { TerminalVisuals } from "./visuals";
import {
  terminalCommands,
  type TerminalCommandCompletion,
  type TerminalCommandRequest,
} from "./commands";
import { TerminalFrameWriter } from "./frame-writer";
import {
  TerminalCommandSession,
  terminalErrorMessage as displayError,
} from "./command-session";
import { registerTerminalViewport } from "./viewport";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";

const MAX_PASTE_BYTES = 1024 * 1024;

export interface TerminalPaneProps {
  pane: RexPane;
  terminalRef: TerminalRef;
  settings: Settings;
  focused: boolean;
  visible?: boolean;
  showHeader: boolean;
  onFocus(): void;
  onZoom(): void;
  onClose(): void;
  onAction?(command: string): Promise<unknown>;
  onTitle?(title: string): void;
  onBell?(): void;
  onNotification?(title: string, body?: string): void;
}

export {
  dispatchTerminalCommand,
  dispatchTerminalCommandAsync,
} from "./commands";
function synchronizeTheme(
  runtime: TerminalRuntime,
  ref: TerminalRef,
  settings: Settings,
  onError: (message: string) => void,
) {
  const theme = terminalServerTheme(settings);
  const signature = JSON.stringify(theme);
  if (runtime.serverThemeSignature === signature) return;
  runtime.serverThemeSignature = signature;
  void window.rex
    .request("invokeAction", {
      ...ref,
      action: "com.superlogical.terminal.set_theme",
      args: theme,
    })
    .catch((failure: unknown) => {
      if (runtime.serverThemeSignature === signature)
        runtime.serverThemeSignature = undefined;
      onError(`Theme sync failed: ${displayError(failure)}`);
    });
}

function createPromptNavigator(runtime: TerminalRuntime) {
  const term = runtime.terminal;
  let markerPosition: TerminalRuntime["prompts"][number] | undefined;
  let markerViewport = -1;
  return (direction: "previous" | "next") => {
    const buffer = term.buffer.active;
    const logicalMarker =
      markerPosition &&
      !markerPosition.isDisposed &&
      markerViewport === buffer.viewportY
        ? markerPosition
        : undefined;
    // A prompt inside the last screen cannot be scrolled to the very top.
    // Keep its marker as the logical position so the next jump still advances.
    const line = logicalMarker
      ? logicalMarker.line
      : buffer.viewportY === buffer.baseY
        ? buffer.baseY + buffer.cursorY
        : buffer.viewportY;
    const markers = runtime.prompts.filter((marker) => !marker.isDisposed);
    const marker =
      direction === "previous"
        ? markers.filter((item) => item.line < line).at(-1)
        : markers.find((item) => item.line > line);
    if (marker) {
      term.scrollToLine(marker.line);
      markerPosition = marker;
      markerViewport = term.buffer.active.viewportY;
    }
  };
}

function registerTerminalLinks(
  runtime: TerminalRuntime,
  settings: () => Settings,
  onError: (failure: unknown) => void,
) {
  const term = runtime.terminal;
  const openLink = (url: string) => {
    const kind = linkProtocol(url);
    if (!kind) {
      onError(new Error("This link protocol is not permitted."));
      return;
    }
    if (
      (kind === "web" && !settings().openLinks) ||
      (kind === "app" && settings().appLinks === "never")
    )
      return;
    void window.rex.request("openExternal", { url }).catch(onError);
  };
  const handler: NonNullable<typeof term.options.linkHandler> = {
    activate: (_event, text) => openLink(text),
    allowNonHttpProtocols: true,
  };
  term.options.linkHandler = handler;
  const links = new WebLinksAddon((_event, url) => openLink(url), {
    hover: (_event, url) => {
      runtime.element.title = settings().openLinks ? url.slice(0, 4096) : "";
    },
    leave: () => {
      runtime.element.title = "";
    },
  });
  term.loadAddon(links);
  const appLinks = term.registerLinkProvider({
    provideLinks(line, done) {
      if (settings().appLinks === "never") {
        done(undefined);
        return;
      }
      done(applicationLinks(term, line, (_event, uri) => openLink(uri)));
    },
  });
  return () => {
    links.dispose();
    appLinks.dispose();
    if (term.options.linkHandler === handler)
      term.options.linkHandler = undefined;
    runtime.element.title = "";
  };
}

function registerTerminalPresentation(
  runtime: TerminalRuntime,
  visuals: TerminalVisuals,
  ref: TerminalRef,
  props: () => Pick<TerminalPaneProps, "settings" | "visible" | "onBell">,
  replayingSnapshot: () => boolean,
  onThemeError: (message: string) => void,
) {
  const term = runtime.terminal;
  const cursorStyle = term.parser.registerCsiHandler(
    { intermediates: " ", final: "q" },
    (params) => {
      // DECSCUSR 0 restores the selected cursor after a program override.
      // Other cursor visibility/mode sequences remain intact.
      return props().settings.forceCursorStyle && params[0] !== 0;
    },
  );
  const bell = term.onBell(() => {
    if (replayingSnapshot()) return;
    props().onBell?.();
    const current = props();
    if (!current.settings.terminalBell || current.visible === false) return;
    try {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = 880;
      gain.gain.value = 0.05;
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.08);
      oscillator.onended = () => {
        void audio.close();
      };
    } catch {
      /* A desktop may have no audio output. */
    }
  });
  const colorScheme = matchMedia("(prefers-color-scheme: light)");
  const updateColorScheme = () => {
    const current = props();
    if (current.settings.theme !== "system") return;
    term.options = terminalOptions(current.settings);
    visuals.apply(current.settings);
    if (current.visible !== false)
      synchronizeTheme(runtime, ref, current.settings, onThemeError);
  };
  colorScheme.addEventListener("change", updateColorScheme);
  return () => {
    cursorStyle.dispose();
    bell.dispose();
    colorScheme.removeEventListener("change", updateColorScheme);
  };
}

function registerTerminalSubscription(
  ref: TerminalRef,
  session: TerminalCommandSession,
  writer: TerminalFrameWriter,
  onRecovered: (hadFrame: boolean) => void,
  onAcceptedFrame: () => void,
) {
  const subscriptionId = crypto.randomUUID();
  let disposed = false;
  let sawFrame = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    if (!disposed && !session.isDisposed)
      void window.rex
        .request("subscribe", { ...ref, subscriptionId })
        .catch(session.fail);
  };
  const unsubscribe = window.rex.onTerminal((frame) => {
    if (
      disposed ||
      session.isDisposed ||
      frame.subscriptionId !== subscriptionId
    )
      return;
    if (frame.error) {
      session.fail(frame.error);
      return;
    }
    if (frame.data === undefined && frame.kind !== "resize") return;
    if (session.receiveFrame()) onRecovered(sawFrame);
    sawFrame = true;
    if (!frame.kind || frame.kind === "snapshot") session.beginSnapshot();
    if (!writer.enqueue(frame, session.frameGeneration)) {
      session.fail(
        "Output exceeded the rendering buffer; resynchronizing with Rex.",
      );
      void window.rex
        .request("unsubscribe", { subscriptionId })
        .catch(() => {})
        .finally(() => {
          if (!disposed && !session.isDisposed)
            retryTimer = setTimeout(start, 250);
        });
      return;
    }
    onAcceptedFrame();
  });
  start();
  return () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(retryTimer);
    unsubscribe();
    void window.rex.request("unsubscribe", { subscriptionId }).catch(() => {});
  };
}

interface TerminalCommandBindings {
  runtime: TerminalRuntime;
  ref: TerminalRef;
  session: TerminalCommandSession;
  copy(): Promise<void>;
  openSearch(): void;
  find(previous: boolean): void;
  actionHandler(): TerminalPaneProps["onAction"];
}

function createTerminalCommandExecutor(bindings: TerminalCommandBindings) {
  const { runtime, ref, session } = bindings;
  const term = runtime.terminal;
  const pasteCommand = async (
    text?: string,
    commandGeneration?: number,
    signal?: AbortSignal,
    completion: TerminalCommandCompletion = "settled",
  ) => {
    const readyGeneration =
      commandGeneration ?? (await session.waitUntilReady(signal));
    const value = text ?? (await window.rex.readClipboard());
    signal?.throwIfAborted();
    if (new TextEncoder().encode(value).length > MAX_PASTE_BYTES)
      throw new Error("Paste is larger than the 1 MiB input limit.");
    if (!session.isCommandReady(readyGeneration))
      throw new Error(
        "The terminal connection changed before paste could be accepted.",
      );
    await session.sendCommand(
      () => window.rex.request("paste", { ...ref, text: value }),
      readyGeneration,
      completion,
    );
  };
  const promptNavigation = createPromptNavigator(runtime);
  const handleCommand = (
    command: string,
    commandGeneration: number,
    signal: AbortSignal | undefined,
    completion: TerminalCommandCompletion,
  ) => {
    switch (command) {
      case "copy":
        return bindings.copy();
      case "paste":
        return pasteCommand(undefined, commandGeneration, signal, completion);
      case "select-all":
        term.selectAll();
        break;
      case "find":
        bindings.openSearch();
        break;
      case "find-next":
        bindings.openSearch();
        bindings.find(false);
        break;
      case "find-previous":
        bindings.openSearch();
        bindings.find(true);
        break;
      case "scroll-top":
        term.scrollToTop();
        break;
      case "scroll-bottom":
        term.scrollToBottom();
        break;
      case "previous-prompt":
      case "prompt-previous":
        promptNavigation("previous");
        break;
      case "next-prompt":
      case "prompt-next":
        promptNavigation("next");
        break;
      case "scroll-line-up":
        term.scrollLines(-1);
        break;
      case "scroll-line-down":
        term.scrollLines(1);
        break;
      case "scroll-page-up":
        term.scrollPages(-1);
        break;
      case "scroll-page-down":
        term.scrollPages(1);
        break;
      case "clear-content":
      case "clear-scrollback":
      case "clear-terminal": {
        // The server emits the precise VT operation retaining the current
        // line. Applying a second local clear would corrupt its coordinates.
        const action = bindings.actionHandler();
        if (action) return action("pane.clear_content");
        return session.sendCommand(
          () =>
            window.rex.request("invokeAction", {
              ...ref,
              action: "com.superlogical.terminal.clear",
            }),
          commandGeneration,
        );
      }
      case "copy-last-output": {
        const { start, end } = runtime.outputMarkers;
        if (start && !start.isDisposed) {
          const lines: string[] = [];
          for (
            let line = start.line;
            line <=
            (end && !end.isDisposed
              ? end.line
              : term.buffer.active.baseY + term.buffer.active.cursorY);
            line++
          )
            lines.push(
              term.buffer.active.getLine(line)?.translateToString(true) || "",
            );
          return window.rex.writeClipboard(lines.join("\n").trimEnd());
        }
        break;
      }
      default:
        return bindings.actionHandler()?.(canonicalActionName(command));
    }
  };
  const execute = (
    command: TerminalCommandRequest,
    signal?: AbortSignal,
    completion: TerminalCommandCompletion = "settled",
  ) =>
    session.executeCommand(
      (generation) =>
        typeof command === "string"
          ? handleCommand(command, generation, signal, completion)
          : pasteCommand(command.text, generation, signal, completion),
      signal,
    );
  const paste = (text?: string) =>
    session.executeCommand((generation) => pasteCommand(text, generation));
  return { paste, execute };
}

export function TerminalPane(props: TerminalPaneProps) {
  const {
    pane,
    terminalRef,
    settings,
    focused,
    showHeader,
    onZoom,
    onClose,
    visible = true,
  } = props;
  const { hostId, sessionId, blockId } = terminalRef;
  const container = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<TerminalRuntime | undefined>(undefined);
  const visualsRef = useRef<TerminalVisuals | undefined>(undefined);
  const viewportRef = useRef<
    ReturnType<typeof registerTerminalViewport> | undefined
  >(undefined);
  const callbacks = useRef(props);
  callbacks.current = props;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const searchInput = useRef<HTMLInputElement>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const [connected, setConnected] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [searchResults, setSearchResults] = useState({
    resultIndex: -1,
    resultCount: 0,
  });
  const [menu, setMenu] = useState<TerminalMenu>();
  const commandRef = useRef<(command: string) => void>(() => {});
  const searchOperation = useRef<(previous?: boolean) => void>(() => {});

  useEffect(() => {
    if (!container.current) return;
    const hostElement = container.current;
    const isVisible = () => callbacks.current.visible !== false;
    const runtime = acquireTerminal(
      { hostId, sessionId, blockId },
      settingsRef.current,
      hostElement,
    );
    const term = runtime.terminal;
    runtime.serverThemeSignature = undefined;
    hostElement.replaceChildren(runtime.element);
    runtimeRef.current = runtime;
    const visuals = new TerminalVisuals(
      term,
      runtime.element,
      hostElement,
      settingsRef.current,
    );
    visualsRef.current = visuals;
    const session = new TerminalCommandSession({
      visible: isVisible,
      connected: setConnected,
      error: setError,
    });
    const viewport = registerTerminalViewport({
      runtime,
      hostElement,
      ref: { hostId, sessionId, blockId },
      settings: () => settingsRef.current,
      visible: isVisible,
      onError: (failure) => setError(`Resize failed: ${displayError(failure)}`),
    });
    viewportRef.current = viewport;
    const ref = { hostId, sessionId, blockId };
    const enqueue = (send: () => Promise<unknown>) => session.enqueue(send);
    const writer = new TerminalFrameWriter(runtime, {
      scrollOnOutput: () => settingsRef.current.scrollOnOutput,
      error: (failure, source) => {
        if (!session.isDisposed)
          setError(
            `${source === "image" ? "Image: " : ""}${displayError(failure)}`,
          );
      },
      complete: (frame, frameGeneration) => {
        viewport.frameComplete(frame);
        if (frame.kind !== "resize")
          session.frameRendered(frameGeneration, writer.hasPendingSnapshot);
      },
    });
    const commands = createTerminalCommandExecutor({
      runtime,
      ref,
      session,
      copy: () => input.copy(),
      openSearch: () => setSearchOpen(true),
      find: (previous) => searchOperation.current(previous),
      actionHandler: () => callbacks.current.onAction,
    });
    const input = registerTerminalInput({
      runtime,
      hostElement,
      ref,
      settings: () => settingsRef.current,
      isVisible,
      isOnline: () => session.isOnline,
      isFocused: () => callbacks.current.focused,
      isReplayingSnapshot: () => writer.replayingSnapshot,
      enqueue,
      // DOM paste has no awaiting caller. Its executor already reports failures
      // against the connection that accepted it, including clipboard reads.
      paste: (text) => commands.paste(text).catch(() => {}),
      onFocus: () => callbacks.current.onFocus(),
      onCopied: () => visuals.copied(),
      onError: session.reportError,
      onMenu: setMenu,
    });
    viewport.start();
    const disposeSubscription = registerTerminalSubscription(
      ref,
      session,
      writer,
      (hadFrame) => {
        input.reset();
        if (callbacks.current.focused)
          enqueue(() =>
            window.rex.request("focusEvent", { ...ref, focused: true }),
          );
        if (isVisible()) {
          if (hadFrame) runtime.serverThemeSignature = undefined;
          synchronizeTheme(runtime, ref, settingsRef.current, (message) => {
            if (!session.isDisposed) setError(message);
          });
        }
      },
      () => {
        if (
          callbacks.current.focused &&
          isVisible() &&
          document.activeElement === document.body
        )
          term.focus();
      },
    );
    commandRef.current = (command) => {
      void commands.execute(command).catch(() => {});
    };
    const commandRegistration = terminalCommands.register(ref, {
      available: () =>
        !session.isDisposed && isVisible() && hostElement.isConnected,
      focused: () => callbacks.current.focused,
      execute: commands.execute,
      // Execution owns error reporting; the broker only settles its caller.
      onError: () => {},
    });
    const disposePresentation = registerTerminalPresentation(
      runtime,
      visuals,
      ref,
      () => callbacks.current,
      () => writer.replayingSnapshot,
      (message) => {
        if (!session.isDisposed) setError(message);
      },
    );
    const titleListener = term.onTitleChange((title) =>
      callbacks.current.onTitle?.(title),
    );
    const disposeLinks = registerTerminalLinks(
      runtime,
      () => settingsRef.current,
      session.reportError,
    );
    const resultsListener = runtime.search.onDidChangeResults((results) => {
      if (!session.isDisposed) setSearchResults(results);
    });
    const visibilityChanged = (show: boolean) => {
      if (!show) {
        session.hide();
        input.reset();
      }
      viewport.visibilityChanged(show);
      if (show) commandRegistration.activate();
    };
    runtime.visibilityChanged = visibilityChanged;
    return () => {
      session.dispose();
      viewport.dispose();
      disposeSubscription();
      disposePresentation();
      input.dispose();
      titleListener.dispose();
      disposeLinks();
      resultsListener.dispose();
      commandRegistration.dispose();
      writer.dispose();
      releaseTerminal(runtime);
      if (runtimeRef.current === runtime) runtimeRef.current = undefined;
      if (viewportRef.current === viewport) viewportRef.current = undefined;
      if (runtime.visibilityChanged === visibilityChanged)
        runtime.visibilityChanged = undefined;
      visuals.dispose();
      if (visualsRef.current === visuals) visualsRef.current = undefined;
    };
  }, [hostId, sessionId, blockId]);

  useEffect(() => {
    runtimeRef.current?.visibilityChanged?.(visible);
  }, [visible]);
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.terminal.options = terminalOptions(settings);
    visualsRef.current?.apply(settings);
    runtime.kitty.setEnabled(settings.graphicsEnabled);
    runtime.element.dataset.graphicsEnabled = String(settings.graphicsEnabled);
    runtime.element.style.setProperty(
      "--terminal-cursor-period",
      `${Math.max(100, settings.cursorBlinkInterval || 500) * 2}ms`,
    );
    runtime.element.style.fontStyle = settings.fontStyle || "normal";
    runtime.element.style.setProperty(
      "-webkit-font-smoothing",
      settings.fontSmoothing ? "antialiased" : "auto",
    );
    if (settings.ligatures && !runtime.ligatures) {
      runtime.ligatures = new LigaturesAddon();
      runtime.terminal.loadAddon(runtime.ligatures);
    } else if (!settings.ligatures && runtime.ligatures) {
      runtime.ligatures.dispose();
      runtime.ligatures = undefined;
    }
    runtime.element.style.fontVariantLigatures = settings.ligatures
      ? "normal"
      : "none";
    if (!settings.ligatures && runtime.terminal.element)
      runtime.terminal.element.style.fontFeatureSettings =
        '"calt" off, "liga" off';
    runtime.cursorResetPending = settings.forceCursorStyle;
    if (settings.forceCursorStyle) runtime.requestCursorReset?.();
    viewportRef.current?.settingsChanged();
    if (visible)
      synchronizeTheme(
        runtime,
        { hostId, sessionId, blockId },
        settings,
        setError,
      );
  }, [settings, hostId, sessionId, blockId, visible]);
  useEffect(() => {
    if (focused && visible && !searchOpen) runtimeRef.current?.terminal.focus();
    else if (!focused || !visible) runtimeRef.current?.terminal.blur();
  }, [focused, visible, searchOpen]);
  useEffect(() => {
    if (searchOpen && visible) searchInput.current?.focus();
  }, [searchOpen, visible]);
  useEffect(() => {
    if (!menu) return;
    menuElement.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const close = () => setMenu(undefined);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        runtimeRef.current?.terminal.focus();
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key, true);
    };
  }, [menu]);

  const search = (previous = false, incremental = false) => {
    const runtime = runtimeRef.current;
    if (!runtime || !query) {
      runtime?.search.clearDecorations();
      setSearchResults({ resultIndex: -1, resultCount: 0 });
      setSearchError(undefined);
      return;
    }
    try {
      if (regex) new RegExp(query);
      const options = {
        regex,
        caseSensitive,
        incremental,
        decorations: {
          matchBackground: "#637b4f",
          matchBorder: "#8cae70",
          matchOverviewRuler: "#8cae70",
          activeMatchBackground: "#c5a35c",
          activeMatchBorder: "#f2d793",
          activeMatchColorOverviewRuler: "#f2d793",
        },
      };
      if (previous) runtime.search.findPrevious(query, options);
      else runtime.search.findNext(query, options);
      setSearchError(undefined);
    } catch (failure) {
      setSearchError(displayError(failure));
    }
  };
  useEffect(() => {
    if (searchOpen) search(false, true);
  }, [query, caseSensitive, regex, searchOpen]);
  const closeSearch = () => {
    setSearchOpen(false);
    runtimeRef.current?.search.clearDecorations();
    runtimeRef.current?.terminal.focus();
  };
  searchOperation.current = (previous) => search(previous);
  const menuCommand = (command: string) => {
    setMenu(undefined);
    commandRef.current(command);
    if (command !== "find") runtimeRef.current?.terminal.focus();
  };

  return (
    <section
      className={`terminal-pane ${focused ? "is-focused" : ""}`}
      aria-label={`${pane.label} terminal`}
      aria-hidden={!visible}
      onPointerDown={() => callbacks.current.onFocus()}
      onPointerEnter={() => {
        if (settings.focusFollowsMouse && visible) callbacks.current.onFocus();
      }}
    >
      {showHeader && (
        <div className="pane-header">
          <span>
            <TerminalSquare size={13} />{" "}
            {pane.title && settings.preferGeneratedTitles
              ? pane.title
              : pane.label}
          </span>
          <div>
            <button
              className="icon-button"
              title="Search terminal"
              aria-label="Search terminal"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={13} />
            </button>
            <button
              className="icon-button"
              title="Maximize pane"
              aria-label="Maximize pane"
              onClick={(event) => {
                event.stopPropagation();
                onZoom();
              }}
            >
              <Maximize2 size={13} />
            </button>
            <button
              className="icon-button"
              title="Close pane"
              aria-label="Close pane"
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      <div
        className="terminal-container"
        ref={container}
        style={{
          padding: `${settings.paddingY ?? 12}px ${settings.paddingX ?? 18}px`,
          background: terminalOptions(settings).theme?.background,
        }}
      />
      {searchOpen && (
        <form
          className="terminal-search"
          role="search"
          aria-label="Find in terminal"
          onSubmit={(event) => {
            event.preventDefault();
            search();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              closeSearch();
            }
            if (event.key === "Enter" && event.shiftKey) {
              event.preventDefault();
              search(true);
            }
          }}
        >
          <Search size={14} />
          <input
            ref={searchInput}
            aria-label="Find terminal text"
            value={query}
            placeholder="Find in terminal…"
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="terminal-search-count" role="status">
            {searchError
              ? "Invalid regex"
              : `${Math.max(0, searchResults.resultIndex + 1)}/${searchResults.resultCount}`}
          </span>
          <button
            type="button"
            className={`icon-button ${caseSensitive ? "is-active" : ""}`}
            title="Match case"
            aria-label="Match case"
            aria-pressed={caseSensitive}
            onClick={() => setCaseSensitive(!caseSensitive)}
          >
            <CaseSensitive size={15} />
          </button>
          <button
            type="button"
            className={`icon-button ${regex ? "is-active" : ""}`}
            title="Regular expression"
            aria-label="Regular expression"
            aria-pressed={regex}
            onClick={() => setRegex(!regex)}
          >
            <Regex size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Previous match"
            title="Previous match (Shift Enter)"
            onClick={() => search(true)}
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="submit"
            className="icon-button"
            aria-label="Next match"
            title="Next match (Enter)"
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Close terminal search"
            onClick={closeSearch}
          >
            <X size={14} />
          </button>
        </form>
      )}
      {error && (
        <div className="terminal-error" role="status">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      {!connected && !error && visible && (
        <div className="terminal-loading">Connecting terminal…</div>
      )}
      {menu && (
        <div
          ref={menuElement}
          className="terminal-context-menu"
          role="menu"
          aria-label="Terminal actions"
          style={{
            left: menu.x,
            top: menu.y,
            maxHeight: `calc(100vh - ${menu.y + 8}px)`,
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            const buttons = [
              ...(menuElement.current?.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ) || []),
            ];
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              event.stopPropagation();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }
          }}
        >
          <button
            role="menuitem"
            disabled={!menu.selection}
            onClick={() => menuCommand("copy")}
          >
            <Copy size={14} /> Copy <kbd>Ctrl Shift C</kbd>
          </button>
          <button role="menuitem" onClick={() => menuCommand("paste")}>
            Paste <kbd>Ctrl Shift V</kbd>
          </button>
          <button role="menuitem" onClick={() => menuCommand("select-all")}>
            Select all
          </button>
          <button role="menuitem" onClick={() => menuCommand("find")}>
            <Search size={14} /> Find in terminal <kbd>Ctrl Shift F</kbd>
          </button>
          <div role="separator" />
          <button role="menuitem" onClick={() => menuCommand("scroll-top")}>
            <ArrowUp size={14} /> Scroll to top
          </button>
          <button role="menuitem" onClick={() => menuCommand("scroll-bottom")}>
            <ArrowDown size={14} /> Scroll to bottom
          </button>
          <button
            role="menuitem"
            onClick={() => menuCommand("previous-prompt")}
          >
            Previous prompt
          </button>
          <button role="menuitem" onClick={() => menuCommand("next-prompt")}>
            Next prompt
          </button>
          <button role="menuitem" onClick={() => menuCommand("clear-terminal")}>
            Clear terminal and scrollback
          </button>
          <button
            role="menuitem"
            onClick={() => menuCommand("pane.reset_terminal")}
          >
            Reset terminal…
          </button>
          <div role="separator" />
          <button
            role="menuitem"
            onClick={() => menuCommand("client.font.increase")}
          >
            Increase font size
          </button>
          <button
            role="menuitem"
            onClick={() => menuCommand("client.font.decrease")}
          >
            Decrease font size
          </button>
          <button
            role="menuitem"
            onClick={() => menuCommand("client.font.reset")}
          >
            Reset font size
          </button>
          <div role="separator" />
          <button
            role="menuitem"
            onClick={() => menuCommand("pane.split.right")}
          >
            Split right
          </button>
          <button
            role="menuitem"
            onClick={() => menuCommand("pane.split.down")}
          >
            Split below
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(undefined);
              onZoom();
            }}
          >
            Toggle pane zoom
          </button>
          <button
            role="menuitem"
            className="terminal-menu-danger"
            onClick={() => {
              setMenu(undefined);
              onClose();
            }}
          >
            Close pane
          </button>
        </div>
      )}
    </section>
  );
}
