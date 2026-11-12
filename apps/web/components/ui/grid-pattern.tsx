"use client";

import {
  type ComponentProps,
  type CSSProperties,
  type PointerEvent,
  useRef,
} from "react";
import { cn } from "@/lib/utils";

export interface GridPatternProps extends ComponentProps<"div"> {
  /**
   * The color of the lit cells and of the light under the pointer, any CSS
   * color. A theme variable follows your theme.
   *
   * @default "var(--foreground)"
   */
  accentColor?: string;
  /**
   * The lines' color, any CSS color. A translucent one sits on any surface.
   *
   * @default "var(--border)"
   */
  color?: string;
  /**
   * Draws the lines as dashes, four to a cell, with one across each crossing.
   *
   * @default false
   */
  dashed?: boolean;
  /**
   * Which edges fade out to the surface: `radial` keeps the middle, the
   * others name the side that fades.
   *
   * @default "none"
   */
  fade?: "none" | "radial" | "top" | "bottom" | "left" | "right";
  /**
   * Whether the lines near the pointer light up. Touch never lights them.
   *
   * @default true
   */
  interactive?: boolean;
  /**
   * The lines' width, in pixels.
   *
   * @default 1
   */
  lineWidth?: number;
  /**
   * Draws every nth line heavier, as on graph paper: 5 gives blocks of five
   * cells. 0 keeps every line the same.
   *
   * @default 0
   */
  majorEvery?: number;
  /**
   * How far the light under the pointer reaches, in pixels.
   *
   * @default 180
   */
  radius?: number;
  /**
   * Another layout of the lit cells, a whole number.
   *
   * @default 0
   */
  seed?: number;
  /**
   * The side of one cell, in pixels.
   *
   * @default 40
   */
  size?: number;
  /**
   * How fast the lit cells come and go: 1 is normal, 0 holds them.
   *
   * @default 1
   */
  speed?: number;
  /**
   * How many cells take turns lighting up, from 0 to 24; a little over
   * half of them show at a time. Each fades in and out, then moves a few
   * cells on.
   *
   * @default 8
   */
  squares?: number;
}

const px = (value: number | undefined) =>
  value === undefined ? undefined : `${value}px`;

/** The step of the heavier lines, when there is one. */
const majorOf = (every: number | undefined) =>
  every !== undefined && every >= 2 ? Math.round(every) : undefined;

/** A number in [0, 1) for cell `i`, spread evenly along `step`'s sequence. */
const spread = (i: number, step: number) =>
  ((0.5 + (i + 1) * step) % 1).toFixed(4);

/**
 * The lit cells: where each sits across the box (the R2 sequence, snapped
 * to the grid in CSS) and where it starts in the cycle. They start in
 * turn, a third of a cycle and one step apart, so the ones lit together
 * are neighbours in the sequence, which keeps them spread over the box.
 */
const squaresOf = (count: number, seed: number) => {
  const total = Math.max(0, Math.min(Math.round(count), 24));
  return Array.from({ length: total }).map((_, key) => ({
    key,
    style: {
      "--grid-pattern-phase": (
        (0.04 + (key * (total + 1)) / (3 * total)) %
        1
      ).toFixed(4),
      "--grid-pattern-u": spread(key + seed * 24, 0.754_877_666_2),
      "--grid-pattern-v": spread(key + seed * 24, 0.569_840_291),
    } as CSSProperties,
  }));
};

/**
 * A square grid of thin lines behind its content, drawn in CSS: no canvas
 * and no WebGL. The lines are hard-edged gradients on the pixel grid, so
 * they stay sharp at any size and screen ratio, with a cell centred in the
 * box. Every nth line can be heavier, the lines can be dashed, a few cells
 * light up and fade in turn, and the lines near the pointer take the accent
 * color. It follows the theme through `--border` and `--foreground`. With
 * reduced motion the lit cells hold still; touch never moves the light.
 *
 * @cssvar --grid-pattern-accent The lit cells' and the light's color (`var(--foreground)`).
 * @cssvar --grid-pattern-color The lines' color (`var(--border)`).
 * @cssvar --grid-pattern-line-width The lines' width (`1px`).
 * @cssvar --grid-pattern-radius How far the pointer's light reaches (`180px`).
 * @cssvar --grid-pattern-size The side of one cell (`40px`).
 * @cssvar --grid-pattern-speed How fast the lit cells come and go (`1`).
 */
export const GridPattern = (props: GridPatternProps) => {
  const {
    accentColor,
    color,
    dashed = false,
    fade = "none",
    interactive = true,
    lineWidth,
    majorEvery,
    radius,
    seed = 0,
    size,
    speed,
    squares = 8,
    onPointerLeave,
    onPointerMove,
    className,
    children,
    ...rest
  } = props;
  const glow = useRef<HTMLDivElement>(null);

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event);
    const node = glow.current;
    if (!node || event.pointerType === "touch") {
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    node.style.setProperty("--grid-pattern-x", `${event.clientX - box.left}px`);
    node.style.setProperty("--grid-pattern-y", `${event.clientY - box.top}px`);
    // The light lands where the pointer comes in, and glides from the
    // next move on.
    node.dataset.pointer = node.dataset.pointer ? "move" : "enter";
  };

  // The position stays, so the light fades out where it was.
  const pointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(event);
    glow.current?.removeAttribute("data-pointer");
  };

  return (
    <div
      className={cn("relative isolate overflow-hidden", className)}
      data-slot="grid-pattern"
      onPointerLeave={pointerLeave}
      onPointerMove={pointerMove}
      {...rest}
    >
      <div
        aria-hidden="true"
        className="grid-pattern-layer pointer-events-none absolute inset-0 -z-10 [content-visibility:auto]"
        data-dashed={dashed || undefined}
        data-fade={fade}
        data-major={majorOf(majorEvery)}
        data-slot="grid-pattern-layer"
        style={
          {
            "--grid-pattern-accent": accentColor,
            "--grid-pattern-color": color,
            "--grid-pattern-line-width": px(lineWidth),
            "--grid-pattern-major": majorOf(majorEvery),
            "--grid-pattern-radius": px(radius),
            "--grid-pattern-size": px(size),
            "--grid-pattern-speed": speed,
          } as CSSProperties
        }
      >
        <div
          className="grid-pattern-lines absolute inset-0"
          data-slot="grid-pattern-lines"
        />
        {squaresOf(squares, seed).map((cell) => (
          <div
            className="grid-pattern-square animate-grid-pattern-square motion-reduce:[animation-play-state:paused]"
            data-slot="grid-pattern-square"
            key={cell.key}
            style={cell.style}
          />
        ))}
        {interactive ? (
          <div
            className="grid-pattern-lit absolute inset-0"
            data-slot="grid-pattern-lit"
          >
            <div
              className="grid-pattern-glow"
              data-slot="grid-pattern-glow"
              ref={glow}
            />
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
};
