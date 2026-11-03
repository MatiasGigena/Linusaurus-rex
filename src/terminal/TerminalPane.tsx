import { useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { AlertCircle, ArrowDown, ArrowUp, CaseSensitive, ChevronDown, ChevronUp, Copy, Maximize2, Regex, Search, TerminalSquare, X } from 'lucide-react';
import type { RexPane, Settings, TerminalFrame, TerminalRef } from '../shared/types';
import { acquireTerminal, releaseTerminal, type TerminalRuntime } from './runtime';
import { isCompositionKey, isNativeText, keyboardPayload, keyModifiers, pointerCell } from './keys';
import { terminalOptions, terminalServerTheme } from './themes';
import { applicationLinks, linkProtocol } from './links';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

export interface TerminalPaneProps {
  pane: RexPane; terminalRef: TerminalRef; settings: Settings; focused: boolean; visible?: boolean; showHeader: boolean;
  onFocus(): void; onZoom(): void; onClose(): void; onAction?(command: string): void; onTitle?(title: string): void; onBell?(): void;
  onNotification?(title: string, body?: string): void;
}

export function dispatchTerminalCommand(command: string, target?: TerminalRef): void {
  window.dispatchEvent(new CustomEvent('rex-terminal-command', { detail: target ? { command, target } : command }));
}
interface TerminalCommandRequest {
  command: string;
  target?: TerminalRef;
  acknowledge?(completion: Promise<void>): void;
}
/** Resolves when a ready pane accepts the command, without waiting behind its current key RPC. */
export function dispatchTerminalCommandAsync(command: string, target?: TerminalRef): Promise<void> {
  return new Promise((resolve, reject) => {
    let accepted = false;
    const detail: TerminalCommandRequest = { command, target, acknowledge(completion) {
      if (accepted) return;
      accepted = true;
      void completion.then(resolve, reject);
    } };
    window.dispatchEvent(new CustomEvent('rex-terminal-command', { detail }));
    if (!accepted) reject(new Error('The target terminal pane is not visible or is no longer available.'));
  });
}
function currentSelection(term: Terminal) {
  const position = term.getSelectionPosition();
  return position && { position, text: term.getSelection() };
}
function restoreSelection(term: Terminal, previous: ReturnType<typeof currentSelection>) {
  if (!previous) return;
  const { start, end } = previous.position;
  const length = (end.y - start.y) * term.cols + end.x - start.x;
  if (start.y < 0 || end.y >= term.buffer.active.length || length < 0) return;
  term.select(start.x, start.y, length);
  if (term.getSelection() !== previous.text) term.clearSelection();
}
const displayError = (failure: unknown) => failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(failure);
function synchronizeTheme(runtime: TerminalRuntime, ref: TerminalRef, settings: Settings, onError: (message: string) => void) {
  const theme = terminalServerTheme(settings);
  const signature = JSON.stringify(theme);
  if (runtime.serverThemeSignature === signature) return;
  runtime.serverThemeSignature = signature;
  void window.rex.request('invokeAction', { ...ref, action: 'com.superlogical.terminal.set_theme', args: theme }).catch((failure: unknown) => {
    if (runtime.serverThemeSignature === signature) runtime.serverThemeSignature = undefined;
    onError(`Theme sync failed: ${displayError(failure)}`);
  });
}

export function TerminalPane(props: TerminalPaneProps) {
  const { pane, terminalRef, settings, focused, showHeader, onZoom, onClose, visible = true } = props;
  const { hostId, sessionId, blockId } = terminalRef;
  const container = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<TerminalRuntime | undefined>(undefined);
  const callbacks = useRef(props); callbacks.current = props;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const searchInput = useRef<HTMLInputElement>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const [connected, setConnected] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [searchResults, setSearchResults] = useState({ resultIndex: -1, resultCount: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; selection: boolean }>();
  const commandRef = useRef<(command: string) => void>(() => {});
  const searchOperation = useRef<(previous?: boolean) => void>(() => {});

  useEffect(() => {
    if (!container.current) return;
    const hostElement = container.current;
    const runtime = acquireTerminal({ hostId, sessionId, blockId }, settingsRef.current, hostElement);
    const term = runtime.terminal;
    runtime.serverThemeSignature = undefined;
    hostElement.replaceChildren(runtime.element);
    runtimeRef.current = runtime;
    let disposed = false, online = false, commandReady = false, disconnected = false, generation = 0, composing = false, deadKey = false, writing = false, replayingSnapshot = false, sawFrame = false;
    let inputQueue = Promise.resolve();
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let copyTimer: ReturnType<typeof setTimeout> | undefined;
    let motionAnimation = 0, resizeAnimation = 0, nativeTextUntil = 0, pendingBytes = 0, wheelRemainder = 0;
    let pendingMotion: (() => void) | undefined;
    let pendingFrames: TerminalFrame[] = [];
    let layout: ReadonlyMap<string, string> | undefined;
    let pointerButton: 'left' | 'middle' | 'right' | undefined;
    let selectionAnchor: number | undefined;
    let promptNavigationMarker: TerminalRuntime['prompts'][number] | undefined;
    let promptNavigationViewport = -1;
    let lastMouseCell = '', lastSize = '';
    const pressedKeys = new Set<string>();
    const commandWaiters = new Set<{ resolve(generation: number): void; reject(failure: Error): void; timer: ReturnType<typeof setTimeout> }>();
    const ref = { hostId, sessionId, blockId };
    const subscriptionId = crypto.randomUUID();
    const rejectPendingCommands = (message: string) => {
      for (const waiter of commandWaiters) { clearTimeout(waiter.timer); waiter.reject(new Error(message)); }
      commandWaiters.clear();
    };
    const waitForCommands = (): Promise<number> => {
      if (disposed || !visible) return Promise.reject(new Error('The terminal pane is no longer visible.'));
      if (online && commandReady) return Promise.resolve(generation);
      if (disconnected) return Promise.reject(new Error('The terminal is disconnected; wait for it to reconnect.'));
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, timer: setTimeout(() => {
          commandWaiters.delete(waiter);
          reject(new Error('The terminal did not become ready within 10 seconds.'));
        }, 10_000) };
        commandWaiters.add(waiter);
      });
    };
    const reportCommandError = (failure: unknown) => { if (!disposed) setError(displayError(failure)); };
    const fail = (failure: unknown) => {
      generation++; online = false; commandReady = false; disconnected = true;
      rejectPendingCommands(displayError(failure));
      if (!disposed) { setConnected(false); setError(displayError(failure)); }
    };
    // A failed send invalidates later queued input; none is retried after reconnect.
    const enqueue = (send: () => Promise<unknown>) => {
      if (!online || !visible || disposed) return false;
      const inputGeneration = generation;
      inputQueue = inputQueue.then(async () => {
        if (disposed || !online || generation !== inputGeneration) return;
        try { await send(); } catch (failure) {
          const text = displayError(failure);
          if (/connection|socket|network|disconnected|closed|timed out|ECONN|EPIPE|transport|handshake|\bEOF\b/i.test(text)) fail(failure);
          else {
            // An invalid user action or Lua exception is not a lost transport.
            // Drop already-queued keys, then allow the next explicit input.
            generation++;
            if (!disposed) setError(text);
          }
        }
      });
      return true;
    };
    const sendSize = () => {
      if (disposed || !visible || !document.hasFocus() || !hostElement.isConnected || hostElement.clientWidth === 0 || hostElement.clientHeight === 0) return;
      runtime.fit.fit(); clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (disposed || !visible || !document.hasFocus()) return;
        const size = `${term.cols}/${term.rows}`;
        if (size === lastSize) return;
        lastSize = size;
        void window.rex.request('resize', { ...ref, cols: term.cols, rows: term.rows }).catch((failure: unknown) => {
          lastSize = ''; if (!disposed) setError(`Resize failed: ${displayError(failure)}`);
        });
      }, 100);
    };
    const startSubscription = () => {
      if (!disposed && visible) void window.rex.request('subscribe', { ...ref, subscriptionId }).catch(fail);
    };
    const drawNext = () => {
      if (disposed || writing) return;
      if (runtime.cursorResetPending && runtime.boundary.ground) {
        runtime.cursorResetPending = false;
        writing = true;
        term.write('\x1b[0 q', () => { writing = false; if (!disposed) drawNext(); });
        return;
      }
      if (!pendingFrames.length) return;
      const frame = pendingFrames.shift()!;
      const frameGeneration = generation;
      pendingBytes -= frame.data?.length ?? 0;
      const before = term.buffer.active, atBottom = before.viewportY >= before.baseY, previousScroll = before.viewportY;
      const snapshot = !frame.kind || frame.kind === 'snapshot';
      const selection = snapshot ? currentSelection(term) : undefined;
      if (frame.cols && frame.rows && (term.cols !== frame.cols || term.rows !== frame.rows)) term.resize(frame.cols, frame.rows);
      replayingSnapshot = snapshot;
      if (snapshot) { term.reset(); runtime.boundary.reset(); }
      if (frame.data) runtime.boundary.push(frame.data);
      const done = () => {
        writing = false; if (disposed) return;
        if (snapshot) restoreSelection(term, selection);
        replayingSnapshot = false;
        if (!atBottom || !settingsRef.current.scrollOnOutput) term.scrollToLine(previousScroll);
        if (snapshot || frame.kind === 'resize') { if (snapshot) lastSize = ''; resizeAnimation = requestAnimationFrame(sendSize); }
        if (frame.kind !== 'resize' && online && generation === frameGeneration && !commandReady && !pendingFrames.some((pending) => !pending.kind || pending.kind === 'snapshot')) {
          commandReady = true;
          for (const waiter of commandWaiters) { clearTimeout(waiter.timer); waiter.resolve(generation); }
          commandWaiters.clear();
        }
        drawNext();
      };
      writing = true;
      if (frame.data) term.write(frame.data, done); else done();
    };
    runtime.requestCursorReset = drawNext;
    const unsubscribe = window.rex.onTerminal((frame) => {
      if (disposed || frame.subscriptionId !== subscriptionId) return;
      if (frame.error) { fail(frame.error); return; }
      if (frame.data === undefined && frame.kind !== 'resize') return;
      const recovered = !online;
      if (recovered) { generation++; disconnected = false; pressedKeys.clear(); }
      online = true; setConnected(true); setError(undefined);
      if (recovered && callbacks.current.focused) enqueue(() => window.rex.request('focusEvent', { ...ref, focused: true }));
      if (recovered && visible) {
        if (sawFrame) runtime.serverThemeSignature = undefined;
        synchronizeTheme(runtime, ref, settingsRef.current, (message) => { if (!disposed) setError(message); });
      }
      sawFrame = true;
      if (!frame.kind || frame.kind === 'snapshot') { commandReady = false; pendingFrames = []; pendingBytes = 0; }
      pendingFrames.push(frame); pendingBytes += frame.data?.length ?? 0;
      // A validated initial snapshot may exceed the live-output backlog limit.
      // Rejecting it here would reconnect forever to the same large scrollback.
      if (frame.kind === 'output' && pendingBytes > 16 * 1024 * 1024) {
        fail('Output exceeded the rendering buffer; resynchronizing with Rex.');
        pendingFrames = []; pendingBytes = 0;
        void window.rex.request('unsubscribe', { subscriptionId }).catch(() => {}).finally(() => { retryTimer = setTimeout(startSubscription, 250); });
        return;
      }
      drawNext();
      if (callbacks.current.focused && visible && document.activeElement === document.body) term.focus();
    });
    const copy = () => {
      if (term.hasSelection()) void window.rex.writeClipboard(term.getSelection()).catch((failure: unknown) => setError(displayError(failure)));
    };
    const paste = async (text?: string, commandGeneration?: number) => {
      const readyGeneration = commandGeneration ?? await waitForCommands();
      const value = text ?? await window.rex.readClipboard();
      if (new TextEncoder().encode(value).length > 1024 * 1024) throw new Error('Paste is larger than the 1 MiB input limit.');
      if (generation !== readyGeneration || !commandReady || !enqueue(() => window.rex.request('paste', { ...ref, text: value }))) {
        throw new Error('The terminal connection changed before paste could be accepted.');
      }
    };
    const promptNavigation = (direction: 'previous' | 'next') => {
      const buffer = term.buffer.active;
      const logicalMarker = promptNavigationMarker && !promptNavigationMarker.isDisposed && promptNavigationViewport === buffer.viewportY ? promptNavigationMarker : undefined;
      // A prompt inside the last screen cannot be scrolled to the very top.
      // Keep its marker as the logical position so the next jump still advances.
      const line = logicalMarker ? logicalMarker.line : buffer.viewportY === buffer.baseY ? buffer.baseY + buffer.cursorY : buffer.viewportY;
      const markers = runtime.prompts.filter((marker) => !marker.isDisposed);
      const marker = direction === 'previous' ? markers.filter((item) => item.line < line).at(-1) : markers.find((item) => item.line > line);
      if (marker) { term.scrollToLine(marker.line); promptNavigationMarker = marker; promptNavigationViewport = term.buffer.active.viewportY; }
    };
    const handleCommand = (command: string, commandGeneration: number) => {
      switch (command) {
        case 'copy': copy(); break;
        case 'paste': return paste(undefined, commandGeneration);
        case 'select-all': term.selectAll(); break;
        case 'find': setSearchOpen(true); break;
        case 'find-next': setSearchOpen(true); searchOperation.current(false); break;
        case 'find-previous': setSearchOpen(true); searchOperation.current(true); break;
        case 'scroll-top': term.scrollToTop(); break;
        case 'scroll-bottom': term.scrollToBottom(); break;
        case 'previous-prompt': case 'prompt-previous': promptNavigation('previous'); break;
        case 'next-prompt': case 'prompt-next': promptNavigation('next'); break;
        case 'scroll-line-up': term.scrollLines(-1); break;
        case 'scroll-line-down': term.scrollLines(1); break;
        case 'scroll-page-up': term.scrollPages(-1); break;
        case 'scroll-page-down': term.scrollPages(1); break;
        case 'clear-content': case 'clear-scrollback': case 'clear-terminal':
          // The server emits the precise VT operation retaining the current
          // line. Applying a second local clear would corrupt its coordinates.
          if (callbacks.current.onAction) callbacks.current.onAction('clear-content-server');
          else enqueue(() => window.rex.request('invokeAction', { ...ref, action: 'com.superlogical.terminal.clear' }));
          break;
        case 'copy-last-output': {
          const { start, end } = runtime.outputMarkers;
          if (start && !start.isDisposed) {
            const lines: string[] = [];
            for (let line = start.line; line <= (end && !end.isDisposed ? end.line : term.buffer.active.baseY + term.buffer.active.cursorY); line++) lines.push(term.buffer.active.getLine(line)?.translateToString(true) || '');
            void window.rex.writeClipboard(lines.join('\n').trimEnd()).catch((failure: unknown) => setError(displayError(failure)));
          }
          break;
        }
        default: callbacks.current.onAction?.(command);
      }
    };
    const executeCommand = async (command: string) => {
      const commandGeneration = await waitForCommands();
      if (disposed || !online || !commandReady || commandGeneration !== generation) throw new Error('The terminal connection changed before the command could be accepted.');
      await handleCommand(command, commandGeneration);
    };
    commandRef.current = (command) => { void executeCommand(command).catch(reportCommandError); };
    const commandListener = (event: Event) => {
      if (!visible || !hostElement.isConnected) return;
      const detail = (event as CustomEvent<string | TerminalCommandRequest>).detail;
      const target = typeof detail === 'string' ? undefined : detail.target;
      const matches = target ? target.hostId === hostId && target.sessionId === sessionId && target.blockId === blockId : callbacks.current.focused;
      if (matches) {
        const completion = executeCommand(typeof detail === 'string' ? detail : detail.command);
        void completion.catch(reportCommandError);
        if (typeof detail !== 'string') detail.acknowledge?.(completion);
      }
    };
    window.addEventListener('rex-terminal-command', commandListener);
    const cursorStyleListener = term.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, (params) => {
      const style = params[0];
      // DECSCUSR 0 clears any preceding program override and returns to the
      // selected cursor. Other cursor visibility/mode sequences remain intact.
      return settingsRef.current.forceCursorStyle && style !== 0;
    });
    const dataListener = term.onData((data) => {
      // Rex's Ghostty already answered terminal queries. Only native IME/dead-key
      // text enters this path; keys, paste, mouse and focus use typed events.
      if (isNativeText(data) && (composing || performance.now() < nativeTextUntil)) enqueue(() => window.rex.request('input', { ...ref, data }));
    });
    term.attachCustomKeyEventHandler((event) => {
      if (event.defaultPrevented || !visible || !online) return false;
      if (isCompositionKey(event) || composing || deadKey) {
        nativeTextUntil = performance.now() + 1500;
        if (event.key === 'Dead') deadKey = true;
        else if (event.type === 'keyup') deadKey = false;
        return true;
      }
      if (event.type === 'keypress') return false;
      const payload = keyboardPayload(event, layout);
      if (!payload) return true;
      if (event.type === 'keyup') { if (!pressedKeys.delete(event.code)) return false; }
      else pressedKeys.add(event.code);
      event.preventDefault(); enqueue(() => window.rex.request('key', { ...ref, event: payload }));
      if (settingsRef.current.scrollOnOutput && event.type === 'keydown') term.scrollToBottom();
      return false;
    });
    const clipboardPaste = (event: ClipboardEvent) => {
      if (!visible) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void paste(event.clipboardData?.types.includes('text/plain') ? event.clipboardData.getData('text/plain') : undefined).catch(reportCommandError);
    };
    const compositionStart = () => { composing = true; nativeTextUntil = performance.now() + 1500; };
    const compositionEnd = () => { composing = false; nativeTextUntil = performance.now() + 250; };
    const beforeInput = (event: InputEvent) => { if (event.isComposing || event.inputType.startsWith('insertComposition')) nativeTextUntil = performance.now() + 1500; };
    const focusIn = () => enqueue(() => window.rex.request('focusEvent', { ...ref, focused: true }));
    const focusOut = () => { pressedKeys.clear(); enqueue(() => window.rex.request('focusEvent', { ...ref, focused: false })); };
    hostElement.addEventListener('paste', clipboardPaste, true);
    hostElement.addEventListener('compositionstart', compositionStart, true);
    hostElement.addEventListener('compositionend', compositionEnd, true);
    hostElement.addEventListener('beforeinput', beforeInput as EventListener, true);
    hostElement.addEventListener('focusin', focusIn); hostElement.addEventListener('focusout', focusOut);
    const screen = runtime.element.querySelector<HTMLElement>('.xterm-screen')!;
    const cellAt = (event: MouseEvent) => pointerCell(event.clientX, event.clientY, screen.getBoundingClientRect(), term.cols, term.rows);
    const tracking = () => term.modes.mouseTrackingMode !== 'none';
    const sendMouse = (event: MouseEvent, action: 'press' | 'motion' | 'release', button?: 'left' | 'middle' | 'right') => {
      const cell = cellAt(event), signature = `${cell.x}/${cell.y}/${button || ''}`;
      if (action === 'motion' && lastMouseCell === signature) return;
      lastMouseCell = signature;
      enqueue(() => window.rex.request('mouse', { ...ref, event: { action, ...(button ? { button } : {}), ...cell, mods: keyModifiers(event, false) } }));
    };
    const stopMouse = (event: MouseEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const mouseDown = (event: MouseEvent) => {
      if (!visible) return;
      if (event.button === 2 && !(event.shiftKey && tracking() && settingsRef.current.mouseReporting)) { stopMouse(event); return; }
      if (!tracking() || (event.button === 0 && event.shiftKey)) return;
      if (!settingsRef.current.mouseReporting && event.button === 0) {
        const at = cellAt(event); selectionAnchor = (term.buffer.active.viewportY + at.y) * term.cols + at.x;
        term.clearSelection(); stopMouse(event); return;
      }
      if (!settingsRef.current.mouseReporting || !online) return;
      pointerButton = event.button === 0 ? 'left' : event.button === 1 ? 'middle' : 'right';
      term.clearSelection(); sendMouse(event, 'press', pointerButton); stopMouse(event);
    };
    const mouseMove = (event: MouseEvent) => {
      if (!visible) return;
      if (selectionAnchor !== undefined) {
        const at = cellAt(event), end = (term.buffer.active.viewportY + at.y) * term.cols + at.x, start = Math.min(selectionAnchor, end);
        term.select(start % term.cols, Math.floor(start / term.cols), Math.abs(selectionAnchor - end) + 1);
        stopMouse(event); return;
      }
      const inside = screen.contains(event.target as Node);
      if (!pointerButton && (!inside || !callbacks.current.focused || term.modes.mouseTrackingMode !== 'any' || event.shiftKey)) return;
      if (!settingsRef.current.mouseReporting || !online || !tracking()) return;
      pendingMotion = () => sendMouse(event, 'motion', pointerButton);
      if (!motionAnimation) motionAnimation = requestAnimationFrame(() => { motionAnimation = 0; pendingMotion?.(); pendingMotion = undefined; });
      if (pointerButton) stopMouse(event);
    };
    const mouseUp = (event: MouseEvent) => {
      if (selectionAnchor !== undefined) { selectionAnchor = undefined; stopMouse(event); return; }
      if (!pointerButton) return;
      cancelAnimationFrame(motionAnimation); motionAnimation = 0; pendingMotion?.(); pendingMotion = undefined;
      sendMouse(event, 'release', pointerButton); pointerButton = undefined; stopMouse(event);
    };
    const contextMenu = (event: MouseEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (event.shiftKey && tracking() && settingsRef.current.mouseReporting && online) return;
      callbacks.current.onFocus();
      setMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 230)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 410)), selection: term.hasSelection() });
    };
    const wheel = (event: WheelEvent) => {
      if (!visible) return;
      if (settingsRef.current.mouseReporting && tracking() && !event.shiftKey && online) {
        event.preventDefault(); event.stopImmediatePropagation();
        const lineHeight = screen.clientHeight / Math.max(1, term.rows);
        wheelRemainder += event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? lineHeight : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? screen.clientHeight : 1) / lineHeight;
        const lines = Math.trunc(wheelRemainder); wheelRemainder -= lines;
        const cell = cellAt(event);
        for (let i = 0; i < Math.min(Math.abs(lines), 8); i++) enqueue(() => window.rex.request('wheel', { ...ref, event: { ...cell, delta_x: 0, delta_y: Math.sign(lines) } }));
      } else if (tracking()) {
        event.preventDefault(); event.stopImmediatePropagation();
        const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY : event.deltaY / (screen.clientHeight / Math.max(1, term.rows));
        term.scrollLines(Math.sign(lines) * Math.max(1, Math.round(Math.abs(lines))));
      }
    };
    hostElement.addEventListener('mousedown', mouseDown, true);
    window.addEventListener('mousemove', mouseMove, true); window.addEventListener('mouseup', mouseUp, true);
    hostElement.addEventListener('contextmenu', contextMenu); hostElement.addEventListener('wheel', wheel, { capture: true, passive: false });
    const selectionListener = term.onSelectionChange(() => {
      clearTimeout(copyTimer);
      if (!replayingSnapshot && settingsRef.current.copyOnSelect && term.hasSelection()) copyTimer = setTimeout(copy, 150);
    });
    const titleListener = term.onTitleChange((title) => callbacks.current.onTitle?.(title));
    const bellListener = term.onBell(() => {
      if (replayingSnapshot) return;
      callbacks.current.onBell?.();
      if (settingsRef.current.terminalBell && visible) {
        try {
          const audio = new AudioContext(), oscillator = audio.createOscillator(), gain = audio.createGain();
          oscillator.frequency.value = 880; gain.gain.value = .05; oscillator.connect(gain); gain.connect(audio.destination); oscillator.start();
          oscillator.stop(audio.currentTime + .08); oscillator.onended = () => { void audio.close(); };
        } catch { /* A desktop may have no audio output. */ }
      }
    });
    const openLink = (url: string) => {
      const kind = linkProtocol(url);
      if (!kind) { setError('This link protocol is not permitted.'); return; }
      if ((kind === 'web' && !settingsRef.current.openLinks) || (kind === 'app' && settingsRef.current.appLinks === 'never')) return;
      void window.rex.request('openExternal', { url }).catch((failure: unknown) => setError(displayError(failure)));
    };
    term.options.linkHandler = { activate: (_event, text) => openLink(text), allowNonHttpProtocols: true };
    const links = new WebLinksAddon((_event, url) => openLink(url), {
      hover: (_event, url) => { runtime.element.title = settingsRef.current.openLinks ? url.slice(0, 4096) : ''; },
      leave: () => { runtime.element.title = ''; },
    });
    term.loadAddon(links);
    const appLinks = term.registerLinkProvider({ provideLinks(line, done) {
      if (settingsRef.current.appLinks === 'never') { done(undefined); return; }
      done(applicationLinks(term, line, (_event, uri) => openLink(uri)));
    } });
    const resultsListener = runtime.search.onDidChangeResults((results) => { if (!disposed) setSearchResults(results); });
    const observer = new ResizeObserver(sendSize); observer.observe(hostElement);
    const visibility = () => { if (!document.hidden && visible) { lastSize = ''; sendSize(); } };
    document.addEventListener('visibilitychange', visibility);
    const windowFocus = () => { if (visible) { lastSize = ''; sendSize(); } };
    window.addEventListener('focus', windowFocus);
    const colorScheme = matchMedia('(prefers-color-scheme: light)');
    const updateColorScheme = () => {
      if (settingsRef.current.theme !== 'system') return;
      const options = terminalOptions(settingsRef.current);
      term.options = options;
      hostElement.style.backgroundColor = options.theme?.background || '';
      if (visible) synchronizeTheme(runtime, ref, settingsRef.current, (message) => { if (!disposed) setError(message); });
    };
    colorScheme.addEventListener('change', updateColorScheme);
    const navigatorWithKeyboard = navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<ReadonlyMap<string, string>> } };
    void navigatorWithKeyboard.keyboard?.getLayoutMap().then((value) => { layout = value; }).catch(() => {});
    sendSize(); startSubscription();
    return () => {
      disposed = true; online = false; generation++;
      rejectPendingCommands('The terminal pane was hidden or closed before the command became ready.');
      clearTimeout(resizeTimer); clearTimeout(retryTimer); clearTimeout(copyTimer); cancelAnimationFrame(motionAnimation); cancelAnimationFrame(resizeAnimation);
      observer.disconnect(); unsubscribe(); cursorStyleListener.dispose();
      dataListener.dispose(); selectionListener.dispose(); titleListener.dispose(); bellListener.dispose(); links.dispose(); appLinks.dispose(); resultsListener.dispose();
      window.removeEventListener('rex-terminal-command', commandListener);
      hostElement.removeEventListener('paste', clipboardPaste, true);
      hostElement.removeEventListener('compositionstart', compositionStart, true); hostElement.removeEventListener('compositionend', compositionEnd, true);
      hostElement.removeEventListener('beforeinput', beforeInput as EventListener, true);
      hostElement.removeEventListener('focusin', focusIn); hostElement.removeEventListener('focusout', focusOut);
      hostElement.removeEventListener('mousedown', mouseDown, true);
      window.removeEventListener('mousemove', mouseMove, true); window.removeEventListener('mouseup', mouseUp, true);
      hostElement.removeEventListener('contextmenu', contextMenu); hostElement.removeEventListener('wheel', wheel, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', windowFocus);
      colorScheme.removeEventListener('change', updateColorScheme);
      void window.rex.request('unsubscribe', { subscriptionId }).catch(() => {});
      term.attachCustomKeyEventHandler(() => false); releaseTerminal(runtime);
      if (runtime.requestCursorReset === drawNext) runtime.requestCursorReset = undefined;
      if (runtimeRef.current === runtime) runtimeRef.current = undefined;
    };
  }, [hostId, sessionId, blockId, visible]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.terminal.options = terminalOptions(settings);
    runtime.element.style.setProperty('--terminal-cursor-period', `${Math.max(100, settings.cursorBlinkInterval || 500) * 2}ms`);
    runtime.element.style.fontStyle = settings.fontStyle || 'normal';
    runtime.element.style.setProperty('-webkit-font-smoothing', settings.fontSmoothing ? 'antialiased' : 'auto');
    if (settings.ligatures && !runtime.ligatures) {
      runtime.ligatures = new LigaturesAddon();
      runtime.terminal.loadAddon(runtime.ligatures);
    } else if (!settings.ligatures && runtime.ligatures) {
      runtime.ligatures.dispose(); runtime.ligatures = undefined;
    }
    runtime.element.style.fontVariantLigatures = settings.ligatures ? 'normal' : 'none';
    if (!settings.ligatures && runtime.terminal.element) runtime.terminal.element.style.fontFeatureSettings = '"calt" off, "liga" off';
    runtime.cursorResetPending = settings.forceCursorStyle;
    if (settings.forceCursorStyle) runtime.requestCursorReset?.();
    if (visible && document.hasFocus()) {
      runtime.fit.fit();
      void window.rex.request('resize', { hostId, sessionId, blockId, cols: runtime.terminal.cols, rows: runtime.terminal.rows }).catch((failure: unknown) => setError(displayError(failure)));
    }
    if (visible) synchronizeTheme(runtime, { hostId, sessionId, blockId }, settings, setError);
  }, [settings, hostId, sessionId, blockId, visible]);
  useEffect(() => {
    if (focused && visible && !searchOpen) runtimeRef.current?.terminal.focus();
    else if (!focused || !visible) runtimeRef.current?.terminal.blur();
  }, [focused, visible, searchOpen]);
  useEffect(() => { if (searchOpen && visible) searchInput.current?.focus(); }, [searchOpen, visible]);
  useEffect(() => {
    if (!menu) return;
    menuElement.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = () => setMenu(undefined);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); runtimeRef.current?.terminal.focus(); } };
    window.addEventListener('mousedown', close); window.addEventListener('blur', close); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', key, true); };
  }, [menu]);

  const search = (previous = false, incremental = false) => {
    const runtime = runtimeRef.current;
    if (!runtime || !query) { runtime?.search.clearDecorations(); setSearchResults({ resultIndex: -1, resultCount: 0 }); setSearchError(undefined); return; }
    try {
      if (regex) new RegExp(query);
      const options = { regex, caseSensitive, incremental, decorations: { matchBackground: '#637b4f', matchBorder: '#8cae70', matchOverviewRuler: '#8cae70', activeMatchBackground: '#c5a35c', activeMatchBorder: '#f2d793', activeMatchColorOverviewRuler: '#f2d793' } };
      if (previous) runtime.search.findPrevious(query, options); else runtime.search.findNext(query, options);
      setSearchError(undefined);
    } catch (failure) { setSearchError(displayError(failure)); }
  };
  useEffect(() => { if (searchOpen) search(false, true); }, [query, caseSensitive, regex, searchOpen]);
  const closeSearch = () => { setSearchOpen(false); runtimeRef.current?.search.clearDecorations(); runtimeRef.current?.terminal.focus(); };
  searchOperation.current = (previous) => search(previous);
  const menuCommand = (command: string) => { setMenu(undefined); commandRef.current(command); if (command !== 'find') runtimeRef.current?.terminal.focus(); };

  return <section className={`terminal-pane ${focused ? 'is-focused' : ''}`} aria-label={`${pane.label} terminal`} aria-hidden={!visible} onPointerDown={() => callbacks.current.onFocus()} onPointerEnter={() => { if (settings.focusFollowsMouse && visible) callbacks.current.onFocus(); }}>
    {showHeader && <div className="pane-header"><span><TerminalSquare size={13} /> {pane.title && settings.preferGeneratedTitles ? pane.title : pane.label}</span><div>
      <button className="icon-button" title="Search terminal" aria-label="Search terminal" onClick={() => setSearchOpen(true)}><Search size={13} /></button>
      <button className="icon-button" title="Maximize pane" aria-label="Maximize pane" onClick={(event) => { event.stopPropagation(); onZoom(); }}><Maximize2 size={13} /></button>
      <button className="icon-button" title="Close pane" aria-label="Close pane" onClick={(event) => { event.stopPropagation(); onClose(); }}><X size={14} /></button>
    </div></div>}
    <div className="terminal-container" ref={container} style={{ padding: `${settings.paddingY ?? 12}px ${settings.paddingX ?? 18}px`, background: terminalOptions(settings).theme?.background }} />
    {searchOpen && <form className="terminal-search" role="search" aria-label="Find in terminal" onSubmit={(event) => { event.preventDefault(); search(); }} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
      if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); search(true); }
    }}>
      <Search size={14} /><input ref={searchInput} aria-label="Find terminal text" value={query} placeholder="Find in terminal…" onChange={(event) => setQuery(event.target.value)} />
      <span className="terminal-search-count" role="status">{searchError ? 'Invalid regex' : `${Math.max(0, searchResults.resultIndex + 1)}/${searchResults.resultCount}`}</span>
      <button type="button" className={`icon-button ${caseSensitive ? 'is-active' : ''}`} title="Match case" aria-label="Match case" aria-pressed={caseSensitive} onClick={() => setCaseSensitive(!caseSensitive)}><CaseSensitive size={15} /></button>
      <button type="button" className={`icon-button ${regex ? 'is-active' : ''}`} title="Regular expression" aria-label="Regular expression" aria-pressed={regex} onClick={() => setRegex(!regex)}><Regex size={15} /></button>
      <button type="button" className="icon-button" aria-label="Previous match" title="Previous match (Shift Enter)" onClick={() => search(true)}><ChevronUp size={15} /></button>
      <button type="submit" className="icon-button" aria-label="Next match" title="Next match (Enter)"><ChevronDown size={15} /></button>
      <button type="button" className="icon-button" aria-label="Close terminal search" onClick={closeSearch}><X size={14} /></button>
    </form>}
    {error && <div className="terminal-error" role="status"><AlertCircle size={14} /><span>{error}</span></div>}
    {!connected && !error && visible && <div className="terminal-loading">Connecting terminal…</div>}
    {menu && <div ref={menuElement} className="terminal-context-menu" role="menu" aria-label="Terminal actions" style={{ left: menu.x, top: menu.y, maxHeight: `calc(100vh - ${menu.y + 8}px)` }} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
      const buttons = [...(menuElement.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
      <button role="menuitem" disabled={!menu.selection} onClick={() => menuCommand('copy')}><Copy size={14} /> Copy <kbd>Ctrl Shift C</kbd></button>
      <button role="menuitem" onClick={() => menuCommand('paste')}>Paste <kbd>Ctrl Shift V</kbd></button>
      <button role="menuitem" onClick={() => menuCommand('select-all')}>Select all</button>
      <button role="menuitem" onClick={() => menuCommand('find')}><Search size={14} /> Find in terminal <kbd>Ctrl Shift F</kbd></button>
      <div role="separator" />
      <button role="menuitem" onClick={() => menuCommand('scroll-top')}><ArrowUp size={14} /> Scroll to top</button>
      <button role="menuitem" onClick={() => menuCommand('scroll-bottom')}><ArrowDown size={14} /> Scroll to bottom</button>
      <button role="menuitem" onClick={() => menuCommand('previous-prompt')}>Previous prompt</button>
      <button role="menuitem" onClick={() => menuCommand('next-prompt')}>Next prompt</button>
      <button role="menuitem" onClick={() => menuCommand('clear-terminal')}>Clear terminal and scrollback</button>
      <button role="menuitem" onClick={() => menuCommand('reset-terminal')}>Reset terminal…</button>
      <div role="separator" />
      <button role="menuitem" onClick={() => menuCommand('font-increase')}>Increase font size</button>
      <button role="menuitem" onClick={() => menuCommand('font-decrease')}>Decrease font size</button>
      <button role="menuitem" onClick={() => menuCommand('font-reset')}>Reset font size</button>
      <div role="separator" />
      <button role="menuitem" onClick={() => menuCommand('split-right')}>Split right</button>
      <button role="menuitem" onClick={() => menuCommand('split-below')}>Split below</button>
      <button role="menuitem" onClick={() => { setMenu(undefined); onZoom(); }}>Toggle pane zoom</button>
      <button role="menuitem" className="terminal-menu-danger" onClick={() => { setMenu(undefined); onClose(); }}>Close pane</button>
    </div>}
  </section>;
}
