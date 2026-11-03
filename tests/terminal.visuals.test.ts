import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseColor,
  nearestThemeColor,
  contrast,
  displayP3Color,
} from "../src/terminal/visuals.js";
import { KittyFramer, parseKittyCommand } from "../src/terminal/kitty.js";

test("theme quantization corrects contrast after nearest-color matching", () => {
  const palette = [
    [0, 0, 0],
    [64, 64, 64],
    [255, 255, 255],
  ] as const;
  assert.deepEqual(nearestThemeColor([65, 65, 65], palette), palette[1]);
  assert.deepEqual(
    nearestThemeColor([65, 65, 65], palette, palette[0], 7),
    palette[2],
  );
  assert.ok(contrast(palette[2], palette[0]) >= 7);
  assert.equal(
    displayP3Color([255, 128, 0]),
    "color(display-p3 1.00000 0.50196 0.00000)",
  );
  assert.deepEqual(parseColor("rgb(12, 34, 56)"), [12, 34, 56]);
});
test("Kitty framing preserves split text/escape continuations and protects other string protocols", () => {
  const source = "before\x1b_Ga=T,i=7,f=24,s=1,v=1;AAAA\x1b\\after";
  for (let split = 0; split <= source.length; split++) {
    const framer = new KittyFramer(),
      parts = [
        ...framer.push(source.slice(0, split)),
        ...framer.push(source.slice(split)),
      ];
    assert.equal(
      parts
        .filter((p) => p.kind === "text")
        .map((p) => p.data)
        .join(""),
      "beforeafter",
    );
    assert.deepEqual(
      parts.filter((p) => p.kind === "kitty").map((p) => p.data),
      ["a=T,i=7,f=24,s=1,v=1;AAAA"],
    );
  }
  const framed = new KittyFramer().push(
    "\x1b]2;title\x1b_Gnot-an-image\x07\x1bPqSIXEL\x1b\\",
  );
  assert.equal(framed.filter((p) => p.kind === "kitty").length, 0);
  assert.equal(
    framed.map((p) => p.data).join(""),
    "\x1b]2;title\x1b_Gnot-an-image\x07\x1bPqSIXEL\x1b\\",
  );
  assert.deepEqual(parseKittyCommand("a=p,i=2,C=1;"), {
    keys: { a: "p", i: "2", C: "1" },
    payload: "",
  });
});

test("virtual placement metadata retains SGR58 without visible underline and ignores RGB component zeroes", () => {
  const glyph = "\u{10eeee}",
    source =
      "\x1b[58;2;1;2;3m\x1b[38;2;0;0;0m" +
      glyph +
      "\u0305\u0305\x1b[59m" +
      glyph;
  const complete = new KittyFramer()
    .push(source)
    .filter((part) => part.kind === "text")
    .map((part) => part.data)
    .join("");
  assert.equal((complete.match(/\u034f/g) || []).length, 1);
  assert.ok(complete.includes(glyph + "\u034f\u030d\u030e\u0310\u0305\u0305"));
  const characters = Array.from(source);
  for (let split = 0; split <= characters.length; split++) {
    const framer = new KittyFramer();
    const output = [
      ...framer.push(characters.slice(0, split).join("")),
      ...framer.push(characters.slice(split).join("")),
    ]
      .map((part) => part.data)
      .join("");
    assert.equal(
      output,
      complete,
      "Metadata must survive every VT/codepoint frame boundary",
    );
  }
  for (const header of ["a=p,i=NaN", "a=p,i=-1", "a=p,p=4294967296"])
    assert.throws(() => parseKittyCommand(header), /32-bit|negative/);
});
