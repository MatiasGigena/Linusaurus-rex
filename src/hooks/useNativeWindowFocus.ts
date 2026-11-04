import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../core/workspace";
import type { Host, Selection } from "../shared/types";

interface NativeWindowFocusInputs {
  getSelection(): Readonly<Selection> | undefined;
  getHosts(): readonly Pick<Host, "id" | "endpoint">[] | undefined;
  onError(message: string): void;
}

/** Owns native focus state and server-focus feedback for this window's live intent. */
export function useNativeWindowFocus(inputs: NativeWindowFocusInputs) {
  const [nativeFocused, setNativeFocused] = useState(() => document.hasFocus());
  const latest = useRef(inputs);
  latest.current = inputs;
  const selection = inputs.getSelection();
  useEffect(() => {
    if (!selection?.windowId) return;
    let current = true;
    const hostId = selection.hostId;
    const endpoint = latest.current
      .getHosts()
      ?.find((host) => host.id === hostId)?.endpoint;
    void window.rex.request("focusWindow", selection).catch((failure) => {
      const currentSelection = latest.current.getSelection();
      if (
        current &&
        currentSelection?.hostId === selection.hostId &&
        currentSelection.sessionId === selection.sessionId &&
        currentSelection.windowId === selection.windowId &&
        latest.current
          .getHosts()
          ?.some((host) => host.id === hostId && host.endpoint === endpoint)
      )
        latest.current.onError(errorMessage(failure));
    });
    return () => {
      current = false;
    };
  }, [selection?.hostId, selection?.sessionId, selection?.windowId]);
  useEffect(() => {
    const focus = () => setNativeFocused(true);
    const blur = () => setNativeFocused(false);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return nativeFocused;
}
