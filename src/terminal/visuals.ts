import type { IBufferCell, ITheme, Terminal } from "@xterm/xterm";
import type { Settings } from "../shared/types";
import { DEFAULT_EXTENDED_ANSI, terminalTheme } from "./themes";

export type Rgb = readonly [number, number, number];
const names = [
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
export function parseColor(value: string): Rgb | undefined {
  const hex = /^#([\da-f]{6})(?:[\da-f]{2})?$/i.exec(value);
  if (hex)
    return [0, 2, 4].map((offset) =>
      parseInt(hex[1].slice(offset, offset + 2), 16),
    ) as unknown as Rgb;
  const rgb = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(value);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
}
export const rgbHex = (rgb: Rgb) =>
  "#" +
  rgb
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
function luminance(rgb: Rgb): number {
  return rgb
    .map((value) => {
      const n = value / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    })
    .reduce(
      (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
      0,
    );
}
export function contrast(a: Rgb, b: Rgb): number {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Quantize to the actual theme colors, with contrast correction after mapping. */
export function nearestThemeColor(
  rgb: Rgb,
  palette: readonly Rgb[],
  background?: Rgb,
  minimumContrast = 1,
): Rgb {
  const eligible = background
    ? palette.filter(
        (color) => contrast(color, background) + 0.001 >= minimumContrast,
      )
    : palette;
  const choices = eligible.length
    ? eligible
    : background
      ? [...palette]
          .sort((a, b) => contrast(b, background) - contrast(a, background))
          .slice(0, 1)
      : palette;
  return (
    [...choices].sort((a, b) => distance(a, rgb) - distance(b, rgb))[0] || rgb
  );
}
function distance(a: Rgb, b: Rgb): number {
  return (
    (a[0] - b[0]) ** 2 * 0.2126 +
    (a[1] - b[1]) ** 2 * 0.7152 +
    (a[2] - b[2]) ** 2 * 0.0722
  );
}
export function displayP3Color(rgb: Rgb, alpha = 1): string {
  return `color(display-p3 ${rgb.map((value) => (value / 255).toFixed(5)).join(" ")}${alpha === 1 ? "" : ` / ${alpha.toFixed(5)}`})`;
}
export function supportsDisplayP3(): boolean {
  return Boolean(
    globalThis.CSS?.supports("color", "color(display-p3 1 0 0)") &&
    globalThis.matchMedia?.("(color-gamut: p3)").matches,
  );
}
export function cellBackground(
  cell: IBufferCell | undefined,
  theme: ITheme,
): string {
  if (!cell) return theme.background || "#353b41";
  const inverse = !!cell.isInverse();
  if (inverse ? cell.isFgRGB() : cell.isBgRGB()) {
    const value = inverse ? cell.getFgColor() : cell.getBgColor();
    return rgbHex([(value >> 16) & 255, (value >> 8) & 255, value & 255]);
  }
  if (inverse ? cell.isFgPalette() : cell.isBgPalette()) {
    const index = inverse ? cell.getFgColor() : cell.getBgColor();
    return index < 16
      ? theme[names[index]] || "#000000"
      : theme.extendedAnsi?.[index - 16] ||
          DEFAULT_EXTENDED_ANSI[index - 16] ||
          "#000000";
  }
  return (inverse ? theme.foreground : theme.background) || "#353b41";
}

/** Effects use public terminal buffers and the DOM renderer, preserving original VT attributes. */
export class TerminalVisuals {
  private settings: Settings;
  private theme: ITheme;
  private palette: Rgb[] = [];
  private original = new WeakMap<
    HTMLElement,
    {
      color: string;
      background: string;
      appliedColor: string;
      appliedBackground: string;
    }
  >();
  private disposables: { dispose(): void }[] = [];
  private copyTimer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  private cursorCanvas: HTMLCanvasElement;
  private trail: { x: number; y: number; at: number }[] = [];
  constructor(
    private term: Terminal,
    private element: HTMLDivElement,
    private host: HTMLDivElement,
    settings: Settings,
  ) {
    this.settings = settings;
    this.theme = terminalTheme(settings);
    this.cursorCanvas = document.createElement("canvas");
    this.cursorCanvas.className = "terminal-cursor-effect";
    element.appendChild(this.cursorCanvas);
    this.disposables.push(
      term.onRender(() => this.render()),
      term.onScroll(() => this.render()),
      term.onResize(() => this.render()),
      term.onCursorMove(() => this.cursor()),
    );
    this.apply(settings);
  }
  apply(settings: Settings) {
    this.settings = settings;
    this.theme = terminalTheme(settings);
    this.palette = names.map((name) =>
      parseColor(this.theme[name] || "#000000")!,
    );
    this.element.dataset.boldPolicy = settings.boldPolicy;
    this.element.dataset.italicPolicy = settings.italicPolicy;
    this.element.dataset.selectionRounded = String(settings.selectionRounded);
    this.element.dataset.forceThemePalette = String(settings.forceThemePalette);
    this.element.style.setProperty(
      "font-synthesis-weight",
      settings.boldPolicy === "font" ? "none" : "auto",
    );
    this.element.style.setProperty(
      "font-synthesis-style",
      settings.italicPolicy === "font" ? "none" : "auto",
    );
    this.element.dataset.colorSpace =
      settings.displayP3 && supportsDisplayP3() ? "display-p3" : "srgb";
    this.element.dataset.cursorEffect = settings.cursorEffect;
    this.cursorCanvas.hidden = settings.cursorEffect === "off";
    if (settings.cursorEffect === "off") {
      this.trail = [];
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.cursorCanvas
        .getContext("2d")
        ?.clearRect(0, 0, this.cursorCanvas.width, this.cursorCanvas.height);
    }
    const color = (value: string | undefined) => {
      const rgb = value && parseColor(value);
      const alpha =
        value && /^#[\da-f]{8}$/i.test(value)
          ? parseInt(value.slice(7, 9), 16) / 255
          : 1;
      return rgb && settings.displayP3 && supportsDisplayP3()
        ? displayP3Color(rgb, alpha)
        : value || "";
    };
    this.element.style.setProperty(
      "--terminal-selection-color",
      color(this.theme.selectionBackground),
    );
    this.element.style.setProperty(
      "--terminal-cursor-color",
      color(this.theme.cursor),
    );
    this.render();
    this.term.refresh(0, this.term.rows - 1);
  }
  copied() {
    if (!this.settings.selectionCopyAnimation) return;
    clearTimeout(this.copyTimer);
    this.element.classList.remove("terminal-copy-shine");
    void this.element.offsetWidth;
    this.element.classList.add("terminal-copy-shine");
    this.copyTimer = setTimeout(
      () => this.element.classList.remove("terminal-copy-shine"),
      500,
    );
  }
  render() {
    const screen = this.element.querySelector<HTMLElement>(".xterm-screen"),
      composed = screen?.hasAttribute("data-kitty-composition");
    // Read native styles without the compositor's paint-only background mask.
    if (screen && composed) screen.removeAttribute("data-kitty-composition");
    const settings = this.settings,
      p3 = settings.displayP3 && supportsDisplayP3();
    const fallback = parseColor(this.theme.background || "#353b41")!;
    for (const span of this.element.querySelectorAll<HTMLElement>(
      ".xterm-rows > div > span",
    )) {
      let old = this.original.get(span);
      if (
        !old ||
        span.style.color !== old.appliedColor ||
        span.style.backgroundColor !== old.appliedBackground
      ) {
        old = {
          color: span.style.color,
          background: span.style.backgroundColor,
          appliedColor: span.style.color,
          appliedBackground: span.style.backgroundColor,
        };
        this.original.set(span, old);
      }
      // Remove our previous paint before reading classes/defaults on a settings change.
      span.style.color = old.color;
      span.style.backgroundColor = old.background;
      if (!p3 && !settings.forceThemePalette) {
        old.appliedColor = span.style.color;
        old.appliedBackground = span.style.backgroundColor;
        continue;
      }
      const computed = getComputedStyle(span),
        fg = parseColor(computed.color),
        rawBg = parseColor(computed.backgroundColor);
      const transparent =
        !rawBg || /rgba\([^)]*,\s*0\s*\)/.test(computed.backgroundColor);
      const bg = transparent ? fallback : rawBg;
      const mappedBg =
        settings.forceThemePalette && !transparent
          ? nearestThemeColor(bg, this.palette)
          : bg;
      const mappedFg =
        fg &&
        (settings.forceThemePalette
          ? nearestThemeColor(
              fg,
              this.palette,
              mappedBg,
              settings.minimumContrastRatio,
            )
          : fg);
      if (mappedFg)
        span.style.color = p3 ? displayP3Color(mappedFg) : rgbHex(mappedFg);
      if (!/rgba\([^)]*,\s*0\s*\)/.test(computed.backgroundColor))
        span.style.backgroundColor = p3
          ? displayP3Color(mappedBg)
          : rgbHex(mappedBg);
      old.appliedColor = span.style.color;
      old.appliedBackground = span.style.backgroundColor;
    }
    this.backgrounds(p3);
    if (screen && composed) screen.dataset.kittyComposition = "true";
    this.element.dispatchEvent(new Event("rex-terminal-visuals"));
  }
  private backgrounds(p3: boolean) {
    const buffer = this.term.buffer.active,
      theme = this.theme,
      counts = new Map<string, number>();
    for (
      let y = 0;
      y < this.term.rows;
      y += Math.max(1, Math.floor(this.term.rows / 15))
    )
      for (const x of [0, Math.floor(this.term.cols / 2), this.term.cols - 1]) {
        const color = cellBackground(
          buffer.getLine(buffer.viewportY + y)?.getCell(x),
          theme,
        );
        counts.set(color, (counts.get(color) || 0) + 1);
      }
    const total = [...counts.values()].reduce((a, b) => a + b, 0),
      dominant = [...counts].sort((a, b) => b[1] - a[1])[0];
    const program =
      this.settings.matchProgramBackground &&
      dominant &&
      dominant[1] >= total * 0.6
        ? dominant[0]
        : undefined;
    const paint = (value: string) =>
      p3 ? displayP3Color(parseColor(value) || [0, 0, 0]) : value;
    const pane = this.host.closest<HTMLElement>(".terminal-pane");
    if (program && program !== theme.background) {
      pane?.setAttribute("data-program-background", program);
      pane?.style.setProperty("--program-pane-background", paint(program));
    } else {
      pane?.removeAttribute("data-program-background");
      pane?.style.removeProperty("--program-pane-background");
    }
    this.host.style.backgroundColor = paint(
      program || theme.background || "#353b41",
    );
    if (this.settings.paddingColor === "extend") {
      const gradient = (horizontal: boolean, end: boolean) => {
        const count = horizontal ? this.term.cols : this.term.rows;
        const colors = Array.from({ length: count }, (_, i) => {
          const cell = buffer
            .getLine(
              buffer.viewportY +
                (horizontal ? (end ? this.term.rows - 1 : 0) : i),
            )
            ?.getCell(horizontal ? i : end ? this.term.cols - 1 : 0);
          return `${paint(cellBackground(cell, theme))} ${(i / count) * 100}% ${((i + 1) / count) * 100}%`;
        });
        return `linear-gradient(to ${horizontal ? "right" : "bottom"},${colors.join(",")})`;
      };
      this.host.style.backgroundImage = [
        gradient(false, false),
        gradient(false, true),
        gradient(true, false),
        gradient(true, true),
      ].join(",");
      this.host.style.backgroundSize = `${this.settings.paddingX}px 100%,${this.settings.paddingX}px 100%,100% ${this.settings.paddingY}px,100% ${this.settings.paddingY}px`;
      this.host.style.backgroundPosition =
        "left top,right top,left top,left bottom";
      this.host.style.backgroundRepeat = "no-repeat";
    } else this.host.style.backgroundImage = "none";
  }
  private cursor() {
    if (this.settings.cursorEffect === "off" || !document.hasFocus()) return;
    const screen = this.element.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) return;
    const box = screen.getBoundingClientRect(),
      origin = this.element.getBoundingClientRect();
    const x =
      box.left -
      origin.left +
      ((this.term.buffer.active.cursorX + 0.5) * box.width) / this.term.cols;
    const y =
      box.top -
      origin.top +
      ((this.term.buffer.active.cursorY + 0.5) * box.height) / this.term.rows;
    this.trail.push({ x, y, at: performance.now() });
    this.trail = this.trail.slice(-20);
    if (!this.frame)
      this.frame = requestAnimationFrame((time) => this.drawTrail(time));
  }
  private drawTrail(now: number) {
    this.frame = 0;
    const canvas = this.cursorCanvas,
      dpr = devicePixelRatio || 1,
      box = this.element.getBoundingClientRect();
    if (
      canvas.width !== Math.ceil(box.width * dpr) ||
      canvas.height !== Math.ceil(box.height * dpr)
    ) {
      canvas.width = Math.ceil(box.width * dpr);
      canvas.height = Math.ceil(box.height * dpr);
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.trail = this.trail.filter((point) => now - point.at < 400);
    const color = this.theme.cursor || "#9bc5ab";
    for (let i = 0; i < this.trail.length; i++) {
      const point = this.trail[i],
        alpha = Math.max(0, 1 - (now - point.at) / 400);
      context.globalAlpha = alpha * 0.65;
      context.fillStyle = color;
      context.strokeStyle = color;
      if (this.settings.cursorEffect === "warp" && i) {
        const before = this.trail[i - 1];
        context.lineWidth = 8 * alpha;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(before.x, before.y);
        context.lineTo(point.x, point.y);
        context.stroke();
      } else if (this.settings.cursorEffect === "blaze") {
        context.beginPath();
        context.moveTo(point.x, point.y - 8 * alpha);
        context.lineTo(point.x + 5 * alpha, point.y + 6 * alpha);
        context.lineTo(point.x - 5 * alpha, point.y + 6 * alpha);
        context.closePath();
        context.fill();
      } else {
        context.beginPath();
        context.arc(point.x, point.y, Math.max(1, 4 * alpha), 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = 1;
    if (this.trail.length)
      this.frame = requestAnimationFrame((time) => this.drawTrail(time));
  }
  dispose() {
    this.disposables.forEach((disposable) => disposable.dispose());
    cancelAnimationFrame(this.frame);
    clearTimeout(this.copyTimer);
    this.cursorCanvas.remove();
    this.host.style.backgroundImage = "none";
  }
}
