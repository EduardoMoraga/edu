/**
 * The EDU wordmark (≤ 60 columns) and tagline. The wordmark is the product
 * mark and stays "EDU"; a custom identity name appears in the signature line.
 */
import { createTheme, type Theme } from './theme.js';

export const TAGLINE = 'a second brain that learns · a crew you can see';
const TAGLINE_ASCII = 'a second brain that learns - a crew you can see';

const WORDMARK_UNICODE = [
  '███████╗██████╗ ██╗   ██╗',
  '██╔════╝██╔══██╗██║   ██║',
  '█████╗  ██║  ██║██║   ██║',
  '██╔══╝  ██║  ██║██║   ██║',
  '███████╗██████╔╝╚██████╔╝',
  '╚══════╝╚═════╝  ╚═════╝ ',
];

const WORDMARK_ASCII = [
  ' _____ ____  _   _ ',
  '| ____|  _ \\| | | |',
  '|  _| | | | | | | |',
  '| |___| |_| | |_| |',
  '|_____|____/ \\___/ ',
];

export interface BannerOptions {
  unicode: boolean;
  theme?: Theme;
  /** Identity name; shown in the signature line when it is not "Edu". */
  name?: string;
  version?: string;
}

export function renderBanner(opts: BannerOptions): string {
  const theme = opts.theme ?? createTheme(0);
  const mark = (opts.unicode ? WORDMARK_UNICODE : WORDMARK_ASCII).map((l) =>
    theme.paint('accent', l.trimEnd(), { bold: true }),
  );
  const tagline = opts.unicode ? TAGLINE : TAGLINE_ASCII;
  const sig: string[] = [];
  if (opts.name && opts.name.toLowerCase() !== 'edu') sig.push(opts.name);
  if (opts.version) sig.push(`v${opts.version}`);
  const lines = [...mark, '', theme.paint('muted', tagline)];
  if (sig.length > 0) lines.push(theme.paint('muted', sig.join(opts.unicode ? ' · ' : ' - ')));
  return lines.join('\n');
}
