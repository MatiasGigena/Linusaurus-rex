import type { IBufferCell, Terminal } from "@xterm/xterm";
import {
  cellBackground,
  displayP3Color,
  nearestThemeColor,
  parseColor,
  rgbHex,
} from "./visuals";

const BELOW_BACKGROUND = -1073741824;
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
const paletteNames = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;
export interface KittyDrawOperation {
  imageId: number;
  placementId: number;
  z: number;
  draw(context: CanvasRenderingContext2D): void;
}

/** The text DOM remains native; only its cell backgrounds move into this public-buffer compositor. */
export class KittyCompositor {
  private below: HTMLCanvasElement;
  private above: HTMLCanvasElement;
  private cursor: HTMLDivElement;
  private screen: HTMLElement | undefined;
  private cursorSignature = "";
  private gamut: PredefinedColorSpace = "srgb";
  constructor(
    private terminal: Terminal,
    private element: HTMLElement,
  ) {
    this.below = document.createElement("canvas");
    this.below.className = "kitty-composition-underlay";
    this.above = document.createElement("canvas");
    this.above.className = "kitty-composition-overlay";
    this.cursor = document.createElement("div");
    this.cursor.className = "kitty-composition-cursor";
    for (const node of [this.below, this.above, this.cursor])
      node.setAttribute("aria-hidden", "true");
  }
  paint(
    operations: KittyDrawOperation[],
    width: number,
    height: number,
    enabled: boolean,
  ) {
    const screen = this.element.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) return;
    if (this.screen !== screen) {
      this.screen?.removeAttribute("data-kitty-composition");
      this.screen = screen;
      screen.append(this.below, this.above, this.cursor);
    }
    const active = enabled && operations.length > 0 && width > 0 && height > 0;
    if (!active) {
      screen.removeAttribute("data-kitty-composition");
      this.below.hidden = true;
      this.above.hidden = true;
      this.cursor.hidden = true;
      this.cursor.replaceChildren();
      this.cursorSignature = "";
      this.below.width = 0;
      this.below.height = 0;
      this.above.width = 0;
      this.above.height = 0;
      return;
    }
    const gamut =
      this.element.dataset.colorSpace === "display-p3" ? "display-p3" : "srgb";
    if (gamut !== this.gamut) {
      const replace = (old: HTMLCanvasElement) => {
        const next = old.cloneNode(false) as HTMLCanvasElement;
        old.replaceWith(next);
        return next;
      };
      this.below = replace(this.below);
      this.above = replace(this.above);
      this.gamut = gamut;
    }
    screen.dataset.kittyComposition = "true";
    this.below.hidden = false;
    this.above.hidden = false;
    this.cursor.hidden = false;
    const scale = Math.min(
      devicePixelRatio || 1,
      Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
    );
    const setup = (canvas: HTMLCanvasElement) => {
      const w = Math.max(1, Math.floor(width * scale)),
        h = Math.max(1, Math.floor(height * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d", { colorSpace: this.gamut })!;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, w, h);
      context.setTransform(w / width, 0, 0, h / height, 0, 0);
      return context;
    };
    const below = setup(this.below),
      above = setup(this.above),
      sorted = [...operations].sort(
        (a, b) =>
          a.z - b.z || a.imageId - b.imageId || a.placementId - b.placementId,
      );
    for (const operation of sorted)
      if (operation.z < BELOW_BACKGROUND) operation.draw(below);
    this.backgrounds(below, width, height);
    for (const operation of sorted)
      if (operation.z >= BELOW_BACKGROUND && operation.z < 0)
        operation.draw(below);
    for (const operation of sorted) if (operation.z >= 0) operation.draw(above);
    this.cursorPaint(screen);
  }
  private backgrounds(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ) {
    const theme = this.terminal.options.theme || {},
      palette = paletteNames.map((name) =>
        parseColor(theme[name] || "#000000")!,
      ),
      p3 = this.element.dataset.colorSpace === "display-p3",
      quantize = this.element.dataset.forceThemePalette === "true";
    const buffer = this.terminal.buffer.active,
      cw = width / this.terminal.cols,
      ch = height / this.terminal.rows;
    for (let row = 0; row < this.terminal.rows; row++) {
      const line = buffer.getLine(buffer.viewportY + row);
      let last: string | undefined,
        start = 0;
      const flush = (column: number) => {
        if (last) {
          context.fillStyle = last;
          context.fillRect(start * cw, row * ch, (column - start) * cw, ch);
        }
        start = column;
      };
      for (let column = 0; column <= this.terminal.cols; column++) {
        const cell =
          column < this.terminal.cols ? line?.getCell(column) : undefined;
        let color =
          cell && explicitBackground(cell)
            ? cellBackground(cell, theme)
            : undefined;
        if (color) {
          let rgb = parseColor(color);
          if (rgb && quantize) rgb = nearestThemeColor(rgb, palette);
          const alpha = /^#[\da-f]{8}$/i.test(color)
            ? parseInt(color.slice(7, 9), 16) / 255
            : 1;
          if (rgb && p3) color = displayP3Color(rgb, alpha);
          else if (rgb && quantize) color = rgbHex(rgb);
        }
        if (color !== last) {
          flush(column);
          last = color;
        }
      }
    }
  }
  private cursorPaint(screen: HTMLElement) {
    const source = screen.querySelector<HTMLElement>(
      ".xterm-rows:not(.kitty-composition-cursor) .xterm-cursor",
    );
    if (!source || !source.getClientRects().length) {
      this.cursor.replaceChildren();
      this.cursorSignature = "";
      return;
    }
    const box = source.getBoundingClientRect(),
      origin = screen.getBoundingClientRect(),
      rows = source.closest<HTMLElement>(".xterm-rows")!;
    const focus = rows.classList.contains("xterm-focus") ? "xterm-focus" : "";
    const signature = JSON.stringify([
      source.outerHTML,
      focus,
      box.x - origin.x,
      box.y - origin.y,
      box.width,
      box.height,
    ]);
    if (signature === this.cursorSignature) return;
    this.cursorSignature = signature;
    // Retain the native cursor's CSS rules and animations instead of painting
    // an approximation. This presentation-only clone stays outside the AX tree.
    this.cursor.className = `kitty-composition-cursor xterm-rows ${focus}`;
    const clone = source.cloneNode(true) as HTMLElement;
    Object.assign(clone.style, {
      position: "absolute",
      left: `${box.x - origin.x}px`,
      top: `${box.y - origin.y}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      lineHeight: getComputedStyle(source).lineHeight,
      boxSizing: "border-box",
    });
    this.cursor.replaceChildren(clone);
    const animation = source.getAnimations()[0],
      copy = clone.getAnimations()[0];
    if (animation && copy && typeof animation.currentTime === "number")
      copy.currentTime = animation.currentTime;
  }
  dispose() {
    this.screen?.removeAttribute("data-kitty-composition");
    this.below.remove();
    this.above.remove();
    this.cursor.remove();
  }
}
function explicitBackground(cell: IBufferCell): boolean {
  return !!cell.isInverse() || !cell.isBgDefault();
}
