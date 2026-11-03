import type { IMarker, Terminal } from "@xterm/xterm";

export type GraphicsPart =
  { kind: "text"; data: string } | { kind: "kitty"; data: string };
const MAX_SEQUENCE = 24 * 1024 * 1024,
  MAX_PIXELS = 16 * 1024 * 1024,
  MAX_STORAGE = 64 * 1024 * 1024;
/** Extract Kitty APCs without mistaking payload bytes inside OSC/DCS strings for commands. */
export class KittyFramer {
  private state:
    | "ground"
    | "escape"
    | "string"
    | "stringEscape"
    | "apc"
    | "kitty"
    | "kittyEscape" = "ground";
  private held = "";
  private stringOsc = false;
  reset() {
    this.state = "ground";
    this.held = "";
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
        if (this.held.length > MAX_SEQUENCE) {
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
      else if (ch === "\x9f") this.state = "apc";
      else {
        text += ch;
        if (["\x90", "\x9d", "\x9e"].includes(ch)) {
          this.state = "string";
          this.stringOsc = ch === "\x9d";
        }
      }
    }
    flush();
    return parts;
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
    keys[pair[1]] = pair[2];
  }
  return { keys, payload };
}
interface ImageRecord {
  canvas: HTMLCanvasElement;
  bytes: number;
  number?: number;
}
interface Placement {
  imageId: number;
  id: number;
  marker: IMarker;
  x: number;
  cols: number;
  rows: number;
  offsetX: number;
  offsetY: number;
  source: [number, number, number, number];
  canvas: HTMLCanvasElement;
  screen: "normal" | "alternate";
  z: number;
}
/** Direct-payload Kitty graphics. No filesystem, shared-memory, or remote URL access. */
export class KittyGraphics {
  readonly framer = new KittyFramer();
  private images = new Map<number, ImageRecord>();
  private placements: Placement[] = [];
  private chunk: { keys: Record<string, string>; payload: string } | undefined;
  private serial = 1;
  private layer: HTMLDivElement;
  private subscriptions: { dispose(): void }[] = [];
  constructor(
    private term: Terminal,
    private element: HTMLDivElement,
  ) {
    this.layer = document.createElement("div");
    this.layer.className = "kitty-image-layer";
    element.appendChild(this.layer);
    this.subscriptions.push(
      term.onRender(() => this.render()),
      term.onScroll(() => this.render()),
      term.onResize(() => this.render()),
      term.buffer.onBufferChange(() => this.render()),
      term.parser.registerEscHandler({ final: "c" }, () => {
        this.reset();
        return false;
      }),
      term.parser.registerCsiHandler({ final: "J" }, (params) => {
        if (params[0] === 2) this.delete({ d: "a" });
        if (params[0] === 3) this.removePlacements(() => true);
        return false;
      }),
    );
  }
  setEnabled(enabled: boolean) {
    this.layer.hidden = !enabled;
  }
  reset() {
    this.framer.reset();
    this.chunk = undefined;
    this.images.clear();
    for (const placement of this.placements) placement.marker.dispose();
    this.placements = [];
    this.layer.replaceChildren();
  }
  async command(sequence: string): Promise<string> {
    const { keys, payload } = parseKittyCommand(sequence),
      action = keys.a || this.chunk?.keys.a || "t";
    if (action === "q") return ""; // Rex's authoritative terminal has already answered all queries.
    if (action === "d") {
      this.delete(keys);
      return "";
    }
    if (!["t", "T", "p"].includes(action))
      throw new Error(
        `Kitty graphics action ${action} is not supported by this renderer.`,
      );
    if (keys.U === "1" || keys.P)
      throw new Error(
        "Kitty Unicode/relative placements require a newer renderer.",
      );
    let effective = keys,
      id = Number(keys.i) || 0;
    if (action === "t" || action === "T") {
      if (keys.t && keys.t !== "d")
        throw new Error(
          "Kitty images must use a direct payload; file and shared-memory transfers are disabled.",
        );
      if (this.chunk) {
        this.chunk.payload += payload;
        if (this.chunk.payload.length > MAX_SEQUENCE) {
          this.chunk = undefined;
          throw new Error("Chunked Kitty image exceeds 24 MiB.");
        }
        effective = { ...this.chunk.keys, ...keys };
        if (keys.m === "1") return "";
      } else if (keys.m === "1") {
        this.chunk = { keys, payload };
        return "";
      }
      const encoded = this.chunk?.payload || payload;
      this.chunk = undefined;
      id = Number(effective.i) || this.serial++;
      const canvas = await decodeKittyImage(effective, encoded);
      this.images.delete(id);
      this.images.set(id, {
        canvas,
        bytes: canvas.width * canvas.height * 4,
        number: Number(effective.I) || undefined,
      });
      while (
        [...this.images.values()].reduce((sum, image) => sum + image.bytes, 0) >
        MAX_STORAGE
      ) {
        const old = this.images.keys().next().value!;
        this.images.delete(old);
        this.removePlacements((placement) => placement.imageId === old);
      }
      if (action === "t" && effective.a !== "T") return "";
    }
    if (!id && effective.I) {
      const number = Number(effective.I);
      id =
        [...this.images]
          .reverse()
          .find(([, image]) => image.number === number)?.[0] || 0;
    }
    const image = this.images.get(id);
    if (!image) throw new Error(`Kitty image ${id} has not been transmitted.`);
    const screen = this.element.querySelector<HTMLElement>(".xterm-screen"),
      cellWidth = (screen?.clientWidth || this.term.cols * 9) / this.term.cols,
      cellHeight =
        (screen?.clientHeight || this.term.rows * 18) / this.term.rows;
    const source: [number, number, number, number] = [
      Math.max(0, Number(effective.x) || 0),
      Math.max(0, Number(effective.y) || 0),
      Number(effective.w) || image.canvas.width,
      Number(effective.h) || image.canvas.height,
    ];
    source[2] = Math.min(source[2], image.canvas.width - source[0]);
    source[3] = Math.min(source[3], image.canvas.height - source[1]);
    if (source[2] <= 0 || source[3] <= 0)
      throw new Error("Kitty source crop is outside the image.");
    let cols = Number(effective.c) || 0,
      rows = Number(effective.r) || 0;
    if (!cols && !rows) {
      cols = Math.max(1, Math.ceil(source[2] / cellWidth));
      rows = Math.max(1, Math.ceil(source[3] / cellHeight));
    } else if (!cols)
      cols = Math.max(
        1,
        Math.ceil((rows * cellHeight * source[2]) / source[3] / cellWidth),
      );
    else if (!rows)
      rows = Math.max(
        1,
        Math.ceil((cols * cellWidth * source[3]) / source[2] / cellHeight),
      );
    cols = Math.min(4096, Math.max(1, cols));
    rows = Math.min(4096, Math.max(1, rows));
    const marker = this.term.registerMarker(0);
    if (!marker) return "";
    const placementId = Number(effective.p) || this.serial++;
    this.removePlacements(
      (placement) => placement.imageId === id && placement.id === placementId,
    );
    const canvas = document.createElement("canvas");
    canvas.width = source[2];
    canvas.height = source[3];
    canvas.dataset.kittyImage = String(id);
    canvas.dataset.kittyPlacement = String(placementId);
    canvas
      .getContext("2d")!
      .drawImage(image.canvas, ...source, 0, 0, source[2], source[3]);
    this.placements.push({
      imageId: id,
      id: placementId,
      marker,
      x: this.term.buffer.active.cursorX,
      cols,
      rows,
      offsetX: Number(effective.X) || 0,
      offsetY: Number(effective.Y) || 0,
      source,
      canvas,
      screen: this.term.buffer.active.type,
      z: Number(effective.z) || 0,
    });
    this.layer.appendChild(canvas);
    this.render();
    return effective.C === "1" ? "" : `\x1b[${rows}B\x1b[${cols}C`;
  }
  private removePlacements(predicate: (placement: Placement) => boolean) {
    this.placements = this.placements.filter((placement) => {
      if (!predicate(placement)) return true;
      placement.canvas.remove();
      placement.marker.dispose();
      return false;
    });
  }
  private delete(keys: Record<string, string>) {
    const mode = keys.d || "a",
      lower = mode.toLowerCase();
    const id =
      Number(keys.i) ||
      [...this.images]
        .reverse()
        .find(([, image]) => image.number === Number(keys.I))?.[0];
    const predicate = (placement: Placement) => {
      if (lower === "i" || lower === "n")
        return (
          placement.imageId === id &&
          (!keys.p || placement.id === Number(keys.p))
        );
      if (lower === "a")
        return (
          placement.screen === this.term.buffer.active.type &&
          placement.marker.line >= this.term.buffer.active.viewportY &&
          placement.marker.line <
            this.term.buffer.active.viewportY + this.term.rows
        );
      if (lower === "c" || lower === "p") {
        const x =
            lower === "c"
              ? this.term.buffer.active.cursorX
              : Number(keys.x) - 1,
          y =
            lower === "c"
              ? this.term.buffer.active.baseY + this.term.buffer.active.cursorY
              : this.term.buffer.active.viewportY + Number(keys.y) - 1;
        return (
          x >= placement.x &&
          x < placement.x + placement.cols &&
          y >= placement.marker.line &&
          y < placement.marker.line + placement.rows
        );
      }
      return false;
    };
    this.removePlacements(predicate);
    if (mode !== lower) {
      if (id) this.images.delete(id);
      else if (lower === "a")
        for (const id of this.images.keys())
          if (!this.placements.some((placement) => placement.imageId === id))
            this.images.delete(id);
    }
  }
  private render() {
    const screen = this.element.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) return;
    const box = screen.getBoundingClientRect(),
      origin = this.element.getBoundingClientRect(),
      cw = box.width / this.term.cols,
      ch = box.height / this.term.rows;
    Object.assign(this.layer.style, {
      left: `${box.left - origin.left}px`,
      top: `${box.top - origin.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    this.removePlacements((placement) => placement.marker.isDisposed);
    for (const placement of this.placements) {
      const y = placement.marker.line - this.term.buffer.active.viewportY;
      Object.assign(placement.canvas.style, {
        display:
          placement.screen === this.term.buffer.active.type ? "block" : "none",
        left: `${placement.x * cw + placement.offsetX}px`,
        top: `${y * ch + placement.offsetY}px`,
        width: `${placement.cols * cw}px`,
        height: `${placement.rows * ch}px`,
        zIndex: String(Math.max(-2, Math.min(2, placement.z))),
      });
    }
  }
  dispose() {
    this.reset();
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.layer.remove();
  }
}

export async function decodeKittyImage(
  keys: Record<string, string>,
  encoded: string,
): Promise<HTMLCanvasElement> {
  if (encoded.length > MAX_SEQUENCE || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
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
    height < 1 ||
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
  } else if (format === 24 || format === 32) {
    const channels = format / 8;
    if (bytes.length !== width * height * channels)
      throw new Error(
        "Kitty raw pixel data length does not match its dimensions.",
      );
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      rgba[pixel * 4] = bytes[pixel * channels];
      rgba[pixel * 4 + 1] = bytes[pixel * channels + 1];
      rgba[pixel * 4 + 2] = bytes[pixel * channels + 2];
      rgba[pixel * 4 + 3] = channels === 4 ? bytes[pixel * channels + 3] : 255;
    }
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
  } else throw new Error(`Kitty image format ${format} is not supported.`);
  return canvas;
}
