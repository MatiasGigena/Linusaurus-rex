import type { Settings, UpdateState } from "../../src/shared/types.js";
import type { LinuxUpdateManager } from "./updates.js";

type Preferences = Pick<
  Settings,
  "autoCheckUpdates" | "autoDownloadUpdates" | "installUpdatesWhenIdle"
>;
interface PreferenceSource {
  get(): Preferences;
  onChange(listener: (settings: Settings) => void): () => void;
}
type UpdateManager = Pick<
  LinuxUpdateManager,
  "status" | "check" | "download" | "apply" | "cancel" | "dispose"
>;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Own update policy; the manager owns verified downloads and installation mechanics. */
export class UpdateCoordinator {
  private timer?: ReturnType<typeof setInterval>;
  private stopSettings: () => void;
  private disposed = false;

  constructor(
    private manager: UpdateManager,
    private preferences: PreferenceSource,
  ) {
    let previous = preferences.get();
    this.stopSettings = preferences.onChange((settings) => {
      const started = settings.autoCheckUpdates && !previous.autoCheckUpdates;
      this.schedule(settings.autoCheckUpdates);
      if (
        !settings.installUpdatesWhenIdle &&
        previous.installUpdatesWhenIdle &&
        manager.status().phase === "scheduled"
      )
        manager.cancel();
      if (
        !started &&
        ((settings.autoDownloadUpdates && !previous.autoDownloadUpdates) ||
          (settings.installUpdatesWhenIdle && !previous.installUpdatesWhenIdle))
      ) {
        void this.progress(manager.status()).catch(() => {});
      }
      previous = settings;
    });
    this.schedule(previous.autoCheckUpdates);
  }

  status() {
    return this.manager.status();
  }
  async check() {
    return this.progress(await this.manager.check());
  }
  async download() {
    return this.progress(await this.manager.download());
  }
  apply(whenIdle = false) {
    return this.manager.apply(whenIdle);
  }
  cancel() {
    return this.manager.cancel();
  }

  private async progress(
    state: UpdateState,
    automatic = false,
  ): Promise<UpdateState> {
    if (
      this.disposed ||
      (automatic && !this.preferences.get().autoCheckUpdates)
    )
      return state;
    if (
      state.phase === "available" &&
      this.preferences.get().autoDownloadUpdates
    ) {
      state = await this.manager.download();
    }
    if (
      !this.disposed &&
      state.phase === "ready" &&
      state.installKind === "appimage" &&
      this.preferences.get().installUpdatesWhenIdle
    )
      return this.manager.apply(true);
    return state;
  }

  private schedule(enabled: boolean) {
    if (!enabled) {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      return;
    }
    if (this.timer || this.disposed) return;
    const check = async () => {
      if (!this.disposed && this.preferences.get().autoCheckUpdates)
        await this.progress(await this.manager.check(), true);
    };
    this.timer = setInterval(
      () => void check().catch(() => {}),
      CHECK_INTERVAL_MS,
    );
    void check().catch(() => {});
  }

  dispose() {
    this.disposed = true;
    this.stopSettings();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.manager.dispose();
  }
}
