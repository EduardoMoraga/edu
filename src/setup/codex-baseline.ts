// SHA256 of public edu-agent@0.10.2 plugins/codex files. No private data.
// tarball sha256: 0cc31fa000265bd2a4cdba32fa76b558fd741b9d47442954d8f8a9b44fa12fbc
export const codexBaseline: Readonly<Record<string, string>> = {
  ".mcp.json": "764d32325c19d9b5d45b8689a3e6236aacc725147adab059a4b2fca5b021e316",
  "hooks/hooks.json": "a42aa520685140835130d1b8c9f0b92cef8584b8f23f9bf616a120270e5493f0",
  ".codex-plugin/plugin.json": "00b06408d2281c41725816672189e344b7fef8e03342f0b02c80e8f74fe5be6e",
  "agents/builder.md": "d2a65ee9215ab0eb04a1967620687015e516d4b4f1d6c2b484e1bf2cba6f60cb",
  "agents/explorer.md": "635a2cbc2ebd0c1edc01eee63293de38ca5bc976646d4163731315a4b714c885",
  "agents/lead.md": "b3bd29bf25ede5e7310435b65de5da1de540c4d31ef08a6c23fe9455fb69ec65",
  "agents/reviewer.md": "b7027764705cad8dfe1498e50a8cb8986e8acd9d582b5678b911bb8590650171",
  "skills/edu-brain/SKILL.md": "a2dca4f04089654a8848eac2870cb34387866e3d377bc637d43fb9d188cf57c6",
  "skills/edu-brief/SKILL.md": "c4325eb643c1afe806514276e77665cabdd95a3b300f8c1baed67cd2c47c391b",
  "skills/edu-crew/SKILL.md": "05e18a5aeb6e649f4b1340d17b0fb68e70927ac9f837db855432feb5b2242a1e",
  "skills/edu-recall/SKILL.md": "8276fb56aaa1b03b61eb62e5d22be61fa662a525d22eb9501336a38f46433771",
  "skills/edu-reflect/SKILL.md": "02b19ca17452fcb94554141e87f06709634a84f61313026f09c1ce702756ebf8",
  "skills/edu-remember/SKILL.md": "b25189f2a7baffd8d99ae5fe2f4e88c907900dcfa09aade531635769f8abfef8",
  "skills/edu-review/SKILL.md": "dd47ea41875b09b0158b8892f8b983274e1d779b39e000f501a9e39027db3bee",
  "skills/edu-run/SKILL.md": "1d424c0024495d0a0503fb238784efcdcc0b55a70f3f657e56fac5c0d113820d",
  "skills/edu-status/SKILL.md": "60568208f892c9f90bb22ee48b8bf80ab9fbfec4bc41b24265fdea7d1a858708",
  "skills/edu-vault/SKILL.md": "9f0bd012e39975355d893b43963d8865b9f53f460bd401de5525bea668d71f9a"
};

/** Exact bytes produced by public 0.10.2 localizePluginsForPlatform(win32). */
export function codexBaselineFor(platform: NodeJS.Platform): Readonly<Record<string, string>> {
  return platform === 'win32' ? { ...codexBaseline, '.mcp.json': '0d497fb4a61b6b170670437f50975ceffb82111b349711966eb24a818d89be81' } : codexBaseline;
}
