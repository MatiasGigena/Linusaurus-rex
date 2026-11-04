import { TerminalSquare } from "lucide-react";
import type { PaletteCommand } from "../components/CommandPalette";
import type { NavigationHost } from "../components/Sidebar";
import type { KeymapResult, Settings } from "../shared/types";
import { CLIENT_ACTIONS } from "../shared/actions";
import { aliases } from "./actions/aliases";
import type { Form } from "./actions/context";
interface PaletteOptions {
  palette: "all" | "sessions" | undefined;
  settings: Settings | undefined;
  keymaps: Record<string, KeymapResult>;
  activeHostId: string | undefined;
  navHosts: NavigationHost[];
  dispatch(name: string, args?: Record<string, unknown>): void;
  execute(name: string, args?: Record<string, unknown>): Promise<unknown>;
  select(hostId: string, sessionId: string, windowId?: string): void;
  setForm(form: Form): void;
}
function serverActionArguments(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Arguments must contain valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Arguments must be a JSON object.");
  return value as Record<string, unknown>;
}
export function buildPaletteCommands({
  palette,
  settings,
  keymaps,
  activeHostId,
  navHosts,
  dispatch,
  execute,
  select,
  setForm,
}: PaletteOptions): PaletteCommand[] {
  return [
    ...(palette === "sessions"
      ? []
      : CLIENT_ACTIONS.filter(
          (action) => !["client.window.close"].includes(action.name),
        ).map((action) => {
          const shortcutName = Object.entries(aliases).find(
            ([, name]) => name === action.name,
          )?.[0];
          return {
            id: action.name,
            label: action.title || action.name,
            description: action.name,
            shortcut: shortcutName
              ? settings?.shortcuts[shortcutName]
              : undefined,
            run: () => dispatch(action.name),
          };
        })),
    ...(palette === "sessions"
      ? []
      : [
          {
            id: "pane.new_block",
            label: "Create block from server plugin…",
            description: "Discover available block types",
            run: () => dispatch("pane.new_block"),
          },
        ]),
    ...(palette === "sessions"
      ? []
      : (keymaps[activeHostId || ""]?.actions || [])
          .filter(
            (action) =>
              action.kind !== "client" &&
              !CLIENT_ACTIONS.some((client) => client.name === action.name),
          )
          .map((action) => ({
            id: `server:${action.name}`,
            label: action.title || action.name,
            description: "Server action · " + action.name,
            run: () => {
              const schemaRequired = action.args?.required;
              const required = Array.isArray(schemaRequired)
                ? schemaRequired.filter(
                    (key): key is string => typeof key === "string",
                  )
                : [];
              if (required?.length)
                setForm({
                  title: action.title || action.name,
                  description: "Arguments for this server-defined action.",
                  fields: [
                    {
                      name: "args",
                      label: "Arguments (JSON)",
                      value: JSON.stringify(
                        Object.fromEntries(required.map((key) => [key, ""])),
                        null,
                        2,
                      ),
                      multiline: true,
                    },
                  ],
                  submit: async (values) => {
                    await execute(
                      action.name,
                      serverActionArguments(values.args),
                    );
                  },
                });
              else dispatch(action.name);
            },
          }))),
    ...(palette === "sessions"
      ? []
      : navHosts.flatMap((host) =>
          host.sessions.flatMap((session) =>
            session.windows.map((window) => ({
              id: `tab:${host.id}/${session.id}/${window.id}`,
              label: window.label,
              description: `${host.label} · ${session.label} · Tab`,
              icon: <TerminalSquare size={17} />,
              run: () => select(host.id, session.id, window.id),
            })),
          ),
        )),
    ...navHosts.flatMap((host) =>
      host.sessions.map((session) => ({
        id: `session:${host.id}/${session.id}`,
        label: session.label,
        description: host.label,
        icon: <TerminalSquare size={17} />,
        run: () => select(host.id, session.id),
      })),
    ),
  ];
}
