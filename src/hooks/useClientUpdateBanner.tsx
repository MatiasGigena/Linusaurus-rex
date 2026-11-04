import { useEffect, useState } from "react";
import type { UpdateState } from "../shared/types";

/** Discover updates during bootstrap, with later native events owning the offer. */
export function useClientUpdateBanner(onReview: () => void) {
  const [update, setUpdate] = useState<UpdateState>();
  useEffect(() => {
    if (!window.rex) return;
    let active = true;
    let receivedUpdate = false;
    const unsubscribe = window.rex.onClientEvent((event) => {
      if (active && event.type === "update") {
        receivedUpdate = true;
        setUpdate(event.state);
      }
    });
    void window.rex
      .request("updateStatus", {})
      .then((initial) => {
        if (active && !receivedUpdate) setUpdate(initial);
      })
      .catch(() => {
        // Initial discovery is optional; later native events can populate it.
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  if (!update || !["available", "ready", "scheduled"].includes(update.phase))
    return null;
  return (
    <div className="client-update-banner">
      <span>
        Linusaurus Rex {update.version}{" "}
        {update.phase === "scheduled"
          ? "will install when idle"
          : update.phase === "ready"
            ? "is ready to install"
            : "is available"}
        .
      </span>
      <button onClick={onReview}>Review update</button>
    </div>
  );
}
