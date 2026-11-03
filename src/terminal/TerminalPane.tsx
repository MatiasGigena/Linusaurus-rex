import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { AlertCircle, Maximize2, TerminalSquare, X } from 'lucide-react';
import type { RexPane, Settings, TerminalRef } from '../shared/types';
import '@xterm/xterm/css/xterm.css';

interface Props {
  pane: RexPane;
  terminalRef: TerminalRef;
  settings: Settings;
  focused: boolean;
  showHeader: boolean;
  onFocus(): void;
  onZoom(): void;
  onClose(): void;
}

export function TerminalPane({ pane, terminalRef, settings, focused, showHeader, onFocus, onZoom, onClose }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const callbacks = useRef({ onFocus });
  callbacks.current = { onFocus };
  const [error, setError] = useState<string>();
  const { hostId, sessionId, blockId } = terminalRef;

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let connected = false;
    let input = '';
    let inputTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingFrame: string | undefined;
    let writing = false;
    let sending = false;
    const subscriptionId = crypto.randomUUID();
    const ref = { hostId, sessionId, blockId };
    const term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 8000,
      allowProposedApi: false,
      theme: {
        background: '#353b41', foreground: '#c6cfd7', cursor: '#9bc5ab', selectionBackground: '#61757480',
        black: '#414951', red: '#d98282', green: '#87cba3', yellow: '#dfc17f', blue: '#81a9d5',
        magenta: '#b59bd2', cyan: '#7bc6ce', white: '#c9d3dc', brightBlack: '#76838e',
        brightRed: '#eda1a1', brightGreen: '#a3dfbc', brightYellow: '#f1d79b', brightBlue: '#a0c4ec',
        brightMagenta: '#ceb4eb', brightCyan: '#a0dde2', brightWhite: '#edf2f5',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container.current);
    terminal.current = term;
    const flushInput = async () => {
      if (disposed || sending || !connected || !input) return;
      const data = input;
      input = '';
      sending = true;
      try { await window.rex.request('input', { ...ref, data }); }
      catch (failure) {
        connected = false;
        input = '';
        if (!disposed) setError(String(failure instanceof Error ? failure.message : failure));
      } finally {
        sending = false;
        if (input && !disposed) inputTimer = setTimeout(() => void flushInput(), 8);
      }
    };
    const sendSize = () => {
      if (disposed) return;
      fit.fit();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!disposed) void window.rex.request('resize', { ...ref, cols: term.cols, rows: term.rows })
          .catch((failure: unknown) => { if (!disposed) setError(`Resize failed: ${String(failure)}`); });
      }, 180);
    };
    const drawFrame = () => {
      if (disposed || writing || pendingFrame === undefined) return;
      const data = pendingFrame;
      pendingFrame = undefined;
      const buffer = term.buffer.active;
      const atBottom = buffer.viewportY >= buffer.baseY;
      const previousScroll = buffer.viewportY;
      writing = true;
      term.reset();
      term.write(data, () => {
        writing = false;
        if (disposed) return;
        if (!atBottom) term.scrollToLine(previousScroll);
        drawFrame();
      });
    };
    const unsubscribe = window.rex.onTerminal((frame) => {
      if (frame.subscriptionId !== subscriptionId || disposed) return;
      if (frame.error) { connected = false; input = ''; setError(frame.error); return; }
      if (frame.data !== undefined) {
        connected = true;
        setError(undefined);
        pendingFrame = frame.data;
        drawFrame();
      }
    });
    const dataListener = term.onData((data) => {
      if (!connected || disposed) return;
      input += data;
      if (input.length > 1024 * 1024) { input = ''; setError('Paste is too large (maximum 1 MiB).'); return; }
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => void flushInput(), 8);
    });
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
        if (term.hasSelection()) void window.rex.writeClipboard(term.getSelection()).catch(() => setError('Could not copy the selection.'));
        return false;
      }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyV') {
        void window.rex.readClipboard().then((text) => { if (!disposed && connected) term.paste(text); })
          .catch(() => setError('Clipboard access failed. Use your desktop paste shortcut.'));
        return false;
      }
      if (event.ctrlKey && event.shiftKey && ['KeyP', 'KeyN', 'KeyT', 'KeyW', 'KeyB', 'KeyD', 'Comma', 'Enter'].includes(event.code)) return false;
      return true;
    });
    const observer = new ResizeObserver(sendSize);
    observer.observe(container.current);
    sendSize();
    void window.rex.request('subscribe', { ...ref, subscriptionId }).catch((failure: unknown) => {
      if (!disposed) setError(String(failure instanceof Error ? failure.message : failure));
    });
    const unsubscribeCommands = window.rex.onCommand((command) => {
      if (!container.current?.contains(document.activeElement)) return;
      if (command === 'copy' && term.hasSelection()) void window.rex.writeClipboard(term.getSelection()).catch(() => setError('Could not copy the selection.'));
      if (command === 'paste') void window.rex.readClipboard().then((text) => { if (!disposed && connected) term.paste(text); }).catch(() => setError('Could not read the clipboard.'));
    });
    return () => {
      disposed = true;
      connected = false;
      input = '';
      clearTimeout(inputTimer);
      clearTimeout(resizeTimer);
      observer.disconnect();
      unsubscribe();
      unsubscribeCommands();
      dataListener.dispose();
      void window.rex.request('unsubscribe', { subscriptionId }).catch(() => {});
      terminal.current = null;
      term.dispose();
    };
  }, [hostId, sessionId, blockId, settings.fontSize, settings.fontFamily]);

  useEffect(() => { if (focused) terminal.current?.focus(); }, [focused]);

  return <section className={`terminal-pane ${focused ? 'is-focused' : ''}`} aria-label={`${pane.label} terminal`} onPointerDown={() => callbacks.current.onFocus()}>
    {showHeader && <div className="pane-header"><span><TerminalSquare size={13} /> {pane.label}</span><div>
      <button className="icon-button" title="Maximize pane" aria-label="Maximize pane" onClick={(event) => { event.stopPropagation(); onZoom(); }}><Maximize2 size={13} /></button>
      <button className="icon-button" title="Close pane" aria-label="Close pane" onClick={(event) => { event.stopPropagation(); onClose(); }}><X size={14} /></button>
    </div></div>}
    <div className="terminal-container" ref={container} />
    {error && <div className="terminal-error" role="status"><AlertCircle size={14} /><span>{error}</span></div>}
  </section>;
}
