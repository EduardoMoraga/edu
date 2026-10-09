/**
 * Keyboard and paste handling for the live view. Keys by pane:
 *
 * - everywhere: ctrl+c cancels a running run (quits when idle), PgUp/PgDn
 *   scroll the focus pane, tab cycles panes, any key closes the help overlay.
 * - composer: typing edits a multi-line draft (←/→, home/end, ↑/↓ between
 *   lines, alt+enter newline), Enter submits, Esc clears (or leaves when
 *   empty), `/` opens the command palette, `?` in an empty draft opens help.
 * - agents: ↑/↓ select; focus: ↑/↓ scroll a line, home oldest, end follow.
 * - outside the composer: y/n/d answer approvals, `/` palette, `?` help, q quit.
 */
import { useApp, useInput, usePaste, type Key } from 'ink';
import type { Dispatch, SetStateAction } from 'react';
import { EMPTY_EDITOR, editKey, insert, type EditorState } from './editor.js';
import { FOLLOW, scrollBy, scrollToTop, type ScrollState } from './focus.js';
import { findCommand, parseCommand, type CommandName, type PaletteCommand } from './palette.js';
import type { AppProps, Pane } from './App.js';
import type { PendingApproval, TuiState } from './state.js';
import { fill, uiStrings, type UiLang, type UiStrings } from './strings.js';

const PANES: Pane[] = ['agents', 'focus', 'composer'];

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface AppInput {
  props: AppProps;
  state: TuiState;
  dispatch: Dispatch<{ kind: 'move'; delta: number }>;
  pane: Pane;
  setPane: Setter<Pane>;
  help: boolean;
  setHelp: Setter<boolean>;
  editor: EditorState;
  setEditor: Setter<EditorState>;
  palette: {
    /** Defined while the palette is open. */
    query?: string;
    matches: readonly PaletteCommand[];
    selected: number;
    setPick: Setter<number>;
    commands: readonly PaletteCommand[];
  };
  setNotice: Setter<string | undefined>;
  approval?: PendingApproval;
  /** Marks an approval as answered locally (hides the card). */
  answer(approvalId: string): void;
  setDetail: Setter<boolean>;
  cancelling: boolean;
  setCancelling: Setter<boolean>;
  scroll: { total: number; height: number; set: Setter<ScrollState> };
  setLang: Setter<UiLang>;
  strings: UiStrings;
}

export function useAppInput(input: AppInput): void {
  const { exit } = useApp();
  const { props, state, pane, editor, palette, strings, scroll } = input;
  const running = state.run.startedAt !== undefined && state.run.endedAt === undefined;

  const say = (text: string | undefined) => input.setNotice(text);
  const clear = () => input.setEditor(EMPTY_EDITOR);

  const cancel = (): boolean => {
    if (!props.onCancel || input.cancelling || !running) return false;
    input.setCancelling(true);
    props.onCancel();
    return true;
  };

  const decide = (approved: boolean) => {
    const approval = input.approval;
    if (!approval) return say(strings.notice.noApproval);
    props.onApprove?.(approval.approvalId, approved);
    input.answer(approval.approvalId);
  };

  const run = (name: CommandName, args: string) => {
    switch (name) {
      case 'help':
        return input.setHelp(true);
      case 'agents':
        return input.setPane('agents');
      case 'approve':
      case 'reject':
        return decide(name === 'approve');
      case 'cancel':
        if (!cancel()) say(fill(strings.notice.unavailable, { name: '/cancel' }));
        return;
      case 'lang': {
        const lang = args.toLowerCase();
        if (lang !== 'es' && lang !== 'en') return say(fill(strings.notice.usage, { usage: '/lang es|en' }));
        input.setLang(lang);
        return say(uiStrings(lang).notice.lang);
      }
      case 'quit':
        return exit();
      default:
        return host(name, args);
    }
  };

  const host = (name: CommandName, args: string) => {
    const fallback = () =>
      name === 'brain'
        ? say(fill(strings.notice.brain, { recalled: state.brain.recalledIds.length, learned: state.brain.learnings.length }))
        : say(fill(strings.notice.unavailable, { name: `/${name}` }));
    const handler = props.onCommand;
    if (!handler) return fallback();
    void Promise.resolve()
      .then(() => handler(name, args))
      .then(
        (text) => (text ? say(text) : fallback()),
        (error: unknown) => say(error instanceof Error ? error.message : String(error)),
      );
  };

  const submit = () => {
    const text = editor.text.trim();
    if (!text) return;
    if (palette.query !== undefined) {
      const chosen = palette.matches[palette.selected];
      if (!chosen) {
        clear();
        return say(fill(strings.notice.unknown, { name: text }));
      }
      if (chosen.args) return input.setEditor(insert(EMPTY_EDITOR, `/${chosen.name} `));
      clear();
      return run(chosen.name, '');
    }
    clear();
    const parsed = parseCommand(text);
    if (!parsed) {
      if (props.onSubmit) props.onSubmit(text);
      else say(strings.notice.noLead);
      return;
    }
    const command = findCommand(palette.commands, parsed.name);
    if (!command) return say(fill(strings.notice.unknown, { name: `/${parsed.name}` }));
    if (command.args && !parsed.args) return say(fill(strings.notice.usage, { usage: `/${command.name} ${command.args}` }));
    run(command.name, parsed.args);
  };

  const scrollFocus = (delta: number) => input.scroll.set((s) => scrollBy(s, scroll.total, scroll.height, delta));
  const page = Math.max(1, scroll.height - 2);

  const onComposerKey = (text: string, key: Key) => {
    if (palette.query !== undefined) {
      if (key.upArrow || key.downArrow) {
        const n = palette.matches.length;
        if (n) palette.setPick((palette.selected + (key.upArrow ? n - 1 : 1)) % n);
        return;
      }
      if (key.tab) {
        const chosen = palette.matches[palette.selected];
        if (chosen) input.setEditor(insert(EMPTY_EDITOR, `/${chosen.name}${chosen.args ? ' ' : ''}`));
        return;
      }
    }
    if (key.escape) {
      if (editor.text) clear();
      else input.setPane('agents');
      say(undefined);
      return;
    }
    if (key.tab) return cyclePane(key.shift);
    if (text === '?' && !editor.text) return input.setHelp(true);
    if (editKey(editor, text, key).kind === 'submit') return submit();
    // Functional update: several keys can arrive before the next render.
    input.setEditor((current) => {
      const result = editKey(current, text, key);
      return result.kind === 'edit' ? result.state : current;
    });
    say(undefined);
  };

  const cyclePane = (back: boolean) =>
    input.setPane((p) => PANES[(PANES.indexOf(p) + (back ? PANES.length - 1 : 1)) % PANES.length]!);

  useInput((text: string, key: Key) => {
    if (key.ctrl && text === 'c') {
      // Nothing running yet (home screen) or already finished: quit right away.
      if (!cancel()) exit();
      return;
    }
    if (input.help) return input.setHelp(false);
    if (key.pageUp || key.pageDown) return scrollFocus(key.pageUp ? -page : page);
    if (pane === 'composer') return onComposerKey(text, key);
    if (key.tab) return cyclePane(key.shift);
    if (text === '/') {
      input.setPane('composer');
      input.setEditor(insert(EMPTY_EDITOR, '/'));
      return;
    }
    if (pane === 'focus') {
      if (key.upArrow || key.downArrow) return scrollFocus(key.upArrow ? -1 : 1);
      if (key.home) return input.scroll.set(scrollToTop(scroll.total, scroll.height));
      if (key.end) return input.scroll.set(FOLLOW);
    } else if (key.upArrow || key.downArrow) {
      return input.dispatch({ kind: 'move', delta: key.upArrow ? -1 : 1 });
    }
    if (input.approval && (text === 'y' || text === 'n')) return decide(text === 'y');
    if (input.approval && text === 'd') return input.setDetail((d) => !d);
    if (text === '?') return input.setHelp(true);
    if (text === 'q') exit();
  });

  // Bracketed paste: the whole chunk lands in the composer, newlines included.
  usePaste((text) => {
    if (input.help) input.setHelp(false);
    input.setPane('composer');
    input.setEditor((e) => insert(e, text));
  });
}
