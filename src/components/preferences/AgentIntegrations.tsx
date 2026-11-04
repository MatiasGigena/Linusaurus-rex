import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Section, Toggle } from "./Controls";
import { errorMessage } from "../../core/workspace";
import type { IntegrationPreview } from "../../shared/types";

export function AgentIntegrations({
  letAgentsNameSessions,
  onSessionNamingChange,
}: {
  letAgentsNameSessions: boolean;
  onSessionNamingChange(value: boolean): void;
}) {
  const [error, setError] = useState<string>();
  const [integrationOutput, setIntegrationOutput] = useState("");
  const [agents, setAgents] = useState<string[]>([
    "claude",
    "codex",
    "opencode",
    "pi",
  ]);
  const [preview, setPreview] = useState<IntegrationPreview>();
  const [integrating, setIntegrating] = useState(false);
  const mounted = useRef(true);
  const revision = useRef(0);
  const intent = useRef({ agents, letAgentsNameSessions });
  intent.current = { agents, letAgentsNameSessions };
  const invalidatePreview = () => {
    revision.current++;
    setPreview(undefined);
    setError(undefined);
    setIntegrating(false);
  };
  const beginRequest = () => {
    const request = ++revision.current;
    const requested = intent.current;
    setIntegrating(true);
    setError(undefined);
    return () =>
      mounted.current &&
      revision.current === request &&
      intent.current.agents === requested.agents &&
      intent.current.letAgentsNameSessions === requested.letAgentsNameSessions;
  };
  useEffect(() => {
    let active = true;
    mounted.current = true;
    void window.rex
      .request("integrationsStatus", {})
      .then((result) => {
        if (active) setIntegrationOutput(result.output);
      })
      .catch((failure) => {
        if (active) setIntegrationOutput(errorMessage(failure));
      });
    return () => {
      active = false;
      mounted.current = false;
      revision.current++;
    };
  }, []);
  useEffect(() => {
    invalidatePreview();
  }, [letAgentsNameSessions]);
  const makePreview = async (operation: "setup" | "remove") => {
    const ownsRequest = beginRequest();
    setPreview(undefined);
    try {
      const result = await window.rex.request("integrationsPreview", {
        operation,
        agents,
        letAgentsNameSessions: letAgentsNameSessions,
      });
      if (ownsRequest()) setPreview(result);
    } catch (failure) {
      if (ownsRequest()) setError(errorMessage(failure));
    } finally {
      if (ownsRequest()) setIntegrating(false);
    }
  };
  const applyPreview = async () => {
    if (!preview) return;
    const ownsRequest = beginRequest();
    try {
      const result = await window.rex.request("integrationsApply", {
        previewId: preview.previewId,
      });
      if (!ownsRequest()) return;
      setIntegrationOutput(result.output);
      setPreview(undefined);
    } catch (failure) {
      if (ownsRequest()) setError(errorMessage(failure));
    } finally {
      if (ownsRequest()) setIntegrating(false);
    }
  };

  return (
    <>
      <Section title="CODING AGENTS">
        <p className="form-hint">
          Install Rex's skill and hooks so coding agents can manage your
          terminals. Changes are previewed before applying.
        </p>
        <div className="agent-choices">
          {["claude", "codex", "opencode", "pi"].map((agent) => (
            <label key={agent}>
              <input
                type="checkbox"
                checked={agents.includes(agent)}
                onChange={(event) => {
                  invalidatePreview();
                  setAgents(
                    event.target.checked
                      ? [...agents, agent]
                      : agents.filter((value) => value !== agent),
                  );
                }}
              />
              {
                (
                  {
                    claude: "Claude Code",
                    codex: "Codex",
                    opencode: "OpenCode",
                    pi: "Pi",
                  } as Record<string, string>
                )[agent]
              }
            </label>
          ))}
        </div>
        <Toggle
          label="Let agents name sessions"
          value={letAgentsNameSessions}
          onChange={(value) => {
            invalidatePreview();
            onSessionNamingChange(value);
          }}
        />
        <div className="settings-buttons">
          <button
            className="button"
            type="button"
            disabled={integrating || !agents.length}
            onClick={() => void makePreview("setup")}
          >
            Preview install / update
          </button>
          <button
            className="button"
            type="button"
            disabled={integrating || !agents.length}
            onClick={() => void makePreview("remove")}
          >
            Preview removal
          </button>
        </div>
      </Section>
      {preview && (
        <Section title="REVIEW CHANGES">
          <pre
            className="settings-output"
            tabIndex={0}
            aria-label="Agent integration status"
          >
            {preview.output}
          </pre>
          <button
            className="button button-primary"
            type="button"
            disabled={integrating}
            onClick={() => void applyPreview()}
          >
            <ShieldCheck size={14} />
            {integrating ? "Applying…" : "Apply these changes"}
          </button>
        </Section>
      )}
      <Section title="CURRENT INTEGRATION STATUS">
        <pre
          className="settings-output"
          tabIndex={0}
          aria-label="Agent integration status"
        >
          {integrationOutput || "Checking installed agents…"}
        </pre>
      </Section>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
