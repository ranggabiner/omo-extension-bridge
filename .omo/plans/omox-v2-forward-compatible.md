# omox-v2-forward-compatible - Work Plan

## TL;DR (For humans)
**Who this is for and what changes for them:** For developers and automated agents using OmO with Antigravity and custom model providers. After this release, updating OmO (`bun add -g omo-ai@beta`) will no longer break `omox` or require a new `omox` release merely because OmO's version number, bundle hashes, or minified variable names changed.

**What you'll get:** A forward-compatible `omox 2.0.0` with capability-driven verification, AST-based surgical repair families, read-only canonical Senpi package resolution with fail-closed fallback, strengthened rollback stale-state guards, and a comprehensive synthetic test suite.

**Why this approach:** Replaces fragile whole-file SHA-256 matching and minified string replacement (`FK`, `hJ`, `mJ`, `s5`, `RK`, `Ph`) with structural AST pattern matching on invariant CLI flags (`--no-extensions`, `--list-models`, `--tools bash,edit`), guaranteeing compatibility with future OmO releases.

**What it will NOT do:**
- Will NOT register `beta.89` or future versions in hardcoded compatibility tables.
- Will NOT mutate fork reflection in `plugin/extensions/omo.js` (proven natively healthy).
- Will NOT install missing packages during extension discovery (strictly read-only).
- Will NOT approximate complex package configurations in fallback mode (fails closed).
- Will NOT perform full-bundle reprinting or reformatting.

**Effort:** Large
**Risk:** Medium - High blast radius on core OmO launcher files (`omo.js`, `omo-task.js`), mitigated by in-memory AST validation, selective per-capability patching, atomic writes, and rollback stale-state guards.
**Decisions to sanity-check:** 
- Fork reflection left 100% untouched based on empirical native proof.
- Ordinary Task/RPC runner left untouched; only DAG `.slice(1)` branch in `xw(e)` is patched.
- Authoritative resolution imports canonical Senpi with `onMissing` skip handler; narrow fallback strictly rejects non-npm sources.

Your next move: High-accuracy plan review is active. Full execution detail follows below.

---

> TL;DR (machine): Large, Medium risk. Capability-driven forward-compatible v2 eliminating version-coupling, adding AST semantic repair, read-only Senpi resolution, dual-axis verification, and rollback guards.

## Scope
### Affected user and ideal state
**Affected user:** Developers and agents running OmO Native with custom/package model providers (e.g. Antigravity) across routine upstream OmO updates.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | Routine OmO version bumps, bundle hash changes, and variable re-minifications do not break omox compatibility. | Upstream releases should not force an omox maintenance release when underlying invocation contracts remain identical. |
| IS-2 | `omox verify` evaluates installed capability health and accurately reports `NATIVE_OK` on unknown future builds without version registration or omox markers. | Users and CI can verify runtime health on day zero of an upstream release. |
| IS-3 | `omox apply` selectively repairs only failing capabilities using structural AST repairs without touching healthy surfaces. | Prevents regressions and respects upstream native improvements (e.g. native task propagation and native fork reflection). |
| IS-4 | Package extension resolution is strictly read-only and authoritative, using Senpi's canonical `DefaultPackageManager` with `onMissing` skip handler and failing closed on unsupported narrow configurations. | Guarantees zero installation side-effects and 100% fidelity with Senpi's package model. |
| IS-5 | Rollback verifies recorded `postSha256` before modifying disk, safely refusing to restore stale bytes if OmO was updated after applying. | Prevents accidental overwriting of newer OmO installations. |
| GAP-1 | `KNOWN_TARGETS` and `PATCH_DATA` in v1.1.0 are keyed by exact version string, causing `beta.89` to report `INCOMPATIBLE`. | Closed by Todos 2, 3, 4. |
| GAP-2 | `patch.mjs` enforces exact post-patch whole-file SHA-256 match, which breaks on any build difference. | Closed by Todos 2, 5. |
| GAP-3 | `patch-data.mjs` uses fragile minified strings (`FK`, `hJ`, `mJ`, `s5`, `RK`, `Ph`). | Closed by Todos 2, 3. |
| GAP-4 | `verify.mjs` skipped runtime smoke tests whenever version check was not `PATCHED_OK` or `NATIVE_OK`. | Closed by Todo 4. |
| GAP-5 | DAG tasks in `omo-task.js` have `.slice(1)` that strips the first extension. | Closed by Todo 3. |
| GAP-6 | `daemon-launch-spec.json` has `0664` mode by default, failing security check. | Closed by Todo 3. |

### Must have
- Zero version-registry requirement for compatibility: unknown OmO versions evaluate via capability.
- Dual-axis verification: Layer A Engine Control Probes + Layer B Installed OmO AST Data-Flow Proof.
- Selective repair families: Memory (`omo.js`), DAG Task (`omo-task.js`), Daemon (`chmod 0644`).
- Read-only canonical Senpi package resolver with fail-closed narrow fallback.
- In-memory transaction planning, atomic backup, atomic write, post-patch AST parse validation.
- Rollback stale-state guard checking `postSha256` before write.
- Comprehensive test matrix including synthetic future native build passing with `NATIVE_OK`.
- Full live validation on installed `beta.89`.
- Version bump to `2.0.0`, git commit, and tag `v2.0.0`.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Must NOT register `5.0.0-0.beta.89` in `KNOWN_TARGETS` or add hardcoded version recipes.
- Must NOT mutate fork reflection in `plugin/extensions/omo.js`.
- Must NOT allow the package resolver to install packages or write to disk.
- Must NOT use `import.meta.require`.
- Must NOT perform whole-file AST reprinting (surgical character-range replacement only).
- Must NOT suppress test failures or bypass security permission checks.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD + tests-after using Node/Bun test runners in `test/smoke.mjs`.
- Evidence: Captured stdout, stderr, exit codes, and AST parse results logged in `.omo/evidence/`.

## Execution strategy
### Parallel execution waves
- **Wave 1 (Infrastructure & Engine)**: Todo 1 (Authoritative Resolver & Narrow Fallback), Todo 2 (AST Semantic Scanner & Data-Flow Validator).
- **Wave 2 (Modular Repair Families)**: Todo 3 (Memory, DAG Task, and Daemon Repair Families).
- **Wave 3 (Dual-Layer Verifier)**: Todo 4 (Refactor `src/verify.mjs` with Engine Control + AST Data-Flow Proof).
- **Wave 4 (Transaction Safety & Rollback)**: Todo 5 (Transactional Applier with AST Validation), Todo 6 (Strengthened Rollback with Stale Guards).
- **Wave 5 (Testing, Live Validation & Release)**: Todo 7 (Synthetic & Regression Test Matrix), Todo 8 (Live beta.89 Validation, Bump 2.0.0, Git Commit & Tag).

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | None | 3, 4 | 2 |
| 2 | None | 3, 4, 5 | 1 |
| 3 | 1, 2 | 5 | None |
| 4 | 1, 2 | 7 | 5 |
| 5 | 2, 3 | 7, 8 | 4, 6 |
| 6 | None | 7, 8 | 5 |
| 7 | 3, 4, 5, 6 | 8 | None |
| 8 | 7 | None | None |

## Todos
> Implementation + Test = ONE todo. Never separate.

- [x] 1. Implement Authoritative Read-Only Package Resolver with Fail-Closed Narrow Fallback
  Recommended task executor category: deep-low
  What to do:
  - Create `src/lib/runtime-helper.mjs`.
  - Implement Tier 1 authoritative resolution: dynamically import `@code-yeongyu/senpi` (`DefaultPackageManager`, `SettingsManager`) with an explicit `onMissing: () => {}` skip handler to guarantee zero package installation side-effects.
  - Implement Tier 2 narrow fallback: supports only explicit `npm:` sources in proven directory layout. If any object PackageSource, autoload delta, extension filter array, git URL, or local path is encountered, strictly fail closed with `UNSUPPORTED_PACKAGE_CONFIGURATION`.
  - Preserves exact encounter order (never sorts alphabetically); deduplicates preserving first occurrence; accesses zero credentials.
  Must NOT do:
  - Must NOT attempt a loose approximation of Senpi's delta-filtering or git/local resolution.
  - Must NOT write or install packages to disk.
  Closes: GAP-1, IS-4
  Parallelization: Wave 1 | Blocked by: None | Blocks: Todos 3, 4
  References:
  - `/home/ranggabiner/.bun/install/global/node_modules/@code-yeongyu/senpi/dist/bundle/chunks/session-worker.js:6781315-6785500`
  - `src/lib/detect-extensions.mjs:1-120`
  Acceptance criteria:
  - Unit test in `test/smoke.mjs` verifying Tier 1 returns exact extension paths in encounter order.
  - Unit test verifying Tier 2 narrow fallback resolves plain `npm:` packages and throws `UNSUPPORTED_PACKAGE_CONFIGURATION` on object PackageSources, deltas, or git/file paths.
  QA scenarios:
  - Happy path: `node -e 'import("./src/lib/runtime-helper.mjs").then(m => console.log(m.resolvePackageExtensions()))'` outputs `[...pi-antigravity..., ...pi-commandcode-provider...]`.
  - Failure path: Passing `{ packages: [{ source: "pkg", autoload: false }] }` to fallback validator returns `{ supported: false }`.
  Commit: Y | feat(resolver): authoritative read-only senpi package resolver and fail-closed fallback

- [x] 2. Implement AST Semantic Scanner and Consumer Data-Flow Gate Validator
  Recommended task executor category: deep-low
  What to do:
  - Create `src/lib/semantic-scanner.mjs`.
  - Use `@babel/parser` to locate invariant CLI literals:
    - Preflight: `["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--list-models"]`.
    - Reflection: `["-p", "--system-prompt", ..., "--tools", "bash,edit", "--no-extensions", ..., "--model", ...]`.
    - People Ask: `["-p", "--system-prompt", ..., "--tools", "none", "--no-extensions", ..., "--model", ...]`.
    - Fork Reflection: `["-p", "--fork", ..., "--session-dir", ..., "--model", ...]`.
    - DAG Task: Call expression `.slice(1)` on `(e.extensions ?? [])` inside `"dag" === r.kind`.
  - Enforce Gate 1 (Literals), Gate 2 (Enclosing AST scope), Gate 3 (Downstream consumer data flow: array flows into child spawn args or launch return object), Gate 4 (Uniqueness: exactly 1 match; 0 or >1 fails closed).
  Must NOT do:
  - Must NOT match based on minified variable names (`LK`, `RK`, `FK`, `qK`, `s5`, `u5`, `jC`, `rD`).
  - Must NOT accept ambiguous (>1) targets.
  Closes: GAP-1, GAP-3, IS-1
  Parallelization: Wave 1 | Blocked by: None | Blocks: Todos 3, 4, 5
  References:
  - `/home/ranggabiner/.bun/install/global/node_modules/omo-ai/plugin/extensions/omo.js:810400-819400`
  - `/home/ranggabiner/.bun/install/global/node_modules/omo-ai/plugin/extensions/omo-task.js:299600-300200`
  Acceptance criteria:
  - Scanner returns exact source character offsets (`start`, `end`) for all 4 targets on `beta.88` and `beta.89` with 100% uniqueness.
  QA scenarios:
  - Happy path: Scanner on `omo.js` returns `{ preflight: 1, reflection: 1, peopleAsk: 1, fork: 1 }`.
  - Failure path: Input file with duplicate matching reflection arrays fails closed with `status: AMBIGUOUS_TARGET`.
  Commit: Y | feat(ast): semantic scanner with consumer data-flow validation

- [x] 3. Implement Modular Repair Families for Memory, DAG Task, and Daemon Security
  Recommended task executor category: deep-low
  What to do:
  - Create `src/lib/patch-families/memory.mjs`, `src/lib/patch-families/task.mjs`, `src/lib/patch-families/daemon.mjs`, `src/lib/patch-families/index.mjs`.
  - `memory.mjs`: Surgically prepends static standard ESM imports (`import * as _omoxFs from "node:fs"; import * as _omoxPath from "node:path";`) and the self-contained resolver function into `plugin/extensions/omo.js`. Injects `..._omoxGetPkgExts().flatMap(e => ["--extension", e])` into Preflight, Non-Fork Reflection, and People Ask. Leaves Fork Reflection 100% untouched.
  - `task.mjs`: In `plugin/extensions/omo-task.js`, replaces `(e.extensions ?? []).slice(1)` with `e.extensions ?? []` for DAG tasks. Leaves ordinary task/RPC runners untouched.
  - `daemon.mjs`: Generic file permission repair `chmod 0644` on `plugin/daemon-launch-spec.json`.
  Must NOT do:
  - Must NOT mutate fork reflection in `omo.js`.
  - Must NOT mutate ordinary task runners in `omo-task.js`.
  - Must NOT reprint or reformat whole files (character-offset surgical slice replacement only).
  Closes: GAP-1, GAP-3, GAP-5, GAP-6, IS-3
  Parallelization: Wave 2 | Blocked by: Todos 1, 2 | Blocks: Todo 5
  References:
  - `src/lib/patch-data.mjs:1-120`
  - `src/lib/permissions.mjs:1-60`
  Acceptance criteria:
  - Applying `memory.mjs` produces valid ESM syntax that re-parses with Babel without errors.
  - Applying `task.mjs` removes DAG slice without altering surrounding task infrastructure.
  - `daemon.mjs` sets file mode to `0644`.
  QA scenarios:
  - Happy path: In-memory mutation of `omo.js` parsed with `@babel/parser` yields zero syntax errors and exactly +1 statement.
  - Failure path: File lacking unique preflight target aborts repair without modifying buffers.
  Commit: Y | feat(patch-families): modular surgical repair families for memory, task, and daemon

- [x] 4. Refactor Verifier to Dual-Axis Architecture (Engine Control + Installed OmO AST Proof)
  Recommended task executor category: deep-low
  What to do:
  - Rewrite `src/verify.mjs` and `src/lib/patch.mjs` to separate `runtimeHealth` from `repairSupport`.
  - Layer A (Engine Control Probes): Uses `test/fixtures/fake-provider/` in a temporary isolated agent environment to verify Senpi model discovery with and without `--extension`.
  - Layer B (Installed OmO AST Data-Flow Proof): Scans installed OmO JavaScript code to prove whether child process command lines actually include package extension injection.
  - Filesystem Security Probe: Reads `stat.mode` of `plugin/daemon-launch-spec.json` (`(mode & 0o022) === 0`).
  - Synthesize overall status: `NATIVE_OK`, `PATCHED_OK`, `NEEDS_PATCH`, `INCOMPATIBLE`, `VERIFY_FAILED`.
  Must NOT do:
  - Must NOT gate verification on `KNOWN_TARGETS[omoVersion]`.
  - Must NOT treat manually reconstructed legacy argvs as OmO runtime proof.
  - Must NOT allow unproven/NOT_PROBED capabilities to produce `NATIVE_OK`.
  Closes: GAP-1, GAP-4, IS-2
  Parallelization: Wave 3 | Blocked by: Todos 1, 2 | Blocks: Todo 7
  References:
  - `src/verify.mjs:1-180`
  - `src/lib/patch.mjs:1-180`
  - `test/fixtures/fake-provider/index.mjs:1-35`
  Acceptance criteria:
  - `runVerify()` on unpatched beta.89 outputs `NEEDS_PATCH` with exact broken surfaces identified (preflight, reflection, peopleAsk, dag, daemon).
  - `runVerify()` on synthetic future native build outputs `NATIVE_OK` without requiring omox markers or version recipes.
  QA scenarios:
  - Happy path: `node ./src/cli.mjs verify` on installed beta.89 exits with code 10 (`NEEDS_PATCH`).
  - Native path: Running verify on synthetic native fixture exits with code 0 (`NATIVE_OK`).
  Commit: Y | feat(verify): dual-axis capability verification and data-flow proof

- [x] 5. Implement Transactional In-Memory Applier with Post-Patch AST Parse Validation
  Recommended task executor category: deep-low
  What to do:
  - Refactor `src/apply.mjs` and `src/lib/patch.mjs`.
  - Pre-patch check: calls `inspectTarget()` and mutates only failing capabilities.
  - In-memory transaction planner: builds the entire mutation plan in memory and validates that all proposed transformations have exactly 1 target.
  - Pre-write validation: parses the resulting buffer with `@babel/parser` to guarantee syntax validity before touching disk.
  - Transactional write: writes backups with SHA-256 and mode, replaces target files atomically via temporary files + rename, and chmods `daemon-launch-spec.json` to `0644`.
  - Post-write verification: re-parses disk files and confirms capability pass. Automatic in-memory rollback on any error.
  - Provenance logging: records applied repair IDs, timestamp, and pre/post hashes to `~/.omo/omox/state.json`.
  Must NOT do:
  - Must NOT enforce exact precomputed whole-file SHA-256 matches.
  - Must NOT mutate healthy surfaces (e.g. fork reflection or ordinary RPC).
  - Must NOT perform partial writes without full plan validation.
  Closes: GAP-1, GAP-2, IS-3
  Parallelization: Wave 4 | Blocked by: Todos 2, 3 | Blocks: Todos 7, 8
  References:
  - `src/apply.mjs:1-120`
  - `src/lib/backup.mjs:1-150`
  Acceptance criteria:
  - `runApply()` applies repairs selectively, generates valid backups, records provenance, and reaches `PATCHED_OK`.
  - Duplicate `runApply()` is idempotent: performs zero writes and reports `PATCHED_OK`.
  QA scenarios:
  - Happy path: `runApply()` on unpatched fixture updates files, logs provenance, and re-inspects to `PATCHED_OK`.
  - Idempotent path: Running `runApply()` a second time performs 0 writes.
  Commit: Y | feat(apply): transactional in-memory applier with post-patch ast validation

- [x] 6. Implement Strengthened Rollback with Post-Apply Stale-State Guards
  Recommended task executor category: deep-low
  What to do:
  - Refactor `src/rollback.mjs`.
  - In backup manifests, record `manifestVersion: "2.0.0"`, `preSha256`, `postSha256`, `preMode`, `postMode`, and file paths.
  - Stale-State Guard: before restoring any file, verify that `sha256File(diskPath) === manifest.postSha256`.
  - If current disk hash does not match `postSha256` (indicating OmO was reinstalled, upgraded, or modified since apply), abort rollback with an explicit error refusing to overwrite newer upstream bytes.
  - On valid match, atomically restore `preSha256` bytes and `preMode`, then archive the backup manifest.
  Must NOT do:
  - Must NOT overwrite files if disk SHA-256 diverges from recorded post-apply state.
  - Must NOT leave orphaned `.bak` files.
  Closes: IS-5
  Parallelization: Wave 4 | Blocked by: None | Blocks: Todos 7, 8
  References:
  - `src/rollback.mjs:1-120`
  - `src/lib/backup.mjs:1-150`
  Acceptance criteria:
  - Rollback succeeds when files match `postSha256`, restoring original `preSha256` bytes and modes.
  - Rollback fails closed with an error when a file has been modified or reinstalled after apply.
  QA scenarios:
  - Happy path: Apply $\rightarrow$ Rollback restores exact pre-patch SHA-256 and mode `0664`.
  - Stale guard path: Modifying target file after apply causes `rollback` to refuse restoration.
  Commit: Y | feat(rollback): strengthened rollback with post-apply stale-state guards

- [x] 7. Build Comprehensive Test Suite Matrix (Future Native, Broken Builds, Fallback Matrix)
  Recommended task executor category: deep-low
  What to do:
  - Update `test/smoke.mjs` and add fixtures for the complete v2 test matrix:
    - Test A: Synthetic Future Native OmO build (`NATIVE_OK`, zero omox markers, zero version entries).
    - Test B: Synthetic Broken OmO build with new hashes and identifiers (`NEEDS_PATCH` $\rightarrow$ repairs safely to `PATCHED_OK`).
    - Test C: Ambiguous target rejection (file with duplicate reflection signatures fails closed with `INCOMPATIBLE`).
    - Test D: Resolver matrix: verifies canonical Senpi resolution vs fail-closed narrow fallback on string, scoped, object, and git/file packages.
    - Test E: Rollback stale-state rejection guard.
    - Test F: Legacy `beta.88` regression fixture.
    - Test G: Live `beta.89` regression fixture.
  Must NOT do:
  - Must NOT delete, skip, or disable existing security and permission tests.
  - Must NOT hardcode expected whole-file hashes for dynamic test runs.
  Closes: GAP-1, GAP-2, GAP-3, GAP-4, IS-1, IS-2, IS-3
  Parallelization: Wave 5 | Blocked by: Todos 3, 4, 5, 6 | Blocks: Todo 8
  References:
  - `test/smoke.mjs:1-1000`
  - `test/fixtures/fake-provider/`
  Acceptance criteria:
  - `node test/smoke.mjs` executes all unit, synthetic, and fixture tests with 100% passing results and exit code 0.
  QA scenarios:
  - Happy path: `node test/smoke.mjs` reports `All tests passed` with 0 failures.
  Commit: Y | test: comprehensive v2 forward-compatibility and regression test matrix

- [x] 8. Execute Live beta.89 Verification, Apply, Rollback Validation, Version Bump to 2.0.0, Git Commit & Tag
  Recommended task executor category: deep-high
  What to do:
  - Execute live `node ./src/cli.mjs verify` against installed `beta.89`: must report `NEEDS_PATCH` without version registration.
  - Execute live `node ./src/cli.mjs apply` against installed `beta.89`: repairs memory preflight, reflection, people ask, DAG task, and daemon permissions.
  - Execute live `node ./src/cli.mjs verify` post-apply: confirms `PATCHED_OK`.
  - Execute `node ./src/cli.mjs rollback`: confirms clean restoration to `NEEDS_PATCH` and mode `0664`.
  - Re-execute `node ./src/cli.mjs apply`: returns to healthy `PATCHED_OK`.
  - Bump `version: "2.0.0"` in `package.json`.
  - Update `README.md` to reflect capability-driven forward-compatible architecture.
  - Commit all changes: `feat: forward-compatible capability-driven omox v2.0.0`.
  - Tag release: `git tag v2.0.0`.
  Must NOT do:
  - Must NOT register `beta.89` in `hashes.mjs` or `KNOWN_TARGETS`.
  - Must NOT leave working tree dirty or uncommitted.
  Closes: IS-1, IS-2, IS-3, IS-4, IS-5
  Parallelization: Wave 5 | Blocked by: Todo 7 | Blocks: None
  References:
  - `package.json:1-30`
  - `README.md:1-150`
  Acceptance criteria:
  - Full suite passes on live workstation with exit code 0.
  - Git working tree is clean.
  - Tag `v2.0.0` points to the final release commit.
  QA scenarios:
  - Live verify: `node ./src/cli.mjs verify` $\rightarrow$ `PATCHED_OK`.
  - Git status: `git status --short` is empty; `git tag -l` includes `v2.0.0`.
  Commit: Y | chore(release): bump version to 2.0.0 and tag v2.0.0

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
- [x] F2. Code quality review
- [x] F3. Real manual QA
- [x] F4. Ideal-state fidelity

## Commit strategy
- Atomic Conventional Commits per todo:
  - `feat(resolver): authoritative read-only senpi package resolver and fail-closed fallback`
  - `feat(ast): semantic scanner with consumer data-flow validation`
  - `feat(patch-families): modular surgical repair families for memory, task, and daemon`
  - `feat(verify): dual-axis capability verification and data-flow proof`
  - `feat(apply): transactional in-memory applier with post-patch ast validation`
  - `feat(rollback): strengthened rollback with post-apply stale-state guards`
  - `test: comprehensive v2 forward-compatibility and regression test matrix`
  - `chore(release): bump version to 2.0.0 and tag v2.0.0`

## Success criteria
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 2, 3, 7 | Synthetic Future Native Build (`NATIVE_OK`) + Synthetic Broken Build (`NEEDS_PATCH` $\rightarrow$ `PATCHED_OK`) | `.omo/evidence/synthetic-future-build.log` |
| IS-2 | 4, 7, 8 | `omox verify` on unregistered installed `beta.89` reports `NEEDS_PATCH` with exact broken capabilities | `.omo/evidence/live-verify-preflight.log` |
| IS-3 | 3, 5, 8 | `omox apply` selectively repairs memory, DAG, and daemon without touching fork reflection or RPC | `.omo/evidence/live-apply-proof.log` |
| IS-4 | 1, 7 | Senpi resolver loads packages read-only without installing side-effects; fallback rejects object sources | `.omo/evidence/resolver-matrix.log` |
| IS-5 | 6, 8 | `omox rollback` safely restores original bytes on match and refuses restoration if disk hash diverges | `.omo/evidence/rollback-stale-guard.log` |
