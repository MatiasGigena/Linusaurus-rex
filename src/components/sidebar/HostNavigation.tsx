import {
  Laptop,
  Server,
  ChevronRight,
  ChevronDown,
  Plus,
  WifiOff,
} from "lucide-react";
import { IconButton } from "../IconButton";
import type { NavigationHost } from "./Sidebar";
import type { NavigationContext } from "./navigation";
import { SessionNavigation } from "./SessionNavigation";
export function HostNavigation({
  host,
  index,
  closed,
  onToggleHost,
  ...props
}: NavigationContext & {
  host: NavigationHost;
  index: number;
  closed: boolean;
  onToggleHost(id: string): void;
}) {
  return (
    <section key={host.id} className="host-group">
      <div className="host-heading">
        <button
          type="button"
          className="host-toggle"
          aria-expanded={!closed}
          onClick={() => onToggleHost(host.id)}
          title={host.endpoint ?? host.label}
        >
          <span className="host-icon">
            {index === 0 ? <Laptop size={18} /> : <Server size={17} />}
          </span>
          <span className="host-name">{host.label}</span>
          <span
            className={`status-dot ${host.connected ? "online" : "offline"}`}
            aria-label={host.connected ? "Connected" : "Disconnected"}
          />
          {closed ? (
            <ChevronRight size={13} className="host-chevron" />
          ) : (
            <ChevronDown size={13} className="host-chevron" />
          )}
        </button>
        <IconButton
          label={`New session on ${host.label}`}
          onClick={() => props.onNewSession(host.id)}
          className="host-add"
        >
          <Plus size={15} />
        </IconButton>
      </div>
      {!closed && (
        <div className="host-sessions">
          {!host.connected && (
            <div className="host-disconnected" title={host.error}>
              <WifiOff size={13} />
              <span>{host.error || "Waiting for connection"}</span>
            </div>
          )}
          {host.sessions.length === 0 && host.connected && (
            <button
              type="button"
              className="no-sessions"
              onClick={() => props.onNewSession(host.id)}
            >
              <Plus size={13} /> Create a session
            </button>
          )}
          {host.sessions.map((session) => (
            <SessionNavigation
              key={session.id}
              hostId={host.id}
              session={session}
              {...props}
            />
          ))}
        </div>
      )}
    </section>
  );
}
