/**
 * Edu live view: a fold of EduEvents rendered as header · agent tree · focus
 * pane · approval card · brain strip · composer. Responsive to width; long
 * text wraps instead of being cut; all styling flows through the theme so
 * NO_COLOR output is escape-free. Keyboard handling lives in `useAppInput`.
 */
import { Box, useWindowSize } from 'ink';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { EduEvent } from '../core/contracts.js';
import { getGlyphs, detectTheme, type Glyphs, type Theme } from '../identity/index.js';
import { AgentTree } from './components/AgentTree.js';
import { ApprovalCard, approvalCardHeight } from './components/ApprovalCard.js';
import { BrainStrip, brainLines, type ContextUsage } from './components/BrainStrip.js';
import { Composer, composerHeight } from './components/Composer.js';
import { FocusPane } from './components/FocusPane.js';
import { Header, headerModel } from './components/Header.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { Palette } from './components/Palette.js';
import { Line, Rule, UiContext } from './components/ui.js';
import { EMPTY_EDITOR, type EditorState } from './editor.js';
import { FOLLOW, focusWindow, type ScrollState } from './focus.js';
import { computeLayout, focusLogHeight } from './layout.js';
import { logLines, type DisplayLine } from './lines.js';
import { availableCommands, filterCommands, paletteQuery } from './palette.js';
import { agentTree, focusedAgent, moveFocus, selectAgent } from './selectors.js';
import { initialState, reduce, reduceAll, type TuiState } from './state.js';
import { uiStrings, type UiLang } from './strings.js';
import { useAppInput } from './useAppInput.js';
import { wrapPlain, wrapSegments } from './wrap.js';

export type Pane = 'agents' | 'focus' | 'composer';

/**
 * Host handler for palette commands the view cannot run itself (`brain`,
 * `recall`, and in watch mode `dispatch`, `status`). The returned text is
 * shown as a notice above the composer.
 */
export type CommandHandler = (name: string, args: string) => string | void | Promise<string | void>;

export interface AppProps {
  /** Live stream (async iterable) or a finished run (array, folded synchronously). */
  events: AsyncIterable<EduEvent> | readonly EduEvent[];
  onApprove?: (approvalId: string, approved: boolean) => void;
  onSubmit?: (text: string) => void;
  onCancel?: () => void;
  onCommand?: CommandHandler;
  /** Identity name shown in the header. Defaults to "Edu". */
  name?: string;
  theme?: Theme;
  glyphs?: Glyphs;
  /** Interface language for labels, placeholders and help. Defaults to English; `/lang` switches it. */
  lang?: UiLang;
  /** Watch (crew) mode: adds `/dispatch` and `/status` to the palette. */
  crew?: boolean;
  /** Overrides the terminal size (tests, embedding). */
  columns?: number;
  rows?: number;
  context?: ContextUsage;
  /** Pane focused on mount. Defaults to the composer when onSubmit is wired, so typing works immediately. */
  initialPane?: Pane;
}

/** Wrapped task description lines under the focus title. */
const TASK_LINES = 2;
/** Notice and run-error blocks never take more than this many lines. */
const NOTICE_LINES = 2;

type Action = { kind: 'event'; event: EduEvent } | { kind: 'move'; delta: number } | { kind: 'select'; agentId: string };

function appReducer(state: TuiState, action: Action): TuiState {
  if (action.kind === 'event') return reduce(state, action.event);
  if (action.kind === 'move') return moveFocus(state, action.delta);
  return selectAgent(state, action.agentId);
}

function isEventArray(events: AppProps['events']): events is readonly EduEvent[] {
  return Array.isArray(events);
}

export function App(props: AppProps) {
  const { events } = props;
  const theme = useMemo(() => props.theme ?? detectTheme(), [props.theme]);
  const glyphs = useMemo(() => props.glyphs ?? getGlyphs(), [props.glyphs]);
  const [lang, setLang] = useState<UiLang>(props.lang ?? 'en');
  const strings = uiStrings(lang);
  const ui = useMemo(() => ({ theme, glyphs, strings }), [theme, glyphs, strings]);
  const live = !isEventArray(events);

  const [state, dispatch] = useReducer(appReducer, events, (e) => (isEventArray(e) ? reduceAll(e) : initialState));
  const window = useWindowSize();
  const layout = computeLayout(props.columns ?? window.columns, props.rows ?? window.rows);

  const [pane, setPane] = useState<Pane>(props.initialPane ?? (props.onSubmit ? 'composer' : 'agents'));
  const [help, setHelp] = useState(false);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [pick, setPick] = useState(0);
  const [notice, setNotice] = useState<string | undefined>();
  const [detail, setDetail] = useState(false);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [cancelling, setCancelling] = useState(false);
  const [scroll, setScroll] = useState<ScrollState>(FOLLOW);
  const now = useLiveClock(live && state.run.endedAt === undefined, state.now);

  // Consume a live stream.
  const lastEventWall = now.lastEventWall;
  useEffect(() => {
    if (isEventArray(events)) return;
    let stopped = false;
    void (async () => {
      try {
        for await (const event of events) {
          if (stopped) break;
          lastEventWall.current = Date.now();
          dispatch({ kind: 'event', event });
        }
      } catch (err) {
        if (!stopped) {
          const message = err instanceof Error ? err.message : String(err);
          dispatch({ kind: 'event', event: { type: 'error', message: `event stream: ${message}`, at: new Date().toISOString() } });
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [events, lastEventWall]);

  const agent = focusedAgent(state);
  const agentId = agent?.id;
  useEffect(() => setScroll(FOLLOW), [agentId]);

  // Palette: open while the composer holds a bare `/word`.
  const commands = useMemo(() => availableCommands(Boolean(props.crew)), [props.crew]);
  const query = pane === 'composer' && !help ? paletteQuery(editor.text) : undefined;
  const matches = query === undefined ? [] : filterCommands(commands, query);
  const selected = Math.min(pick, Math.max(0, matches.length - 1));
  useEffect(() => setPick(0), [query]);

  // Height budget: everything that is not the focus log.
  const pending = state.approvals.filter((a) => !answered.has(a.approvalId));
  const approval = pending[0];
  const role = approval ? (state.agents[approval.agentId]?.role ?? approval.agentId) : '';
  const approvalProps = approval ? { approval, role, width: layout.inner, queued: pending.length - 1, showDetail: detail } : undefined;
  const header = headerModel({ state, layout, name: props.name ?? 'Edu', now: now.value, cancelling, glyphs, strings });
  // Errors not tied to an agent (engine missing, broken stream) have no pane of their own.
  const runError = state.errors.filter((e) => !e.agentId).at(-1)?.message;
  const errorLines: DisplayLine[] = runError
    ? wrapSegments([{ text: `${glyphs.fail} `, tone: 'danger' }, { text: runError, tone: 'danger' }], layout.inner, { indent: 2, maxLines: NOTICE_LINES, ellipsis: glyphs.ellipsis })
    : [];
  const noticeLines = notice ? wrapPlain(notice, layout.inner, { maxLines: NOTICE_LINES, ellipsis: glyphs.ellipsis }) : [];
  const brainRows = brainLines(state.brain, props.context, layout.inner, glyphs, strings).length;
  const taskLines: DisplayLine[] = agent?.task
    ? wrapPlain(agent.task, layout.focusWidth, { maxLines: TASK_LINES, ellipsis: glyphs.ellipsis }).map((text) => [{ text }])
    : [[{ text: ' ' }]];
  const logHeight = focusLogHeight(layout, {
    approvalLines: approvalProps ? approvalCardHeight(approvalProps, glyphs, strings) : 0,
    treeRows: Math.max(1, agentTree(state).length),
    headerLines: header.height,
    bottomLines: brainRows + noticeLines.length + composerHeight(editor, layout.inner),
    taskLines: taskLines.length,
    extraLines: errorLines.length ? errorLines.length + 1 : 0,
  });
  const lines = useMemo(
    () => (agent ? logLines(agent.log, layout.focusWidth, glyphs, strings) : []),
    [agent, layout.focusWidth, glyphs, strings],
  );
  const view = focusWindow(lines, logHeight, scroll);

  useAppInput({
    props,
    state,
    dispatch,
    pane,
    setPane,
    help,
    setHelp,
    editor,
    setEditor,
    palette: { query, matches, selected, setPick, commands },
    setNotice,
    approval,
    answer: (approvalId) => {
      setAnswered((s) => new Set(s).add(approvalId));
      setDetail(false);
    },
    setDetail,
    cancelling,
    setCancelling,
    scroll: { total: lines.length, height: logHeight, set: setScroll },
    setLang,
    strings,
  });

  const twoColumns = layout.mode !== 'narrow';
  const overlay = help ? <HelpOverlay width={layout.inner} /> : query !== undefined ? <Palette items={matches} selected={selected} width={layout.inner} /> : null;
  return (
    <UiContext value={ui}>
      <Box
        flexDirection="column"
        width={layout.columns}
        borderStyle={glyphs.unicode ? 'round' : 'classic'}
        borderColor={theme.color('border')}
        paddingX={1}
      >
        <Header model={header} hasGoal={Boolean(state.run.goal)} />
        <Rule width={layout.inner} />
        {overlay ?? (
          <Box flexDirection={twoColumns ? 'row' : 'column'}>
            <AgentTree state={state} layout={layout} now={now.value} active={pane === 'agents'} />
            {twoColumns ? null : <Rule width={layout.inner} />}
            <Box
              borderStyle={glyphs.unicode ? 'single' : 'classic'}
              borderColor={theme.color('border')}
              borderTop={false}
              borderRight={false}
              borderBottom={false}
              borderLeft={twoColumns}
              paddingLeft={twoColumns ? 1 : 0}
            >
              <FocusPane agent={agent} width={layout.focusWidth} now={now.value} active={pane === 'focus'} task={taskLines} view={view} />
            </Box>
          </Box>
        )}
        {approvalProps && !help ? (
          <>
            <Rule width={layout.inner} />
            <ApprovalCard {...approvalProps} />
          </>
        ) : null}
        {errorLines.length ? (
          <>
            <Rule width={layout.inner} />
            {errorLines.map((l, i) => (
              <Line key={i} line={l} />
            ))}
          </>
        ) : null}
        <Rule width={layout.inner} />
        <BrainStrip brain={state.brain} context={props.context} width={layout.inner} />
        {noticeLines.map((text, i) => (
          <Line key={`n${i}`} line={[{ text, tone: 'accent' }]} />
        ))}
        <Composer editor={editor} active={pane === 'composer'} width={layout.inner} />
      </Box>
    </UiContext>
  );
}

/**
 * Display clock. Event time drives elapsed counters; while a live run is
 * active it advances by wall time since the last event, so replays at their
 * original timestamps still tick naturally.
 */
function useLiveClock(ticking: boolean, eventNow: number) {
  const lastEventWall = useRef(Date.now());
  const [wall, setWall] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setWall(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  const value = ticking && eventNow > 0 ? eventNow + Math.max(0, wall - lastEventWall.current) : eventNow;
  return { value, lastEventWall };
}
