export function originPatterns(args: readonly string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--websocket-origin-pattern" && args[index + 1])
      values.push(args[++index]);
    else if (args[index].startsWith("--websocket-origin-pattern="))
      values.push(args[index].slice(27));
  }
  return values;
}
export function validateOrigins(origins: unknown): string[] {
  if (!Array.isArray(origins) || origins.length > 64)
    throw new Error("Allow at most 64 web origin patterns.");
  return [
    ...new Set(
      origins.map((input) => {
        if (
          typeof input !== "string" ||
          input.length > 512 ||
          /[\s\x00-\x1f]/.test(input)
        )
          throw new Error(
            "Use a browser origin or specific host[:port] pattern.",
          );
        let origin = input;
        if (/^https?:\/\//i.test(origin)) {
          const parsed = new URL(origin);
          if (
            parsed.username ||
            parsed.password ||
            !["", "/"].includes(parsed.pathname) ||
            parsed.search ||
            parsed.hash
          )
            throw new Error(
              "A browser origin contains only scheme, hostname and optional port.",
            );
          origin = parsed.host;
        }
        if (
          !/^[a-zA-Z0-9.*:\[\]_-]+$/.test(origin) ||
          !origin ||
          origin === "*"
        )
          throw new Error(
            "Use a specific host[:port] or wildcard subdomain, such as localhost:3000 or *.example.com.",
          );
        return origin.toLowerCase();
      }),
    ),
  ];
}
export function withOrigins(
  args: readonly string[],
  origins: readonly string[],
): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--websocket-origin-pattern") {
      index++;
      continue;
    }
    if (!args[index].startsWith("--websocket-origin-pattern="))
      result.push(args[index]);
  }
  for (const origin of origins)
    result.push("--websocket-origin-pattern", origin);
  return result;
}
