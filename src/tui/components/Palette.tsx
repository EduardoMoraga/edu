import { Box, Text } from 'ink';
import { displayWidth, padEndDisplay, truncate } from '../../identity/index.js';
import type { PaletteCommand } from '../palette.js';
import { glyphSafe } from '../strings.js';
import { Label, Tx, useUi } from './ui.js';

export interface PaletteProps {
  items: readonly PaletteCommand[];
  /** Index of the highlighted item. */
  selected: number;
  width: number;
}

/** The `/` options panel, shown in place of the body while the draft is a bare `/word`. */
export function Palette({ items, selected, width }: PaletteProps) {
  const { glyphs, strings } = useUi();
  const labels = items.map((c) => `/${c.name}${c.args ? ` ${c.args}` : ''}`);
  const labelWidth = Math.max(10, ...labels.map((l) => displayWidth(l))) + 2;
  const room = Math.max(8, width - 4 - labelWidth);
  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      <Label active>{strings.palette.title}</Label>
      {items.length === 0 ? <Tx dim>{strings.palette.empty}</Tx> : null}
      {items.map((c, i) => {
        const active = i === selected;
        return (
          <Text key={c.name} wrap="truncate-end">
            <Tx tone="accent">{active ? `${glyphs.selected} ` : '  '}</Tx>
            <Tx tone={active ? 'accent' : undefined} bold={active}>
              {padEndDisplay(labels[i]!, labelWidth)}
            </Tx>
            <Tx dim={!active}>{truncate(strings.palette.describe[c.name] ?? '', room, glyphs.ellipsis)}</Tx>
          </Text>
        );
      })}
      <Text> </Text>
      <Tx dim>{glyphSafe(strings.palette.hint, glyphs.unicode)}</Tx>
    </Box>
  );
}
