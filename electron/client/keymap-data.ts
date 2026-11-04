import type {
  ActionDefinition,
  KeyBinding,
  KeymapResult,
} from "../../src/shared/types.js";

export interface KeyMode {
  name: string;
  exclusive?: boolean;
  blocked?: string[][];
}
export interface ValidatedKeymap extends KeymapResult {
  modes: KeyMode[];
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
}
function action(value: unknown): ActionDefinition | undefined {
  const item = object(value);
  if (!item || typeof item.name !== "string" || !item.name) return undefined;
  for (const name of ["title", "description", "kind"])
    if (item[name] !== undefined && typeof item[name] !== "string")
      return undefined;
  if (item.args !== undefined && !object(item.args)) return undefined;
  if (item.repeats !== undefined && typeof item.repeats !== "boolean")
    return undefined;
  return {
    ...item,
    name: item.name,
    title: typeof item.title === "string" ? item.title : undefined,
    description:
      typeof item.description === "string" ? item.description : undefined,
    kind: typeof item.kind === "string" ? item.kind : undefined,
    args: object(item.args),
  };
}
function binding(value: unknown): KeyBinding | undefined {
  const item = object(value);
  if (
    !item ||
    !strings(item.keys) ||
    !item.keys.length ||
    typeof item.action !== "string" ||
    !item.action
  )
    return undefined;
  if (item.mode !== undefined && typeof item.mode !== "string")
    return undefined;
  if (item.args !== undefined && !object(item.args)) return undefined;
  return {
    ...item,
    keys: [...item.keys],
    action: item.action,
    args: object(item.args),
  };
}
function mode(value: unknown): KeyMode | undefined {
  const item = object(value);
  if (!item || typeof item.name !== "string" || !item.name) return undefined;
  if (item.exclusive !== undefined && typeof item.exclusive !== "boolean")
    return undefined;
  if (
    item.blocked !== undefined &&
    (!Array.isArray(item.blocked) ||
      !item.blocked.every((keys) => strings(keys) && keys.length > 0))
  )
    return undefined;
  return {
    name: item.name,
    exclusive: typeof item.exclusive === "boolean" ? item.exclusive : undefined,
    blocked: Array.isArray(item.blocked)
      ? item.blocked.map((keys) => (strings(keys) ? [...keys] : []))
      : undefined,
  };
}
function decoded<T>(
  value: unknown,
  decode: (item: unknown) => T | undefined,
): T[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const result = decode(item);
        return result === undefined ? [] : [result];
      })
    : [];
}

/** Filter invalid remote entries so one malformed shortcut cannot disable keyboard input. */
export function normalizeKeymap(
  value: unknown,
  local: ActionDefinition[] = [],
): ValidatedKeymap {
  const result = object(value) ?? {};
  return {
    actions: [...local, ...decoded(result.actions, action)],
    bindings: decoded(result.bindings, binding),
    modes: decoded(result.modes, mode),
    warnings: Array.isArray(result.warnings)
      ? result.warnings
      : Array.isArray(result.diagnostics)
        ? result.diagnostics
        : [],
  };
}
