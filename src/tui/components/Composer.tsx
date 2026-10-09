import { Text } from 'ink';
import { displayWidth } from '../../identity/index.js';
import { Tx, useUi } from './ui.js';

export interface ComposerProps {
  value: string;
  active: boolean;
  width: number;
}

/** Single-line message box to the lead. Input is owned by App; this only renders. */
export function Composer({ value, active, width }: ComposerProps) {
  const { glyphs } = useUi();
  const prompt = `${glyphs.arrow} `;
  if (!value && !active) {
    return (
      <Text wrap="truncate-end">
        <Tx tone="muted">{prompt}</Tx>
        <Tx dim>{`message the lead ${glyphs.sep} tab ${glyphs.sep} ? help`}</Tx>
      </Text>
    );
  }
  const room = Math.max(4, width - displayWidth(prompt) - 1);
  const shown = tail(value, room);
  return (
    <Text wrap="truncate-end">
      <Tx tone={active ? 'accent' : 'muted'} bold={active}>
        {prompt}
      </Tx>
      <Tx>{shown}</Tx>
      {active ? <Tx tone="accent">{glyphs.cursor}</Tx> : null}
    </Text>
  );
}

/** Keeps the end of the input visible while typing. */
function tail(text: string, max: number): string {
  if (displayWidth(text) <= max) return text;
  const chars = [...text];
  let out = '';
  for (let i = chars.length - 1; i >= 0; i--) {
    const next = chars[i] + out;
    if (displayWidth(next) > max) break;
    out = next;
  }
  return out;
}
