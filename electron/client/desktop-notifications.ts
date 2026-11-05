import type { BrowserWindow } from "electron";
import type { ClientEvent, Host, Settings } from "../../src/shared/types.js";
import { desktopAllowed, noticeSound } from "./notifications.js";

type Notice = Extract<ClientEvent, { type: "notification" }>;
const recent = new Map<string, number>();
const RETENTION_MS = 10_000;
const DUPLICATE_WINDOW_MS = 3000;

export interface NativeNotice {
  on(event: "click" | "close", listener: () => void): void;
  show(): void;
  close(): void;
}
export interface DesktopNotificationEffects {
  supported(): boolean;
  create(options: {
    title: string;
    body: string;
    silent: boolean;
  }): NativeNotice;
}
type NotificationWindow = Pick<
  BrowserWindow,
  "isDestroyed" | "show" | "isMinimized" | "restore" | "focus"
>;

/** Per-window native notification lifetime; duplicate suppression is shared across windows. */
export class DesktopNotifications {
  private notices = new Map<NativeNotice, string>();
  private disposed = false;
  constructor(
    private window: NotificationWindow,
    private settings: () => Settings,
    private actions: {
      select(value: {
        hostId: string;
        sessionId: string;
        windowId?: string;
        blockId?: string;
      }): void;
      openServerSettings(host: Host): Promise<unknown>;
    },
    private effects: DesktopNotificationEffects,
  ) {}
  show(event: Notice): void {
    if (
      this.disposed ||
      process.env.LINUSAURUS_TEST_NOTIFICATIONS === "1" ||
      !this.effects.supported()
    )
      return;
    const saved = this.settings();
    const owner = saved.hosts.find((host) => host.id === event.hostId);
    if (!owner) return;
    const settings = saved.notifications;
    const source = "source" in event ? String(event.source) : undefined;
    if (!desktopAllowed(settings, event.kind, source)) return;
    const signature = JSON.stringify([
      event.hostId,
      event.sessionId,
      event.windowId,
      event.blockId,
      event.kind,
      event.title,
      event.body,
    ]);
    const now = Date.now();
    for (const [key, time] of recent)
      if (now - time > RETENTION_MS) recent.delete(key);
    if (now - (recent.get(signature) ?? 0) < DUPLICATE_WINDOW_MS) return;
    recent.set(signature, now);
    const notice = this.effects.create({
      title: event.title,
      body: event.body,
      silent: !noticeSound(settings, event.kind),
    });
    this.notices.set(notice, event.hostId);
    notice.on("click", () => {
      if (
        this.disposed ||
        !this.notices.has(notice) ||
        this.window.isDestroyed()
      )
        return;
      const host = this.settings().hosts.find(
        (host) => host.id === event.hostId && host.endpoint === owner.endpoint,
      );
      if (!host) return;
      this.window.show();
      if (this.window.isMinimized()) this.window.restore();
      this.window.focus();
      if (source === "tailscale")
        void this.actions.openServerSettings(host).catch(() => {});
      else if (event.sessionId)
        this.actions.select({
          hostId: event.hostId,
          sessionId: event.sessionId,
          windowId: event.windowId,
          ...(event.blockId ? { blockId: event.blockId } : {}),
        });
    });
    notice.on("close", () => this.notices.delete(notice));
    notice.show();
  }
  clearHost(hostId: string): void {
    for (const [notice, owner] of this.notices)
      if (owner === hostId) {
        this.notices.delete(notice);
        notice.close();
      }
  }
  dispose(): void {
    this.disposed = true;
    for (const notice of this.notices.keys()) notice.close();
    this.notices.clear();
  }
}
