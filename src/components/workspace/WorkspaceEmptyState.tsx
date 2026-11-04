import { Command, Plus, RefreshCw, TerminalSquare } from "lucide-react";

export function WorkspaceEmptyState({
  connected,
  error,
  onNewSession,
  onReconnect,
  onPalette,
}: {
  connected: boolean;
  error?: string;
  onNewSession(): void;
  onReconnect(): void;
  onPalette(): void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-terminal-icon">
        <TerminalSquare size={30} />
      </div>
      <span className="eyebrow">LINUSAURUS REX</span>
      <h1>
        {connected
          ? "Make room for your next idea."
          : "Your workspace is waiting."}
      </h1>
      <p>
        {connected
          ? "Choose a session, or start a fresh workspace. Your programs stay on Rex when this app closes."
          : error ||
            "Connect to your existing Rex server to bring your terminals together."}
      </p>
      <div className="empty-actions">
        <button className="button button-primary" onClick={onNewSession}>
          <Plus size={15} />
          New session
        </button>
        <button className="button" onClick={onReconnect}>
          <RefreshCw size={14} />
          Reconnect
        </button>
      </div>
      <button className="empty-palette" onClick={onPalette}>
        <Command size={13} />
        Find a session or command<kbd>Ctrl Shift P</kbd>
      </button>
    </div>
  );
}
