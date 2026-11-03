import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TerminalBoundary } from '../src/terminal/boundary.js';

test('cursor preferences cannot be injected inside a split CSI sequence', () => {
  const parser = new TerminalBoundary();
  parser.push('text\x1b['); assert.equal(parser.ground, false);
  parser.push('5 '); assert.equal(parser.ground, false);
  parser.push('qnext'); assert.equal(parser.ground, true);
});

test('string payloads remain protected across WebSocket frame boundaries', () => {
  const parser = new TerminalBoundary();
  parser.push('\x1b]8;;https://example.com'); assert.equal(parser.ground, false);
  parser.push('\x1b'); assert.equal(parser.ground, false);
  parser.push('\\link'); assert.equal(parser.ground, true);
  parser.push('\x1bP1;2qpayload'); assert.equal(parser.ground, false);
  parser.push('\x1b\\'); assert.equal(parser.ground, true);
  parser.push('\x1b]0;title\x07'); assert.equal(parser.ground, true);
  parser.push('\x1b_opaque'); assert.equal(parser.ground, false);
  parser.push('\x18'); assert.equal(parser.ground, true);
});
