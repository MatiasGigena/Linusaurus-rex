import { randomUUID } from "node:crypto";
import { RexCommandRunner, type CommandRunner } from "../rex/command.js";

const AGENTS = new Set(["claude", "codex", "opencode", "pi"]);
export interface IntegrationChange {
  operation: "setup" | "remove";
  agents: string[];
  letAgentsNameSessions: boolean;
  force?: boolean;
}
export interface IntegrationPreview {
  previewId: string;
  output: string;
  steps: unknown[];
}
export interface IntegrationStatus extends Record<string, unknown> {
  harnesses: unknown[];
}

export function integrationArgs(
  change: IntegrationChange,
  dryRun: boolean,
): string[] {
  if (
    !["setup", "remove"].includes(change.operation) ||
    !Array.isArray(change.agents) ||
    !change.agents.length ||
    change.agents.some((agent) => !AGENTS.has(agent))
  )
    throw new Error("Choose one or more supported coding agents.");
  if (
    typeof change.letAgentsNameSessions !== "boolean" ||
    (change.force !== undefined && typeof change.force !== "boolean")
  )
    throw new Error("Invalid agent integration settings.");
  return [
    "--autostart=false",
    "skill",
    change.operation,
    ...[...new Set(change.agents)].map((agent) => `--agent=${agent}`),
    ...(change.operation === "setup"
      ? [
          `--session-naming=${change.letAgentsNameSessions}`,
          ...(change.force ? ["--force"] : []),
        ]
      : []),
    ...(dryRun ? ["--dry-run"] : []),
    "--json",
  ];
}

export class IntegrationManager {
  private runner = new RexCommandRunner("rex", 30_000);
  private run: CommandRunner;
  private previews = new Map<
    string,
    { change: IntegrationChange; steps: string; expires: number }
  >();
  constructor(run?: CommandRunner) {
    this.run = run ?? this.runner.run;
  }
  async status(): Promise<IntegrationStatus> {
    const result = this.parse(
      await this.run(["--autostart=false", "skill", "status", "--json"]),
    );
    if (result.harnesses !== undefined && !Array.isArray(result.harnesses))
      throw new Error(
        "The installed Rex CLI returned an invalid integration status: harnesses must be an array.",
      );
    return { ...result, harnesses: result.harnesses ?? [] };
  }
  async preview(change: IntegrationChange): Promise<IntegrationPreview> {
    const output = await this.run(integrationArgs(change, true));
    const parsed = this.parse(output);
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const previewId = randomUUID();
    for (const [id, preview] of this.previews)
      if (preview.expires < Date.now()) this.previews.delete(id);
    this.previews.set(previewId, {
      change: structuredClone(change),
      steps: JSON.stringify(steps),
      expires: Date.now() + 10 * 60_000,
    });
    return { previewId, output, steps };
  }
  async apply(
    previewId: string,
  ): Promise<{ output: string; steps: unknown[] }> {
    const preview = this.previews.get(previewId);
    if (!preview || preview.expires < Date.now())
      throw new Error(
        "This preview expired. Preview the integration change again.",
      );
    this.previews.delete(previewId);
    const current = this.parse(
      await this.run(integrationArgs(preview.change, true)),
    );
    if (JSON.stringify(current.steps ?? []) !== preview.steps)
      throw new Error(
        "The integration files changed after the preview. Preview again before applying.",
      );
    const output = await this.run(integrationArgs(preview.change, false));
    const parsed = this.parse(output);
    return { output, steps: Array.isArray(parsed.steps) ? parsed.steps : [] };
  }
  dispose() {
    this.previews.clear();
    this.runner.dispose();
  }
  private parse(output: string): Record<string, unknown> {
    let value: unknown;
    try {
      value = JSON.parse(output);
    } catch {
      throw new Error(
        "The installed Rex CLI returned an invalid integration response.",
      );
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(
        "The installed Rex CLI returned an invalid integration response.",
      );
    return value as Record<string, unknown>;
  }
}
