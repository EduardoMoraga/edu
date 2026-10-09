import { Box, Text } from 'ink';
import { composerView, type EditorState } from '../editor.js';
import { glyphSafe } from '../strings.js';
import { Tx, useUi } from './ui.js';

/** The composer grows up to this many rows, then scrolls with the cursor. */
export const COMPOSER_ROWS = 5;
const PROMPT_WIDTH = 2;

export interface ComposerProps {
  editor: EditorState;
  active: boolean;
  width: number;
}

/** Rows the composer occupies at `width` (always at least one, for the placeholder). */
export function composerHeight(editor: EditorState, width: number): number {
  return editor.text ? composerView(editor, width - PROMPT_WIDTH, COMPOSER_ROWS).rows.length : 1;
}

/**
 * Multi-line message box to the lead. Input is owned by App; this only
 * renders the text, the cursor (a thin bar between characters) and scroll
 * markers when rows are hidden above or below.
 */
export function Composer({ editor, active, width }: ComposerProps) {
  const { glyphs, strings } = useUi();
  const prompt = `${glyphs.arrow} `;
  if (!editor.text) {
    return (
      <Text wrap="truncate-end">
        <Tx tone={active ? 'accent' : 'muted'} bold={active}>
          {prompt}
        </Tx>
        {active ? <Tx tone="accent">{glyphs.cursor}</Tx> : null}
        <Tx dim>{active ? ` ${strings.composer.active}` : glyphSafe(strings.composer.idle, glyphs.unicode)}</Tx>
      </Text>
    );
  }
  const view = composerView(editor, width - PROMPT_WIDTH, COMPOSER_ROWS);
  return (
    <Box flexDirection="column" width={width}>
      {view.rows.map((row, i) => {
        const first = i === 0;
        const last = i === view.rows.length - 1;
        const marker = first && view.above > 0 ? (glyphs.unicode ? '↑ ' : '^ ') : last && view.below > 0 ? (glyphs.unicode ? '↓ ' : 'v ') : first ? prompt : '  ';
        const chars = [...row.text];
        const at = active ? row.cursorAt : undefined;
        return (
          <Text key={i} wrap="truncate-end">
            <Tx tone={active ? 'accent' : 'muted'} bold={active}>
              {marker}
            </Tx>
            {at === undefined ? (
              <Tx>{row.text}</Tx>
            ) : (
              <>
                <Tx>{chars.slice(0, at).join('')}</Tx>
                <Tx tone="accent">{glyphs.cursor}</Tx>
                <Tx>{chars.slice(at).join('')}</Tx>
              </>
            )}
          </Text>
        );
      })}
    </Box>
  );
}
