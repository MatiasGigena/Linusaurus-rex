import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatBlockResult,
  inspectMethods,
  parseMethodArgs,
} from "../src/terminal/blocks.js";

test("plugin method discovery handles array and older dictionary schemas", () => {
  assert.deepEqual(
    inspectMethods({
      methods: [
        {
          name: "read",
          description: "Read a value",
          args_schema: { type: "object" },
        },
      ],
    }),
    [{ name: "read", description: "Read a value", schema: { type: "object" } }],
  );
  assert.deepEqual(
    inspectMethods({
      block: {
        methods: {
          inspect: {
            description: "Inspect state",
            input_schema: { type: "object" },
          },
        },
      },
    }),
    [
      {
        name: "inspect",
        description: "Inspect state",
        schema: { type: "object" },
      },
    ],
  );
  assert.deepEqual(
    inspectMethods({
      block: { block_id: "b" },
      api: {
        methods: {
          title: { description: "Get title", input_schema: { type: "object" } },
        },
      },
    }),
    [{ name: "title", description: "Get title", schema: { type: "object" } }],
  );
  assert.deepEqual(
    inspectMethods({ methods: [null, { description: "Nameless method" }] }),
    [],
  );
  assert.deepEqual(inspectMethods(null), []);
});

test("method discovery preserves all advertised source priorities, including empty sources", () => {
  const info: Record<string, unknown> = {
    api: { methods: ["api"] },
    methods: ["root"],
    block: { methods: ["block"] },
    creator: { methods: ["creator"] },
    block_type: { methods: ["block-type"] },
    info: { methods: ["info"] },
  };
  for (const [key, expected] of [
    ["api", "api"],
    ["methods", "root"],
    ["block", "block"],
    ["creator", "creator"],
    ["block_type", "block-type"],
    ["info", "info"],
  ]) {
    assert.deepEqual(inspectMethods(info), [
      { name: expected, description: "" },
    ]);
    delete info[key];
  }
  assert.deepEqual(
    inspectMethods({ api: { methods: [] }, methods: ["fallback"] }),
    [],
  );
  assert.deepEqual(
    inspectMethods({ api: { methods: {} }, methods: ["fallback"] }),
    [],
  );
  assert.deepEqual(
    inspectMethods({ api: { methods: "invalid" }, methods: ["fallback"] }),
    [{ name: "fallback", description: "" }],
  );
});

test("dictionary methods preserve explicit names, primitive descriptions and schema aliases", () => {
  assert.deepEqual(
    inspectMethods({
      methods: {
        described: "Description from an older API",
        numeric: 7,
        zero: 0,
        false: false,
        empty: null,
        array: ["older dictionary metadata"],
        renamed: {
          name: "explicit",
          description: "Named method",
          args_schema: { preferred: true },
          input_schema: { ignored: true },
          argsSchema: { ignored: true },
        },
        aliased: {
          name: null,
          method: "legacy",
          args_schema: [],
          input_schema: { type: "object" },
        },
        camel: {
          args_schema: null,
          input_schema: 3,
          argsSchema: { additionalProperties: false },
        },
        hidden: { name: "" },
      },
    }),
    [
      {
        name: "described",
        description: "Description from an older API",
        schema: undefined,
      },
      { name: "numeric", description: "7", schema: undefined },
      { name: "zero", description: "", schema: undefined },
      { name: "false", description: "", schema: undefined },
      { name: "empty", description: "", schema: undefined },
      { name: "array", description: "", schema: undefined },
      {
        name: "explicit",
        description: "Named method",
        schema: { preferred: true },
      },
      { name: "legacy", description: "", schema: { type: "object" } },
      {
        name: "camel",
        description: "",
        schema: { additionalProperties: false },
      },
    ],
  );
  assert.deepEqual(
    inspectMethods({
      methods: [
        "",
        { method: "aliased" },
        { name: "", method: "ignored" },
        [],
        5,
      ],
    }),
    [
      { name: "", description: "" },
      { name: "aliased", description: "", schema: undefined },
    ],
  );
});

test("plugin calls require an explicit JSON object and preserve literal argument strings", () => {
  assert.deepEqual(
    parseMethodArgs('{"value":"$(do-not-run)","enabled":true}'),
    { value: "$(do-not-run)", enabled: true },
  );
  for (const text of ["null", "[]", '"hello"', "5"])
    assert.throws(() => parseMethodArgs(text), /JSON object/);
  assert.throws(() => parseMethodArgs("{"), SyntaxError);
  assert.equal(formatBlockResult(undefined), "null");
});

test("block results always provide display text when successful serialization omits a top-level value", () => {
  for (const result of [
    Symbol("plugin value"),
    () => {},
    { toJSON: () => undefined },
  ]) {
    assert.equal(formatBlockResult(result), "null");
  }
  assert.equal(
    formatBlockResult({ value: 7, omitted: undefined }),
    '{\n  "value": 7\n}',
  );
  assert.equal(formatBlockResult([undefined]), "[\n  null\n]");
  const failure = new Error("plugin serialization failed");
  assert.throws(
    () =>
      formatBlockResult({
        toJSON() {
          throw failure;
        },
      }),
    (error) => error === failure,
  );
});
