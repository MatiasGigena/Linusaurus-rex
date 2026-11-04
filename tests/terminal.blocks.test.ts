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

test('block results always provide display text when successful serialization omits a top-level value', () => {
  for (const result of [Symbol('plugin value'), () => {}, { toJSON: () => undefined }]) {
    assert.equal(formatBlockResult(result), 'null');
  }
  assert.equal(formatBlockResult({ value: 7, omitted: undefined }), '{\n  "value": 7\n}');
  assert.equal(formatBlockResult([undefined]), '[\n  null\n]');
  const failure = new Error('plugin serialization failed');
  assert.throws(() => formatBlockResult({ toJSON() { throw failure; } }), error => error === failure);
});
