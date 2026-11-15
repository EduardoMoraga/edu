// Edu Deck: the Edu tab (brain, maintenance, spec, crew, session, recent notes) and the strip on the tree tab.
// Copyright (c) 2026 Eduardo Moraga. MIT License.
import type { Elements } from 'claude-code'

import type { DeckConfirm, DeckEdu, DeckEduJob } from '../types'
import { JOB_GLYPHS, activeJobs, ago, elapsed, isActiveJob, stripParts, totalNotes } from './deck-edu.ts'
import type { Palette } from './deck-looks.ts'
import { fmtTokens } from './deck-model.ts'
import type { Words } from './deck-words.ts'

type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type EduActions = {
  refresh: () => void
  ask: (jobId: string, verdict: 'approve' | 'reject') => void
  confirm: () => void
  cancel: () => void
  open: () => void
}

export type EduInput = {
  edu: DeckEdu | undefined
  confirming?: DeckConfirm
  width: number
  palette: Palette
  w: Words
  now: number
  actions?: EduActions
}

/** Rows the strip takes on the tree tab: one, or none while Edu has nothing to say. */
export function eduStripRows(edu: DeckEdu | undefined, w: Words): number {
  return stripParts(edu, w.edu).length ? 1 : 0
}

/** One line under the tabs: brain size, approvals, overdue, active crew, session. Pressing it opens the Edu tab. */
export function drawEduStrip(ui: Ui, o: EduInput) {
  const { Box, Text, Button } = ui
  const parts = stripParts(o.edu, o.w.edu)
  if (!parts.length) return null
  const warn = Boolean(o.edu?.brain?.toApprove || o.edu?.maintenance?.overdue || o.edu?.approvals || o.edu?.state === 'failed' || o.edu?.state === 'missing')
  const label = `${o.w.edu.title} · ${o.w.edu.strip(parts)}`
  const line = (
    <Text wrap="truncate-end">
      <Text bold color={o.palette.main}>{o.w.edu.title}</Text>
      <Text color={o.palette.dim}>{' · '}</Text>
      <Text color={warn ? o.palette.warn : o.palette.dim}>{o.w.edu.strip(parts)}</Text>
    </Text>
  )
  return (
    <Box key="edu-strip" flexDirection="row" width={o.width}>
      {o.actions ? (
        <Button key="edu:open" plain label={label} onPress={() => o.actions?.open()}>
          {line}
        </Button>
      ) : (
        line
      )}
    </Box>
  )
}

function jobColor(palette: Palette, status: string): string {
  if (status === 'running') return palette.agent
  if (status === 'awaiting-approval') return palette.warn
  if (status === 'done') return palette.done
  if (status === 'failed') return palette.failed
  return palette.dim
}

function tokensText(job: DeckEduJob, w: Words): string {
  if (job.tokensKnown) return w.edu.tokens(fmtTokens(job.tokens, w.decimal) || '0')
  return job.tokens > 0 ? w.edu.tokensPartial(fmtTokens(job.tokens, w.decimal)) : ''
}

export function drawEdu(ui: Ui, o: EduInput) {
  const { Box, Text, Button } = ui
  const { w, palette, now } = o
  const words = w.edu
  const edu = o.edu
  const section = (key: string, title: string, right: string | undefined, children: unknown) => (
    <Box key={key} flexDirection="column" width={o.width} marginTop={1}>
      <Box key={`${key}:head`} flexDirection="row" justifyContent="space-between" columnGap={1} width={o.width}>
        <Text bold color={palette.main}>{title}</Text>
        {right ? (
          <Text color={palette.dim} wrap="truncate-end">
            {right}
          </Text>
        ) : null}
      </Box>
      {children as never}
    </Box>
  )

  const refresh = o.actions ? <Button key="edu:refresh" hotkey="r" label={words.refresh} onPress={() => o.actions?.refresh()} /> : null

  const status =
    !edu || (edu.state === 'loading' && edu.checkedAt === undefined) ? (
      <Text color={palette.dim}>{words.loading}</Text>
    ) : edu.state === 'missing' ? (
      <Box key="edu-missing" flexDirection="column" width={o.width}>
        <Text color={palette.warn} wrap="wrap">
          {words.missing}
        </Text>
        {edu.error ? (
          <Text color={palette.dim} wrap="wrap">
            {words.missingReason(edu.error)}
          </Text>
        ) : null}
      </Box>
    ) : edu.state === 'failed' ? (
      <Text color={palette.failed} wrap="wrap">
        {words.failed(edu.error ?? '')}
      </Text>
    ) : null

  const head = (
    <Box key="edu-head" flexDirection="row" justifyContent="space-between" columnGap={1} width={o.width} marginTop={1}>
      <Box key="edu-who" flexShrink={1}>
        <Text wrap="truncate-end">
          <Text bold color={palette.main}>{edu?.identity ?? 'Edu'}</Text>
          {edu?.project?.name ? <Text color={palette.dim}>{` · ${edu.project.name}`}</Text> : null}
          {edu?.checkedAt !== undefined ? <Text color={palette.dim}>{` · ${words.updated(ago(edu.checkedAt, now))}`}</Text> : null}
        </Text>
      </Box>
      {refresh}
    </Box>
  )

  if (!edu || edu.checkedAt === undefined || edu.state === 'missing') {
    return (
      <Box key="edu-view" flexDirection="column" width={o.width}>
        {head}
        {status}
      </Box>
    )
  }

  const brain = edu.brain
  const brainBody = brain ? (
    <Text wrap="wrap">
      <Text color={palette.done}>{`${words.canonical} ${brain.canonical}`}</Text>
      <Text color={palette.dim}>{' · '}</Text>
      {`${words.episodic} ${brain.episodic}`}
      <Text color={palette.dim}>{' · '}</Text>
      {`${words.transitive} ${brain.transitive}`}
      <Text color={palette.dim}>{' · '}</Text>
      {`${words.lessons} ${brain.lessons}`}
      {brain.toApprove ? (
        <Text>
          <Text color={palette.dim}>{' · '}</Text>
          <Text color={palette.warn}>{words.toApprove(brain.toApprove)}</Text>
        </Text>
      ) : null}
      {edu.maintenance?.overdue ? (
        <Text>
          <Text color={palette.dim}>{' · '}</Text>
          <Text color={palette.failed}>{words.overdue(edu.maintenance.overdue)}</Text>
        </Text>
      ) : null}
    </Text>
  ) : (
    <Text color={palette.dim} wrap="wrap">
      {words.noBrain}
    </Text>
  )
  const maintained = edu.maintenance?.lastRun !== undefined ? words.maintained(ago(edu.maintenance.lastRun, now)) : words.neverMaintained

  const sessionText = edu.session
    ? `${edu.session.status === 'open-session' ? words.sessionOpen : words.sessionClosed} · ${edu.session.id}`
    : edu.sessionKnown
      ? words.sessionNone
      : words.sessionOld

  const confirming = o.confirming
  const jobRow = (job: DeckEduJob) => {
    const mark = JOB_GLYPHS[job.status] ?? '?'
    const color = jobColor(palette, job.status)
    const tokens = tokensText(job, w)
    const right = [tokens, elapsed(job.startedAt || now, job.endedAt ?? now)].filter(Boolean).join(' · ')
    const asking = confirming?.jobId === job.id
    return (
      <Box key={`edu-job:${job.id}`} flexDirection="column" width={o.width}>
        <Box key={`edu-job-line:${job.id}`} flexDirection="row" justifyContent="space-between" columnGap={1} width={o.width}>
          <Box key={`edu-job-text:${job.id}`} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={color}>{`${mark} `}</Text>
              <Text bold>{job.cli}</Text>
              <Text color={palette.dim}>{` ${job.mode} · ${words.crewStatus[job.status] ?? job.status} · ${job.id} · `}</Text>
              {job.task || ' '}
            </Text>
          </Box>
          <Text color={palette.dim}>{right}</Text>
        </Box>
        {job.status === 'awaiting-approval' && o.actions && !asking ? (
          <Box key={`edu-job-act:${job.id}`} flexDirection="row" columnGap={1}>
            <Button key={`edu:approve:${job.id}`} label={words.approve} onPress={() => o.actions?.ask(job.id, 'approve')} />
            <Button key={`edu:reject:${job.id}`} label={words.reject} onPress={() => o.actions?.ask(job.id, 'reject')} />
          </Box>
        ) : null}
        {asking && confirming && o.actions ? (
          <Box key={`edu-job-confirm:${job.id}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text color={palette.warn}>{confirming.verdict === 'approve' ? words.confirmApprove(job.id) : words.confirmReject(job.id)}</Text>
            <Button key="edu:confirm" variant="primary" label={words.yes} onPress={() => o.actions?.confirm()} />
            <Button key="edu:cancel" hotkey="x" label={words.no} onPress={() => o.actions?.cancel()} />
          </Box>
        ) : null}
      </Box>
    )
  }
  const jobs = [...edu.jobs.filter(isActiveJob), ...edu.jobs.filter(job => !isActiveJob(job))]
  const active = activeJobs(edu)

  return (
    <Box key="edu-view" flexDirection="column" width={o.width}>
      {head}
      {status}
      {section('edu-brain', words.brain, brain ? `${totalNotes(brain)} · ${maintained}` : undefined, brainBody)}
      {section('edu-session', words.session, undefined, <Text color={edu.session?.status === 'open-session' ? palette.done : palette.dim} wrap="truncate-end">{sessionText}</Text>)}
      {edu.spec
        ? section('edu-spec', words.spec, undefined, <Text color={palette.dim} wrap="truncate-end">{words.specLine(edu.spec.name, edu.spec.requirements, edu.spec.checks)}</Text>)
        : null}
      {section(
        'edu-crew',
        words.crew,
        jobs.length ? `${words.crewActive(active)} · ${words.crewRecent(jobs.length)}` : undefined,
        jobs.length ? (
          <Box key="edu-jobs" flexDirection="column" width={o.width}>
            {jobs.map(jobRow)}
          </Box>
        ) : (
          <Text color={palette.dim} wrap="wrap">
            {words.crewNone}
          </Text>
        ),
      )}
      {edu.recent.length
        ? section(
            'edu-recent',
            words.recent,
            undefined,
            <Box key="edu-recent-list" flexDirection="column" width={o.width}>
              {edu.recent.map((note, i) => (
                <Text key={`edu-note:${i}`} wrap="truncate-end">
                  <Text color={palette.dim}>{`${note.tier.padEnd(10)} ${ago(note.at, now).padEnd(9)} `}</Text>
                  {note.title}
                </Text>
              ))}
            </Box>,
          )
        : null}
    </Box>
  )
}
