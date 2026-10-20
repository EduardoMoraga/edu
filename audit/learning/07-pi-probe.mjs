// Reproduce: node audit/learning/07-pi-probe.mjs (no models, all brains in /tmp).
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const repo = process.cwd();
const temp = await mkdtemp(join(tmpdir(), '07-pi-integration-'));
const piRoot = '/usr/local/lib/cloudroom/pi/node_modules/@earendil-works/pi-coding-agent';
const oldCwd = process.cwd();
const oldEnv = { ...process.env };
const results = [];
function record(name, details) { results.push({ name, ...details }); console.log(JSON.stringify(results.at(-1))); }
try {
  await symlink(join(repo, 'node_modules'), join(temp, 'node_modules'));
  // Preserve package-relative template lookup after bundling source into /tmp.
  await writeFile(join(temp, 'package.json'), JSON.stringify({name:'edu-agent',type:'module'}));
  await symlink(join(repo, 'templates'), join(temp, 'templates'));
  await build({ stdin: { contents: `export {openBrain} from './src/brain/index.ts'; export {workspaceBrief} from './src/cli/hooks.ts'; export {createStdioServer} from './src/mcp/stdio.ts'; export {Client} from '@modelcontextprotocol/sdk/client/index.js'; export {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';`, resolveDir: repo, loader: 'ts' }, outfile: join(temp, 'modules.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
  const { openBrain, workspaceBrief, createStdioServer, Client, InMemoryTransport } = await import(pathToFileURL(join(temp, 'modules.mjs')));
  const global = join(temp, 'home', '.edu');
  const a = join(temp, 'project-a'); const b = join(temp, 'project-b');
  const env = { HOME: join(temp, 'home'), EDU_HOME: global, EDU_CEILING_DIRECTORIES: temp, PATH: process.env.PATH };
  process.env.HOME = env.HOME; process.env.EDU_HOME = global; process.env.EDU_CEILING_DIRECTORIES = temp;
  delete process.env.EDU_PROJECT;
  for (const [root, label, scope] of [[global, 'GLOBAL_MARKER_07', 'global'], [join(a,'.edu'), 'PROJECT_A_MARKER_07', 'project'], [join(b,'.edu'), 'PROJECT_B_MARKER_07', 'project']]) {
    const loc = { scope, root }; const brain = openBrain([loc]); await brain.init(loc);
    await writeFile(join(root, 'EDU.md'), `# ${label}\n\nIdentity ${label}.\n`);
    await brain.write({tier:'transitive', kind:'decision', title:label, body:`Use ${label}.`});
  }
  const ctx = { env, home: env.HOME };
  const briefA = (await workspaceBrief(ctx,a)).text;
  assert(briefA.includes('PROJECT_A_MARKER_07') && !briefA.includes('PROJECT_B_MARKER_07'));
  record('workspace-brief-a', { correctProject: true, globalOverlay: briefA.includes('GLOBAL_MARKER_07') });
  // Real Pi loader, but event dispatch is simulated, not a running LLM session.
  // A tiny EDU_BIN wrapper executes the real workspaceBrief implementation with inherited cwd.
  const wrapper = join(temp, 'edu-wrapper');
  await writeFile(wrapper, `#!${process.execPath}\nimport('${pathToFileURL(join(temp,'modules.mjs'))}').then(async ({workspaceBrief})=>{const r=await workspaceBrief({env:process.env,home:process.env.HOME},process.cwd());if(r)console.log(r.text);});\n`, {mode:0o755});
  process.env.EDU_BIN = wrapper;
  process.chdir(a);
  const {loadExtensions, createExtensionRuntime} = await import(`${piRoot}/dist/core/extensions/loader.js`);
  const runtime = createExtensionRuntime();
  const loaded = await loadExtensions([join(repo,'plugins/pi/extensions/edu.ts'), join(repo,'plugins/pi/extensions/edu-skills.ts')], a, undefined, runtime);
  assert.equal(loaded.errors.length, 0, JSON.stringify(loaded.errors));
  const edu = loaded.extensions.find(x=>x.path.endsWith('/edu.ts'));
  const skills = loaded.extensions.find(x=>x.path.endsWith('/edu-skills.ts'));
  record('actual-pi-loader', { errors: loaded.errors, events: [...edu.handlers.keys()], version: JSON.parse(await readFile(`${piRoot}/package.json`,'utf8')).version });
  const {getMcpToolExposure, validateMcpServerConfig} = await import(`${piRoot}/dist/core/mcp-servers.js`);
  const registration = runtime.mcpServers.get('edu').config;
  assert.equal(registration.command,'edu');
  assert.equal(getMcpToolExposure(registration,'edu_brief'),'codemode');
  for (const exposure of ['direct','deferred']) {
    const config = validateMcpServerConfig('edu',{...registration,exposure});
    assert.equal(typeof config,'object'); assert.equal(getMcpToolExposure(config,'edu_brief'),exposure);
  }
  record('exposure-contract', { default:getMcpToolExposure(registration,'edu_brief'), directAccepted:true, deferredAccepted:true, customEduBinUsedByMcp:registration.command===wrapper, llmDiscoveryTested:false });
  const hook = edu.handlers.get('before_agent_start')[0];
  const notices = [];
  const context = cwd => ({cwd,mode:'print',ui:{notify:(...args)=>notices.push(args)}});
  await edu.handlers.get('session_start')[0]({}, context(b));
  const first = await hook({systemPrompt:'BASE',messageType:'user',prompt:'task'}, context(b));
  assert(first.systemPrompt.includes('PROJECT_A_MARKER_07'));
  assert(!first.systemPrompt.includes('PROJECT_B_MARKER_07'));
  record('ctx-cwd-b-process-cwd-a', { injectedProject:'A', expectedContextProject:'B', wrongBrainReproduced:true });
  process.chdir(b);
  const second = await hook({systemPrompt:'BASE',messageType:'user',prompt:'task'}, context(b));
  assert(second.systemPrompt.includes('PROJECT_B_MARKER_07') && !second.systemPrompt.includes('PROJECT_A_MARKER_07'));
  const bBrain = openBrain([{scope:'project',root:join(b,'.edu')}]);
  await bBrain.write({tier:'transitive',kind:'decision',title:'NEXT_SESSION_LEARNING_07',body:'New durable decision.'});
  const third = await hook({systemPrompt:'BASE',messageType:'user',prompt:'task2'}, context(b));
  assert(third.systemPrompt.includes('NEXT_SESSION_LEARNING_07'));
  record('fresh-brief-per-prompt', { readsNewFixtureNote:true, modelLearningDemonstrated:false });
  runtime.getCommands = () => [{source:'skill',name:'skill:edu-brain',sourceInfo:{path:'/tmp/07-other/edu-brain/SKILL.md'}}];
  const discovered = await skills.handlers.get('resources_discover')[0]();
  assert(!discovered.skillPaths.some(x=>x.endsWith('/edu-brain')));
  record('skill-discovery', { paths:discovered.skillPaths.length, suppressedExternalDuplicate:true });
  runtime.getCommands = () => [{source:'skill',name:'skill:edu-brain',sourceInfo:{path:join(repo,'plugins/pi/skills/edu-brain/SKILL.md')}}];
  assert((await skills.handlers.get('resources_discover')[0]()).skillPaths.some(x=>x.endsWith('/edu-brain')));
  record('skill-reload', { retainsOwnSkill:true });
  const server = await createStdioServer({cwd:a,env});
  const client = new Client({name:'pi-audit-07',version:'1'});
  const [ct,st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  const call = async(name,args={}) => {const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r));return r.content.filter(x=>x.type==='text').map(x=>x.text).join('');};
  const toolList = (await client.listTools()).tools;
  const fromMcp = await call('edu_brief');
  assert(fromMcp.includes('PROJECT_A_MARKER_07') && !fromMcp.includes('PROJECT_B_MARKER_07'));
  await call('edu_project_use',{workspace:b});
  const switchedBrief = await call('edu_brief');
  assert(switchedBrief.includes('PROJECT_B_MARKER_07'));
  process.chdir(a);
  const afterSwitch = await hook({systemPrompt:'BASE',messageType:'user',prompt:'task'},context(a));
  assert(afterSwitch.systemPrompt.includes('PROJECT_A_MARKER_07'));
  record('mcp-project-switch-vs-hook', { mcpBrain:'B', hookBrain:'A', independentSelectors:true, tools:toolList.length, briefSchema:toolList.find(x=>x.name==='edu_brief').inputSchema });
  await call('edu_remember',{tier:'transitive',kind:'decision',title:'MCP_PERSISTENCE_07',body:'Persist fixture only.'});
  const opened=await call('edu_session_open',{title:'07 fixture audit',source:'07-pi-probe'});
  const sessionId=/Session id: (.+)/.exec(opened)[1];
  await call('edu_session_close',{id:sessionId,summary:'Fixture audit only; real memory untouched.'});
  await client.close(); await server.close();
  const server2=await createStdioServer({cwd:b,env}); const client2=new Client({name:'pi-audit-07',version:'1'});
  const [c2,s2]=InMemoryTransport.createLinkedPair(); await server2.connect(s2); await client2.connect(c2);
  const persisted=await client2.callTool({name:'edu_brief',arguments:{}});
  assert(JSON.stringify(persisted).includes('MCP_PERSISTENCE_07'));
  record('new-mcp-session', { persistedDecisionVisible:true, modelLearningDemonstrated:false });
  await client2.close(); await server2.close();
  // Wrapper failure: warning once, subsequent failures remain absent from prompt.
  await writeFile(wrapper, '#!/bin/sh\nexit 9\n',{mode:0o755});
  assert.equal(await hook({systemPrompt:'BASE'},context(a)),undefined);
  assert.equal(await hook({systemPrompt:'BASE'},context(a)),undefined);
  assert.equal(notices.length,1);
  record('failed-hook', { returnsNoBrief:true, warningCount:notices.length });
} finally {
  process.chdir(oldCwd);
  for(const key of ['HOME','EDU_HOME','EDU_CEILING_DIRECTORIES','EDU_PROJECT','EDU_BIN']) {if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key];}
  await rm(temp,{recursive:true,force:true});
}
