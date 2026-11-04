import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientEvent,
  KeymapResult,
  RexBridge,
  Selection,
  SessionView,
  Settings,
} from "../shared/types";
import { errorMessage, paneKey, viewKey } from "../core/workspace";
import {
  type HostState,
  type PaneMetadata,
  collectHostSnapshot,
  reconcileSelection,
} from "../core/workspaceSnapshot";

export function useWorkspace() {
  const [settings, setSettings] = useState<Settings>();
  const [hosts, setHosts] = useState<HostState[]>([]);
  const [views, setViews] = useState<Record<string, SessionView>>({});
  const [selection, setSelection] = useState<Selection>();
  const [focusedPane, setFocusedPane] = useState<string>();
  const [metadata, setMetadata] = useState<Record<string, PaneMetadata>>({});
  const [keymaps, setKeymaps] = useState<Record<string, KeymapResult>>({});
  const [keyHints, setKeyHints] =
    useState<Extract<ClientEvent, { type: "keys" }>>();
  const [notices, setNotices] = useState<
    Extract<ClientEvent, { type: "notification" }>[]
  >([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const actionHandler = useRef<
    (
      name: string,
      args: Record<string, unknown>,
      event?: ClientEvent,
    ) => Promise<unknown>
  >(async () => {});
  const inFlight = useRef(false);
  const refreshQueued = useRef(false);
  const viewEpoch = useRef(0);
  const mounted = useRef(true);
  const configured = useRef(new Map<string, string>());
  const delayedRefresh = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const reloadSession = useCallback(
    async (hostId: string, sessionId: string) => {
      const view = await window.rex.request("inspectSession", {
        hostId,
        sessionId,
      });
      viewEpoch.current++;
      if (mounted.current) {
        setViews((previous) => ({
          ...previous,
          [viewKey(hostId, sessionId)]: view,
        }));
        const current = selectionRef.current;
        if (current?.hostId === hostId && current.sessionId === sessionId)
          setFocusedPane(
            view.windows.find((window) => window.id === current.windowId)
              ?.focusedBlockId,
          );
      }
      return view;
    },
    [],
  );
  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const config = settingsRef.current;
    if (!config) return;
    if (inFlight.current) {
      refreshQueued.current = true;
      return;
    }
    inFlight.current = true;
    const startingEpoch = viewEpoch.current;
    const request: RexBridge["request"] = (method, args) => {
      if (!mounted.current || startingEpoch !== viewEpoch.current)
        return Promise.reject(new Error("Workspace refresh was superseded."));
      return window.rex.request(method, args);
    };
    try {
      const snapshots = await Promise.all(
        config.hosts.map((host) => collectHostSnapshot(host, request)),
      );
      const nextHosts = snapshots.map((snapshot) => snapshot.host);
      const allViews = Object.assign(
        {},
        ...snapshots.map((snapshot) => snapshot.views),
      ) as Record<string, SessionView>;
      if (!mounted.current) return;
      if (startingEpoch !== viewEpoch.current) {
        refreshQueued.current = true;
        return;
      }
      for (const host of nextHosts) {
        if (!host.connected) {
          configured.current.delete(host.id);
          continue;
        }
        if (configured.current.get(host.id) === host.endpoint) continue;
        configured.current.set(host.id, host.endpoint);
        void window.rex
          .request("keymap", { hostId: host.id })
          .then((keymap) => {
            if (
              !mounted.current ||
              !settingsRef.current?.hosts.some(
                (current) =>
                  current.id === host.id && current.endpoint === host.endpoint,
              )
            ) {
              if (configured.current.get(host.id) === host.endpoint)
                configured.current.delete(host.id);
              return;
            }
            setKeymaps((previous) => ({ ...previous, [host.id]: keymap }));
          })
          .catch(() => {
            if (configured.current.get(host.id) === host.endpoint)
              configured.current.delete(host.id);
          });
      }
      setHosts(nextHosts);
      setViews((previous) => {
        const next = { ...allViews };
        for (const host of nextHosts)
          if (!host.connected)
            for (const [key, view] of Object.entries(previous))
              if (key.startsWith(`${host.id}/`)) next[key] = view;
        return next;
      });
      const reconciled = reconcileSelection(
        selectionRef.current,
        nextHosts,
        allViews,
      );
      setSelection(reconciled.selection);
      if (reconciled.updateFocus) setFocusedPane(reconciled.focusedPane);
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setLoading(false);
        if (refreshQueued.current) {
          refreshQueued.current = false;
          setTimeout(() => void refresh(), 0);
        }
      }
    }
  }, []);
  const scheduleRefresh = useCallback(() => {
    clearTimeout(delayedRefresh.current);
    delayedRefresh.current = setTimeout(() => void refresh(), 80);
  }, [refresh]);
  const saveSettings = useCallback(async (next: Settings) => {
    const saved = await window.rex.setSettings(next);
    if (mounted.current) {
      if (
        JSON.stringify(settingsRef.current?.hosts) !==
        JSON.stringify(saved.hosts)
      )
        viewEpoch.current++;
      settingsRef.current = saved;
      setSettings(saved);
    }
    return saved;
  }, []);
  const run = useCallback(
    async <T>(action: () => Promise<T>): Promise<T> => {
      setBusy(true);
      setError(undefined);
      viewEpoch.current++;
      try {
        const result = await action();
        await refresh();
        return result;
      } catch (failure) {
        setError(errorMessage(failure));
        throw failure;
      } finally {
        viewEpoch.current++;
        if (mounted.current) {
          setBusy(false);
          scheduleRefresh();
        }
      }
    },
    [refresh, scheduleRefresh],
  );
  const select = useCallback(
    (
      hostId: string,
      sessionId: string,
      windowId?: string,
      blockId?: string,
    ) => {
      setFocusedPane(blockId);
      setSelection((previous) => ({
        hostId,
        sessionId,
        windowId:
          windowId ||
          (previous?.sessionId === sessionId ? previous.windowId : ""),
      }));
      if (sessionId && !windowId)
        void reloadSession(hostId, sessionId)
          .then((view) =>
            setSelection((current) =>
              current?.hostId === hostId && current.sessionId === sessionId
                ? {
                    hostId,
                    sessionId,
                    windowId: view.activeWindowId || view.windows[0]?.id || "",
                  }
                : current,
            ),
          )
          .catch((failure) => setError(errorMessage(failure)));
    },
    [reloadSession],
  );

  useEffect(() => {
    mounted.current = true;
    if (!window.rex) {
      setError("Open this client as a desktop application.");
      setLoading(false);
      return;
    }
    void window.rex
      .getSettings()
      .then((saved) => {
        if (!mounted.current) return;
        settingsRef.current = saved;
        setSettings(saved);
        selectionRef.current = saved.lastSelection;
        setSelection(saved.lastSelection);
        setFocusedPane(saved.lastSelection?.blockId);
        void refresh();
      })
      .catch((failure) => {
        setError(errorMessage(failure));
        setLoading(false);
      });
    const unsubscribe = window.rex.onClientEvent((event) => {
      if (event.type === "action") {
        void actionHandler
          .current(event.name, event.args, event)
          .then((result) => window.rex.replyAction(event.requestId, result))
          .catch((failure) =>
            window.rex.replyAction(
              event.requestId,
              undefined,
              errorMessage(failure),
            ),
          );
      } else if (event.type === "activity") {
        setMetadata((previous) => ({
          ...previous,
          [paneKey(event.hostId, event.sessionId, event.blockId)]: {
            ...previous[paneKey(event.hostId, event.sessionId, event.blockId)],
            activities: event.activities,
            ...(event.title !== undefined ? { title: event.title } : {}),
            ...(event.program !== undefined ? { program: event.program } : {}),
            ...(event.cwd !== undefined ? { cwd: event.cwd } : {}),
          },
        }));
      } else if (event.type === "select")
        select(event.hostId, event.sessionId, event.windowId, event.blockId);
      else if (event.type === "notification")
        setNotices((previous) => [...previous.slice(-4), event]);
      else if (event.type === "layout") scheduleRefresh();
      else if (event.type === "keys") setKeyHints(event);
      else if (event.type === "keymap")
        setKeymaps((previous) => ({
          ...previous,
          [event.hostId]: event.keymap,
        }));
      else if (event.type === "settings") {
        const changed =
          JSON.stringify(settingsRef.current?.hosts) !==
          JSON.stringify(event.settings.hosts);
        settingsRef.current = event.settings;
        setSettings(event.settings);
        if (changed) {
          viewEpoch.current++;
          scheduleRefresh();
        }
      } else if (event.type === "status") {
        if (!event.connected) configured.current.delete(event.hostId);
        scheduleRefresh();
      }
    });
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => {
      mounted.current = false;
      viewEpoch.current++;
      clearInterval(timer);
      clearTimeout(delayedRefresh.current);
      unsubscribe();
    };
  }, [refresh, scheduleRefresh, select]);
  useEffect(() => {
    if (!selection || !settingsRef.current) return;
    const timer = setTimeout(() => {
      if (settingsRef.current)
        void saveSettings({
          ...settingsRef.current,
          lastSelection: selection,
        }).catch((failure) => setError(errorMessage(failure)));
    }, 400);
    return () => clearTimeout(timer);
  }, [selection, saveSettings]);
  useEffect(() => {
    if (!window.rex) return;
    void window.rex
      .request("setContext", {
        selection: selection ? { ...selection, blockId: focusedPane } : null,
        visible: !document.hidden,
      })
      .catch(() => {});
    const visibility = () =>
      void window.rex
        .request("setContext", {
          selection: selection ? { ...selection, blockId: focusedPane } : null,
          visible: !document.hidden,
        })
        .catch(() => {});
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [selection, focusedPane]);
  useEffect(() => {
    if (!notices.length) return;
    const timer = setTimeout(
      () => setNotices((previous) => previous.slice(1)),
      8000,
    );
    return () => clearTimeout(timer);
  }, [notices]);
  return {
    settings,
    hosts,
    views,
    selection,
    focusedPane,
    metadata,
    keymaps,
    keyHints,
    notices,
    error,
    busy,
    loading,
    settingsRef,
    actionHandler,
    setError,
    setFocusedPane,
    setSelection,
    setNotices,
    saveSettings,
    refresh,
    reloadSession,
    run,
    select,
  };
}
