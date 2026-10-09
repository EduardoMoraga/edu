/**
 * Responsive layout, as a pure function of terminal size.
 *
 * wide   (≥ 100 cols): two columns, tree shows per-agent tokens.
 * medium (80–99):      two columns, narrower tree without tokens.
 * narrow (< 80):       single column; tree stacked above the focus pane.
 */

export type LayoutMode = 'wide' | 'medium' | 'narrow';

export interface Layout {
  mode: LayoutMode;
  columns: number;
  rows: number;
  /** Content width inside the outer frame (border + 1 col padding each side). */
  inner: number;
  treeWidth: number;
  /** Content width of the focus pane (after its divider and padding). */
  focusWidth: number;
  showTreeTokens: boolean;
}

export const MIN_COLUMNS = 40;
export const MIN_ROWS = 12;
const NARROW_TREE_MAX = 44;

export function computeLayout(columns: number, rows: number): Layout {
  const cols = Math.max(MIN_COLUMNS, Math.floor(columns || 0));
  const r = Math.max(MIN_ROWS, Math.floor(rows || 0));
  const inner = cols - 4;
  if (cols >= 100) {
    const treeWidth = 34;
    return { mode: 'wide', columns: cols, rows: r, inner, treeWidth, focusWidth: inner - treeWidth - 2, showTreeTokens: true };
  }
  if (cols >= 80) {
    const treeWidth = 26;
    return { mode: 'medium', columns: cols, rows: r, inner, treeWidth, focusWidth: inner - treeWidth - 2, showTreeTokens: false };
  }
  // Stacked: keep the tree compact instead of stretching status to the far edge.
  const treeWidth = Math.min(inner, NARROW_TREE_MAX);
  return { mode: 'narrow', columns: cols, rows: r, inner, treeWidth, focusWidth: inner, showTreeTokens: false };
}

export interface ChromeLines {
  /** Approval card lines (0 when no card). */
  approvalLines: number;
  /** Agent rows (stacked above the focus pane in narrow mode). */
  treeRows: number;
  /** Header lines; defaults to 1 (2 when narrow). */
  headerLines?: number;
  /** Everything under the bottom rule: brain strip, notice, composer rows. Defaults to 1 (2 when narrow). */
  bottomLines?: number;
  /** Focus pane task lines; defaults to 1. */
  taskLines?: number;
  /** Extra framed blocks above the bottom rule (e.g. a run error), including their rule. */
  extraLines?: number;
}

/**
 * Lines available for the focus log. Chrome = frame (2) + header + rules (2)
 * + bottom block + focus title (1) + task + approval card (+1 rule) + stacked
 * tree in narrow mode + extra blocks.
 */
export function focusLogHeight(layout: Layout, opts: ChromeLines): number {
  const narrow = layout.mode === 'narrow';
  const header = opts.headerLines ?? (narrow ? 2 : 1);
  const bottom = opts.bottomLines ?? (narrow ? 2 : 1);
  const tree = narrow ? opts.treeRows + 2 : 0;
  const approval = opts.approvalLines > 0 ? opts.approvalLines + 1 : 0;
  const chrome = 2 + header + 2 + bottom + 1 + (opts.taskLines ?? 1) + approval + tree + (opts.extraLines ?? 0);
  return Math.max(3, layout.rows - chrome);
}
