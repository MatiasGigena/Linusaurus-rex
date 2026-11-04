import type { Selection } from "../src/shared/types.js";
import { identifier, record, string } from "./validation.js";

/** The same selection snapshot is persisted and received from renderer windows. */
export function parseSelection(value: unknown): Selection {
  const selection = record(value);
  const result: Selection = {
    hostId: identifier(selection.hostId, "selected host"),
    sessionId: string(selection.sessionId, "selected session", 256),
    windowId: string(selection.windowId, "selected tab", 256),
    ...(selection.blockId === undefined
      ? {}
      : { blockId: identifier(selection.blockId, "selected pane") }),
  };
  if (!result.sessionId && (result.windowId || result.blockId))
    throw new Error("An empty host selection cannot contain a tab or pane.");
  return result;
}
