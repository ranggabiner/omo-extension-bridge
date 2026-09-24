# Plan: omo-extension-bridge v1.1.0

## Goal
Implement release 1.1.0 of `omo-extension-bridge` (`omox`):
1. Comprehensive child provider propagation across all OmO production child processes needing model/provider access (task/RPC workers, category workers, team members, workpool, revival, memory reflection, memory dream, memory model preflight, people-ask).
2. Guarantee preflight provider visibility matches child visibility, preserving `--no-extensions + explicit --extension <resolved-package-entry>`.
3. First-class `omox update` command updating omox itself from `github:ranggabiner/omo-extension-bridge` using Bun priority and npm fallback, with robust PATH resolution, no shell interpolation, and safe self-update behavior.
4. Update README, CLI help, bump version to 1.1.0.
5. Deterministic fake extension-only provider fixture (`omox-fixture / fixture-model`) and comprehensive automated test suite (23+ tests).
6. Live verification: ordinary Antigravity task worker PASS, real memory reflection with `antigravity/gemini-3.8-flash` PASS, `omox verify` with per-surface status, `omox update` test, rollback test.

---

## Production Child-Launch Inventory

| Path | Purpose | Process / In-process | Needs Provider Extensions? | Previous Behavior | New Behavior | Verification Method |
|---|---|---|---|---|---|---|
| `plugin/extensions/omo-task.js` (`xw`, `Aw`, `start`) | Task / RPC child workers (ordinary, category, team, workpool, revival, host runner) | Subprocess (RPC) | YES | Inherited only if already on spec; omox 1.0.0 added resolution via DefaultPackageManager | Forward resolved package extensions with `--no-extensions --extension <path>` | Worker smoke test + unit test |
| `plugin/extensions/omo.js` (`FK`) | Memory model preflight (`--list-models`) | Subprocess | YES | `--no-extensions --list-models` with zero extensions; `antigravity/*` models invisible | Forwards same resolved package extensions to `--list-models` | Deterministic fixture test + preflight parity test |
| `plugin/extensions/omo.js` (`hJ`) | Memory reflection & dream spawn | Subprocess (supervised) | YES | `--no-extensions` without `--extension`; child failed with `Model not found` | Forwards resolved package extensions: `--no-extensions --extension <path> ... --model <model>` | Real reflection live test + fixture test |
| `plugin/extensions/omo.js` (`mJ`) | Memory reflection fork-mode spawn | Subprocess (supervised) | YES | `--fork` without `--extension`; lost package extensions | Forwards resolved package extensions | Unit test + argv snapshot test |
| `plugin/extensions/omo.js` (`s5`) | People ask command (`/people --ask`) | Subprocess | YES | `--no-extensions` without `--extension`; lost package extensions | Forwards resolved package extensions | Unit test with fake provider fixture |
| `plugin/extensions/omo.js` (facts runner) | Facts extraction | In-process (senpi-task) | Handled by senpi-task / parent | In-process | In-process | Structural audit |
| `plugin/extensions/omo.js` (kibitzer) | Memory kibitzer / recall | In-process (senpi-task) | Handled by senpi-task / parent | In-process | In-process | Structural audit |
| `plugin/extensions/memory-run-supervisor.mjs` | Supervisor wrapper for reflection child | Subprocess wrapper | Passes through args from `hJ`/`mJ` | Passes through args | Passes through args | Structural audit |

---

## Implementation Details

### 1. Provider Extension Resolution in `omo.js`
Create a clean, robust, generic extension resolution helper within `omo.js` that:
- Reads package-managed extensions (e.g. from `settings.json` and package roots or `@code-yeongyu/senpi` package manager).
- Deduplicates paths, ensures absolute paths, preserves deterministic order.
- Injects `--extension <entry>` into:
  - `FK`: preflight model probe (`RK` args)
  - `hJ`: reflection & dream spawn args (`p`)
  - `mJ`: fork-mode reflection spawn args (`r`)
  - `s5`: people-ask spawn args (`i`)
- Safe fail-closed: if no package extensions are installed, preserves previous behavior without failure.

### 2. Patch Data & Incremental Patched State Handling
- `src/lib/hashes.mjs`:
  - Register `plugin/extensions/omo.js` in `KNOWN_TARGETS['5.0.0-0.beta.88']`.
  - Support the current patched state (where `omo-task.js` and `engine-prepare.js` are already patched) as valid `NEEDS_PATCH` pre-state if `omo.js` is unpatched!
  - Record unpatched and patched hashes for `omo.js`.
- `src/lib/patch.mjs` & `src/apply.mjs`:
  - Transactional backup of all target files before mutation.
  - Skip files that are already at their target patched hash.
  - Rollback restores the exact immediate pre-apply bytes and modes.

### 3. Expanded `omox verify`
Report explicit per-surface status:
```
Child Provider Propagation
  Task/RPC: PASS
  Team/Workpool/Revival: PASS
  Memory model preflight: PASS
  Memory reflection: PASS
  Memory dream: PASS
  People ask: PASS

Antigravity
  Installed: yes
  Configured model: antigravity/gemini-3.8-flash
  Parent catalog: PASS
  Task worker: PASS
  Reflection child: PASS
```

### 4. `omox update` Implementation (`src/update.mjs`)
- Resolve package manager: Bun first (`bun add -g github:ranggabiner/omo-extension-bridge`), fallback npm (`npm install -g github:ranggabiner/omo-extension-bridge`).
- Robust PATH search without hardcoding user directories.
- Use `spawn()` / `execFile()` with argument arrays (NO shell interpolation).
- Self-update safety: await child exit, resolve new executable from PATH, spawn `omox --version`, output previous and current version.
- On failure: print clear stderr, exit code 50.
- Does NOT touch OmO, does NOT run `apply` or `rollback`.

### 5. Deterministic Fake Extension-Only Provider Fixture
Create `test/fixtures/fake-provider/`:
- `fake-provider.mjs`: registers provider `omox-fixture` and model `omox-fixture/fixture-model`.
- When tested without `--extension`, `senpi --list-models omox-fixture` fails/returns empty.
- When tested with `--extension`, `senpi --list-models omox-fixture` lists `fixture-model`.

### 6. Documentation & CLI Help
- Bump `package.json` to 1.1.0.
- Update `src/cli.mjs` help text with `omox update` description and `--help` details.
- Update `README.md` with all 12 required sections.

---

## Test & Verification Plan
- Unit tests:
  - Tests 1-15 for provider propagation, preflight parity, reflection, dream, people-ask, deduplication, incremental patch, rollback.
  - Tests 16-23 for update command (Bun/npm selection, failures, self-run version check, CLI help, version 1.1.0).
- Live verification:
  - `omox verify`
  - Ordinary Antigravity task worker test
  - Real memory reflection invocation
  - Rollback verification on disposable state
  - Push to GitHub and tag `v1.1.0`
