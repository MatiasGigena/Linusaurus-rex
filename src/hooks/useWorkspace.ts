import {
  activeSessionSelection,
  SupersededSessionInspectionError,
  WorkspaceReconciliationError,
  type SessionMutationPlan,
  type WorkspaceOperations,
} from "../core/workspaceOperations";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientEvent,
  Host,
  KeymapResult,
  RexBridge,
  Selection,
  SessionView,
  Settings,
  TerminalRef,
} from "../shared/types";
import { errorMessage, paneKey, viewKey } from "../core/workspace";
import {
  type HostState,
  type HostSnapshot,
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
  const inFlight = useRef<Promise<HostSnapshot[]> | undefined>(undefined);
  const refreshQueued = useRef(false);
  const viewEpoch = useRef(0);
  const inspectionGeneration = useRef(0);
  const inspectionSequences = useRef(new Map<string, number>());
  const mounted = useRef(true);
  const configured = useRef(new Map<string, string>());
  const delayedRefresh = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const reloadSession = useCallback(
    async (hostId: string, sessionId: string) => {
      if (!mounted.current)
        throw new Error(
          "The workspace closed before the session could be refreshed.",
        );
      const configuration = settingsRef.current?.hosts.find(
        (host) => host.id === hostId,
      );
      if (!configuration)
        throw new Error("The selected host is no longer configured.");
      // An older full snapshot must not publish while this newer read is pending.
      // Direct reads still use per-session sequences rather than this epoch.
      viewEpoch.current++;
      const key = viewKey(hostId, sessionId);
      const sequence = (inspectionSequences.current.get(key) || 0) + 1;
      inspectionSequences.current.set(key, sequence);
      const generation = inspectionGeneration.current;
      const isCurrentInspection = () =>
        mounted.current &&
        inspectionSequences.current.get(key) === sequence &&
        inspectionGeneration.current === generation &&
        settingsRef.current?.hosts.some(
          (host) =>
            host.id === hostId && host.endpoint === configuration.endpoint,
        );
      let view: SessionView;
      try {
        view = await window.rex.request("inspectSession", {
          hostId,
          sessionId,
        });
      } catch (failure) {
        if (!isCurrentInspection())
          throw new SupersededSessionInspectionError(failure);
        viewEpoch.current++;
        setHosts((previous) => {
          const existing = previous.find((host) => host.id === hostId);
          const failed = {
            ...(existing || configuration),
            connected: false,
            error: errorMessage(failure),
            sessions: existing?.sessions || [],
          };
          return existing
            ? previous.map((host) => (host.id === hostId ? failed : host))
            : [...previous, failed];
        });
        throw failure;
      }
      if (!isCurrentInspection()) throw new SupersededSessionInspectionError();
      viewEpoch.current++;
      setHosts((previous) => {
        const existing = previous.find((host) => host.id === hostId);
        const host = existing || configuration;
        if (!host) return previous;
        const sessions = existing?.sessions || [];
        const summary = { id: view.id, label: view.label };
        const next = {
          ...host,
          connected: true,
          error: undefined,
          sessions: sessions.some((session) => session.id === view.id)
            ? sessions.map((session) =>
                session.id === view.id ? summary : session,
              )
            : [...sessions, summary],
        };
        return existing
          ? previous.map((item) => (item.id === hostId ? next : item))
          : [...previous, next];
      });
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
      return view;
    },
    [],
  );
  const refreshSnapshot = useCallback(async (): Promise<
    HostSnapshot[] | undefined
  > => {
    if (!mounted.current) return;
    const config = settingsRef.current;
    if (!config) return;
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
      inspectionGeneration.current++;
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
      return snapshots;
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
      throw failure;
    }
  }, []);
  const refreshHosts = useCallback((): Promise<HostSnapshot[]> => {
    if (!mounted.current || !settingsRef.current) return Promise.resolve([]);
    if (inFlight.current) {
      refreshQueued.current = true;
      return inFlight.current;
    }
    const work = (async () => {
      let snapshots: HostSnapshot[] = [];
      do {
        refreshQueued.current = false;
        const next = await refreshSnapshot();
        if (next) snapshots = next;
      } while (mounted.current && refreshQueued.current);
      return snapshots;
    })();
    inFlight.current = work;
    const finish = () => {
      if (inFlight.current === work) inFlight.current = undefined;
      if (mounted.current) setLoading(false);
    };
    void work.then(finish, finish);
    return work;
  }, [refreshSnapshot]);
  const refresh = useCallback(async (): Promise<void> => {
    await refreshHosts();
  }, [refreshHosts]);
  const refreshInBackground = useCallback(() => {
    // Per-host failures are published in snapshots; unexpected failures are
    // already recorded by refreshSnapshot and must not become unhandled rejections.
    void refresh().catch(() => {});
  }, [refresh]);
  const scheduleRefresh = useCallback(() => {
    clearTimeout(delayedRefresh.current);
    delayedRefresh.current = setTimeout(refreshInBackground, 80);
  }, [refreshInBackground]);
  const saveSettings = useCallback(async (next: Settings) => {
    const saved = await window.rex.setSettings(next);
    if (mounted.current) {
      if (
        JSON.stringify(settingsRef.current?.hosts) !==
        JSON.stringify(saved.hosts)
      ) {
        viewEpoch.current++;
        inspectionGeneration.current++;
      }
      settingsRef.current = saved;
      setSettings(saved);
    }
    return saved;
  }, []);
  const pendingMutations = useRef(0);
  const completeMutation = useCallback(
    async <T, R>(
      action: () => Promise<T>,
      reconcile: (result: T) => Promise<R>,
    ): Promise<{ result: T; reconciled: R }> => {
      pendingMutations.current++;
      setBusy(true);
      setError(undefined);
      viewEpoch.current++;
      let applied = false;
      try {
        const result = await action();
        applied = true;
        viewEpoch.current++;
        if (!mounted.current)
          throw new Error(
            "The workspace closed before the change could be refreshed.",
          );
        return { result, reconciled: await reconcile(result) };
      } catch (failure) {
        const reported = applied
          ? new WorkspaceReconciliationError(failure)
          : failure;
        if (mounted.current) {
          setError(errorMessage(reported));
          scheduleRefresh();
        }
        throw reported;
      } finally {
        pendingMutations.current--;
        if (mounted.current) setBusy(pendingMutations.current > 0);
      }
    },
    [scheduleRefresh],
  );
  const requireCurrentHost = useCallback((host: Host | undefined) => {
    if (!mounted.current)
      throw new Error(
        "The workspace closed before the change could be refreshed.",
      );
    if (
      !host ||
      !settingsRef.current?.hosts.some(
        (current) =>
          current.id === host.id && current.endpoint === host.endpoint,
      )
    )
      throw new Error(
        "The host configuration changed before the change could be refreshed.",
      );
  }, []);
  const run = useCallback(
    async <T>(hostId: string, action: () => Promise<T>): Promise<T> => {
      const host = settingsRef.current?.hosts.find(
        (host) => host.id === hostId,
      );
      requireCurrentHost(host);
      // A general host mutation has no narrower session target. Preserve its
      // workspace-wide read barrier until the converging snapshot is published.
      inspectionGeneration.current++;
      const completed = await completeMutation(action, async () => {
        inspectionGeneration.current++;
        requireCurrentHost(host);
        const snapshots = await refreshHosts();
        requireCurrentHost(host);
        const target = snapshots.find(
          (snapshot) => snapshot.host.id === hostId,
        );
        if (!target)
          throw new Error("The changed host could not be refreshed.");
        if ("failure" in target) throw target.failure;
        if (!target.host.connected)
          throw new Error(
            target.host.error || "The changed host is disconnected.",
          );
      });
      return completed.result;
    },
    [completeMutation, refreshHosts, requireCurrentHost],
  );
  const mutateSession = useCallback(
    async <T>(
      plan: SessionMutationPlan<T>,
      action: () => Promise<T>,
    ): Promise<{ result: T; view: SessionView }> => {
      const host = settingsRef.current?.hosts.find(
        (host) => host.id === plan.hostId,
      );
      requireCurrentHost(host);
      // Targeted writes supersede reads of this session, not unrelated sessions.
      // The post-write reload advances the same sequence again before reading.
      // Newly created sessions are identified by the result callback only then.
      if (typeof plan.sessionId === "string") {
        const key = viewKey(plan.hostId, plan.sessionId);
        inspectionSequences.current.set(
          key,
          (inspectionSequences.current.get(key) || 0) + 1,
        );
      }
      const completed = await completeMutation(action, async (result) => {
        requireCurrentHost(host);
        const sessionId =
          typeof plan.sessionId === "function"
            ? plan.sessionId(result)
            : plan.sessionId;
        let view: SessionView;
        try {
          view = await reloadSession(plan.hostId, sessionId);
        } catch (failure) {
          requireCurrentHost(host);
          throw failure;
        }
        requireCurrentHost(host);
        if (plan.selectActive) {
          const next = activeSessionSelection(plan.hostId, view);
          selectionRef.current = next;
          setSelection(next);
          setFocusedPane(
            view.windows.find((window) => window.id === next.windowId)
              ?.focusedBlockId,
          );
        }
        return view;
      });
      return { result: completed.result, view: completed.reconciled };
    },
    [completeMutation, reloadSession, requireCurrentHost],
  );
  const focusPane = useCallback(
    async (target: TerminalRef): Promise<void> => {
      setFocusedPane(target.blockId);
      await mutateSession(
        { hostId: target.hostId, sessionId: target.sessionId },
        () => window.rex.request("focus", target),
      );
    },
    [mutateSession],
  );
  const select = useCallback(
    (
      hostId: string,
      sessionId: string,
      windowId?: string,
      blockId?: string,
    ) => {
      setFocusedPane(blockId);
      const previous = selectionRef.current;
      const requested: Selection = {
        hostId,
        sessionId,
        windowId:
          windowId ||
          (previous?.hostId === hostId && previous.sessionId === sessionId
            ? previous.windowId
            : ""),
      };
      selectionRef.current = requested;
      setSelection(requested);
      if (sessionId && !windowId)
        void reloadSession(hostId, sessionId)
          .then((view) =>
            setSelection((current) =>
              current === requested
                ? {
                    hostId,
                    sessionId,
                    windowId: view.activeWindowId || view.windows[0]?.id || "",
                  }
                : current,
            ),
          )
          .catch((failure) => {
            if (
              mounted.current &&
              !(failure instanceof SupersededSessionInspectionError)
            )
              setError(errorMessage(failure));
          });
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
        refreshInBackground();
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
          inspectionGeneration.current++;
          scheduleRefresh();
        }
      } else if (event.type === "status") {
        if (!event.connected) configured.current.delete(event.hostId);
        scheduleRefresh();
      }
    });
    const timer = setInterval(() => {
      if (!document.hidden) refreshInBackground();
    }, 5000);
    return () => {
      mounted.current = false;
      viewEpoch.current++;
      inspectionGeneration.current++;
      clearInterval(timer);
      clearTimeout(delayedRefresh.current);
      unsubscribe();
    };
  }, [refreshInBackground, scheduleRefresh, select]);
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
  const operations: WorkspaceOperations = {
    run,
    mutateSession,
    refresh,
    getSettings: () => settingsRef.current,
    saveSettings,
    select,
    focusPane,
    dismissNotices: () => setNotices([]),
  };
  return {
    operations,
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
