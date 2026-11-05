interface RendererFrame {
  url: string;
}
export interface RendererEvent {
  sender: { id: number; mainFrame: RendererFrame };
  senderFrame: RendererFrame | null;
}

/** A registered window grants access only to its original main-frame document. */
export function trustedRenderer<T extends { allowedUrl: string }>(
  event: RendererEvent,
  contexts: ReadonlyMap<number, T>,
): T {
  const context = contexts.get(event.sender.id);
  if (
    !context ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url.split("#")[0] !== context.allowedUrl.split("#")[0]
  )
    throw new Error("Untrusted renderer");
  return context;
}
