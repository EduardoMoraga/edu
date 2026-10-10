/** The single source of ownership evidence used by doctor and detach. */
export const TOOL_IDS = ['gentle-ai', 'engram', 'moragent', 'orca', 'axi', 'codegraph', 'herdr', 'hermes', 'edu'] as const;
export type ToolId = typeof TOOL_IDS[number];

export interface Signature {
  marker: string;
  commands: readonly string[];
  mcp: readonly string[];
  plugins: readonly string[];
  packages: readonly string[];
  extras?: { codexInstructionKeys?: readonly string[]; claudeOutputStyle?: string; opencodeDefaultAgent?: string };
  memoryWriter: boolean;
  orchestrator: boolean;
  /**
   * Sections inside a managed block that are the user's own words (e.g. Gentle AI's onboarding writes
   * the user's personal rules into its persona block). They survive detach as plain user text.
   * Keyed by block name; values are Markdown `##` heading titles.
   */
  keepSections?: Readonly<Record<string, readonly string[]>>;
}

export const SIGNATURES: Record<ToolId, Signature> = {
  'gentle-ai': { marker: 'gentle-ai', commands: ['gentle-ai', 'gentle-shell'], mcp: [], plugins: ['gentle-ai'], packages: ['gentle-pi'], extras: { claudeOutputStyle: 'Gentleman', opencodeDefaultAgent: 'gentle-orchestrator' }, memoryWriter: false, orchestrator: true, keepSections: { persona: ['Rules', 'Expertise'] } },
  engram: { marker: 'engram', commands: ['engram'], mcp: ['engram'], plugins: ['engram'], packages: ['gentle-engram'], extras: { codexInstructionKeys: ['model_instructions_file', 'experimental_compact_prompt_file'] }, memoryWriter: true, orchestrator: false },
  moragent: { marker: 'moragent', commands: ['mora ', 'moragent'], mcp: ['moragent'], plugins: ['moragent'], packages: ['moragent'], memoryWriter: true, orchestrator: true },
  orca: { marker: 'orca', commands: ['orca'], mcp: ['orca'], plugins: ['orca'], packages: ['orca'], memoryWriter: false, orchestrator: false },
  axi: { marker: 'axi', commands: ['-axi'], mcp: [], plugins: ['axi'], packages: ['axi'], memoryWriter: false, orchestrator: false },
  codegraph: { marker: 'codegraph', commands: ['codegraph'], mcp: ['codegraph'], plugins: ['codegraph'], packages: ['codegraph'], memoryWriter: false, orchestrator: false },
  herdr: { marker: 'herdr', commands: ['herdr'], mcp: ['herdr'], plugins: ['herdr'], packages: ['herdr'], memoryWriter: false, orchestrator: false },
  hermes: { marker: 'hermes', commands: ['hermes'], mcp: ['hermes'], plugins: ['hermes'], packages: ['hermes'], memoryWriter: false, orchestrator: false },
  edu: { marker: 'edu', commands: ['edu '], mcp: ['edu'], plugins: ['edu'], packages: ['edu'], memoryWriter: true, orchestrator: true },
};

export function ownerOf(value: string, field: 'commands' | 'mcp' | 'plugins' | 'packages'): ToolId | undefined {
  const lower = value.toLowerCase();
  return TOOL_IDS.find((id) => SIGNATURES[id][field].some((part) => field === 'mcp' ? lower === part : lower.includes(part) || (field === 'commands' && lower === part.trim())));
}

export function assertDetachable(ids: string[]): ToolId[] {
  if (ids.includes('edu')) throw new Error('Edu cannot detach itself.');
  const unknown = ids.filter((id) => !(TOOL_IDS as readonly string[]).includes(id));
  if (unknown.length) throw new Error(`Unknown tool: ${unknown.join(', ')}`);
  return [...new Set(ids)] as ToolId[];
}
