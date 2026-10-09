/**
 * Edu live view: a fold of EduEvents rendered as header · agent tree · focus
 * pane · approval card · brain strip + composer. Responsive to width; all
 * styling flows through the theme so NO_COLOR output is escape-free.
 */
import { Box, useApp, useInput, useWindowSize, type Key } from 'ink';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { EduEvent } from '../core/contracts.js';
import { getGlyphs, detectTheme, type Glyphs, type Theme } from '../identity/index.js';
import { AgentTree } from './components/AgentTree.js';
import { ApprovalCard, approvalCardHeight } from './components/ApprovalCard.js';
import { BrainStrip, type ContextUsage } from './components/BrainStrip.js';
import { Composer } from './components/Composer.js';
import { FocusPane } from './components/FocusPane.js';
import { Header } from './components/Header.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { Line, Rule, UiContext } from './components/ui.js';
import { computeLayout, focusLogHeight } from './layout.js';
import { agentTree, focusedAgent, moveFocus, selectAgent } from './selectors.js';
import { initialState, reduce, reduceAll, type TuiState } from './state.js';

export type Pane = 'agents' | 'focus' | 'composer';
const PANES: Pane[] = ['agents', 'focus', 'composer'];

export interface AppProps {
  /** Live stream (async iterable) or a finished run (array, folded synchronously). */
  events: AsyncIterable<EduEvent> | readonly EduEvent[];
  onApprove?: (approvalId: string, approved: boolean) => void;
  onSubmit?: (text: string) => void;
  onCancel?: () => void;
  /** Identity name shown in the header. Defaults to "Edu". */
  name?: string;
  theme?: Theme;
  glyphs?: Glyphs;
  /** Overrides the terminal size (tests, embedding). */
  columns?: number;
  rows?: number;
  context?: ContextUsage;
  /** Pane focused on mount. Defaults to the composer when onSubmit is wired, so typing works immediately. */
  initialPane?: Pane;
}

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
  const { events, onApprove, onSubmit, onCancel } = props;
  const theme = useMemo(() => props.theme ?? detectTheme(), [props.theme]);
  const glyphs = useMemo(() => props.glyphs ?? getGlyphs(), [props.glyphs]);
  const ui = useMemo(() => ({ theme, glyphs }), [theme, glyphs]);
  const live = !isEventArray(events);

  const [state, dispatch] = useReducer(appReducer, events, (e) => (isEventArray(e) ? reduceAll(e) : initialState));
  const { exit } = useApp();
  const window = useWindowSize();
  const layout = computeLayout(props.columns ?? window.columns, props.rows ?? window.rows);

  const [pane, setPane] = useState<Pane>(props.initialPane ?? (onSubmit ? 'composer' : 'agents'));
  const [help, setHelp] = useState(false);
  const [draft, setDraft] = useState('');
  const [detail, setDetail] = useState(false);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [cancelling, setCancelling] = useState(false);
  const [scroll, setScroll] = useState(0);
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
  useEffect(() => setScroll(0), [agentId]);

  const pending = state.approvals.filter((a) => !answered.has(a.approvalId));
  const approval = pending[0];
  const approvalLines = approval ? approvalCardHeight(detail, approval.detail, layout.inner) : 0;
  const treeRows = agentTree(state).length;
  const logHeight = focusLogHeight(layout, { approvalLines, treeRows: Math.max(1, treeRows) });

  useInput((input: string, key: Key) => {
    if (key.ctrl && input === 'c') {
      // Nothing running yet (home screen) or already finished: quit right away.
      const running = state.run.startedAt !== undefined && state.run.endedAt === undefined;
      if (onCancel && !cancelling && running) {
        setCancelling(true);
        onCancel();
      } else {
        exit();
      }
      return;
    }
    if (help) {
      setHelp(false);
      return;
    }
    if (key.tab) {
      setPane((p) => PANES[(PANES.indexOf(p) + (key.shift ? PANES.length - 1 : 1)) % PANES.length]!);
      return;
    }
    if (pane === 'composer') {
      if (key.escape) setPane('agents');
      else if (key.return) {
        const text = draft.trim();
        if (text) onSubmit?.(text);
        setDraft('');
      } else if (key.backspace || key.delete) setDraft((d) => [...d].slice(0, -1).join(''));
      else if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow) setDraft((d) => d + input);
      return;
    }
    if (key.upArrow || key.downArrow) {
      const delta = key.upArrow ? -1 : 1;
      if (pane === 'focus') setScroll((s) => Math.max(0, s - delta));
      else dispatch({ kind: 'move', delta });
      return;
    }
    if (approval && (input === 'y' || input === 'n')) {
      onApprove?.(approval.approvalId, input === 'y');
      setAnswered((s) => new Set(s).add(approval.approvalId));
      setDetail(false);
      return;
    }
    if (approval && input === 'd') setDetail((d) => !d);
    else if (input === '?') setHelp(true);
    else if (input === 'q') exit();
  });

  const twoColumns = layout.mode !== 'narrow';
  // Errors not tied to an agent (engine missing, broken stream) have no pane of their own.
  const runError = state.errors.filter((e) => !e.agentId).at(-1)?.message;
  return (
    <UiContext value={ui}>
      <Box
        flexDirection="column"
        width={layout.columns}
        borderStyle={glyphs.unicode ? 'round' : 'classic'}
        borderColor={theme.color('border')}
        paddingX={1}
      >
        <Header state={state} layout={layout} name={props.name ?? 'Edu'} now={now.value} cancelling={cancelling} />
        <Rule width={layout.inner} />
        {help ? (
          <HelpOverlay width={layout.inner} />
        ) : (
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
              <FocusPane agent={agent} width={layout.focusWidth} height={logHeight} now={now.value} active={pane === 'focus'} scroll={scroll} />
            </Box>
          </Box>
        )}
        {approval && !help ? (
          <>
            <Rule width={layout.inner} />
            <ApprovalCard
              approval={approval}
              role={state.agents[approval.agentId]?.role ?? approval.agentId}
              width={layout.inner}
              queued={pending.length - 1}
              showDetail={detail}
            />
          </>
        ) : null}
        {runError ? (
          <>
            <Rule width={layout.inner} />
            <Line line={[{ text: `${glyphs.fail} `, tone: 'danger' }, { text: runError, tone: 'danger' }]} />
          </>
        ) : null}
        <Rule width={layout.inner} />
        <Box flexDirection={twoColumns ? 'row' : 'column'} justifyContent="space-between">
          <BrainStrip brain={state.brain} context={props.context} width={twoColumns ? Math.floor(layout.inner * 0.55) : layout.inner} />
          <Box width={twoColumns ? Math.ceil(layout.inner * 0.45) - 1 : layout.inner}>
            <Composer value={draft} active={pane === 'composer'} width={twoColumns ? Math.ceil(layout.inner * 0.45) - 1 : layout.inner} />
          </Box>
        </Box>
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
