import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { ContextItem } from "../components/ContextMenu";
import type { Host } from "../shared/types";
import { sessionMenuItems, tabMenuItems } from "../workspace/contextMenus";

interface WorkspaceMenuInputs {
  getHosts(): readonly Pick<Host, "id" | "endpoint">[] | undefined;
  collapsedSessions: Set<string>;
  toggleCollapse(sessionId: string): void;
  dispatch(name: string, args?: Record<string, unknown>): void;
}
interface Menu {
  x: number;
  y: number;
  hostId: string;
  endpoint?: string;
  items: (ContextItem | null)[];
}

/** Session/tab menus retain the server identity from when their intent was opened. */
export function useWorkspaceMenus(inputs: WorkspaceMenuInputs) {
  const [menu, setMenu] = useState<Menu>();
  const latest = useRef(inputs);
  latest.current = inputs;
  const closeMenu = () => setMenu(undefined);
  const hosts = inputs.getHosts();
  useEffect(() => {
    if (
      menu &&
      !hosts?.some(
        (host) => host.id === menu.hostId && host.endpoint === menu.endpoint,
      )
    )
      setMenu(undefined);
  }, [menu, hosts]);

  const menuDispatch =
    (hostId: string, endpoint: string | undefined) =>
    (name: string, args?: Record<string, unknown>) => {
      // A settings event changes the live host before React can hide this menu.
      if (
        !latest.current
          .getHosts()
          ?.some((host) => host.id === hostId && host.endpoint === endpoint)
      ) {
        closeMenu();
        return;
      }
      latest.current.dispatch(name, args);
    };
  const openSessionMenu = (
    event: MouseEvent,
    hostId: string,
    sessionId: string,
  ) => {
    const endpoint = latest.current
      .getHosts()
      ?.find((host) => host.id === hostId)?.endpoint;
    setMenu({
      x: event.clientX,
      y: event.clientY,
      hostId,
      endpoint,
      items: sessionMenuItems({
        hostId,
        sessionId,
        collapsedSessions: inputs.collapsedSessions,
        toggleCollapse: inputs.toggleCollapse,
        dispatch: menuDispatch(hostId, endpoint),
      }),
    });
  };
  const openTabMenu = (
    event: MouseEvent,
    hostId: string,
    sessionId: string,
    windowId: string,
  ) => {
    const endpoint = latest.current
      .getHosts()
      ?.find((host) => host.id === hostId)?.endpoint;
    setMenu({
      x: event.clientX,
      y: event.clientY,
      hostId,
      endpoint,
      items: tabMenuItems({
        hostId,
        sessionId,
        windowId,
        dispatch: menuDispatch(hostId, endpoint),
      }),
    });
  };
  return { menu, closeMenu, openSessionMenu, openTabMenu };
}
