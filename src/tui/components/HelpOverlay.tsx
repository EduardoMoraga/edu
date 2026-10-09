import { Box, Text } from 'ink';
import { Label, Tx, useUi } from './ui.js';

const KEYS: Array<[string, string]> = [
  ['↑ ↓', 'select agent (scroll in the focus pane)'],
  ['tab', 'cycle panes: agents → focus → composer'],
  ['y n', 'approve or reject the pending request'],
  ['d', 'show or hide approval details'],
  ['enter', 'send the composer message to the lead'],
  ['esc', 'leave the composer'],
  ['?', 'toggle this help'],
  ['q', 'quit the view (the run keeps going)'],
  ['ctrl+c', 'cancel the run; press again to quit'],
];

/** Keyboard reference, shown in place of the body while open. */
export function HelpOverlay({ width }: { width: number }) {
  const { glyphs } = useUi();
  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      <Label active>KEYS</Label>
      {KEYS.map(([key, what]) => (
        <Text key={key} wrap="truncate-end">
          <Tx tone="accent" bold>
            {(glyphs.unicode ? key : key.replace('↑ ↓', 'up/dn').replace('→', '>')).padEnd(8)}
          </Tx>
          <Tx>{glyphs.unicode ? what : what.replaceAll('→', '>')}</Tx>
        </Text>
      ))}
      <Text> </Text>
      <Tx dim>any key closes this help</Tx>
    </Box>
  );
}
