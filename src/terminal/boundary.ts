type State = 'ground' | 'escape' | 'csi' | 'osc' | 'string' | 'string-escape';

/**
 * Tracks safe points for a client preference sequence without modifying server
 * output. A WebSocket frame can end halfway through any terminal escape.
 */
export class TerminalBoundary {
  private state: State = 'ground';
  private stringState: 'osc' | 'string' = 'string';
  get ground(): boolean { return this.state === 'ground'; }
  reset(): void { this.state = 'ground'; }
  push(data: string): void {
    for (const character of data) {
      const code = character.codePointAt(0)!;
      if (code === 0x18 || code === 0x1a) { this.state = 'ground'; continue; }
      if (this.state === 'osc' || this.state === 'string') {
        if (code === 0x9c || (this.state === 'osc' && code === 7)) this.state = 'ground';
        else if (code === 0x1b) { this.stringState = this.state; this.state = 'string-escape'; }
        continue;
      }
      if (this.state === 'string-escape') {
        if (character === '\\' || code === 0x9c || (this.stringState === 'osc' && code === 7)) this.state = 'ground';
        else if (code !== 0x1b) this.state = this.stringState;
        continue;
      }
      if (code === 0x1b) { this.state = 'escape'; continue; }
      if (code === 0x9b) { this.state = 'csi'; continue; }
      if (code === 0x9d) { this.state = 'osc'; continue; }
      if ([0x90, 0x98, 0x9e, 0x9f].includes(code)) { this.state = 'string'; continue; }
      if (this.state === 'escape') {
        if (character === '[') this.state = 'csi';
        else if (character === ']') this.state = 'osc';
        else if (['P', '_', '^', 'X'].includes(character)) this.state = 'string';
        else if (code >= 0x30 && code <= 0x7e) this.state = 'ground';
      } else if (this.state === 'csi' && code >= 0x40 && code <= 0x7e) this.state = 'ground';
    }
  }
}
