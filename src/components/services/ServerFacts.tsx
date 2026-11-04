import type { Host, ServerManagementInfo } from "../../shared/types";
export function ServerConnectionFacts({
  server,
  host,
}: {
  server: ServerManagementInfo | undefined;
  host: Host | undefined;
}) {
  return (
    <>
      <dl className="server-facts">
        <dt>Connection</dt>
        <dd>
          {server
            ? server.running
              ? "Running"
              : "Stopped / unavailable"
            : "Checking…"}
        </dd>
        <dt>Endpoint</dt>
        <dd>{server?.endpoint || host?.endpoint || "Local discovery"}</dd>
        <dt>Persistent sessions</dt>
        <dd>{server?.sessionCount ?? "Checking…"}</dd>
        <dt>Executable</dt>
        <dd>{server?.executable || "Not discovered"}</dd>
        <dt>Version</dt>
        <dd>{server?.version || "Unknown"}</dd>
        {server?.service && (
          <>
            <dt>Service</dt>
            <dd>
              {server.service.unit} ({server.service.scope})
            </dd>
            <dt>Service state</dt>
            <dd>
              {server.service.activeState}
              {server.service.subState ? ` / ${server.service.subState}` : ""}
            </dd>
            <dt>Restart policy</dt>
            <dd>{server.service.restart}</dd>
          </>
        )}
      </dl>
    </>
  );
}
export function ServerRuntimeDetails({
  server,
}: {
  server: ServerManagementInfo | undefined;
}) {
  return (
    <details className="raw-diagnostics">
      <summary>Runtime and integrity details</summary>
      <dl className="server-facts">
        <dt>Process</dt>
        <dd>{server?.pid ?? "Stopped"}</dd>
        <dt>Configuration</dt>
        <dd>{server?.configPath || "Default"}</dd>
        <dt>State directory</dt>
        <dd>{server?.stateDirectory || "Default"}</dd>
        <dt>Binary SHA-256</dt>
        <dd>{server?.binarySha256 || "Unavailable"}</dd>
        <dt>Launch arguments</dt>
        <dd>
          <code>{server?.arguments.join(" ") || "Not discovered"}</code>
        </dd>
        {server?.service && (
          <>
            <dt>Service file</dt>
            <dd>{server.service.fragmentPath || "Unavailable"}</dd>
            <dt>Service overrides</dt>
            <dd>{server.service.dropInPaths.join("\n") || "None"}</dd>
          </>
        )}
      </dl>
    </details>
  );
}
