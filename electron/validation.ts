export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
export function string(
  value: unknown,
  name: string,
  max = 4096,
  allowNul = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowNul && value.includes("\0"))
  )
    throw new Error(`Invalid ${name}`);
  return value;
}
export function identifier(value: unknown, name: string): string {
  const result = string(value, name, 256);
  if (!result) throw new Error(`Missing ${name}`);
  return result;
}
export function integer(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`Invalid ${name}`);
  return value;
}
