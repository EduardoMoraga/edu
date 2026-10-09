import { Box, Text } from 'ink';
import { displayWidth, padEndDisplay } from '../../identity/index.js';
import { glyphSafe } from '../strings.js';
import { wrapPlain } from '../wrap.js';
import { Label, Tx, useUi } from './ui.js';

/** Keyboard reference, shown in place of the body while open. Descriptions wrap. */
export function HelpOverlay({ width }: { width: number }) {
  const { glyphs, strings } = useUi();
  const keys = strings.help.keys.map(([k, what]) => [glyphSafe(k, glyphs.unicode), glyphSafe(what, glyphs.unicode)] as const);
  const keyWidth = Math.max(...keys.map(([k]) => displayWidth(k))) + 2;
  const room = Math.max(10, width - 2 - keyWidth);
  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      <Label active>{strings.help.title}</Label>
      {keys.map(([key, what]) =>
        wrapPlain(what, room).map((line, i) => (
          <Text key={`${key}${i}`} wrap="truncate-end">
            <Tx tone="accent" bold>
              {padEndDisplay(i === 0 ? key : '', keyWidth)}
            </Tx>
            <Tx>{line}</Tx>
          </Text>
        )),
      )}
      <Text> </Text>
      <Tx dim>{strings.help.close}</Tx>
    </Box>
  );
}
