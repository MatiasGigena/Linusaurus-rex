import { Bot, Code2, GitBranch, Terminal } from 'lucide-react';
export function ProgramIcon({ program, size = 17 }: { program?: string; size?: number }) {
  const name = program?.toLowerCase() || '';
  if (/codex|claude|opencode|\bpi\b/.test(name)) return <Bot size={size} />;
  if (/git/.test(name)) return <GitBranch size={size} />;
  if (/vim|nvim|code/.test(name)) return <Code2 size={size} />;
  return <Terminal size={size} strokeWidth={1.7} />;
}
