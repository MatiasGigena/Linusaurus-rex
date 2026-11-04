import type { IBufferCell, IMarker, Terminal } from "@xterm/xterm";
import { KITTY_DIACRITICS } from "./kitty-diacritics";
import { KittyCompositor, type KittyDrawOperation } from "./kitty-compositor";

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
interface Frame {
  canvas: HTMLCanvasElement;
  gap: number;
}
interface ImageRecord {
  canvas: HTMLCanvasElement;
  bytes: number;
  number?: number;
  frames: Frame[];
  current: number;
  state: 1 | 2 | 3;
  loops: number;
  limit: number;
  timer?: ReturnType<typeof setTimeout>;
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
  parent?: { imageId: number; id: number; dx: number; dy: number };
}
interface VirtualPlacement {
  imageId: number;
  id: number;
  cols: number;
  rows: number;
  z: number;
  source: [number, number, number, number];
}
const MAX_FRAMES = 64,
  MAX_PLACEMENTS = 2048;
const diacriticIndex = new Map(
  KITTY_DIACRITICS.map((code, index) => [code, index]),
);
const placementKey = (imageId: number, id: number) => `${imageId}/${id}`;
/** Direct-payload Kitty graphics. Filesystem/shared-memory transfers stay on the server. */
export class KittyGraphics {
  readonly framer = new KittyFramer();
  private images = new Map<number, ImageRecord>();
  private placements: Placement[] = [];
  private virtual = new Map<string, VirtualPlacement>();
  private virtualOrigins = new Map<string, { x: number; y: number }>();
  private chunk: { keys: Record<string, string>; payload: string } | undefined;
  private serial = 1;
  private layer: HTMLDivElement;
  private virtualCanvas: HTMLCanvasElement;
  private subscriptions: { dispose(): void }[] = [];
  private enabled = true;
  private disposed = false;
  private compositor: KittyCompositor;
  constructor(
    private term: Terminal,
    private element: HTMLDivElement,
  ) {
    this.layer = document.createElement("div");
    this.layer.className = "kitty-image-layer";
    this.layer.setAttribute("aria-hidden", "true");
    element.appendChild(this.layer);
    this.virtualCanvas = document.createElement("canvas");
    this.virtualCanvas.dataset.kittyVirtual = "true";
    this.layer.appendChild(this.virtualCanvas);
    this.compositor = new KittyCompositor(term, element);
    const styleChanged = () => this.render();
    element.addEventListener("rex-terminal-visuals", styleChanged);
    this.subscriptions.push({
      dispose: () =>
        element.removeEventListener("rex-terminal-visuals", styleChanged),
    });
    this.subscriptions.push(
      term.onRender(() => this.render()),
      term.onScroll(() => this.render()),
      term.onResize(() => this.render()),
      term.buffer.onBufferChange(() => this.render()),
      term.parser.registerEscHandler({ final: "c" }, () => {
        this.reset(true);
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
    this.enabled = enabled;
    this.layer.hidden = !enabled;
    if (!enabled)
      for (const image of this.images.values()) this.cancelTimer(image);
    this.render();
  }
  reset(preserveFramer = false) {
    if (!preserveFramer) this.framer.reset();
    this.chunk = undefined;
    for (const image of this.images.values()) this.cancelTimer(image);
    this.images.clear();
    for (const placement of this.placements) placement.marker.dispose();
    this.placements = [];
    this.virtual.clear();
    this.virtualOrigins.clear();
    this.layer.replaceChildren(this.virtualCanvas);
    this.virtualCanvas.width = 0;
    this.virtualCanvas.height = 0;
    this.compositor.paint([], 0, 0, false);
  }
  async command(sequence: string): Promise<string> {
    const { keys, payload } = parseKittyCommand(sequence),
      action = keys.a || this.chunk?.keys.a || "t";
    if (action === "q") return ""; // The authoritative Rex emulator owns all protocol replies.
    if (keys.i && keys.I)
      throw new Error("Specify either a Kitty image id or image number.");
    if (action === "d") {
      this.chunk = undefined;
      this.delete(keys);
      return "";
    }
    if (action === "a") {
      this.controlAnimation(this.image(keys), keys);
      return "";
    }
    if (action === "c") {
      this.compose(this.image(keys), keys);
      return "";
    }
    if (!["t", "T", "p", "f"].includes(action))
      throw new Error(`Unsupported Kitty graphics action ${action}.`);
    let effective = keys,
      id = this.imageId(keys);
    if (["t", "T", "f"].includes(action)) {
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
      if (effective.t && effective.t !== "d")
        throw new Error(
          "Rex must resolve file/shared-memory images into direct payloads before relaying them to a client.",
        );
      id = this.imageId(effective);
      const canvas = await decodeKittyImage(effective, encoded);
      if (this.disposed) return "";
      if (action === "f") {
        this.addFrame(this.image(effective), effective, canvas);
        return "";
      }
      id = Number(effective.i) || this.serial++;
      this.dropImage(id);
      const image: ImageRecord = {
        canvas,
        bytes: canvas.width * canvas.height * 4,
        number: Number(effective.I) || undefined,
        frames: [{ canvas, gap: 0 }],
        current: 0,
        state: 1,
        loops: 0,
        limit: Infinity,
      };
      this.images.set(id, image);
      this.enforceQuota(id);
      if (action === "t" && effective.a !== "T") return "";
    }
    return this.placeImage(effective, id);
  }
  private placeImage(effective: Record<string, string>, id: number): string {
    const image = this.images.get(id);
    if (!image) throw new Error(`Kitty image ${id} has not been transmitted.`);
    const screen = this.element.querySelector<HTMLElement>(".xterm-screen"),
      cw = (screen?.clientWidth || this.term.cols * 9) / this.term.cols,
      ch = (screen?.clientHeight || this.term.rows * 18) / this.term.rows;
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
      cols = Math.ceil(source[2] / cw);
      rows = Math.ceil(source[3] / ch);
    } else if (!cols)
      cols = Math.ceil((rows * ch * source[2]) / source[3] / cw);
    else if (!rows) rows = Math.ceil((cols * cw * source[3]) / source[2] / ch);
    cols = Math.min(4096, Math.max(1, cols));
    rows = Math.min(4096, Math.max(1, rows));
    const placementId = Number(effective.p) || this.serial++,
      key = placementKey(id, placementId);
    if (effective.U === "1") {
      if (effective.P)
        throw new Error("A virtual Kitty placement cannot have a parent.");
      if (this.virtual.size >= MAX_PLACEMENTS && !this.virtual.has(key))
        throw new Error("Kitty placement limit reached.");
      this.virtual.set(key, {
        imageId: id,
        id: placementId,
        cols,
        rows,
        source,
        z: Number(effective.z) || 0,
      });
      this.render();
      return "";
    }
    let parent: Placement["parent"];
    if (effective.P) {
      parent = {
        imageId: Number(effective.P),
        id: Number(effective.Q) || 0,
        dx: Number(effective.H) || 0,
        dy: Number(effective.V) || 0,
      };
      const seen = new Set([key]);
      let next: { imageId: number; id: number } | undefined = parent;
      for (let depth = 0; next; depth++) {
        const targetKey = placementKey(next.imageId, next.id);
        if (seen.has(targetKey))
          throw new Error("Kitty relative placement would create a cycle.");
        seen.add(targetKey);
        if (depth >= 32)
          throw new Error("Kitty relative placement chain exceeds 32 levels.");
        const { imageId, id: parentId }: { imageId: number; id: number } = next;
        const target: Placement | undefined = this.placements.find(
          (placement) =>
            placement.imageId === imageId && placement.id === parentId,
        );
        if (!target && !this.virtual.has(targetKey))
          throw new Error("Kitty relative placement parent does not exist.");
        next = target?.parent;
      }
    }
    const existing = this.placements.find(
      (placement) => placement.imageId === id && placement.id === placementId,
    );
    if (this.placements.length >= MAX_PLACEMENTS && !existing)
      throw new Error("Kitty placement limit reached.");
    const marker = this.term.registerMarker(0);
    if (!marker) return "";
    const canvas = existing?.canvas || document.createElement("canvas");
    if (existing) {
      existing.marker.dispose();
      this.placements = this.placements.filter((p) => p !== existing);
    }
    canvas.dataset.kittyImage = String(id);
    canvas.dataset.kittyPlacement = String(placementId);
    const placement: Placement = {
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
      parent,
    };
    this.placements.push(placement);
    this.paint(placement, image);
    this.layer.appendChild(canvas);
    this.render();
    return effective.C === "1" || parent ? "" : `\x1b[${rows}B\x1b[${cols}C`;
  }
  private imageId(keys: Record<string, string>): number {
    return (
      Number(keys.i) ||
      [...this.images]
        .reverse()
        .find(([, image]) => image.number === Number(keys.I))?.[0] ||
      0
    );
  }
  private image(keys: Record<string, string>): ImageRecord {
    const image = this.images.get(this.imageId(keys));
    if (!image) throw new Error("Kitty image has not been transmitted.");
    return image;
  }
  private cancelTimer(image: ImageRecord) {
    clearTimeout(image.timer);
    image.timer = undefined;
  }
  private enforceQuota(keep: number) {
    const image = this.images.get(keep);
    if (!image) throw new Error(`Kitty image ${keep} has not been transmitted.`);
    if (image.bytes > MAX_STORAGE) {
      this.dropImage(keep);
      throw new Error(
        "Kitty image/animation exceeds the 64 MiB storage quota.",
      );
    }
    while (
      [...this.images.values()].reduce((sum, image) => sum + image.bytes, 0) >
      MAX_STORAGE
    ) {
      const old = [...this.images.keys()].find((id) => id !== keep);
      if (old === undefined) break;
      this.dropImage(old);
    }
  }
  private dropImage(id: number) {
    const image = this.images.get(id);
    if (image) this.cancelTimer(image);
    this.removePlacements((p) => p.imageId === id);
    for (const [key, placement] of this.virtual)
      if (placement.imageId === id) {
        this.virtual.delete(key);
        this.removePlacements((p) =>
          p.parent && placementKey(p.parent.imageId, p.parent.id) === key
            ? true
            : false,
        );
      }
    this.images.delete(id);
  }
  private paint(placement: Placement, image: ImageRecord) {
    const frame = image.frames[image.current].canvas;
    const budget = Math.max(
      1,
      Math.floor(MAX_STORAGE / 4 / Math.max(1, this.placements.length)),
    );
    const scale = Math.min(
      1,
      Math.sqrt(budget / (placement.source[2] * placement.source[3])),
    );
    let width = Math.max(1, Math.floor(placement.source[2] * scale)),
      height = Math.max(1, Math.floor(placement.source[3] * scale));
    if (width * height > budget) {
      if (width > height) width = Math.max(1, Math.floor(budget / height));
      else height = Math.max(1, Math.floor(budget / width));
    }
    placement.canvas.width = width;
    placement.canvas.height = height;
    placement.canvas
      .getContext("2d")!
      .drawImage(frame, ...placement.source, 0, 0, width, height);
    placement.canvas.dataset.kittyFrame = String(image.current + 1);
    placement.canvas.dataset.kittyAnimation = String(image.state);
  }
  private repaint(image: ImageRecord) {
    for (const placement of this.placements)
      if (this.images.get(placement.imageId) === image)
        this.paint(placement, image);
    this.render();
  }
  private addFrame(
    image: ImageRecord,
    keys: Record<string, string>,
    patch: HTMLCanvasElement,
  ) {
    const index = keys.r ? Number(keys.r) - 1 : image.frames.length;
    if (index < 0 || index > image.frames.length || index >= MAX_FRAMES)
      throw new Error(
        "Kitty animation frame index exceeds its 64-frame limit.",
      );
    const width = image.canvas.width,
      height = image.canvas.height,
      x = Number(keys.x) || 0,
      y = Number(keys.y) || 0;
    if (x < 0 || y < 0 || x + patch.width > width || y + patch.height > height)
      throw new Error("Kitty animation patch is outside the image.");
    if (
      index === image.frames.length &&
      image.bytes + width * height * 4 > MAX_STORAGE
    )
      throw new Error("Kitty animation exceeds the 64 MiB storage quota.");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    const base = keys.r
      ? image.frames[index]
      : keys.c
        ? image.frames[Number(keys.c) - 1]
        : undefined;
    if (keys.c && !base)
      throw new Error("Kitty animation background frame does not exist.");
    if (base) context.drawImage(base.canvas, 0, 0);
    else if (keys.Y) {
      const rgba = Number(keys.Y) >>> 0;
      context.fillStyle = `rgba(${rgba >>> 24},${(rgba >>> 16) & 255},${(rgba >>> 8) & 255},${(rgba & 255) / 255})`;
      context.fillRect(0, 0, width, height);
    }
    context.save();
    context.beginPath();
    context.rect(x, y, patch.width, patch.height);
    context.clip();
    context.globalCompositeOperation = keys.X === "1" ? "copy" : "source-over";
    context.drawImage(patch, x, y);
    context.restore();
    const gap =
      keys.z && Number(keys.z) !== 0
        ? Math.max(0, Math.min(60000, Number(keys.z)))
        : (image.frames[index]?.gap ?? 40);
    image.frames[index] = { canvas, gap };
    if (index === 0) image.canvas = canvas;
    image.bytes = image.frames.length * width * height * 4;
    this.enforceQuota(
      [...this.images].find(([, value]) => value === image)![0],
    );
    this.repaint(image);
    this.schedule(image);
  }
  private controlAnimation(image: ImageRecord, keys: Record<string, string>) {
    if (keys.c) {
      const index = Number(keys.c) - 1;
      if (!image.frames[index])
        throw new Error("Kitty animation frame does not exist.");
      image.current = index;
    }
    if (keys.z && Number(keys.z) !== 0) {
      const index = keys.r ? Number(keys.r) - 1 : image.current;
      if (!image.frames[index])
        throw new Error("Kitty animation gap frame does not exist.");
      image.frames[index].gap = Math.max(0, Math.min(60000, Number(keys.z)));
    }
    if (keys.v && Number(keys.v) > 0)
      image.limit = Number(keys.v) === 1 ? Infinity : Number(keys.v) - 1;
    if (keys.s) {
      const state = Number(keys.s);
      if (![1, 2, 3].includes(state))
        throw new Error("Invalid Kitty animation state.");
      if (state === 1 || image.state === 1) image.loops = 0;
      image.state = state as 1 | 2 | 3;
    }
    this.cancelTimer(image);
    this.repaint(image);
    this.schedule(image);
  }
  private schedule(image: ImageRecord) {
    if (
      image.timer ||
      image.state === 1 ||
      !this.enabled ||
      this.disposed ||
      !this.element.getClientRects().length
    )
      return;
    if (image.frames.length < 2) return;
    // All-gapless animations are data-only; do not spin the UI thread.
    if (!image.frames.some((frame) => frame.gap > 0)) return;
    image.timer = setTimeout(
      () => {
        image.timer = undefined;
        if (
          !this.enabled ||
          this.disposed ||
          !this.element.getClientRects().length
        )
          return;
        let next = image.current + 1;
        if (next >= image.frames.length) {
          if (image.state === 2) return;
          if (++image.loops >= image.limit) {
            image.state = 1;
            image.loops = 0;
            this.repaint(image);
            return;
          }
          next = 0;
        }
        for (
          let skipped = 0;
          image.frames[next].gap === 0 && skipped < image.frames.length;
          skipped++
        ) {
          next++;
          if (next >= image.frames.length) {
            if (image.state === 2) return;
            if (++image.loops >= image.limit) {
              image.state = 1;
              image.loops = 0;
              this.repaint(image);
              return;
            }
            next = 0;
          }
        }
        image.current = next;
        this.repaint(image);
        this.schedule(image);
      },
      Math.max(8, image.frames[image.current].gap),
    );
  }
  private compose(image: ImageRecord, keys: Record<string, string>) {
    const source = image.frames[Number(keys.r) - 1],
      target = image.frames[Number(keys.c) - 1];
    if (!source || !target)
      throw new Error("Kitty composition frame does not exist.");
    const sx = Number(keys.X) || 0,
      sy = Number(keys.Y) || 0,
      dx = Number(keys.x) || 0,
      dy = Number(keys.y) || 0,
      w = Number(keys.w) || image.canvas.width,
      h = Number(keys.h) || image.canvas.height;
    if (
      [sx, sy, dx, dy, w, h].some((value) => !Number.isInteger(value)) ||
      Math.min(sx, sy, dx, dy) < 0 ||
      w < 1 ||
      h < 1 ||
      sx + w > image.canvas.width ||
      dx + w > image.canvas.width ||
      sy + h > image.canvas.height ||
      dy + h > image.canvas.height
    )
      throw new Error("Kitty composition rectangle is outside the image.");
    if (
      source === target &&
      sx < dx + w &&
      dx < sx + w &&
      sy < dy + h &&
      dy < sy + h
    )
      throw new Error("Kitty same-frame composition rectangles overlap.");
    const context = target.canvas.getContext("2d")!;
    context.save();
    context.beginPath();
    context.rect(dx, dy, w, h);
    context.clip();
    context.globalCompositeOperation = keys.C === "1" ? "copy" : "source-over";
    context.drawImage(source.canvas, sx, sy, w, h, dx, dy, w, h);
    context.restore();
    this.repaint(image);
  }
  private removePlacements(predicate: (placement: Placement) => boolean) {
    const removed = new Set(
      this.placements
        .filter(predicate)
        .map((p) => placementKey(p.imageId, p.id)),
    );
    for (let changed = true; changed;) {
      changed = false;
      for (const p of this.placements)
        if (
          p.parent &&
          removed.has(placementKey(p.parent.imageId, p.parent.id)) &&
          !removed.has(placementKey(p.imageId, p.id))
        ) {
          removed.add(placementKey(p.imageId, p.id));
          changed = true;
        }
    }
    const relativeImages = new Set<number>();
    this.placements = this.placements.filter((p) => {
      if (!removed.has(placementKey(p.imageId, p.id))) return true;
      p.canvas.remove();
      p.marker.dispose();
      if (p.parent) relativeImages.add(p.imageId);
      return false;
    });
    for (const id of relativeImages)
      if (
        !this.placements.some((p) => p.imageId === id) &&
        ![...this.virtual.values()].some((p) => p.imageId === id)
      ) {
        const image = this.images.get(id);
        if (image) this.cancelTimer(image);
        this.images.delete(id);
      }
  }
  private position(
    placement: Placement,
    depth = 0,
  ): { x: number; y: number } | undefined {
    if (depth > 32) return;
    if (!placement.parent)
      return {
        x: placement.x,
        y: placement.marker.line - this.term.buffer.active.viewportY,
      };
    const parent = placement.parent,
      key = placementKey(parent.imageId, parent.id),
      target = this.placements.find(
        (p) => placementKey(p.imageId, p.id) === key,
      ),
      origin = target
        ? this.position(target, depth + 1)
        : this.virtualOrigins.get(key);
    return origin && { x: origin.x + parent.dx, y: origin.y + parent.dy };
  }
  private delete(keys: Record<string, string>) {
    const mode = keys.d || "a",
      lower = mode.toLowerCase(),
      id = this.imageId(keys);
    const affected = new Set<number>();
    if (lower === "f") {
      const image = this.images.get(id);
      if (!image) return;
      const index = Math.max(0, (Number(keys.r) || 1) - 1);
      if (!image.frames[index]) return;
      this.cancelTimer(image);
      if (image.frames.length === 1) {
        this.dropImage(id);
        return;
      }
      image.frames.splice(index, 1);
      image.current = Math.min(image.current, image.frames.length - 1);
      image.canvas = image.frames[0].canvas;
      image.bytes =
        image.frames.length * image.canvas.width * image.canvas.height * 4;
      this.repaint(image);
      this.schedule(image);
      return;
    }
    const idMatch = (imageId: number) =>
      lower === "r"
        ? imageId >= Number(keys.x) && imageId <= Number(keys.y)
        : imageId === id;
    if (["i", "n", "r"].includes(lower))
      for (const [key, p] of this.virtual)
        if (idMatch(p.imageId) && (!keys.p || p.id === Number(keys.p))) {
          affected.add(p.imageId);
          this.virtual.delete(key);
          this.removePlacements((p) =>
            p.parent && placementKey(p.parent.imageId, p.parent.id) === key
              ? true
              : false,
          );
        }
    const predicate = (p: Placement) => {
      if (["i", "n", "r"].includes(lower))
        return idMatch(p.imageId) && (!keys.p || p.id === Number(keys.p));
      const pos = this.position(p);
      if (!pos) return false;
      if (lower === "a")
        return (
          p.screen === this.term.buffer.active.type &&
          pos.y + p.rows > 0 &&
          pos.y < this.term.rows
        );
      if (lower === "z") return p.z === Number(keys.z);
      const x =
          lower === "c" ? this.term.buffer.active.cursorX : Number(keys.x) - 1,
        y =
          lower === "c"
            ? this.term.buffer.active.baseY +
              this.term.buffer.active.cursorY -
              this.term.buffer.active.viewportY
            : Number(keys.y) - 1;
      if (lower === "x") return x >= pos.x && x < pos.x + p.cols;
      if (lower === "y") return y >= pos.y && y < pos.y + p.rows;
      return (
        ["c", "p", "q"].includes(lower) &&
        x >= pos.x &&
        x < pos.x + p.cols &&
        y >= pos.y &&
        y < pos.y + p.rows &&
        (lower !== "q" || p.z === Number(keys.z))
      );
    };
    for (const placement of this.placements)
      if (predicate(placement)) affected.add(placement.imageId);
    if (["i", "n", "r"].includes(lower))
      for (const imageId of this.images.keys())
        if (idMatch(imageId)) affected.add(imageId);
    this.removePlacements(predicate);
    if (mode !== lower)
      for (const imageId of affected)
        if (
          !this.placements.some((p) => p.imageId === imageId) &&
          ![...this.virtual.values()].some((p) => p.imageId === imageId)
        )
          this.dropImage(imageId);
    this.render();
  }
  private renderVirtual(cw: number, ch: number): KittyDrawOperation[] {
    const operations: KittyDrawOperation[] = [];
    if (!this.virtual.size) {
      this.virtualCanvas.width = 0;
      this.virtualCanvas.height = 0;
      this.virtualOrigins.clear();
      return operations;
    }
    const width = Math.max(0, Math.ceil(cw * this.term.cols)),
      height = Math.max(0, Math.ceil(ch * this.term.rows));
    if (
      this.virtualCanvas.width !== width ||
      this.virtualCanvas.height !== height
    ) {
      this.virtualCanvas.width = width;
      this.virtualCanvas.height = height;
    }
    const context = this.virtualCanvas.getContext("2d")!;
    context.clearRect(0, 0, width, height);
    this.virtualOrigins.clear();
    if (!this.virtual.size) return operations;
    const buffer = this.term.buffer.active;
    for (let y = 0; y < this.term.rows; y++) {
      const line = buffer.getLine(buffer.viewportY + y);
      let previous:
        | { fg: number; row: number; col: number; high: number; pid: number }
        | undefined;
      for (let x = 0; x < this.term.cols; x++) {
        const cell = line?.getCell(x),
          chars = cell?.getChars();
        if (!chars || !chars.startsWith("\u{10eeee}")) {
          previous = undefined;
          continue;
        }
        const glyph = Array.from(chars),
          encodedPid =
            glyph[1] === "\u034f" && glyph.length >= 5
              ? [2, 3, 4].map((index) =>
                  diacriticIndex.get(glyph[index].codePointAt(0)!),
                )
              : undefined;
        const pidMetadata =
          encodedPid &&
          encodedPid.every((value) => value !== undefined && value < 256)
            ? encodedPid[0]! * 65536 + encodedPid[1]! * 256 + encodedPid[2]!
            : undefined;
        const marks = glyph
          .slice(pidMetadata === undefined ? 1 : 5)
          .map((ch) => diacriticIndex.get(ch.codePointAt(0)!))
          .filter((value): value is number => value !== undefined);
        const fg = cell!.isFgDefault() ? 0 : cell!.getFgColor(),
          pid = pidMetadata ?? this.underlinePlacementId(cell!, x, y, cw);
        const same = previous && previous.fg === fg && previous.pid === pid;
        const row = marks[0] ?? (same ? previous!.row : 0),
          col =
            marks[1] ?? (same && row === previous!.row ? previous!.col + 1 : 0),
          high =
            marks[2] ??
            (same && row === previous!.row && col === previous!.col + 1
              ? previous!.high
              : 0);
        previous = { fg, row, col, high, pid };
        if (high > 255) continue;
        const id = (fg & 0xffffff) + (high & 255) * 0x1000000;
        const prototype = pid
          ? this.virtual.get(placementKey(id, pid))
          : [...this.virtual.values()].reverse().find((p) => p.imageId === id);
        const image = this.images.get(id);
        if (
          !prototype ||
          !image ||
          row >= prototype.rows ||
          col >= prototype.cols
        )
          continue;
        const key = placementKey(id, prototype.id),
          origin = this.virtualOrigins.get(key);
        this.virtualOrigins.set(key, {
          x: Math.min(origin?.x ?? x, x),
          y: Math.min(origin?.y ?? y, y),
        });
        const source = prototype.source,
          scale = Math.min(
            (prototype.cols * cw) / source[2],
            (prototype.rows * ch) / source[3],
          ),
          w = source[2] * scale,
          h = source[3] * scale;
        const draw = (target: CanvasRenderingContext2D) => {
          target.save();
          target.beginPath();
          target.rect(x * cw, y * ch, cw, ch);
          target.clip();
          target.drawImage(
            image.frames[image.current].canvas,
            ...source,
            x * cw + (prototype.cols * cw - w) / 2 - col * cw,
            y * ch + (prototype.rows * ch - h) / 2 - row * ch,
            w,
            h,
          );
          target.restore();
        };
        draw(context);
        operations.push({
          imageId: id,
          placementId: prototype.id,
          z: prototype.z,
          draw,
        });
      }
    }
    // Hide protocol glyphs in the DOM only. Buffer/search/copy contents remain authoritative.
    for (const span of this.element.querySelectorAll<HTMLElement>(
      ".xterm-rows span",
    ))
      if (span.textContent?.includes("\u{10eeee}"))
        span.textContent = span.textContent.replace(
          /\u{10eeee}\p{Mark}*/gu,
          "\u00a0",
        );
    return operations;
  }
  private underlinePlacementId(
    cell: IBufferCell,
    x: number,
    y: number,
    cw: number,
  ): number {
    // CellData exposes public methods that xterm 6 omits from IBufferCell's
    // declaration. Feature-detect this compatibility seam and retain DOM fallback.
    const metadata = cell as unknown as {
      isUnderlineColorDefault?: () => boolean;
      getUnderlineColor?: () => number;
    };
    if (
      typeof metadata.isUnderlineColorDefault === "function" &&
      typeof metadata.getUnderlineColor === "function"
    ) {
      if (metadata.isUnderlineColorDefault()) return 0;
      const value = metadata.getUnderlineColor();
      return Number.isInteger(value) &&
        value >= 0 &&
        value <= 0xffffff &&
        value !== cell.getFgColor()
        ? value
        : 0;
    }
    const row = this.element.querySelector<HTMLElement>(
        `.xterm-rows > div:nth-child(${y + 1})`,
      ),
      screen = this.element.querySelector<HTMLElement>(".xterm-screen");
    if (!row || !screen) return 0;
    const point = screen.getBoundingClientRect().left + (x + 0.5) * cw;
    const span = [...row.children].find((element) => {
      const box = element.getBoundingClientRect();
      return point >= box.left && point < box.right;
    }) as HTMLElement | undefined;
    const color = span?.style.textDecorationColor;
    if (!color) return 0;
    const match = /^rgb\(\s*(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(color);
    return match
      ? Number(match[1]) * 65536 + Number(match[2]) * 256 + Number(match[3])
      : 0;
  }
  private render() {
    const screen = this.element.querySelector<HTMLElement>(".xterm-screen");
    if (!screen || this.disposed) return;
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
    Object.assign(this.virtualCanvas.style, {
      left: "0",
      top: "0",
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    this.removePlacements((p) => !p.parent && p.marker.isDisposed);
    const operations = this.renderVirtual(cw, ch);
    for (const p of this.placements) {
      const budget = Math.max(
        1,
        Math.floor(MAX_STORAGE / 4 / Math.max(1, this.placements.length)),
      );
      if (p.canvas.width * p.canvas.height > budget) {
        const image = this.images.get(p.imageId);
        if (image) this.paint(p, image);
      }
      const position = this.position(p),
        image = this.images.get(p.imageId);
      if (position && image && p.screen === this.term.buffer.active.type) {
        const x = position.x * cw + p.offsetX,
          y = position.y * ch + p.offsetY,
          width = p.cols * cw,
          height = p.rows * ch,
          scale = Math.min(width / p.source[2], height / p.source[3]),
          w = p.source[2] * scale,
          h = p.source[3] * scale;
        operations.push({
          imageId: p.imageId,
          placementId: p.id,
          z: p.z,
          draw: (context) =>
            context.drawImage(
              image.frames[image.current].canvas,
              ...p.source,
              x + (width - w) / 2,
              y + (height - h) / 2,
              w,
              h,
            ),
        });
      }
      Object.assign(p.canvas.style, {
        display:
          position && p.screen === this.term.buffer.active.type
            ? "block"
            : "none",
        left: `${(position?.x || 0) * cw + p.offsetX}px`,
        top: `${(position?.y || 0) * ch + p.offsetY}px`,
        width: `${p.cols * cw}px`,
        height: `${p.rows * ch}px`,
        objectFit: "contain",
        zIndex: "0",
      });
    }
    this.compositor.paint(operations, box.width, box.height, this.enabled);
    for (const image of this.images.values()) this.schedule(image);
  }
  dispose() {
    this.disposed = true;
    this.reset();
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.layer.remove();
    this.compositor.dispose();
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
