import { ArrowDown, ArrowUp, CornerDownLeft, Search, Terminal } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';

export interface PaletteCommand {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  icon?: ReactNode;
  run: () => void;
}

export interface CommandPaletteProps {
  commands: PaletteCommand[];
  onClose: () => void;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const matches = commands.filter(command => `${command.label} ${command.description ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selectedIndex = Math.min(selected, Math.max(matches.length - 1, 0));
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selectedIndex]);
  const execute = (command: PaletteCommand) => { onClose(); command.run(); };

  return <Dialog title="Command palette" onClose={onClose} className="command-dialog" footer={<><span><ArrowUp size={12} /><ArrowDown size={12} /> to navigate</span><span><CornerDownLeft size={12} /> to select</span><span><kbd>esc</kbd> to close</span></>}>
    <div className="palette-search"><Search size={19} /><input data-autofocus aria-label="Search commands and sessions" placeholder="Search commands and sessions…" value={query} role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={matches[selectedIndex] ? `${listId}-${selectedIndex}` : undefined} autoComplete="off" onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(index => matches.length ? (index + 1) % matches.length : 0); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => matches.length ? (index - 1 + matches.length) % matches.length : 0); }
      if (event.key === 'Enter' && matches[selectedIndex]) { event.preventDefault(); execute(matches[selectedIndex]); }
    }} /><kbd>ESC</kbd></div>
    <div className="palette-results" id={listId} role="listbox" aria-label="Commands" ref={listRef}>
      {matches.length ? matches.map((command, index) => <button type="button" tabIndex={-1} role="option" aria-selected={index === selectedIndex} className={`palette-item ${index === selectedIndex ? 'is-selected' : ''}`} key={command.id} id={`${listId}-${index}`} onMouseMove={() => setSelected(index)} onClick={() => execute(command)}><span className="palette-item-icon">{command.icon ?? <Terminal size={17} />}</span><span className="palette-item-content"><span>{command.label}</span>{command.description && <small>{command.description}</small>}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}{index === selectedIndex && <CornerDownLeft size={14} className="palette-enter" />}</button>) : <div className="palette-empty">No commands match “{query}”.</div>}
    </div>
  </Dialog>;
}
