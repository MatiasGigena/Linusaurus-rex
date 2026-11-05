import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import type { Settings } from "../../src/shared/types.js";
import { linkDecision } from "./links.js";

export interface ExternalLinkEffects {
  confirm(options: MessageBoxOptions): Promise<MessageBoxReturnValue>;
  open(url: string): Promise<void>;
}

/** Owns native consent and persistence for application-link targets. */
export class ExternalLinks {
  constructor(
    private settings: () => Settings,
    private save: (value: Settings) => Promise<Settings>,
    private effects: ExternalLinkEffects,
  ) {}
  async open(url: string): Promise<void> {
    const settings = this.settings();
    const decision = linkDecision(
      url,
      settings.appLinks,
      settings.trustedLinks,
    );
    if (decision.confirmation) {
      const response = await this.effects.confirm({
        type: "question",
        title: "Open application link?",
        message: `Open this link with ${new URL(decision.url).protocol.slice(0, -1)}?`,
        detail: `Target: ${decision.target}\n\nOnly allow targets you recognize.`,
        buttons: ["Open once", "Always allow this app target", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (response.response === 2) return;
      if (response.response === 1) {
        const current = this.settings();
        await this.save({
          ...current,
          trustedLinks: [
            ...new Set([...current.trustedLinks, decision.target]),
          ],
        });
      }
    }
    await this.effects.open(decision.url);
  }
}
