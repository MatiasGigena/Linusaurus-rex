import assert from "node:assert/strict";
import { test } from "node:test";
import { KITTY_DIACRITICS } from "../src/terminal/kitty-diacritics.js";
import { decodeKittyPlaceholder } from "../src/terminal/kitty-placeholder.js";

const placeholder = "\u{10eeee}";
const mark = (value: number) => String.fromCodePoint(KITTY_DIACRITICS[value]);

test("placeholder coordinates inherit only from contiguous cells with the same image and placement", () => {
  const first = decodeKittyPlaceholder(
    placeholder + mark(2) + mark(3) + mark(17),
    0x123456,
    7,
  );
  assert.deepEqual(first, {
    foreground: 0x123456,
    placementId: 7,
    row: 2,
    col: 3,
    high: 17,
  });
  assert.deepEqual(decodeKittyPlaceholder(placeholder, 0x123456, 7, first), {
    ...first,
    col: 4,
  });
  assert.deepEqual(
    decodeKittyPlaceholder(placeholder + mark(9), 0x123456, 7, first),
    { ...first, row: 9, col: 0, high: 0 },
  );
  assert.deepEqual(
    decodeKittyPlaceholder(
      placeholder + mark(2) + mark(10),
      0x123456,
      7,
      first,
    ),
    { ...first, col: 10, high: 0 },
  );
  assert.deepEqual(decodeKittyPlaceholder(placeholder, 0x654321, 7, first), {
    foreground: 0x654321,
    placementId: 7,
    row: 0,
    col: 0,
    high: 0,
  });
  assert.deepEqual(decodeKittyPlaceholder(placeholder, 0x123456, 8, first), {
    foreground: 0x123456,
    placementId: 8,
    row: 0,
    col: 0,
    high: 0,
  });
  assert.equal(
    decodeKittyPlaceholder("plain text", 0x123456, 7, first),
    undefined,
  );
});

test("framer-encoded placement metadata overrides underline fallback without consuming coordinate marks", () => {
  const glyph =
    placeholder + "\u034f" + [0x12, 0x34, 0x56, 1, 2, 3].map(mark).join("");
  assert.deepEqual(decodeKittyPlaceholder(glyph, 0xabcdef, 9), {
    foreground: 0xabcdef,
    placementId: 0x123456,
    row: 1,
    col: 2,
    high: 3,
  });
});
