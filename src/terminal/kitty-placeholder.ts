import { KITTY_DIACRITICS } from "./kitty-diacritics";

const diacriticIndex = new Map(
  KITTY_DIACRITICS.map((code, index) => [code, index]),
);
export interface KittyPlaceholder {
  foreground: number;
  placementId: number;
  row: number;
  col: number;
  high: number;
}

/** Decode one placeholder, inheriting omitted coordinates only from its neighbor. */
export function decodeKittyPlaceholder(
  characters: string,
  foreground: number,
  placementId: number,
  previous?: KittyPlaceholder,
): KittyPlaceholder | undefined {
  if (!characters.startsWith("\u{10eeee}")) return undefined;
  const glyph = Array.from(characters);
  const encodedPid =
    glyph[1] === "\u034f" && glyph.length >= 5
      ? [2, 3, 4].map((index) =>
          diacriticIndex.get(glyph[index].codePointAt(0)!),
        )
      : [];
  const [pidHigh, pidMiddle, pidLow] = encodedPid;
  const pidMetadata =
    pidHigh !== undefined &&
    pidMiddle !== undefined &&
    pidLow !== undefined &&
    Math.max(pidHigh, pidMiddle, pidLow) < 256
      ? pidHigh * 65536 + pidMiddle * 256 + pidLow
      : undefined;
  const marks = glyph
    .slice(pidMetadata === undefined ? 1 : 5)
    .map((character) => diacriticIndex.get(character.codePointAt(0)!))
    .filter((value): value is number => value !== undefined);
  const pid = pidMetadata ?? placementId;
  const continuation =
    previous?.foreground === foreground && previous.placementId === pid
      ? previous
      : undefined;
  const row = marks[0] ?? continuation?.row ?? 0;
  const sameRow = continuation?.row === row ? continuation : undefined;
  const col = marks[1] ?? (sameRow ? sameRow.col + 1 : 0);
  const high =
    marks[2] ?? (sameRow && col === sameRow.col + 1 ? sameRow.high : 0);
  return { foreground, placementId: pid, row, col, high };
}
