import { KITTY_DIACRITICS } from "./kitty-diacritics";

export type GraphicsPart =
  { kind: "text"; data: string } | { kind: "kitty"; data: string };
export const MAX_KITTY_SEQUENCE_LENGTH = 24 * 1024 * 1024;
const MAX_PIXELS = 16 * 1024 * 1024;
/** Extract Kitty APCs without mistaking payload bytes inside OSC/DCS strings for commands. */
export class KittyFramer {
  private state:
    | "ground"
    | "escape"
    | "csi"
    | "string"
    | "stringEscape"
    | "apc"
    | "kitty"
    | "kittyEscape" = "ground";
  private held = "";
  private stringOsc = false;
  private csi = "";
  private underline = 0;
  private savedUnderline = 0;
  reset() {
    this.state = "ground";
    this.held = "";
    this.csi = "";
    this.underline = 0;
    this.savedUnderline = 0;
  }
  push(data: string): GraphicsPart[] {
    const parts: GraphicsPart[] = [];
    let text = "";
    const flush = () => {
      if (text) {
        parts.push({ kind: "text", data: text });
        text = "";
      }
    };
    for (const ch of data) {
      if (this.state === "csi") {
        if (ch === "\x1b") {
          this.state = "escape";
          this.csi = "";
          continue;
        }
        text += ch;
        this.csi += ch;
        if (this.csi.length > 4096) this.csi = "";
        if (ch >= "@" && ch <= "~") {
          if (ch === "m") this.rendition(this.csi.slice(0, -1));
          this.state = "ground";
          this.csi = "";
        }
        continue;
      }
      if (
        (this.state === "kitty" || this.state === "kittyEscape") &&
        (ch === "\x18" || ch === "\x1a")
      ) {
        this.reset();
        text += ch;
        continue;
      }
      if (this.state === "kitty") {
        if (ch === "\x1b") this.state = "kittyEscape";
        else if (ch === "\x9c") {
          flush();
          parts.push({ kind: "kitty", data: this.held });
          this.held = "";
          this.state = "ground";
        } else this.held += ch;
        if (this.held.length > MAX_KITTY_SEQUENCE_LENGTH) {
          this.reset();
          throw new Error("Kitty graphics sequence exceeds 24 MiB.");
        }
        continue;
      }
      if (this.state === "kittyEscape") {
        if (ch === "\\") {
          flush();
          parts.push({ kind: "kitty", data: this.held });
          this.held = "";
          this.state = "ground";
        } else {
          this.held += "\x1b" + ch;
          this.state = "kitty";
        }
        continue;
      }
      if (this.state === "apc") {
        if (ch === "G") {
          flush();
          this.state = "kitty";
          this.held = "";
        } else {
          text += "\x1b_" + ch;
          this.state = ch === "\x1b" ? "stringEscape" : "string";
          this.stringOsc = false;
        }
        continue;
      }
      if (this.state === "escape") {
        if (ch === "_") {
          this.state = "apc";
          continue;
        }
        text += "\x1b" + ch;
        if (ch === "[") {
          this.state = "csi";
          this.csi = "";
          continue;
        }
        if (ch === "7") this.savedUnderline = this.underline;
        if (ch === "8") this.underline = this.savedUnderline;
        if (ch === "c") this.underline = 0;
        if (["P", "]", "^", "X"].includes(ch)) {
          this.state = "string";
          this.stringOsc = ch === "]";
        } else this.state = "ground";
        continue;
      }
      if (this.state === "string") {
        text += ch;
        if (ch === "\x1b") this.state = "stringEscape";
        else if (ch === "\x9c" || (ch === "\x07" && this.stringOsc))
          this.state = "ground";
        continue;
      }
      if (this.state === "stringEscape") {
        text += ch;
        if (ch === "\\") this.state = "ground";
        else if (ch !== "\x1b") this.state = "string";
        continue;
      }
      if (ch === "\x1b") this.state = "escape";
      else if (ch === "\x9b") {
        text += ch;
        this.state = "csi";
        this.csi = "";
      } else if (ch === "\x9f") this.state = "apc";
      else {
        text += ch;
        // xterm discards SGR 58 when underline drawing is off. Encode the PID
        // inside this protocol-only grapheme using width-zero combining data.
        if (ch === "\u{10eeee}" && this.underline) {
          text +=
            "\u034f" +
            [16, 8, 0]
              .map((shift) =>
                String.fromCodePoint(
                  KITTY_DIACRITICS[(this.underline >>> shift) & 255],
                ),
              )
              .join("");
        }
        if (["\x90", "\x9d", "\x9e"].includes(ch)) {
          this.state = "string";
          this.stringOsc = ch === "\x9d";
        }
      }
    }
    flush();
    return parts;
  }
  private rendition(sequence: string) {
    const values = (sequence || "0").split(";");
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      if (value === "" || value === "0" || value === "59") {
        this.underline = 0;
        continue;
      }
      if (value === "38" || value === "48") {
        const mode = Number(values[++index]);
        index += mode === 2 ? 3 : mode === 5 ? 1 : 0;
        continue;
      }
      if (value.startsWith("58:")) {
        const fields = value.split(":");
        if (fields[1] === "5")
          this.underline = Math.max(0, Math.min(255, Number(fields[2]) || 0));
        else if (fields[1] === "2") {
          const rgb = fields.slice(-3).map(Number);
          if (rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255))
            this.underline = rgb[0] * 65536 + rgb[1] * 256 + rgb[2];
        }
        continue;
      }
      if (value === "58") {
        const mode = Number(values[++index]);
        if (mode === 5)
          this.underline = Math.max(
            0,
            Math.min(255, Number(values[++index]) || 0),
          );
        else if (mode === 2) {
          const rgb = values.slice(index + 1, index + 4).map(Number);
          index += 3;
          if (
            rgb.length === 3 &&
            rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
          )
            this.underline = rgb[0] * 65536 + rgb[1] * 256 + rgb[2];
        }
      }
    }
  }
}
export function parseKittyCommand(sequence: string): {
  keys: Record<string, string>;
  payload: string;
} {
  const at = sequence.indexOf(";"),
    header = at < 0 ? sequence : sequence.slice(0, at),
    payload = at < 0 ? "" : sequence.slice(at + 1);
  if (header.length > 4096)
    throw new Error("Kitty control header is too large.");
  const keys: Record<string, string> = {};
  for (const entry of header.split(",")) {
    const pair = /^([a-zA-Z])=([-\w]+)$/.exec(entry);
    if (!pair) throw new Error("Malformed Kitty graphics control.");
    if (!["a", "t", "o", "d", "e"].includes(pair[1])) {
      const value = Number(pair[2]);
      if (
        !/^-?\d+$/.test(pair[2]) ||
        !Number.isSafeInteger(value) ||
        value < -2147483648 ||
        value > 4294967295
      )
        throw new Error("Kitty numeric controls must be 32-bit integers.");
      if (["i", "I", "p", "P", "Q"].includes(pair[1]) && value < 0)
        throw new Error("Kitty image and placement ids cannot be negative.");
    }
    keys[pair[1]] = pair[2];
  }
  return { keys, payload };
}

export async function decodeKittyImage(
  keys: Record<string, string>,
  encoded: string,
): Promise<HTMLCanvasElement> {
  if (
    encoded.length > MAX_KITTY_SEQUENCE_LENGTH ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new Error("Invalid Kitty base64 image payload.");
  let bytes = Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0));
  if (keys.o) {
    if (keys.o !== "z") throw new Error("Unsupported Kitty image compression.");
    const reader = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"))
      .getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        length += result.value.length;
        if (length > MAX_PIXELS * 4)
          throw new Error("Decompressed Kitty image exceeds the pixel limit.");
        chunks.push(result.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
  }
  const format = Number(keys.f) || 32;
  let width = Number(keys.s),
    height = Number(keys.v);
  if (format === 100) {
    if (
      bytes.length < 24 ||
      String.fromCharCode(...bytes.subarray(1, 4)) !== "PNG"
    )
      throw new Error("Kitty format100 requires PNG data.");
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    width = data.getUint32(16);
    height = data.getUint32(20);
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    width > 32768 ||
    height < 1 ||
    height > 32768 ||
    width * height > MAX_PIXELS
  )
    throw new Error("Kitty image dimensions exceed the 16-megapixel limit.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  if (format === 100) {
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
  } else if ([8, 16, 24, 32].includes(format)) {
    const channels = format / 8;
    if (bytes.length !== width * height * channels)
      throw new Error(
        "Kitty raw pixel data length does not match its dimensions.",
      );
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      rgba[pixel * 4] = bytes[pixel * channels];
      rgba[pixel * 4 + 1] =
        channels <= 2 ? bytes[pixel * channels] : bytes[pixel * channels + 1];
      rgba[pixel * 4 + 2] =
        channels <= 2 ? bytes[pixel * channels] : bytes[pixel * channels + 2];
      rgba[pixel * 4 + 3] =
        channels === 2
          ? bytes[pixel * channels + 1]
          : channels === 4
            ? bytes[pixel * channels + 3]
            : 255;
    }
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
  } else throw new Error(`Kitty image format ${format} is not supported.`);
  return canvas;
}
