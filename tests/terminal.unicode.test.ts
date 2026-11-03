import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadGhosttyVt } from 'khostty-libghostty-vt-wasm/api';
import { RexUnicodeProvider } from '../src/terminal/unicode.js';
import { ZERO_WIDTH, DOUBLE_WIDTH } from '../src/terminal/unicode-widths.js';

test('renderer width ranges agree with the canonical Ghostty snapshot decoder', async () => {
  const { abi } = await loadGhosttyVt();
  const authoritative = abi.fn('ghostty_unicode_codepoint_width');
  const provider = new RexUnicodeProvider();
  const boundaries = new Set([0x41, 0x301, 0x200d, 0x1f995, 0x1fae0, 0x1f469, 0x1f4bb]);
  for (const [start, end] of [...ZERO_WIDTH, ...DOUBLE_WIDTH]) for (const cp of [start - 1, start, end, end + 1]) if (cp >= 0 && cp <= 0x10ffff) boundaries.add(cp);
  for (const cp of boundaries) assert.equal(provider.wcwidth(cp), authoritative(cp), `U+${cp.toString(16)} width`);
  assert.equal(provider.wcwidth(0x1fae0), 2, 'Unicode14 melting-face emoji occupies two columns');
  assert.equal(provider.wcwidth(0x200d), 0, 'ZWJ does not add a column in the server default mode');
});
