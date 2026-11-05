import { string } from "../validation.js";

export interface TerminalThemeRequest {
  foreground: string;
  background: string;
  cursor: string;
  scheme: "dark" | "light";
  palette: string[];
}
function color(value: unknown, name: string): string {
  const result = string(value, `${name} color`, 32);
  if (!/^#?[0-9a-f]{6}$/i.test(result))
    throw new Error("Terminal colors must be six-digit hexadecimal values.");
  return result;
}

/** Translate renderer colors into the terminal RPC's indexed palette representation. */
export function terminalThemeRequest(
  args: Record<string, unknown>,
): TerminalThemeRequest {
  if (args.scheme !== "dark" && args.scheme !== "light")
    throw new Error("Invalid terminal color scheme");
  if (!Array.isArray(args.palette) || args.palette.length > 256)
    throw new Error("Invalid terminal palette");
  return {
    foreground: color(args.foreground, "foreground"),
    background: color(args.background, "background"),
    cursor: color(args.cursor, "cursor"),
    scheme: args.scheme,
    palette: args.palette.map((value, index) => {
      const entry = string(value, "palette color", 32);
      const indexed = /^(\d{1,3})=(#?[0-9a-f]{6})$/i.exec(entry);
      if (indexed && Number(indexed[1]) < 256) return entry;
      if (/^#?[0-9a-f]{6}$/i.test(entry)) return `${index}=${entry}`;
      throw new Error("Invalid terminal palette color");
    }),
  };
}
