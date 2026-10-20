// Public edu-agent@0.10.2 plugins/claude-code SHA256.
// Tarball: 0cc31fa000265bd2a4cdba32fa76b558fd741b9d47442954d8f8a9b44fa12fbc
export const claudeBaseline: Readonly<Record<string, string>> = {
  ".mcp.json": "e25e3d6db2d0276940a19d5f39101761cc8ff5681c3fbb515ed4a880ef25ea97",
  "hooks/hooks.json": "a04ed69e0a7f9b364e05f581cd86387feb3cc344461556ba9866f9bd5d3648b4",
  ".claude-plugin/plugin.json": "27b86693a8d32d5393ab95dddfe49adb5468c34d3983ad70c4c67a47b78afde9",
  "agents/builder.md": "5c65cfd0499b2b1d2a604733364bb8f37e171d5462ce723a5c6461ad600e1f6b",
  "output-styles/edu.md": "6c688bc944fe17647cb8cce5a7fbadc581067e6ff6487c520abc6d6b5b34aee9",
  "agents/explorer.md": "e3355d6cfed509f8055b5126bd6aa3c926f38f024c17180e55f2d54c71bf6b03",
  "agents/lead.md": "7fbdadfd4f3e26c19b7ddbc7c825a7076f313bb5ac5d09a09120aa375a24121f",
  "agents/reviewer.md": "9ddba101bd35fce1f5d617e01b00fe017dda7bb7632221bbf6d301ca3a4306fa",
  "skills/brain/SKILL.md": "a2dca4f04089654a8848eac2870cb34387866e3d377bc637d43fb9d188cf57c6",
  "skills/brief/SKILL.md": "c4325eb643c1afe806514276e77665cabdd95a3b300f8c1baed67cd2c47c391b",
  "skills/crew/SKILL.md": "05e18a5aeb6e649f4b1340d17b0fb68e70927ac9f837db855432feb5b2242a1e",
  "skills/recall/SKILL.md": "8276fb56aaa1b03b61eb62e5d22be61fa662a525d22eb9501336a38f46433771",
  "skills/reflect/SKILL.md": "02b19ca17452fcb94554141e87f06709634a84f61313026f09c1ce702756ebf8",
  "skills/remember/SKILL.md": "b25189f2a7baffd8d99ae5fe2f4e88c907900dcfa09aade531635769f8abfef8",
  "skills/review/SKILL.md": "dd47ea41875b09b0158b8892f8b983274e1d779b39e000f501a9e39027db3bee",
  "skills/run/SKILL.md": "1d424c0024495d0a0503fb238784efcdcc0b55a70f3f657e56fac5c0d113820d",
  "skills/status/SKILL.md": "60568208f892c9f90bb22ee48b8bf80ab9fbfec4bc41b24265fdea7d1a858708",
  "skills/vault/SKILL.md": "9f0bd012e39975355d893b43963d8865b9f53f460bd401de5525bea668d71f9a",
  "types/index.d.ts": "8eb1512bb87669b7f8a0208ca58ea8e91b5cd8d859ae2335f2b5a9bd96eeef6f",
  "hooks/deck.tsx": "f252830a511539bb27dae6c8a856b393a9f549494d2f0b605c32d90df2de00d2"
};

/** Exact bytes produced by public 0.10.2 localizePluginsForPlatform(win32). */
export function claudeBaselineFor(platform: NodeJS.Platform): Readonly<Record<string, string>> {
  return platform === 'win32' ? { ...claudeBaseline, '.mcp.json': '5e44db1bdf44d58b9f423dcc5199bff628836f9ffcfc2b3baa86b10749656175' } : claudeBaseline;
}
