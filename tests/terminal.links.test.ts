import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkProtocol } from '../src/terminal/links.js';

test('link routing distinguishes web, permitted desktop apps, and forbidden protocols', () => {
  assert.equal(linkProtocol('https://example.com'), 'web');
  for (const url of ['vscode://file/tmp/demo.ts:4', 'ssh://user@host.example', 'mailto:hello@example.com', 'jetbrains://idea/navigate']) assert.equal(linkProtocol(url), 'app');
  for (const url of ['javascript:alert(1)', 'data:text/plain,test', 'file:///tmp/example', 'vbscript:run', 'unknown://app']) assert.equal(linkProtocol(url), undefined);
});
