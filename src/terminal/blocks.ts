export interface BlockMethod { name: string; description: string; schema?: Record<string, unknown> }

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Accept the method shapes emitted by different Rex API revisions. */
export function inspectMethods(info: unknown): BlockMethod[] {
  const root = object(info);
  if (!root) return [];
  const candidates = [object(root.api)?.methods, root.methods, object(root.block)?.methods, object(root.creator)?.methods, object(root.block_type)?.methods, object(root.info)?.methods];
  const source = candidates.find((candidate) => Array.isArray(candidate) || object(candidate));
  const values = Array.isArray(source) ? source : Object.entries(object(source) || {}).map(([name, method]) => typeof method === 'object' && method ? { name, ...method } : { name, description: String(method || '') });
  return values.flatMap((value): BlockMethod[] => {
    if (typeof value === 'string') return [{ name: value, description: '' }];
    const method = object(value);
    const name = method?.name ?? method?.method;
    if (typeof name !== 'string' || !name) return [];
    return [{ name, description: typeof method?.description === 'string' ? method.description : '', schema: object(method?.args_schema) ?? object(method?.input_schema) ?? object(method?.argsSchema) }];
  });
}

export function parseMethodArgs(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  const args = object(value);
  if (!args) throw new Error('Arguments must be a JSON object, such as {}.');
  return args;
}

export function formatBlockResult(result: unknown): string {
  return JSON.stringify(result ?? null, null, 2);
}
