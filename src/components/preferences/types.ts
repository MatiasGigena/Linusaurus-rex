import type { Dispatch, SetStateAction } from "react";
import type { Settings } from "../../shared/types";
export interface PreferencesEditor {
  draft: Settings;
  setDraft: Dispatch<SetStateAction<Settings>>;
  update<K extends keyof Settings>(key: K, value: Settings[K]): void;
}

export type SettingsTab =
  | "appearance"
  | "terminal"
  | "notifications"
  | "hosts"
  | "integrations"
  | "shortcuts"
  | "server";
