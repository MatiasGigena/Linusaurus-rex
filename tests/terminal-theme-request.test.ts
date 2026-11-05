import assert from "node:assert/strict";
import { test } from "node:test";
import { terminalThemeRequest } from "../electron/features/terminal-theme.js";

const colors = {
  foreground: "#aabbcc",
  background: "112233",
  cursor: "#ffffff",
  scheme: "dark",
  palette: ["#000000", "15=#ffffff"],
};
test("terminal theme translation indexes positional colors and preserves explicit palette slots", () => {
  assert.deepEqual(terminalThemeRequest(colors), {
    ...colors,
    palette: ["0=#000000", "15=#ffffff"],
  });
});
test("terminal theme requests reject malformed colors, schemes and palette indexes", () => {
  for (const changed of [
    { foreground: "rgb(0,0,0)" },
    { scheme: "system" },
    { palette: ["256=#ffffff"] },
    { palette: [null] },
  ])
    assert.throws(
      () => terminalThemeRequest({ ...colors, ...changed }),
      /[Ii]nvalid|six-digit/,
    );
});
