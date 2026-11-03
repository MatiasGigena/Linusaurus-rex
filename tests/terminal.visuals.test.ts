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
