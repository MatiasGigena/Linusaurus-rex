import { useId, useState } from "react";
import { Download, Server } from "lucide-react";
import { Dialog } from "../Dialog";
import type { Settings } from "../../shared/types";
import { ServerManagementPanel } from "./ServerManagementPanel";
import { ClientUpdatesPanel } from "./ClientUpdatesPanel";
export function NativeServicesDialog({
  settings,
  hostId,
  initialTab = "server",
  onSave,
  onClose,
}: {
  settings: Settings;
  hostId: string;
  initialTab?: "server" | "updates";
  onSave(settings: Settings): Promise<Settings>;
  onClose(): void;
}) {
  const [tab, setTab] = useState(initialTab);
  const id = useId();
  const host = settings.hosts.find((host) => host.id === hostId);
  return (
    <Dialog
      title="Linux services and updates"
      subtitle={host?.label || "Linusaurus Rex"}
      wide
      onClose={onClose}
    >
      <div className="services-tabs" role="tablist" aria-label="Linux services">
        <button
          id={id + "-server-tab"}
          role="tab"
          aria-controls={id + "-server-panel"}
          aria-selected={tab === "server"}
          onClick={() => setTab("server")}
        >
          <Server size={14} />
          Rex server
        </button>
        <button
          id={id + "-updates-tab"}
          role="tab"
          aria-controls={id + "-updates-panel"}
          aria-selected={tab === "updates"}
          onClick={() => setTab("updates")}
        >
          <Download size={14} />
          Client updates
        </button>
      </div>
      <div
        id={id + "-server-panel"}
        role="tabpanel"
        aria-labelledby={id + "-server-tab"}
        hidden={tab !== "server"}
      >
        <ServerManagementPanel
          key={JSON.stringify([hostId, host?.endpoint])}
          settings={settings}
          hostId={hostId}
          onSave={onSave}
          onClose={onClose}
          active={tab === "server"}
        />
      </div>
      <div
        id={id + "-updates-panel"}
        role="tabpanel"
        aria-labelledby={id + "-updates-tab"}
        hidden={tab !== "updates"}
      >
        <ClientUpdatesPanel
          settings={settings}
          onSave={onSave}
          onClose={onClose}
          active={tab === "updates"}
        />
      </div>
    </Dialog>
  );
}
