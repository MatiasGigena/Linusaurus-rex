export interface BlockMethod {
  name: string;
  description: string;
  schema?: Record<string, unknown>;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Accept the method shapes emitted by different Rex API revisions. */
export function inspectMethods(info: unknown): BlockMethod[] {
  const root = object(info);
  if (!root) return [];
  const candidates = [
    object(root.api)?.methods,
    root.methods,
    object(root.block)?.methods,
    object(root.creator)?.methods,
    object(root.block_type)?.methods,
    object(root.info)?.methods,
  ];
  let source: unknown;
  for (const candidate of candidates) {
    if (Array.isArray(candidate) || object(candidate)) {
      source = candidate;
      break;
    }
  }

  let values: unknown[];
  if (Array.isArray(source)) values = source;
  else {
    const dictionary = object(source) || {};
    values = [];
    for (const [name, method] of Object.entries(dictionary)) {
      if (typeof method === "object" && method)
        values.push({ name, ...method });
      else values.push({ name, description: String(method || "") });
    }
  }

  const methods: BlockMethod[] = [];
  for (const value of values) {
    if (typeof value === "string") {
      methods.push({ name: value, description: "" });
      continue;
    }
    const method = object(value);
    if (!method) continue;
    const name = method.name ?? method.method;
    if (typeof name !== "string" || !name) continue;
    const description =
      typeof method.description === "string" ? method.description : "";
    const schema =
      object(method.args_schema) ??
      object(method.input_schema) ??
      object(method.argsSchema);
    methods.push({ name, description, schema });
  }
  return methods;
}

export function parseMethodArgs(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  const args = object(value);
  if (!args) throw new Error("Arguments must be a JSON object, such as {}.");
  return args;
}

export function formatBlockResult(result: unknown): string {
  return JSON.stringify(result ?? null, null, 2) ?? "null";
}
