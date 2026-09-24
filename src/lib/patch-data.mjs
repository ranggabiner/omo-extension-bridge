/**
 * Targeted patch hunks with strict structural anchors.
 * Generated from verified working patch on OmO 5.0.0-0.beta.88.
 */

export const PATCH_DATA = Object.freeze({
  '5.0.0-0.beta.88': {
    'plugin/extensions/omo-task.js': [
  {
    "name": "Task Hunk 1",
    "oldText": "r.kind}(e)?(e.extensions??[]).slice(1):e.extensions??[];for(let e of n)e.length>0&&t.push(\"--extensi",
    "newText": "r.kind}(e)?(e.extensions??[]).filter(e=>_w(e)!==z_):e.extensions??[];for(let e of[...new Set(n)])e.length>0&&t.push(\"--extensi"
  },
  {
    "name": "Task Hunk 2",
    "oldText": "ure_failed\",{fallbackAllowed:!1,detail:bk(e)})}),p=d?.capabil",
    "newText": "ure_failed\",{fallbackAllowed:!0,detail:bk(e)})}),p=d?.capabil"
  },
  {
    "name": "Task Hunk 3",
    "oldText": ".stderrBuffer+e).slice(-16384)}),this.child.stdin?.on(\"error",
    "newText": ".stderrBuffer+e).slice(-16384),/Error:\\s+Model\\s+[\"'].*?[\"']\\s+not\\s+found/i.test(this.stderrBuffer)&&(this.finalize(new Error(`Child process model not found: ${this.stderrTail}`)),this.child.kill?.())}),this.child.stdin?.on(\"error"
  },
  {
    "name": "Task Hunk 4",
    "oldText": "Admission;inheritedExtensions;constructor(e={}){this.spawnChild=",
    "newText": "Admission;inheritedExtensions;resolveInheritedExtensions;constructor(e={}){this.spawnChild="
  },
  {
    "name": "Task Hunk 5",
    "oldText": "ions=e.inheritedExtensions??[]}async start(e){let t=void 0===e.extensions&&this.inheritedExtensions.length>0?{...e,extensions:this.inheritedExtensions}:e;awai",
    "newText": "ions=e.inheritedExtensions??[],this.resolveInheritedExtensions=e.resolveInheritedExtensions}async start(e){let t=void 0===e.extensions?{...e,extensions:typeof this.resolveInheritedExtensions==\"function\"?await this.resolveInheritedExtensions():this.inheritedExtensions}:e;awai"
  },
  {
    "name": "Task Hunk 6",
    "oldText": "Admission;inheritedExtensions;now;onWarning;warned=new Set;reattachDelaysMs;admissionWaitMs;sleep;constructor(e){this.options=e,this.ensureDaemon=e.ensureDaemon??wk,this.createClient=e.createClient??(e=>new Wk({socketPath:e})),this.modelAdmission=e.modelAdmission??CC(),this.inheritedExtensions=e.inheritedExtensions??[],this.now=e.now??Date.now,this.onWarning=e.onWarning??(e=>Wf(\"senpi-task host runner fallback\",{message:e})),this.reattachDelaysMs=e.reattachDelaysMs??tD,this.admissionWaitMs=e.admissionWaitMs??6e5,this.sleep=e.sleep??(e=>new Promise(t=>setTimeout(t,e)))}async start(e){let t=void 0===e.extensions&&this.inheritedExtensions.length>0?{...e,extensions:this.inheritedExtensions}:e;awai",
    "newText": "Admission;inheritedExtensions;resolveInheritedExtensions;now;onWarning;warned=new Set;reattachDelaysMs;admissionWaitMs;sleep;constructor(e){this.options=e,this.ensureDaemon=e.ensureDaemon??wk,this.createClient=e.createClient??(e=>new Wk({socketPath:e})),this.modelAdmission=e.modelAdmission??CC(),this.inheritedExtensions=e.inheritedExtensions??[],this.resolveInheritedExtensions=e.resolveInheritedExtensions,this.now=e.now??Date.now,this.onWarning=e.onWarning??(e=>Wf(\"senpi-task host runner fallback\",{message:e})),this.reattachDelaysMs=e.reattachDelaysMs??tD,this.admissionWaitMs=e.admissionWaitMs??6e5,this.sleep=e.sleep??(e=>new Promise(t=>setTimeout(t,e)))}async start(e){let t=void 0===e.extensions?{...e,extensions:typeof this.resolveInheritedExtensions==\"function\"?await this.resolveInheritedExtensions():this.inheritedExtensions}:e;awai"
  },
  {
    "name": "Task Hunk 7",
    "oldText": "ensionPaths();if(0===n.length)return t;let r=[];try{r=await async function(e,t,n){let r;try{return await Promise.race([e,new Promise((e,i)=>{r=setTimeout(()=>i(Error(`${n} timed out after ${t}ms`)),t)})])}finally{void 0!==r&&clearTimeout(r)}}((async()=>{if(void 0!==e.listInstalledPackageRoots)return e.listInstalledPackageRoots();let{DefaultPackageManager:t,SettingsManager:n}=await Fw(),r=e.runtime.cwd(),i=e.agentDir??aZ({env:e.env??process.env});return new t({cwd:r,agentDir:i,settingsManager:n.create(r,i)}).listConfiguredPackages().flatMap(({installedPath:e})=>void 0===e?[]:[e])})(),RZ,\"package discovery\")}catch(e){Wf(\"omo-senpi package extension discovery failed; task children inherit argv extensions only\",{error:String(e)}),r=[]}return[...t,...OP(t,n,r)]}}function DZ(e){let t=jZ(e),n=e.resolveInheritedExtensions??CZ(e);return{start:async e=>t.start(void 0===e.extensions?{...e,extensions:await n()}:e)}}function jZ(e){let t=TP(process.argv),n=new jC({inheritedExtensions:t}),r=e.platform??process.platform;if(\"host\"!==e.settings.process_runner||\"win32\"===r)return n;let i=e.env??process.env,o=e.settings.host_idle_exit_ms;return new rD({policy:e.settings.host_engine_policy,agentDir:e.agentDir??aZ({env:i}),env:i,inheritedExtensions:t,fallback:n,...void 0===e.onHostW",
    "newText": "ensionPaths();if(0===n.length){try{let{DefaultPackageManager:t,SettingsManager:n}=await Fw(),r=e.runtime.cwd(),i=e.agentDir??aZ({env:e.env??process.env}),s=await new t({cwd:r,agentDir:i,settingsManager:n.create(r,i)}).resolve();n=(s.extensions??[]).map(e=>e.path)}catch{}}if(0===n.length)return t;let r=[];try{r=await async function(e,t,n){let r;try{return await Promise.race([e,new Promise((e,i)=>{r=setTimeout(()=>i(Error(`${n} timed out after ${t}ms`)),t)})])}finally{void 0!==r&&clearTimeout(r)}}((async()=>{if(void 0!==e.listInstalledPackageRoots)return e.listInstalledPackageRoots();let{DefaultPackageManager:t,SettingsManager:n}=await Fw(),r=e.runtime.cwd(),i=e.agentDir??aZ({env:e.env??process.env});return new t({cwd:r,agentDir:i,settingsManager:n.create(r,i)}).listConfiguredPackages().flatMap(({installedPath:e})=>void 0===e?[]:[e])})(),RZ,\"package discovery\")}catch(e){Wf(\"omo-senpi package extension discovery failed; task children inherit argv extensions only\",{error:String(e)}),r=[]}return[...t,...OP(t,n,r)]}}function DZ(e){let t=jZ(e),n=e.resolveInheritedExtensions??CZ(e);return{start:async e=>t.start(void 0===e.extensions?{...e,extensions:await n()}:e)}}function jZ(e){let t=TP(process.argv),s=e.resolveInheritedExtensions??CZ(e),n=new jC({inheritedExtensions:t,resolveInheritedExtensions:s}),r=e.platform??process.platform;if(\"host\"!==e.settings.process_runner||\"win32\"===r)return n;let i=e.env??process.env,o=e.settings.host_idle_exit_ms;return new rD({policy:e.settings.host_engine_policy,agentDir:e.agentDir??aZ({env:i}),env:i,inheritedExtensions:t,resolveInheritedExtensions:s,fallback:n,...void 0===e.onHostW"
  }
],
    'bin/lib/engine-prepare.js': [
  {
    "name": "Engine Prepare Hunk 1 (Import & ensureLaunchSpecPermissions)",
    "oldText": "import { existsSync, readFileSync, writeFileSync } from \"node:fs\"\nimport { join } from \"node:path\"\nimport { floorClaudeCodeVersion } from \"./claude-code-floor.js\"\nimport { prepareCompileSafeEngine } from \"./compile-safe-engine.js\"\nimport { prepareRpcStreamErrors } from \"./rpc-stream-errors.js\"\n\n// Written inside the engine tree, so reinstalling or upgrading the engine drops it with the tree.\nexport const ENGINE_PREPARED_STAMP = \".omo-engine-prepared\"",
    "newText": "import { chmodSync, existsSync, readFileSync, writeFileSync } from \"node:fs\"\nimport { join } from \"node:path\"\nimport { floorClaudeCodeVersion } from \"./claude-code-floor.js\"\nimport { prepareCompileSafeEngine } from \"./compile-safe-engine.js\"\nimport { prepareRpcStreamErrors } from \"./rpc-stream-errors.js\"\nimport { packageRoot } from \"./package-paths.js\"\n\n// Written inside the engine tree, so reinstalling or upgrading the engine drops it with the tree.\nexport const ENGINE_PREPARED_STAMP = \".omo-engine-prepared\"\n\nexport function ensureLaunchSpecPermissions() {\n  const specPath = join(packageRoot, \"plugin\", \"daemon-launch-spec.json\")\n  if (existsSync(specPath)) {\n    try {\n      chmodSync(specPath, 0o644)\n    } catch {}\n  }\n}"
  },
  {
    "name": "Engine Prepare Hunk 2 (prepareInstalledEngine hook)",
    "oldText": "export function prepareInstalledEngine(senpiRoot) {\n  floorClaudeCodeVersion(senpiRoot)\n  prepareCompileSafeEngine(senpiRoot)\n  prepareRpcStreamErrors(senpiRoot)\n}",
    "newText": "export function prepareInstalledEngine(senpiRoot) {\n  floorClaudeCodeVersion(senpiRoot)\n  prepareCompileSafeEngine(senpiRoot)\n  prepareRpcStreamErrors(senpiRoot)\n  ensureLaunchSpecPermissions()\n}"
  },
  {
    "name": "Engine Prepare Hunk 3 (ensureEnginePrepared hook)",
    "oldText": "export function ensureEnginePrepared({ senpiRoot, omoVersion, reinstallCommand, report = (line) => { process.stderr.write(line) } }) {\n  if (isPreparedFor(senpiRoot, omoVersion)) return",
    "newText": "export function ensureEnginePrepared({ senpiRoot, omoVersion, reinstallCommand, report = (line) => { process.stderr.write(line) } }) {\n  ensureLaunchSpecPermissions()\n  if (isPreparedFor(senpiRoot, omoVersion)) return"
  }
],
    'plugin/extensions/omo.js': [
  {
    "name": "Preflight Model Probe Hunk",
    "oldText": "var RK=[\"--no-extensions\",\"--no-skills\",\"--no-prompt-templates\",\"--no-context-files\",\"--list-models\"],DK=new Map;async function FK(e){let t=await async function(e,t){let n=await Promise.all(t.filter(e=>e.exists).map(async e=>{try{return`${e.path}:${(await ZO(e.path)).mtimeMs}`}catch{return`${e.path}:missing`}}));return JSON.stringify([e.command,e.prefixArgs,n])}(e.launch,e.configSources),n=(e.now??Date.now)(),r=DK.get(t),i=(void 0!==r&&n-r.probedAt<12e4?r:void 0)?.visible;if(void 0===i)try{i=await async function(e,t,n){let r=NK(e.command,[...e.prefixArgs,...RK],{env:t,stdio:[\"ignore\",\"pipe\",\"pipe\"],windowsHide:!0}),",
    "newText": "async function _omoxResolvePkgExts(e){let t=[];try{let n=Ph({env:e??process.env}),{DefaultPackageManager:r,SettingsManager:i}=await import(\"@code-yeongyu/senpi\"),o=process.cwd(),a=i.create(o,n),s=await new r({cwd:o,agentDir:n,settingsManager:a}).resolve();for(let e of s.extensions??[])!1!==e.enabled&&\"package\"===e.metadata?.origin&&e.path&&t.push(e.path)}catch{}if(0===t.length)try{let n=Ph({env:e??process.env}),r=Ih(n,Ah);if(xh(r)){let e=JSON.parse(oj(r,\"utf8\"));for(let r of e.packages??[]){if(\"string\"!=typeof r)continue;let e=r.replace(/^(npm|git|file):/,\"\"),i=Ih(n,\"npm\",\"node_modules\",e),o=Ih(i,\"package.json\");if(xh(o)){let e=JSON.parse(oj(o,\"utf8\")),n=e.pi?.extensions??(e.main?[e.main]:[]);for(let e of n){let n=Eh(i,e);xh(n)&&t.push(n)}}}}}catch{}return[...new Set(t)]}var RK=[\"--no-extensions\",\"--no-skills\",\"--no-prompt-templates\",\"--no-context-files\",\"--list-models\"],DK=new Map;async function FK(e){let t=await async function(e,t,r){let n=await Promise.all(t.filter(e=>e.exists).map(async e=>{try{return`${e.path}:${(await ZO(e.path)).mtimeMs}`}catch{return`${e.path}:missing`}}));return JSON.stringify([e.command,e.prefixArgs,r,n])}(e.launch,e.configSources,await _omoxResolvePkgExts(e.env)),n=(e.now??Date.now)(),r=DK.get(t),i=(void 0!==r&&n-r.probedAt<12e4?r:void 0)?.visible;if(void 0===i)try{let o=await _omoxResolvePkgExts(e.env),a=[\"--no-extensions\",...o.flatMap(e=>[\"--extension\",e]),\"--no-skills\",\"--no-prompt-templates\",\"--no-context-files\",\"--list-models\"];i=await async function(e,t,n){let r=NK(e.command,[...e.prefixArgs,...a],{env:t,stdio:[\"ignore\",\"pipe\",\"pipe\"],windowsHide:!0}),"
  },
  {
    "name": "Reflection and Dream Spawn Hunk",
    "oldText": "SENPI_MEMORY_REFLECTION:\"1\",SENPI_PTY_FORCE_PIPE:\"1\"},p=[\"-p\",\"--system-prompt\",r,\"--tools\",\"bash,edit\",\"--no-extensions\",\"--no-skills\",\"--no-prompt-templates\",\"--no-context-files\",\"--session-dir\",t,\"--model\",e.model,...void 0===e.thinking?[]:[\"--thinking\",e.thinking],`@${i}`];return{runId:e.run.runId,attempt:e.attempt??1,hardDeadlineAt:e.hardDeadlineAt??Date.now()+9e5,category:e.category,conversationIds:e.run.request.conversationIds,model:e.model,...void 0===e.thinking?{}:{thinking:e.thinking},...void 0===e.nextAttempt?{}:{nextAttempt:e.nextAttempt},kind:\"dream\"===e.run.request.trigger?\"dream\":\"reflection\",trigger:e.run.request.trigger,...\"dream\"===e.run.request.trigger?{origin:e.run.request.origin}:{},mergePolicy:e.mergePolicy,...void 0===e.run.request.targetDoc?{}:{targetDoc:e.run.request.targetDoc},...o?{systemTokenBudget:e.systemTokenBudget,systemTokenTarget:e.systemTokenTarget}:{},worktree:e.worktree,command:d.command,args:[...d.prefixArgs,...p],cwd:e.worktree.dir,env:f,detached:!0,paths:u}}",
    "newText": "SENPI_MEMORY_REFLECTION:\"1\",SENPI_PTY_FORCE_PIPE:\"1\"},g=await _omoxResolvePkgExts(f),p=[\"-p\",\"--system-prompt\",r,\"--tools\",\"bash,edit\",\"--no-extensions\",...g.flatMap(e=>[\"--extension\",e]),\"--no-skills\",\"--no-prompt-templates\",\"--no-context-files\",\"--session-dir\",t,\"--model\",e.model,...void 0===e.thinking?[]:[\"--thinking\",e.thinking],`@${i}`];return{runId:e.run.runId,attempt:e.attempt??1,hardDeadlineAt:e.hardDeadlineAt??Date.now()+9e5,category:e.category,conversationIds:e.run.request.conversationIds,model:e.model,...void 0===e.thinking?{}:{thinking:e.thinking},...void 0===e.nextAttempt?{}:{nextAttempt:e.nextAttempt},kind:\"dream\"===e.run.request.trigger?\"dream\":\"reflection\",trigger:e.run.request.trigger,...\"dream\"===e.run.request.trigger?{origin:e.run.request.origin}:{},mergePolicy:e.mergePolicy,...void 0===e.run.request.targetDoc?{}:{targetDoc:e.run.request.targetDoc},...o?{systemTokenBudget:e.systemTokenBudget,systemTokenTarget:e.systemTokenTarget}:{},worktree:e.worktree,command:d.command,args:[...d.prefixArgs,...p],cwd:e.worktree.dir,env:f,detached:!0,paths:u,extensions:g}}"
  },
  {
    "name": "Fork Reflection Spawn Hunk",
    "oldText": "async function mJ(e){let t=await hJ(e),n=e.parentSessionFile;if(void 0===n)throw Error(\"fork-mode reflection requires the parent session file\");let r=[...YK(e).prefixArgs,\"-p\",\"--fork\",n,\"--session-dir\",t.paths.sessionDir,\"--model\",e.model,...void 0===e.thinking?[]:[\"--thinking\",e.thinking],`@${t.paths.prompt}`];return{...t,fork:{parentSessionFile:n},args:r,cwd:e.parentCwd??t.cwd}}",
    "newText": "async function mJ(e){let t=await hJ(e),n=e.parentSessionFile;if(void 0===n)throw Error(\"fork-mode reflection requires the parent session file\");let r=[...YK(e).prefixArgs,\"-p\",\"--fork\",n,\"--session-dir\",t.paths.sessionDir,\"--model\",e.model,...void 0===e.thinking?[]:[\"--thinking\",e.thinking],\"--no-extensions\",...(t.extensions??[]).flatMap(e=>[\"--extension\",e]),\"--no-skills\",\"--no-prompt-templates\",\"--no-context-files\",`@${t.paths.prompt}`];return{...t,fork:{parentSessionFile:n},args:r,cwd:e.parentCwd??t.cwd}}"
  },
  {
    "name": "People Ask Hunk",
    "oldText": "function s5(e){return async t=>{let n=uK(\"quick\",e.config,e.registry);if(\"resolved\"!==n.kind)return i5;let r=e.env??process.env,i=[\"-p\",\"--system-prompt\",o5,\"--tools\",\"none\",\"--no-extensions\",\"--no-skills\",\"--no-prompt-templates\",\"--no-context-files\",\"--model\",n.model,...void 0===n.thinking?[]:[\"--thinking\",n.thinking],a5(t)],o=void 0===e.senpiCommand?VK(r):{command:e.senpiCommand,prefixArgs:e.senpiPrefixArgs??[]},a=await function(e,t,n,r){return new Promise((i,o)=>{let a=r5(e,[...t],{cwd:n.HOME??process.cwd(),env:{...n,SENPI_PTY_FORCE_PIPE:\"1\"},stdio:[\"ignore\",\"pipe\",\"pipe\"],windowsHide:!0}),",
    "newText": "function s5(e){return async t=>{let n=uK(\"quick\",e.config,e.registry);if(\"resolved\"!==n.kind)return i5;let r=e.env??process.env,s=await _omoxResolvePkgExts(r),i=[\"-p\",\"--system-prompt\",o5,\"--tools\",\"none\",\"--no-extensions\",...s.flatMap(e=>[\"--extension\",e]),\"--no-skills\",\"--no-prompt-templates\",\"--no-context-files\",\"--model\",n.model,...void 0===n.thinking?[]:[\"--thinking\",n.thinking],a5(t)],o=void 0===e.senpiCommand?VK(r):{command:e.senpiCommand,prefixArgs:e.senpiPrefixArgs??[]},a=await function(e,t,n,r){return new Promise((i,o)=>{let a=r5(e,[...t],{cwd:n.HOME??process.cwd(),env:{...n,SENPI_PTY_FORCE_PIPE:\"1\"},stdio:[\"ignore\",\"pipe\",\"pipe\"],windowsHide:!0}),"
  }
]
  }
});
