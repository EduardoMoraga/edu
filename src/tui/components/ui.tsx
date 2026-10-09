/**
 * Shared styling primitives. Every styled glyph in the TUI goes through `Tx`,
 * which drops color, bold and dim entirely when the theme is unstyled
 * (NO_COLOR, pipes) so output contains no ANSI escapes.
 */
import { Text } from 'ink';
import { createContext, use, type ReactNode } from 'react';
import { UNICODE_GLYPHS, createTheme, type Glyphs, type Theme, type ToneToken } from '../../identity/index.js';
import type { DisplayLine } from '../lines.js';
import { uiStrings, type UiStrings } from '../strings.js';

export interface UiContextValue {
  theme: Theme;
  glyphs: Glyphs;
  /** Localized labels; English when absent. */
  strings?: UiStrings;
}

const EN = uiStrings('en');

export const UiContext = createContext<UiContextValue>({ theme: createTheme(0), glyphs: UNICODE_GLYPHS, strings: uiStrings('en') });

export function useUi(): Required<UiContextValue> {
  const value = use(UiContext);
  return value.strings ? (value as Required<UiContextValue>) : { ...value, strings: EN };
}

export interface TxProps {
  tone?: ToneToken;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  wrap?: 'wrap' | 'truncate' | 'truncate-end' | 'truncate-middle' | 'truncate-start';
  children?: ReactNode;
}

export function Tx({ tone, bold, dim, italic, wrap, children }: TxProps) {
  const { theme } = useUi();
  if (!theme.styled) return <Text wrap={wrap}>{children}</Text>;
  return (
    <Text color={tone ? theme.color(tone) : undefined} bold={bold} dimColor={dim} italic={italic} wrap={wrap}>
      {children}
    </Text>
  );
}

/** One display line made of styled segments, clipped to its box. */
export function Line({ line }: { line: DisplayLine }) {
  if (line.length === 0) return <Text> </Text>;
  return (
    <Text wrap="truncate-end">
      {line.map((s, i) => (
        <Tx key={i} tone={s.tone} bold={s.bold} dim={s.dim} italic={s.italic}>
          {s.text}
        </Tx>
      ))}
    </Text>
  );
}

/** Horizontal rule spanning `width` cells. */
export function Rule({ width }: { width: number }) {
  const { glyphs } = useUi();
  return (
    <Tx tone="border" wrap="truncate-end">
      {glyphs.rule.repeat(Math.max(0, width))}
    </Tx>
  );
}

/** Section label: accent when its pane is active, muted otherwise. */
export function Label({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <Tx tone={active ? 'accent' : 'muted'} bold>
      {children}
    </Tx>
  );
}
