import { ChevronDown, Columns2, Command, Maximize2, Minus, PanelLeft, Plus, Rows2, Settings2, Square, Terminal, X } from 'lucide-react';
import { IconButton } from './IconButton';

export interface ToolbarProps {
  title: string;
  subtitle?: string;
  connected: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onSplit: (direction: 'right' | 'below') => void;
  onNewWindow: () => void;
  onZoom: () => void;
  onCloseWindow: () => void;
  onPalette: () => void;
  onSettings: () => void;
  disabled?: boolean;
  zoomed?: boolean;
  onRename?: () => void;
  onRenameWindow?: () => void;
  onClosePane?: () => void;
  onWindowControl?: (action: 'minimize' | 'maximize' | 'close') => void;
}

export function Toolbar(props: ToolbarProps) {
  return <header className="workspace-toolbar">
    <div className="toolbar-leading">
      {props.sidebarCollapsed && <IconButton label="Show sidebar" shortcut="Ctrl Shift B" onClick={props.onToggleSidebar}><PanelLeft size={18} /></IconButton>}
      <span className="toolbar-terminal-icon"><Terminal size={19} /></span>
      <button className="toolbar-title" type="button" onClick={props.onRenameWindow ?? props.onRename ?? props.onPalette} title={props.onRenameWindow || props.onRename ? 'Rename terminal' : 'Switch session'}>
        <span>{props.title || 'Terminal'}</span>
        {props.subtitle && <span className="toolbar-subtitle">{props.subtitle}</span>}
        <ChevronDown size={12} className="title-chevron" />
      </button>
    </div>
    <div className="toolbar-actions">
      <span className={`toolbar-connection ${props.connected ? 'is-connected' : ''}`}><span className={`status-dot ${props.connected ? 'online' : 'offline'}`} />{props.connected ? 'Connected' : 'Disconnected'}</span>
      <span className="toolbar-divider" />
      <IconButton label="New terminal" shortcut="Ctrl Shift T" onClick={props.onNewWindow} disabled={props.disabled}><Plus size={18} /></IconButton>
      <IconButton label="Split right" shortcut="Ctrl Shift D" onClick={() => props.onSplit('right')} disabled={props.disabled}><Columns2 size={17} /></IconButton>
      <IconButton label="Split below" shortcut="Ctrl Shift Alt D" onClick={() => props.onSplit('below')} disabled={props.disabled}><Rows2 size={17} /></IconButton>
      <IconButton label={props.zoomed ? 'Restore panes' : 'Maximize pane'} shortcut="Ctrl Shift Enter" onClick={props.onZoom} disabled={props.disabled} active={props.zoomed}><Maximize2 size={16} /></IconButton>
      <span className="toolbar-divider" />
      <IconButton label="Command palette" shortcut="Ctrl Shift P" onClick={props.onPalette} className="toolbar-palette"><Command size={17} /></IconButton>
      <IconButton label="Settings" onClick={props.onSettings} className="toolbar-settings"><Settings2 size={17} /></IconButton>
      {props.onClosePane && <button type="button" className="pane-close-action" onClick={props.onClosePane} disabled={props.disabled}>Close pane</button>}
      <IconButton label="Close terminal" shortcut="Ctrl Shift W" onClick={props.onCloseWindow} disabled={props.disabled} className="danger-button"><X size={17} /></IconButton>
      {props.onWindowControl && <div className="window-controls" aria-label="Application window controls">
        <IconButton label="Minimize window" onClick={() => props.onWindowControl?.('minimize')}><Minus size={14} /></IconButton>
        <IconButton label="Maximize or restore window" onClick={() => props.onWindowControl?.('maximize')}><Square size={11} /></IconButton>
        <IconButton label="Close application" onClick={() => props.onWindowControl?.('close')} className="window-close"><X size={16} /></IconButton>
      </div>}
    </div>
  </header>;
}
