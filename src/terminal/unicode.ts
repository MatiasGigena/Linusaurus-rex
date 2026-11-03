import type { IUnicodeVersionProvider } from '@xterm/xterm';
import { ZERO_WIDTH, DOUBLE_WIDTH } from './unicode-widths';

function contains(ranges: readonly (readonly [number, number])[], codepoint: number): boolean {
  let low = 0, high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (codepoint < ranges[middle][0]) high = middle - 1;
    else if (codepoint > ranges[middle][1]) low = middle + 1;
    else return true;
  }
  return false;
}

/** Rex's default codepoint-width mode, including modern emoji and zero-width ZWJ. */
export class RexUnicodeProvider implements IUnicodeVersionProvider {
  readonly version = 'rex-ghostty';
  wcwidth(codepoint: number): 0 | 1 | 2 {
    if (codepoint >= 0x20 && codepoint < 0x7f) return 1;
    return contains(ZERO_WIDTH, codepoint) ? 0 : contains(DOUBLE_WIDTH, codepoint) ? 2 : 1;
  }
  charProperties(codepoint: number, preceding: number): number {
    const width = this.wcwidth(codepoint);
    // Public Xterm 6 provider convention, also used by its Unicode11 addon:
    // bits 1–2 hold the cell width and bit 0 marks a combining continuation.
    const previousWidth = (preceding >>> 1) & 3;
    return width === 0 && previousWidth > 0 ? (previousWidth << 1) | 1 : width << 1;
  }
}
