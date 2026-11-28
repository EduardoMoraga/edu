import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHEIL_REMOTE, PERSONAL_REMOTE } from '../profile/profile.js';
import { captureContext, out, runCli } from '../test-support/cli.js';
import {
  formatProfileLines,
  inspectCopies,
  isolationExitCode,
  type DirEntry,
  type CopiesReport,
} from './profiles.js';

const w = path.win32;
const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });

function disk(files: Record<string, string>, dirs: Record<string, readonly DirEntry[]>) {
  const reads: string[] = [];
  return {
    reads,
    readFile: (file: string) => {
      reads.push(file);
      const text = files[file];
      if (text === undefined) return Promise.reject(missing);
      return Promise.resolve(text);
    },
    readDir: (dir: string) => {
      const entries = dirs[dir];
      if (!entries) return Promise.reject(missing);
      return Promise.resolve(entries);
    },
  };
}

function profileFile(id: 'personal' | 'cheil', home: string, brain: string, remote: string): string {
  return JSON.stringify({ id, home, brain, remote });
}

function withNotes(root: string, notes: number): { files: Record<string, string>; dirs: Record<string, readonly DirEntry[]> } {
  const tier = w.join(root, '3-transitive');
  const names = Array.from({ length: notes }, (_, index) => ({ name: `n-${index}.md`, kind: 'file' as const }));
  return {
    files: {},
    dirs: {
      [root]: [{ name: '3-transitive', kind: 'dir' }],
      [tier]: names,
    },
  };
}

const win32 = { platform: 'win32' as const, realpath: () => undefined, env: {} };

describe('profiles on win32 paths', () => {
  const personalHome = w.resolve('D:\\personal');
  const personalBrain = w.resolve('D:\\personal-brain');
  const cheilHome = w.resolve('D:\\cheil');
  const cheilBrain = w.resolve('C:\\Cheil\\_CONOCIMIENTO');

  function both(notes = 0) {
    const personalNotes = withNotes(personalBrain, notes);
    const cheilNotes = withNotes(cheilBrain, notes);
    return disk(
      {
        [w.join(personalHome, 'profile.json')]: profileFile('personal', personalHome, personalBrain, PERSONAL_REMOTE),
        [w.join(cheilHome, 'profile.json')]: profileFile('cheil', cheilHome, cheilBrain, `https://github.com/${CHEIL_REMOTE}.git`),
      },
      { ...personalNotes.dirs, ...cheilNotes.dirs },
    );
  }

  it('lists two valid profiles with home, brain, and remote and exits 0', async () => {
    const fs = both(2);
    const report = await inspectCopies({ ...win32, homes: [personalHome, cheilHome], ...fs });
    expect(isolationExitCode(report)).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.profiles).toEqual([
      { id: 'personal', home: personalHome, brain: personalBrain, remote: PERSONAL_REMOTE },
      { id: 'cheil', home: cheilHome, brain: cheilBrain, remote: CHEIL_REMOTE },
    ]);
    const text = formatProfileLines(report, 'en').map(line => line.text).join('\n');
    expect(text).toContain('Profiles');
    expect(text).toContain('Copies');
    expect(text).toContain(personalHome);
    expect(text).toContain(personalBrain);
    expect(text).toContain(PERSONAL_REMOTE);
    expect(text).toContain(cheilHome);
    expect(text).toContain(cheilBrain);
    expect(text).toContain(CHEIL_REMOTE);
    for (const line of formatProfileLines(report, 'en')) {
      if (!line.text.includes('\\') && !line.text.includes(PERSONAL_REMOTE) && !line.text.includes(CHEIL_REMOTE)) {
        expect(line.text.length).toBeLessThanOrEqual(80);
      }
    }
    expect(fs.reads.some(file => file.endsWith('.md'))).toBe(false);
  });

  it('reports a personal brain inside C:\\Cheil and a cheil remote that is edu-vault', async () => {
    const crossedPath = disk(
      { [w.join(personalHome, 'profile.json')]: profileFile('personal', personalHome, cheilBrain, PERSONAL_REMOTE) },
      withNotes(cheilBrain, 1).dirs,
    );
    const byPath = await inspectCopies({ ...win32, homes: [personalHome], ...crossedPath });
    expect(isolationExitCode(byPath)).toBe(1);
    expect(byPath.profiles).toEqual([]);
    expect(byPath.rejected[0]).toMatchObject({ id: 'personal', home: personalHome, brain: cheilBrain, remote: PERSONAL_REMOTE, code: 'cheil-root' });
    expect(formatProfileLines(byPath, 'en').some(line => line.level === 'fail' && line.text.includes('C:\\Cheil') && line.text.includes(cheilBrain))).toBe(true);

    const folded = await inspectCopies({
      ...win32,
      homes: [personalHome],
      ...disk(
        { [w.join(personalHome, 'profile.json')]: profileFile('personal', personalHome, 'c:\\CHEIL\\notes', PERSONAL_REMOTE) },
        {},
      ),
    });
    expect(folded.findings.map(finding => finding.code)).toEqual(['cheil-root']);
    expect(formatProfileLines(folded, 'es').some(line => line.text.includes('C:\\Cheil') && line.text.includes('cerebro'))).toBe(true);

    const crossedRemote = await inspectCopies({
      ...win32,
      homes: [cheilHome],
      ...disk(
        { [w.join(cheilHome, 'profile.json')]: profileFile('cheil', cheilHome, cheilBrain, PERSONAL_REMOTE) },
        {},
      ),
    });
    expect(isolationExitCode(crossedRemote)).toBe(1);
    expect(crossedRemote.findings[0]).toMatchObject({ code: 'remote-mismatch', id: 'cheil', remote: PERSONAL_REMOTE, expected: CHEIL_REMOTE });
    const remoteText = formatProfileLines(crossedRemote, 'en').find(line => line.level === 'fail')!.text;
    expect(remoteText).toContain(PERSONAL_REMOTE);
    expect(remoteText).toContain(CHEIL_REMOTE);

    const personalRemote = await inspectCopies({
      ...win32,
      homes: [personalHome],
      ...disk(
        { [w.join(personalHome, 'profile.json')]: profileFile('personal', personalHome, personalBrain, `git@github.com:${CHEIL_REMOTE}.git`) },
        withNotes(personalBrain, 0).dirs,
      ),
    });
    expect(personalRemote.findings[0]).toMatchObject({ code: 'remote-mismatch', id: 'personal', remote: CHEIL_REMOTE, expected: PERSONAL_REMOTE });
  });

  it('reports a junction into C:\\Cheil and keeps the spelled path', async () => {
    const spelled = w.resolve('D:\\vault\\brain');
    const report = await inspectCopies({
      ...win32,
      homes: [personalHome],
      realpath: file => (w.resolve(file) === spelled ? cheilBrain : undefined),
      ...disk(
        { [w.join(personalHome, 'profile.json')]: profileFile('personal', personalHome, spelled, PERSONAL_REMOTE) },
        {},
      ),
    });
    expect(report.findings[0]).toMatchObject({ code: 'cheil-root', field: 'brain' });
    expect(report.findings[0]!.path).toContain(spelled);
    expect(report.findings[0]!.path).toContain(cheilBrain);
    expect(report.rejected[0]?.brain).toBe(spelled);
  });

  it('does not repeat a credential from a crossed remote', async () => {
    const report = await inspectCopies({
      ...win32,
      homes: [personalHome],
      ...disk(
        { [w.join(personalHome, 'profile.json')]: profileFile('personal', personalHome, personalBrain, 'https://user:s3cret@github.com/EduardoMCheil/cheil-vault.git') },
        {},
      ),
    });
    expect(report.findings[0]?.remote).toBe(CHEIL_REMOTE);
    expect(JSON.stringify(report)).not.toContain('s3cret');
    expect(formatProfileLines(report, 'en').map(line => line.text).join('\n')).not.toContain('s3cret');
  });

  it('keeps a legitimate cheil brain at C:\\Cheil', async () => {
    const report = await inspectCopies({
      ...win32,
      homes: [cheilHome],
      ...disk(
        { [w.join(cheilHome, 'profile.json')]: profileFile('cheil', cheilHome, cheilBrain, CHEIL_REMOTE) },
        withNotes(cheilBrain, 4).dirs,
      ),
    });
    expect(isolationExitCode(report)).toBe(0);
    expect(report.copies).toEqual([expect.objectContaining({ kind: 'home', profile: 'cheil', root: cheilBrain, notes: 4, remote: CHEIL_REMOTE })]);
  });
});

describe('distinct copies', () => {
  it('reports a non-linked home brain and a vault copy without merging them', async () => {
    const home = w.resolve('D:\\edu');
    const brain = w.join(home, 'brain');
    const vault = w.resolve('E:\\vault');
    const homeNotes = withNotes(brain, 2);
    const vaultNotes = withNotes(vault, 5);
    const files = { [w.join(vault, '.git', 'config')]: `[remote "origin"]\n\turl = https://github.com/${PERSONAL_REMOTE}.git\n` };
    const dirs = { ...homeNotes.dirs, ...vaultNotes.dirs };
    const report = await inspectCopies({
      ...win32,
      homes: [home],
      vaults: [vault],
      ...disk(files, dirs),
    });
    expect(isolationExitCode(report)).toBe(0);
    expect(report.copies.map(copy => ({ kind: copy.kind, root: copy.root, notes: copy.notes }))).toEqual([
      { kind: 'home', root: brain, notes: 2 },
      { kind: 'vault', root: vault, notes: 5 },
    ]);
    const text = formatProfileLines(report, 'en').map(line => line.text).join('\n');
    expect(text).toContain(brain);
    expect(text).toContain(vault);
    expect(text).toMatch(/home\s+personal\s+2/);
    expect(text).toMatch(/vault\s+personal\s+5/);
  });

  it('counts a home brain and a vault that share a real path once', async () => {
    const home = w.resolve('D:\\edu');
    const brain = w.join(home, 'brain');
    const vault = w.resolve('E:\\vault');
    const notes = withNotes(brain, 2);
    const report = await inspectCopies({
      ...win32,
      homes: [home],
      vaults: [vault],
      realpath: file => (w.resolve(file) === vault ? brain : undefined),
      readFile: () => Promise.reject(missing),
      readDir: dir => {
        if (dir === vault) return Promise.resolve([{ name: '3-transitive', kind: 'dir' }]);
        const entries = notes.dirs[dir];
        if (!entries) return Promise.reject(missing);
        return Promise.resolve(entries);
      },
    });
    expect(report.copies).toHaveLength(1);
    expect(report.copies[0]).toMatchObject({ kind: 'home', root: brain, notes: 2 });
  });

  it('lists a registered project brain as its own copy', async () => {
    const home = w.resolve('D:\\edu');
    const brain = w.join(home, 'brain');
    const project = w.resolve('D:\\work\\app\\.edu\\brain');
    const report = await inspectCopies({
      ...win32,
      homes: [home],
      projects: [{ name: 'app', brain: project, home }],
      readFile: () => Promise.reject(missing),
      readDir: dir => {
        const entries = { ...withNotes(brain, 1).dirs, ...withNotes(project, 3).dirs }[dir];
        if (!entries) return Promise.reject(missing);
        return Promise.resolve(entries);
      },
    });
    expect(report.copies.map(copy => ({ kind: copy.kind, notes: copy.notes, name: copy.name }))).toEqual([
      { kind: 'home', notes: 1, name: undefined },
      { kind: 'project', notes: 3, name: 'app' },
    ]);
    const spanish = formatProfileLines(report, 'es').map(line => line.text).join('\n');
    expect(spanish).toContain('proyecto');
    expect(spanish).toContain('(app)');
  });

  it('reports a personal remote on a Cheil vault copy', async () => {
    const home = w.resolve('D:\\edu');
    const brain = w.join(home, 'brain');
    const vault = w.resolve('C:\\Cheil\\_CONOCIMIENTO');
    const report = await inspectCopies({
      ...win32,
      homes: [home],
      vaults: [vault],
      readFile: file => file === w.join(vault, '.git', 'config')
        ? Promise.resolve(`[remote "origin"]\n\turl = https://github.com/${PERSONAL_REMOTE}.git\n`)
        : Promise.reject(missing),
      readDir: dir => {
        const entries = { ...withNotes(brain, 1).dirs, ...withNotes(vault, 1).dirs }[dir];
        if (!entries) return Promise.reject(missing);
        return Promise.resolve(entries);
      },
    });
    expect(isolationExitCode(report)).toBe(1);
    expect(report.findings.some(finding => finding.code === 'cheil-root' && finding.path === vault)).toBe(true);
    expect(report.copies.find(copy => copy.kind === 'vault')).toMatchObject({ root: vault, remote: PERSONAL_REMOTE });
  });

  it('warns on an unreadable or mismatched profile without an isolation exit', async () => {
    const home = w.resolve('D:\\edu');
    const denied = await inspectCopies({
      ...win32,
      homes: [home],
      readFile: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })),
      readDir: () => Promise.reject(missing),
    });
    expect(isolationExitCode(denied)).toBe(0);
    expect(denied.rejected[0]?.code).toBe('unreadable');
    expect(formatProfileLines(denied, 'en').some(line => line.level === 'warn')).toBe(true);

    const mismatch = await inspectCopies({
      ...win32,
      homes: [home],
      ...disk({ [w.join(home, 'profile.json')]: profileFile('personal', w.resolve('D:\\other'), w.resolve('D:\\notes'), PERSONAL_REMOTE) }, {}),
    });
    expect(mismatch.rejected[0]?.code).toBe('home-mismatch');
    expect(isolationExitCode(mismatch)).toBe(0);
  });
});

describe('read-only filesystem', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

  async function sandbox(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'edu-copies-'));
    roots.push(root);
    return root;
  }

  it('does not read note bodies and does not climb past the ceiling', async () => {
    const root = await sandbox();
    const box = path.join(root, 'box');
    const home = path.join(box, 'home');
    const vault = path.join(box, 'vault');
    await mkdir(path.join(root, '.git'), { recursive: true });
    await mkdir(path.join(box, '.git'), { recursive: true });
    await mkdir(path.join(vault, '.git'), { recursive: true });
    await mkdir(path.join(vault, '3-transitive'), { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(path.join(root, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/secret-above/hidden.git\n');
    await writeFile(path.join(box, '.git', 'config'), '[remote "origin"]\n\turl = https://user:SECRET_CEILING@github.com/secret-ceiling/hidden.git\n');
    await writeFile(path.join(vault, '.git', 'config'), `[remote "origin"]\n\turl = https://github.com/${PERSONAL_REMOTE}.git\n`);
    await writeFile(path.join(vault, '3-transitive', 'a.md'), 'note-body-must-not-leak');
    const before = await fingerprint(root);
    const reads: string[] = [];
    const report = await inspectCopies({
      homes: [home],
      vaults: [vault],
      env: { EDU_CEILING_DIRECTORIES: box },
      readFile: async file => {
        reads.push(file);
        return readFile(file, 'utf8');
      },
    });
    expect(await fingerprint(root)).toEqual(before);
    expect(reads.some(file => file.endsWith('.md'))).toBe(false);
    expect(JSON.stringify(report)).not.toContain('note-body-must-not-leak');
    expect(JSON.stringify(report)).not.toContain('SECRET_CEILING');
    expect(JSON.stringify(report)).not.toContain('secret-above');
    expect(report.copies.find(copy => copy.kind === 'vault')).toMatchObject({ root: vault, notes: 1, remote: PERSONAL_REMOTE });
  });

  it('reads a gitdir pointer without opening notes', async () => {
    const root = await sandbox();
    const home = path.join(root, 'home');
    const vault = path.join(root, 'vault');
    const gitdir = path.join(root, 'gitdir');
    await mkdir(path.join(gitdir), { recursive: true });
    await mkdir(path.join(vault, '3-transitive'), { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(path.join(vault, '.git'), `gitdir: ${gitdir}\n`);
    await writeFile(path.join(gitdir, 'config'), `[remote "origin"]\n\turl = git@github.com:${CHEIL_REMOTE}.git\n`);
    await writeFile(path.join(vault, '3-transitive', 'a.md'), 'pointer-body');
    const report = await inspectCopies({
      homes: [home],
      vaults: [vault],
      env: { EDU_CEILING_DIRECTORIES: root },
    });
    expect(report.copies.find(copy => copy.kind === 'vault')?.remote).toBe(CHEIL_REMOTE);
    expect(JSON.stringify(report)).not.toContain('pointer-body');
  });
});

describe('edu doctor profiles', () => {
  async function fingerprint(root: string): Promise<string[]> {
    return listTree(root);
  }

  it('lists two profiles and exits 0 when nothing is isolated', async () => {
    const c = await captureContext();
    const personalHome = c.dirs.eduHome;
    const personalBrain = path.join(personalHome, 'brain');
    const cheilHome = path.join(c.dirs.home, '.edu');
    const cheilBrain = path.join(c.dirs.home, 'cheil-brain');
    await mkdir(personalHome, { recursive: true });
    await mkdir(cheilHome, { recursive: true });
    await writeFile(path.join(personalHome, 'profile.json'), profileFile('personal', personalHome, personalBrain, PERSONAL_REMOTE));
    await writeFile(path.join(cheilHome, 'profile.json'), profileFile('cheil', cheilHome, cheilBrain, CHEIL_REMOTE));
    const before = await fingerprint(c.dirs.home);
    await runCli(c, ['doctor']);
    expect(c.exitCode ?? 0).toBe(0);
    expect(await fingerprint(c.dirs.home)).toEqual(before);
    const text = out(c);
    expect(text).toContain('Profiles');
    expect(text).toContain(personalHome);
    expect(text).toContain(personalBrain);
    expect(text).toContain(PERSONAL_REMOTE);
    expect(text).toContain(cheilHome);
    expect(text).toContain(cheilBrain);
    expect(text).toContain(CHEIL_REMOTE);
    expect(text).not.toMatch(/\u001b/);
  });

  it('prints the Spanish section without ANSI escapes', async () => {
    const c = await captureContext({ env: { EDU_LANG: 'es' } });
    await mkdir(c.dirs.eduHome, { recursive: true });
    await runCli(c, ['doctor']);
    const text = out(c);
    expect(text).toContain('Perfiles');
    expect(text).toContain('Copias');
    expect(text).toContain('hogar');
    expect(text).toContain('cerebro');
    expect(text).toContain('remoto');
    expect(text).not.toMatch(/\u001b/);
  });

  it('exits 1 for a crossed remote and does not modify the fixture', async () => {
    const c = await captureContext();
    const home = c.dirs.eduHome;
    const brain = path.join(home, 'brain', '3-transitive');
    await mkdir(brain, { recursive: true });
    await writeFile(path.join(home, 'profile.json'), profileFile('cheil', home, path.join(home, 'brain'), PERSONAL_REMOTE));
    await writeFile(path.join(brain, 'a.md'), 'isolation-body-must-stay-on-disk');
    const before = await fingerprint(c.dirs.home);
    await runCli(c, ['doctor', '--json']);
    expect(c.exitCode).toBe(1);
    expect(await fingerprint(c.dirs.home)).toEqual(before);
    const report = JSON.parse(out(c)) as { profileReport: CopiesReport };
    expect(report.profileReport.findings[0]).toMatchObject({ code: 'remote-mismatch', id: 'cheil', remote: PERSONAL_REMOTE, expected: CHEIL_REMOTE });
    expect(out(c)).not.toContain('isolation-body-must-stay-on-disk');
  });

  it('reports the grok split as two copies and does not merge or edit them', async () => {
    const c = await captureContext();
    const homeBrain = path.join(c.dirs.eduHome, 'brain');
    const vault = path.join(c.dirs.home, 'EduVault');
    await mkdir(path.join(homeBrain, '3-transitive'), { recursive: true });
    await mkdir(path.join(vault, '3-transitive'), { recursive: true });
    await mkdir(path.join(vault, '.git'), { recursive: true });
    await writeFile(path.join(homeBrain, '3-transitive', 'one.md'), 'grok-home-body-one');
    await writeFile(path.join(homeBrain, '3-transitive', 'two.md'), 'grok-home-body-two');
    for (const name of ['a', 'b', 'c', 'd', 'e']) await writeFile(path.join(vault, '3-transitive', `${name}.md`), `grok-vault-body-${name}`);
    await writeFile(path.join(vault, '.git', 'config'), `[remote "origin"]\n\turl = https://github.com/${PERSONAL_REMOTE}.git\n`);
    const before = await fingerprint(c.dirs.home);
    await runCli(c, ['doctor', '--json']);
    expect(c.exitCode ?? 0).toBe(0);
    expect(await fingerprint(c.dirs.home)).toEqual(before);
    const report = JSON.parse(out(c)) as { profileReport: CopiesReport };
    const copies = report.profileReport.copies;
    expect(copies.find(copy => copy.kind === 'home')).toMatchObject({ root: homeBrain, notes: 2, profile: 'personal' });
    expect(copies.find(copy => copy.kind === 'vault')).toMatchObject({ root: vault, notes: 5, remote: PERSONAL_REMOTE });
    expect(new Set(copies.map(copy => copy.root)).size).toBe(copies.length);
    c.stdout.length = 0;
    c.exitCode = undefined;
    await runCli(c, ['doctor']);
    expect(c.exitCode ?? 0).toBe(0);
    expect(await fingerprint(c.dirs.home)).toEqual(before);
    const printed = out(c);
    expect(printed).toContain(homeBrain);
    expect(printed).toContain(vault);
    expect(printed).toMatch(/home\s+personal\s+2/);
    expect(printed).toMatch(/vault\s+personal\s+5/);
    expect(printed).not.toContain('grok-home-body');
    expect(printed).not.toContain('grok-vault-body');
  });
});

async function listTree(root: string): Promise<string[]> {
  const rows: string[] = [];
  const walk = async (dir: string) => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const full = path.join(dir, entry.name);
      const info = await stat(full);
      rows.push(`${full} ${info.mtimeMs} ${info.size}`);
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(full);
    }
  };
  await walk(root);
  return rows;
}

function fingerprint(root: string): Promise<string[]> {
  return listTree(root);
}
