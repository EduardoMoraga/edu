import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openBrain } from '../../src/brain/brain.js';
import { buildContext } from '../../src/context/pack.js';
import { createEduMcpServer } from '../../src/mcp/server.js';
import { respond } from '../../src/chat/respond.js';
import { defaultConfig } from '../../src/orchestrator/config.js';
import type { EngineRunRequest } from '../../src/core/contracts.js';

it('measures retrieval and factual payload against fixed external fixture requirements', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
  const root = await mkdtemp('/tmp/02-retrieval-brain-');
  const location = { scope: 'project' as const, root };
  const brain = openBrain([location]);
  const eduMdPath = join(root, 'EDU.md');
  await writeFile(eduMdPath, '# Fixture identity\nAudit only.');
  const server = createEduMcpServer({ locations: [location], eduMdPath, env: { HOME: root, EDU_HOME: root }, crewOptions: { brainRoot: root } });
  const client = new Client({ name: '02-retrieval-probe', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  const call = async (name: string, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { text: (result.content as { type: string; text?: string }[]).filter(x => x.type === 'text').map(x => x.text).join(''), error: !!result.isError };
  };
  const report: Record<string, any> = { harness: 'Vitest + real Brain/MCP/context/respond; injected capture engine, no LLM', criteria: 'Relevant target is preselected per task; sufficient payload must contain exact required policy values, not just title/id.' };
  try {
    report.emptyBrief = await call('edu_brief');
    const decision = await brain.write({ tier: 'transitive', kind: 'decision', title: 'Política de reintentos', body: 'Cobros duplicados: conservar Idempotency-Key durante 72 horas; rechazar el segundo cargo. Motivo: la pasarela reenvía eventos.', created: '2026-10-01T00:00:00Z', provenance: { legacy_id: 'D-702', aliases: ['regla-pagos'] } });
    const long = await brain.write({ tier: 'transitive', kind: 'decision', title: 'Recuperación Boreal', body: 'Antecedentes operativos.\n\n' + 'Registro histórico sin instrucciones finales. '.repeat(180) + '\n\nBoreal: restaurar snapshot Q7 y esperar exactamente 47 minutos antes de habilitar escrituras.', created: '2026-10-02T00:00:00Z' });
    const lesson = await brain.write({ tier: 'transitive', kind: 'lesson', status: 'proven', title: 'Cierre de conexión', body: 'Fugas SocketZ: ejecutar drainSockets antes de cerrar el proceso.', band: 'verified' });
    const canonical = await brain.write({ tier: 'canonical', kind: 'domain', title: 'Contrato Zafiro', body: 'Resumen del contrato Zafiro.\n\nLa entrega requiere checksum V9 y firma de Nora.', band: 'verified' });
    await brain.acceptCanonical(canonical.meta.id);
    report.sparseParaphrase = (await brain.recall('impedir facturas repetidas', { limit: 5 })).map(x => x.note.meta.id);
    expect(report.sparseParaphrase).toEqual([]);
    for (let i = 0; i < 15; i++) await brain.write({ tier: 'transitive', kind: 'lesson', title: `Ruido ${i}`, body: 'Como impedir facturas repetidas: debate editorial, sin normas operativas. de la el para que como', created: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z` });
    const cases = [
      { label: 'literal', query: 'Cobros duplicados', target: decision.meta.id },
      { label: 'accent', query: 'politica reintentos', target: decision.meta.id },
      { label: 'paraphrase', query: 'impedir facturas repetidas', target: decision.meta.id },
      { label: 'natural-question', query: '¿Cómo impedir que la misma factura se pague dos veces?', target: decision.meta.id },
      { label: 'alias', query: 'regla-pagos', target: decision.meta.id },
      { label: 'long-tail', query: 'snapshot Q7', target: long.meta.id },
    ];
    report.recall = [];
    for (const c of cases) {
      const hits = await brain.recall(c.query, { limit: 5 });
      const mcp = await call('edu_recall', { query: c.query, limit: 5 });
      report.recall.push({ ...c, ids: hits.map(x => x.note.meta.id), rank: hits.findIndex(x => x.note.meta.id === c.target) + 1, visibleInMcp: mcp.text.includes(c.target), text: mcp.text });
    }
    expect(report.recall.find((x: any) => x.label === 'literal').rank).toBe(1);
    expect(report.recall.find((x: any) => x.label === 'paraphrase').rank).toBe(0);
    const references = [decision.meta.id, 'D-702', 'regla-pagos', `[[${decision.meta.id}|pagos]]`, basename(decision.path), 'politica de reintentos'];
    report.references = [];
    for (const id of references) { const r = await call('edu_read', { id }); report.references.push({ id, sufficient: r.text.includes('72 horas') && r.text.includes('Idempotency-Key'), ...r }); }
    expect(report.references.every((r: any) => r.sufficient)).toBe(true);
    report.payloadReads = [];
    for (const [note, fact] of [[decision, '72 horas'], [long, '47 minutos'], [lesson, 'drainSockets'], [canonical, 'checksum V9']] as const) {
      const r = await call('edu_read', { id: note.meta.id });
      report.payloadReads.push({ id: note.meta.id, fact, present: r.text.includes(fact) });
    }
    expect(report.payloadReads.filter((x: any) => x.present)).toHaveLength(3);
    const defaultLong = await call('edu_read', { id: long.meta.id });
    const expandedLong = await call('edu_read', { id: long.meta.id, maxTokens: 5000 });
    report.longRead = { rawContains: (await brain.read(long.meta.id))!.body.includes('47 minutos'), defaultContains: defaultLong.text.includes('47 minutos'), expandedContains: expandedLong.text.includes('47 minutos'), defaultLength: defaultLong.text.length, defaultText: defaultLong.text, expandedLength: expandedLong.text.length };
    expect(report.longRead).toMatchObject({ rawContains: true, defaultContains: false, expandedContains: true });
    report.context = [];
    for (const budgetTokens of [800, 8000]) {
      const pack = await buildContext(brain, { query: 'reintentos SocketZ Zafiro Boreal', budgetTokens }, { eduMdPath, trackUsage: false });
      report.context.push({ budgetTokens, tokens: pack.tokens, text: pack.text, decisionTitle: pack.text.includes(decision.meta.title), requiredFacts: ['72 horas', '47 minutos', 'drainSockets', 'checksum V9'].map(fact => ({ fact, present: pack.text.includes(fact) })) });
    }
    expect(report.context.every((x: any) => x.requiredFacts.every((f: any) => !f.present))).toBe(true);
    const requests: EngineRunRequest[] = [];
    const engines = () => ({ cli: 'codex' as const, available: async () => true, async *run(req: EngineRunRequest, agentId: string) {
      requests.push(req); yield { type: 'agent.text' as const, agentId, text: 'Captured, no answer evaluated.', at: '2026-10-20T00:00:00Z' };
      yield { type: 'agent.end' as const, agentId, ok: true, summary: 'capture', at: '2026-10-20T00:00:00Z' };
    } });
    await respond({ brain, cwd: root, contractPath: eduMdPath, config: defaultConfig('codex'), message: 'reintentos SocketZ Zafiro Boreal', history: { turns: [] }, engines, onEvent: () => {} });
    report.prompt = { title: requests[0].systemPrompt!.includes(decision.meta.title), id: requests[0].systemPrompt!.includes(decision.meta.id), requiredFacts: ['72 horas', '47 minutos', 'drainSockets', 'checksum V9'].map(fact => ({ fact, present: requests[0].systemPrompt!.includes(fact) })), text: requests[0].systemPrompt };
    expect(report.prompt.title).toBe(true); expect(report.prompt.id).toBe(false);
    // Newer irrelevant decisions: fixed target predates all eight.
    for (let i = 0; i < 8; i++) await brain.write({ tier: 'transitive', kind: 'decision', title: `Diseño icono ${i}`, body: 'Color azul.', created: '2026-10-19T00:00:00Z' });
    const crowded = await buildContext(brain, { query: 'Cobros duplicados', budgetTokens: 8000 }, { eduMdPath, trackUsage: false });
    report.crowded = { targetIncluded: crowded.sections.some(x => x.noteIds.includes(decision.meta.id)), targetDeferred: crowded.deferred.includes(decision.meta.id), tokens: crowded.tokens, text: crowded.text };
    expect(report.crowded.targetIncluded).toBe(false); expect(report.crowded.targetDeferred).toBe(false);
    // Positive control: compact accepted standards do deliver their body to the real prompt.
    const control = await brain.write({ tier: 'canonical', kind: 'standard', title: 'Control Loto', body: 'Loto exige firma K4 antes del envío.', band: 'verified' });
    await brain.acceptCanonical(control.meta.id);
    await respond({ brain, cwd: root, contractPath: eduMdPath, config: defaultConfig('codex'), message: '¿Qué exige Loto?', history: { turns: [] }, engines, onEvent: () => {} });
    report.positiveControl = { bodyInPrompt: requests[1].systemPrompt!.includes('firma K4 antes del envío'), idInPrompt: requests[1].systemPrompt!.includes(control.meta.id) };
    expect(report.positiveControl.bodyInPrompt).toBe(true);
    for (let i = 0; i < 5; i++) await brain.feedback(decision.meta.id, true);
    report.afterPositiveFeedback = (await brain.recall('impedir facturas repetidas', { limit: 5 })).map(x => x.note.meta.id);
    expect(report.afterPositiveFeedback).not.toContain(decision.meta.id);
    report.bracketReferenceRecall = await call('edu_recall', { query: '[[D-702]]' });
    report.bracketReferenceRead = await call('edu_read', { id: '[[D-702]]' });
    expect(report.bracketReferenceRecall.text).toBe('No matching notes.');
    expect(report.bracketReferenceRead.text).toContain('72 horas');
    const session = await call('edu_session_open', { title: 'Temporary retrieval audit', source: '02-retrieval-probe' });
    const sessionId = (await brain.list({ kind: 'session' }))[0]!.meta.id;
    report.close = await call('edu_session_close', { id: sessionId, summary: 'Deterministic retrieval audit; no LLM improvement established.' });
    expect(session.error).toBe(false); expect(report.close.error).toBe(false);
    await writeFile('/code/edu/audit/learning/02-retrieval.results.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ recall: report.recall.map(({ label, rank, visibleInMcp }: any) => ({ label, rank, visibleInMcp })), references: report.references.length, longRead: { ...report.longRead, defaultText: undefined }, factsInContext: report.context.map((x: any) => [x.budgetTokens, x.requiredFacts]), crowded: { ...report.crowded, text: undefined } }));
  } finally { await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); vi.useRealTimers(); }
});
