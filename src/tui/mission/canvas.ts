/**
 * A tiny character canvas: blit styled lines at (x, y), plot single cells,
 * then read it back as DisplayLines. Wide characters occupy two cells.
 */
import { displayWidth, type ToneToken } from '../../identity/index.js';
import type { DisplayLine, Segment } from '../lines.js';

interface Cell {
  /** '' marks the second half of a wide character. */
  ch: string;
  tone?: ToneToken;
  bold?: boolean;
  dim?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Canvas {
  private readonly cells: Cell[][];

  constructor(readonly width: number, readonly height: number) {
    this.cells = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ch: ' ' })));
  }

  plot(x: number, y: number, ch: string, style: Omit<Cell, 'ch'> = {}): void {
    if (y < 0 || y >= this.height || x < 0 || x >= this.width) return;
    this.cells[y]![x] = { ch, ...style };
  }

  /** Writes a line starting at (x, y), clipped to the canvas. */
  blit(x: number, y: number, line: DisplayLine): void {
    let cx = x;
    for (const seg of line) {
      for (const ch of seg.text) {
        const w = displayWidth(ch);
        if (w === 0) continue;
        if (cx + w > this.width) return;
        this.plot(cx, y, ch, { tone: seg.tone, bold: seg.bold, dim: seg.dim });
        if (w === 2) this.plot(cx + 1, y, '', {});
        cx += w;
      }
    }
  }

  lines(): DisplayLine[] {
    return this.cells.map((row) => {
      const out: Segment[] = [];
      for (const cell of row) {
        if (cell.ch === '') continue;
        const last = out.at(-1);
        if (last && last.tone === cell.tone && last.bold === cell.bold && last.dim === cell.dim) last.text += cell.ch;
        else out.push({ text: cell.ch, tone: cell.tone, bold: cell.bold, dim: cell.dim });
      }
      return out;
    });
  }
}

export function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export function overlaps(a: Rect, b: Rect, gapX = 2, gapY = 0): boolean {
  return a.x < b.x + b.w + gapX && b.x < a.x + a.w + gapX && a.y < b.y + b.h + gapY && b.y < a.y + a.h + gapY;
}

/** Integer points on the segment from (x0, y0) to (x1, y1), inclusive (Bresenham). */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}
