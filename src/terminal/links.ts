import type { ILink, Terminal } from '@xterm/xterm';

export const APP_LINK_PROTOCOLS = new Set(['mailto:', 'ssh:', 'sftp:', 'vscode:', 'vscode-insiders:', 'vscode-remote:', 'jetbrains:', 'idea:', 'pycharm:', 'webstorm:', 'goland:', 'clion:', 'rider:', 'rubymine:', 'phpstorm:', 'zed:']);
const appUrl = /\b(?:mailto:[^\s"'<>]+|(?:ssh|sftp|vscode(?:-insiders|-remote)?|jetbrains|idea|pycharm|webstorm|goland|clion|rider|rubymine|phpstorm|zed):\/\/[^\s"'<>]+)/gi;

export function linkProtocol(text: string): 'web' | 'app' | undefined {
  try {
    const protocol = new URL(text).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:' ? 'web' : APP_LINK_PROTOCOLS.has(protocol) ? 'app' : undefined;
  } catch { return undefined; }
}

/** Plain application links use the same wrapped-cell coordinates as OSC8 links. */
export function applicationLinks(terminal: Terminal, requestedLine: number, activate: (event: MouseEvent, uri: string) => void): ILink[] {
  const buffer = terminal.buffer.active;
  let start = requestedLine - 1;
  while (start > 0 && buffer.getLine(start)?.isWrapped && requestedLine - start < 128) start--;
  let text = '';
  const positions: { x: number; end: number; y: number }[] = [];
  for (let row = start; row < buffer.length && row < start + 128 && text.length < 8192; row++) {
    const line = buffer.getLine(row);
    if (!line || (row > start && !line.isWrapped)) break;
    const length = line.translateToString(true).length;
    let offset = 0;
    for (let column = 0; column < line.length && offset < length; column++) {
      const cell = line.getCell(column);
      if (!cell || cell.getWidth() === 0) continue;
      const chars = cell.getChars() || ' ';
      text += chars;
      for (let unit = 0; unit < chars.length; unit++) positions.push({ x: column + 1, end: column + cell.getWidth(), y: row + 1 });
      offset += chars.length;
    }
  }
  return [...text.matchAll(appUrl)].flatMap((match): ILink[] => {
    const uri = match[0].replace(/[),.;!?]+$/, '');
    if (linkProtocol(uri) !== 'app') return [];
    const first = positions[match.index!];
    const last = positions[match.index! + uri.length - 1];
    if (!first || !last) return [];
    return [{ text: uri, range: { start: { x: first.x, y: first.y }, end: { x: last.end, y: last.y } }, activate }];
  });
}
