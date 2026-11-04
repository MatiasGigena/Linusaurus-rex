import type {
  ServerActionArgs,
  TailscaleEnableOptions,
} from "../../src/shared/types.js";
import { identifier, record, string } from "../validation.js";

function fields(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unsupported server action arguments.");
}
function hostname(value: unknown): string {
  const result = identifier(value, "Tailscale hostname").trim();
  if (!result) throw new Error("Missing Tailscale hostname");
  return result;
}
/** Decode the operation-specific server RPC contract before forwarding native requests. */
export function parseServerAction(
  value: Record<string, unknown>,
): ServerActionArgs {
  const action = identifier(value.action, "server action");
  if (action === "tailscale.rename") {
    const args = record(value.args);
    fields(args, ["hostname"]);
    return { action, args: { hostname: hostname(args.hostname) } };
  }
  if (action === "tailscale.enable") {
    const args = value.args === undefined ? {} : record(value.args);
    fields(args, [
      "hostname",
      "control_url",
      "advertise_tags",
      "allow_tailnet_members",
    ]);
    const options: TailscaleEnableOptions = {};
    if (args.hostname !== undefined) options.hostname = hostname(args.hostname);
    if (args.control_url !== undefined)
      options.control_url = string(
        args.control_url,
        "Tailscale control URL",
        8192,
      );
    if (args.allow_tailnet_members !== undefined) {
      if (typeof args.allow_tailnet_members !== "boolean")
        throw new Error("Invalid tailnet membership policy");
      options.allow_tailnet_members = args.allow_tailnet_members;
    }
    if (args.advertise_tags !== undefined) {
      if (
        !Array.isArray(args.advertise_tags) ||
        args.advertise_tags.length > 256
      )
        throw new Error("Invalid Tailscale tags");
      options.advertise_tags = args.advertise_tags.map((tag) =>
        identifier(tag, "Tailscale tag"),
      );
    }
    return { action, args: options };
  }
  if (
    action === "status" ||
    action === "tailscale.disable" ||
    action === "tailscale.login" ||
    action === "tailscale.logout"
  ) {
    if (value.args !== undefined)
      throw new Error("This server action does not accept arguments.");
    return { action };
  }
  throw new Error("Unsupported server action.");
}
