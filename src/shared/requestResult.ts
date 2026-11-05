import type { RexBridge, RexMethods } from "./types";

export interface RequestFailure {
  message: string;
  name: string;
  code?: string;
  method?: string;
}
export type RequestResult =
  { ok: true; value: unknown } | { ok: false; error: RequestFailure };
export type RendererTransport = Omit<RexBridge, "request"> & {
  request(method: string, args: unknown): Promise<unknown>;
};

/** Error metadata must remain plain data until it reaches the caller's JavaScript world. */
export async function captureRequest(
  action: () => unknown | Promise<unknown>,
): Promise<RequestResult> {
  try {
    return { ok: true, value: await action() };
  } catch (failure) {
    const source =
      failure && typeof failure === "object"
        ? (failure as Record<string, unknown>)
        : undefined;
    return {
      ok: false,
      error: {
        message: failure instanceof Error ? failure.message : String(failure),
        name: failure instanceof Error ? failure.name : "Error",
        ...(typeof source?.code === "string" ? { code: source.code } : {}),
        ...(typeof source?.method === "string"
          ? { method: source.method }
          : {}),
      },
    };
  }
}

/** Serialized by contextBridge.executeInMainWorld: keep this function self-contained. */
export function installRendererBridge(transport: RendererTransport): void {
  const request = async <K extends keyof RexMethods>(
    method: K,
    args: RexMethods[K]["args"],
  ): Promise<RexMethods[K]["result"]> => {
    const response = await transport.request(method, args);
    if (!response || typeof response !== "object" || Array.isArray(response))
      throw new Error("Invalid desktop request response.");
    const result = response as Record<string, unknown>;
    if (result.ok === true && Object.hasOwn(result, "value"))
      return result.value as RexMethods[K]["result"];
    if (
      result.ok !== false ||
      !result.error ||
      typeof result.error !== "object" ||
      Array.isArray(result.error)
    )
      throw new Error("Invalid desktop request response.");
    const error = result.error as Record<string, unknown>;
    if (
      typeof error.message !== "string" ||
      typeof error.name !== "string" ||
      (error.code !== undefined && typeof error.code !== "string") ||
      (error.method !== undefined && typeof error.method !== "string")
    )
      throw new Error("Invalid desktop request error.");
    const failure = new Error(error.message);
    failure.name = error.name;
    Object.assign(failure, {
      ...(error.code === undefined ? {} : { code: error.code }),
      ...(error.method === undefined ? {} : { method: error.method }),
    });
    throw failure;
  };
  Object.defineProperty(window, "rex", {
    value: Object.freeze({ ...transport, request }),
    configurable: false,
    writable: false,
  });
}
