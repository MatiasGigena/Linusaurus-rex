import type {
  LayoutActionArgs,
  KeyModeOperation,
  PathPickerArgs,
  RendererContext,
  RexKeyEvent,
} from "../src/shared/types.js";
import { identifier, string, record, integer } from "./validation.js";
import { parseSelection } from "./selection.js";

export function parseKeyMode(args: Record<string, unknown>): KeyModeOperation {
  if (args.operation === "enter")
    return { operation: "enter", name: identifier(args.name, "mode name") };
  if (args.operation === "exit" || args.operation === "exitAll") {
    if (args.name !== undefined)
      throw new Error("Exiting a key mode cannot specify a mode name.");
    return { operation: args.operation };
  }
  throw new Error("Invalid key mode operation");
}

/** Validate the same operation-dependent requirements exposed by the preload types. */
export function parseLayoutAction(
  args: Record<string, unknown>,
): LayoutActionArgs {
  const operation = identifier(args.operation, "layout operation");
  if (operation === "moveToTab") {
    if (args.layerId !== undefined)
      throw new Error("Moving to a tab cannot specify a floating layer.");
    return {
      operation,
      targetWindowId: identifier(args.targetWindowId, "destination tab"),
    };
  }
  if (operation === "minimize" || operation === "restore") {
    if (args.targetWindowId !== undefined)
      throw new Error(
        "Floating layer operations cannot specify a destination tab.",
      );
    return { operation, layerId: identifier(args.layerId, "floating pane ID") };
  }
  if (!["float", "balance", "moveToNewTab"].includes(operation))
    throw new Error("Unsupported layout operation.");
  if (args.layerId !== undefined || args.targetWindowId !== undefined)
    throw new Error(
      "This layout operation does not accept a layer or destination tab.",
    );
  return { operation: operation as "float" | "balance" | "moveToNewTab" };
}

export function parsePathPicker(args: Record<string, unknown>): PathPickerArgs {
  if (args.save !== undefined && typeof args.save !== "boolean")
    throw new Error("Invalid save operation.");
  const defaultPath =
    args.defaultPath === undefined
      ? undefined
      : string(args.defaultPath, "default path");
  if (args.save === true) {
    if (args.directory !== undefined)
      throw new Error("Saving content cannot select a directory.");
    return {
      save: true,
      defaultPath,
      ...(args.content === undefined
        ? {}
        : {
            content: string(
              args.content,
              "export content",
              32 * 1024 * 1024,
              true,
            ),
          }),
    };
  }
  if (args.content !== undefined)
    throw new Error("Export content requires a save operation.");
  if (args.directory !== undefined && typeof args.directory !== "boolean")
    throw new Error("Invalid directory selection.");
  return { save: false, directory: args.directory, defaultPath };
}

export function updateRendererContext(
  previous: RendererContext,
  args: Record<string, unknown>,
): RendererContext {
  const next = { ...previous };
  for (const key of ["visible", "uiBusy"] as const) {
    if (args[key] === undefined) continue;
    if (typeof args[key] !== "boolean")
      throw new Error(`Invalid renderer ${key}.`);
    next[key] = args[key];
  }
  if (args.selection === null) next.selection = null;
  else if (args.selection !== undefined) {
    next.selection = parseSelection(args.selection);
  }
  return next;
}

export function parseKeyEvent(value: unknown): RexKeyEvent {
  const event = record(value);
  const key = identifier(event.key, "physical key");
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(key))
    throw new Error("Invalid physical key");
  const action = event.action;
  if (action !== "press" && action !== "release" && action !== "repeat")
    throw new Error("Invalid key action");
  if (typeof event.composing !== "boolean")
    throw new Error("Invalid composing state");
  const mods = string(event.mods, "modifiers", 160),
    consumed = string(event.consumed_mods, "consumed modifiers", 160);
  if (
    !/^(?:[a-z_]+(?:\+[a-z_]+)*)?$/.test(mods) ||
    !/^(?:[a-z_]+(?:\+[a-z_]+)*)?$/.test(consumed)
  )
    throw new Error("Invalid keyboard modifiers");
  return {
    key,
    mods,
    consumed_mods: consumed,
    text: string(event.text, "key text", 65536, true),
    unshifted_codepoint: integer(
      event.unshifted_codepoint,
      "unshifted codepoint",
      0,
      0x10ffff,
    ),
    composing: event.composing,
    action,
  };
}
export function parsePointerEvent(
  kind: "mouse" | "wheel",
  value: unknown,
): Record<string, unknown> {
  const event = record(value);
  const result: Record<string, unknown> = {
    x: integer(event.x, "pointer column", 0, 65535),
    y: integer(event.y, "pointer row", 0, 65535),
  };
  if (kind === "mouse") {
    if (
      event.action !== "press" &&
      event.action !== "motion" &&
      event.action !== "release"
    )
      throw new Error("Invalid pointer action");
    result.action = event.action;
    if (event.button !== undefined) {
      if (
        event.button !== "left" &&
        event.button !== "middle" &&
        event.button !== "right"
      )
        throw new Error("Invalid pointer button");
      result.button = event.button;
    }
    result.mods = string(event.mods, "pointer modifiers", 80);
  } else {
    for (const axis of ["delta_x", "delta_y"]) {
      const value = event[axis];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > 1000
      )
        throw new Error("Invalid wheel delta");
      result[axis] = value;
    }
  }
  return result;
}
