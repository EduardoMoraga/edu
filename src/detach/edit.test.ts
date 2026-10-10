import { describe, expect, it } from 'vitest';
import { editContent } from './edit.js';

describe('surgical detach edits', () => {
  it('removes the outermost nested managed block without changing surrounding bytes', () => {
    const input = 'before\n<!-- gentle-ai:persona -->\nA\n<!-- gentle-ai:inner -->B<!-- /gentle-ai:inner -->\n<!-- /gentle-ai:persona -->\nbetween\n<!-- edu:core -->keep<!-- /edu:core -->\nafter';
    expect(editContent('instructions', 'codex', input, ['gentle-ai']).text).toBe('before\n\nbetween\n<!-- edu:core -->keep<!-- /edu:core -->\nafter');
  });

  it('removes only matching handlers from mixed Claude hook groups', () => {
    const input = JSON.stringify({ hooks: { SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'gentle-ai hook' }, { type: 'command', command: 'my-script' }] }, { matcher: 'other', hooks: [{ command: 'orca hook' }] }] }, enabledPlugins: { 'engram@engram': true, 'my-plugin': true } }, null, 2);
    const result = JSON.parse(editContent('json', 'claude', input, ['gentle-ai']).text);
    expect(result.hooks.SessionStart).toEqual([{ matcher: '*', hooks: [{ type: 'command', command: 'my-script' }] }, { matcher: 'other', hooks: [{ command: 'orca hook' }] }]);
    expect(result.enabledPlugins['engram@engram']).toBe(true);
  });

  it('keeps JSONC comments while removing owned MCP and default agent', () => {
    const input = '{\n  // user note\n  "mcp": { "engram": { "command": "engram" }, "context7": {} },\n  "default_agent": "gentle-orchestrator"\n}\n';
    const result = editContent('jsonc', 'opencode', input, ['engram', 'gentle-ai']).text;
    expect(result).toContain('// user note');
    expect(result).toContain('"context7"');
    expect(result).not.toContain('"engram"');
    expect(result).not.toContain('gentle-orchestrator');
  });

  it('removes owned TOML tables and multiline root arrays but keeps unrelated comments and tables', () => {
    const input = '# user\nnotify = [\n  "gentle-ai",\n  "hook"\n]\nmodel_instructions_file = "/home/me/engram-instructions.md"\n[plugins."engram@engram"]\nenabled = true\n[plugins."engram@engram".nested]\nx = 1\n[plugins."mine"] # keep\nenabled = true\n[mcp_servers.engram]\ncommand = "engram"\n[mcp_servers.context7]\ncommand = "ctx"\n';
    const result = editContent('toml', 'codex', input, ['engram', 'gentle-ai']).text;
    expect(result).toContain('# user');
    expect(result).toContain('[plugins."mine"] # keep');
    expect(result).toContain('[mcp_servers.context7]');
    expect(result).not.toContain('model_instructions_file');
    expect(result).not.toContain('notify');
    expect(result).not.toContain('engram@engram');
    expect(result).not.toContain('[mcp_servers.engram]');
  });
});

describe('instruction blocks with foreign markers inside', () => {
  it('removes an outer block even when it contains other marker styles left open', async () => {
    const { editInstructions } = await import('./edit.js');
    const input = [
      '# Mine before',
      '<!-- gentle-ai:orchestrator -->',
      'orchestrator text',
      '<!-- authority-first-terminal-procedure:start -->',
      'procedure',
      '<!-- authority-first-terminal-procedure:end -->',
      '<!-- /gentle-ai:orchestrator -->',
      '# Mine after',
      '<!-- gentle-ai:agent-routing -->',
      'routing <!-- gentle-ai:remote-authorization --> nested <!-- /gentle-ai:remote-authorization -->',
      '<!-- /gentle-ai:agent-routing -->',
      '# Mine end',
    ].join('\n');
    const { text, changes } = editInstructions(input, ['gentle-ai']);
    expect(changes).toHaveLength(2);
    expect(text).toContain('# Mine before');
    expect(text).toContain('# Mine after');
    expect(text).toContain('# Mine end');
    expect(text).not.toContain('orchestrator text');
    expect(text).not.toContain('routing');
  });
});

describe('user sections inside managed blocks', () => {
  it('keeps the user rules and expertise written into the gentle-ai persona block', async () => {
    const { editInstructions } = await import('./edit.js');
    const input = '<!-- gentle-ai:persona -->\n## Rules\n\n- Conventional commits only.\n\n## Expertise\n\nHexagonal architecture.\n\n## Persona Voice\n\nGentleman style.\n<!-- /gentle-ai:persona -->\n\n<!-- gentle-ai:orchestrator -->\nbig\n<!-- /gentle-ai:orchestrator -->\n';
    const { text } = editInstructions(input, ['gentle-ai']);
    expect(text).toContain('## Rules');
    expect(text).toContain('- Conventional commits only.');
    expect(text).toContain('## Expertise');
    expect(text).not.toContain('Persona Voice');
    expect(text).not.toContain('big');
    expect(text).not.toContain('gentle-ai:');
  });
});
