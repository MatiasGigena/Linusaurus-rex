import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBlockResult, inspectMethods, parseMethodArgs } from '../src/terminal/blocks.js';

test('plugin method discovery handles array and older dictionary schemas', () => {
  assert.deepEqual(inspectMethods({ methods: [{ name: 'read', description: 'Read a value', args_schema: { type: 'object' } }] }), [{ name: 'read', description: 'Read a value', schema: { type: 'object' } }]);
  assert.deepEqual(inspectMethods({ block: { methods: { inspect: { description: 'Inspect state', input_schema: { type: 'object' } } } } }), [{ name: 'inspect', description: 'Inspect state', schema: { type: 'object' } }]);
  assert.deepEqual(inspectMethods({ block: { block_id: 'b' }, api: { methods: { title: { description: 'Get title', input_schema: { type: 'object' } } } } }), [{ name: 'title', description: 'Get title', schema: { type: 'object' } }]);
  assert.deepEqual(inspectMethods({ methods: [null, { description: 'Nameless method' }] }), []);
  assert.deepEqual(inspectMethods(null), []);
});

test('plugin calls require an explicit JSON object and preserve literal argument strings', () => {
  assert.deepEqual(parseMethodArgs('{"value":"$(do-not-run)","enabled":true}'), { value: '$(do-not-run)', enabled: true });
  for (const text of ['null', '[]', '"hello"', '5']) assert.throws(() => parseMethodArgs(text), /JSON object/);
  assert.throws(() => parseMethodArgs('{'), SyntaxError);
  assert.equal(formatBlockResult(undefined), 'null');
});
