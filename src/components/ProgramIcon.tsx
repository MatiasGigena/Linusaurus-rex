import { Bot, Code2, GitBranch, Terminal } from "lucide-react";
import type { Settings } from "../shared/types";
export function ProgramIcon({
  program,
  size = 17,
  shellTheme = "default",
}: {
  program?: string;
  size?: number;
  shellTheme?: Settings["shellIconTheme"];
}) {
  const name = program?.toLowerCase() || "";
  if (/codex|claude|opencode|\bpi\b/.test(name)) return <Bot size={size} />;
  if (/git/.test(name)) return <GitBranch size={size} />;
  if (/vim|nvim|code/.test(name)) return <Code2 size={size} />;
  return (
    <Terminal
      className={`program-icon shell-artwork shell-${shellTheme}`}
      size={size}
      strokeWidth={1.7}
    />
  );
}
