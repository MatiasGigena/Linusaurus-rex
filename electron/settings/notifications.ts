import {
  DEFAULT_SETTINGS,
  type NotificationSettings,
} from "../../src/shared/types.js";
import { record } from "../validation.js";

const kinds = ["working", "blocked", "error", "done"] as const;
const channelFlags = ["tabs", "desktop", "badge", "sound"] as const;
const flags = [
  "enabled",
  "desktopEnabled",
  "showInTabs",
  "working",
  "blocked",
  "error",
  "done",
  "programMessages",
  "sound",
  "badge",
  "includeIdle",
  "eachProcess",
  "tailscaleLogin",
  "tailscaleApproval",
  "tailscaleError",
] as const;
const positions = [
  "top-right",
  "top-left",
  "bottom-right",
  "bottom-left",
  "top-center",
  "bottom-center",
] as const;

function applyChannels(
  input: Record<string, unknown>,
  result: NotificationSettings,
) {
  if (input.channels === undefined) {
    // Version 0.1 state flags governed desktop notices only. Preserve those choices
    // while enabling the later independent tab and badge channels.
    for (const kind of kinds)
      if (typeof input[kind] === "boolean") {
        result.channels[kind].desktop = input[kind];
        result[kind] = true;
      }
    return;
  }
  const channels = record(input.channels);
  for (const kind of kinds) {
    if (channels[kind] === undefined) continue;
    const channel = record(channels[kind]);
    for (const flag of channelFlags) {
      if (channel[flag] === undefined) continue;
      if (typeof channel[flag] !== "boolean")
        throw new Error(`Invalid ${kind} notification ${flag}`);
      result.channels[kind][flag] = channel[flag];
    }
  }
}

export function validateNotifications(value: unknown): NotificationSettings {
  const result = structuredClone(DEFAULT_SETTINGS.notifications);
  if (value === undefined) return result;
  const input = record(value);
  for (const flag of flags) {
    if (input[flag] === undefined) continue;
    if (typeof input[flag] !== "boolean")
      throw new Error(`Invalid notification ${flag}`);
    result[flag] = input[flag];
  }
  if (input.position !== undefined) {
    const position = positions.find((position) => position === input.position);
    if (!position) throw new Error("Invalid notification position");
    result.position = position;
  }
  applyChannels(input, result);
  return result;
}
