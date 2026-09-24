# omo-extension-bridge (`omox`)

Safe, provider-agnostic CLI utility that bridges package-managed provider extensions into isolated OmO child processes, built on a forward-compatible, capability-driven architecture with zero configuration and exact transactional rollback.

---

## 1. What `omox` Does

`omox` bridges package-managed provider extensions (such as `pi-antigravity`, `pi-commandcode-provider`, and custom provider packages) into isolated OmO child processes that otherwise launch with automatic extension discovery disabled (`--no-extensions`).

### The v2.0.0 Philosophy: Capability-Driven & Forward-Compatible
Prior versions of `omox` relied on hard-coded version tables and whole-file SHA-256 signatures, causing routine upstream OmO updates (such as `beta.88 -> beta.89` or bundle re-minifications) to break compatibility and demand immediate maintenance releases.

**`omox` v2.0.0 eliminates version-locked maintenance releases** by transitioning to a **capability-driven, forward-compatible architecture**:
- **Semantic AST Matching**: Discovers injection targets by structural invariants (CLI flag patterns, enclosing execution scopes, and consumer data-flow gates) using AST analysis rather than fragile minified identifier names or file hashes.
- **Selective Surgical Repairs**: Evaluates propagation health per capability (memory preflight, reflection, dream, peopleAsk, DAG tasks, and daemon permissions). Only failing capabilities are repaired; native or already-healthy surfaces (such as fork reflection) are left 100% pristine.
- **Day-Zero Native Recognition**: When upstream OmO natively supports extension propagation on a surface, `omox` recognizes the capability contract and reports `NATIVE_OK` without requiring code changes or version registration.
- **Authoritative Resolution**: Resolves package extensions using Senpi's canonical `DefaultPackageManager` with read-only guards, eliminating side effects and preserving exact resolution semantics.

### Preserved Child Isolation
`omox` strictly preserves child isolation invariants:
- Retains `--no-extensions`
- Retains `--no-skills`, `--no-prompt-templates`, `--no-context-files`
- Retains process boundaries, session dirs, worktrees, and tool permissions
- Explicitly forwards resolved provider extension entrypoints:
  ```bash
  senpi --no-extensions \
    --extension /absolute/path/to/provider-1 \
    --extension /absolute/path/to/provider-2 \
    --model provider/model
  ```

`omox` verifies and repairs child-provider propagation across all key OmO execution surfaces:
- **Task & RPC Workers**: Ordinary process workers, category workers, subagents, and DAG runners (recovering the first extension previously stripped by DAG slice logic)
- **Team & Workpools**: Team member processes, workpool workers, cold revival / respawn
- **Memory Model Preflight**: Preflight catalog probe (`--list-models`) ensuring preflight provider visibility matches child visibility
- **Memory Reflection & Dream**: Supervisor reflection spawns and dream subprocesses
- **People Ask**: Interactive and automated memory people-ask subprocesses
- **Daemon Permissions**: Hardens `daemon-launch-spec.json` to secure mode `0644` preventing launch failures on group/world-writable systems

---

## 2. Installation

Install globally directly from GitHub without cloning:

### Recommended (Bun)
```bash
bun add -g github:ranggabiner/omo-extension-bridge
```

### Alternative (npm)
```bash
npm install -g github:ranggabiner/omo-extension-bridge
```

- **No repository clone required**
- **No npm registry publishing required** (source installs directly from public GitHub)
- **Bun recommended**, npm fully supported

After installing, verify your installation:
```bash
omox verify
```

---

## 3. Quick Start

Three steps to verify and enable child provider propagation:

```bash
# 1. Install globally
bun add -g github:ranggabiner/omo-extension-bridge

# 2. Inspect active OmO installation (read-only)
omox verify

# 3. Apply compatibility patch if required
omox apply
```

If `omox verify` reports `PATCHED_OK` or `NATIVE_OK`, no patch is necessary. If it reports `NEEDS_PATCH`, run `omox apply`.

---

## 4. Updating `omox`

When new features or upstream OmO compatibility updates are released:

### Preferred Command
```bash
omox update
omox verify
```

`omox update` automatically selects Bun (or npm fallback), fetches the latest release from the official repository (`github:ranggabiner/omo-extension-bridge`), confirms executable resolution, and prints the updated version.

### Manual Alternative
```bash
# Bun
bun add -g github:ranggabiner/omo-extension-bridge

# npm
npm install -g github:ranggabiner/omo-extension-bridge
```

> **Note**: Pushing new code to GitHub does not magically update an already-installed global copy. The user must run `omox update` or reinstall.
>
> `omox update` updates **only** `omox` itself. It does NOT touch `omo-ai`, `senpi`, `pi-antigravity`, or user configuration.

---

## 5. Updating OmO Safely

When updating OmO, follow this safe sequence:

```bash
# 1. Update OmO
bun add -g omo-ai@beta

# 2. ALWAYS verify first
omox verify
```

Based on the reported status:
- **`NATIVE_OK`** &rarr; Do nothing. Upstream OmO natively supports extension propagation.
- **`PATCHED_OK`** &rarr; Do nothing. The compatibility fix is already in place.
- **`NEEDS_PATCH`** &rarr; Run `omox apply`.
- **`INCOMPATIBLE`** &rarr; Do not patch automatically. Inspect reported diagnostics.
- **`VERIFY_FAILED`** &rarr; Inspect reported verification error (e.g. invalid permissions or broken runtime).

> **Important**: Never blindly run `omox apply` after every OmO update. `omox verify` always comes first.

---

## 6. Command Reference

### `omox verify`
Inspects active OmO installation, detects package extensions, audits daemon permissions, and reports per-surface propagation health without modifying any files.

```bash
omox verify [options]
```

### `omox apply`
Safely creates an external backup, applies targeted compatibility patches to known OmO files, enforces secure daemon launch-spec permissions (0644), and runs an out-of-process verification check. Transactional: automatically restores backup if anything fails.

```bash
omox apply [options]
```

### `omox rollback`
Restores the exact byte-for-byte state and file permissions from the latest compatible pre-apply backup.

```bash
omox rollback [options]
```

### `omox update`
Updates the globally installed `omox` CLI itself from `github:ranggabiner/omo-extension-bridge`.

```bash
omox update [options]
```

> `omox update` does NOT update OmO.

### Global Options
- `--skip-runtime-test`: Skip out-of-process worker smoke tests
- `--timeout <ms>`: Timeout for runtime smoke tests in milliseconds (default: 30000)
- `--omo-root <path>`: Explicit path to OmO package root directory
- `--agent-dir <path>`: Explicit path to OmO agent directory (`~/.omo/agent`)
- `--backup-root <path>`: Explicit directory for storing/reading backups
- `--json`: Output result as structured JSON
- `--verbose`: Display full stack traces on error
- `--version, -v`: Show version number
- `--help, -h`: Show CLI help text

---

## 7. Status Meanings

| Status | Meaning | Action Required | Exit Code |
|---|---|---|---|
| `NATIVE_OK` | OmO natively implements provider extension propagation across all surfaces | Do nothing | `0` |
| `PATCHED_OK` | Compatibility repair is applied and verified healthy across all capabilities | Do nothing | `0` |
| `NEEDS_PATCH` | OmO installation lacks extension propagation on one or more capabilities | Run `omox apply` | `10` |
| `INCOMPATIBLE` | Ambiguous AST structures or unrecognized code layout detected | Do not patch automatically | `20` |
| `VERIFY_FAILED` | Verification failed (broken permissions, syntax error, or worker probe failure) | Inspect error details | `30` |

---

## 8. Typical Workflow

```text
[Initial Setup]
  bun add -g github:ranggabiner/omo-extension-bridge
  omox verify
  (if NEEDS_PATCH) -> omox apply

[Later: omox releases an update]
  omox update
  omox verify

[Later: OmO releases an update]
  bun add -g omo-ai@beta
  omox verify
  (if NEEDS_PATCH) -> omox apply

[Emergency Recovery]
  omox rollback
```

---

## 9. Rollback Architecture

Every `omox apply` is strictly transactional:
1. **Isolated External Backup**: Before touching any file, `omox` copies target files to `~/.omo/omox/backups/<timestamp>/` along with file permissions and SHA-256 digests in a `manifest.json`.
2. **Immediate Rollback on Failure**: If any hunk fails to match or post-patch verification fails, `omox` restores the immediate pre-apply state automatically.
3. **Manual Rollback**: Running `omox rollback` selects the latest matching backup for your OmO version and package root, restores exact file bytes and mode bits, and verifies post-restoration digests.
4. **No Secrets in Backup**: Backups contain only patched OmO code files, never user credentials, API keys, or session tokens.

---

## 10. GitHub-Source Distribution & Reproducible Tags

`omox` is distributed directly via public GitHub repositories without requiring an npm registry account or publication.

- **Current Repository State**:
  ```bash
  bun add -g github:ranggabiner/omo-extension-bridge
  ```
- **Reproducible Versioned Install (Pinned Tag)**:
  ```bash
  bun add -g github:ranggabiner/omo-extension-bridge#v2.0.0
  ```

Installing from `main` gets the latest commit; installing by tag gives a reproducible, pinned release.

---

## 11. Safety Model & Architecture

- **Semantic AST Matching**: Rather than fragile whole-file hashes or minified token names, `omox` parses target code with `@babel/parser` and searches for semantic invariant CLI patterns (`--no-extensions`, `--list-models`, `--tools bash,edit`, DAG slice expressions).
- **Three-Gate Validation**: Every candidate target must pass:
  1. *Multiplicity Gate*: Exactly 1 unique target per capability. If duplicate patterns exist, `omox` rejects with `AMBIGUOUS_TARGET`.
  2. *Enclosing Scope Gate*: Must reside within the expected function body (e.g. `probeModels`, `spawnReflectionChild`).
  3. *Consumer Data-Flow Gate*: Candidate arguments must be actively consumed by a child spawn invocation or return expression.
- **Selective Surgical Repairs**: Only capabilities that fail verification are modified. Surfaces that OmO natively implements correctly (such as fork reflection or native task execution) are left completely untouched.
- **Fail-Closed Authoritative Resolution**: Extension discovery leverages Senpi's canonical `DefaultPackageManager` with a read-only `onMissing` handler and strict narrow fallback, ensuring zero unexpected package installations or secret leaks.
- **Post-Mutation AST Parse**: Patched buffers are re-parsed by Babel AST before any disk writes occur, guaranteeing syntax integrity.
- **Atomic Disk Writes**: Updates are written to temporary files and renamed atomically, preserving existing file permissions.
- **Rollback Stale-State Guard**: Prior to restoring pre-apply bytes, `omox rollback` verifies that current disk files match the recorded `postSha256` and `postMode`. If an upstream OmO update or manual edit modified the file after patching, rollback safely aborts to avoid restoring stale bytes over newer software.
- **Forward-Compatible Compatibility**: Verified on OmO Native builds `5.0.0-0.beta.88`, `5.0.0-0.beta.89`, and forward-compatible native releases without requiring version-locked maintenance releases.

---

## 12. Child Provider Propagation Guarantee

The core invariant enforced by `omox`:

$$\text{Package provider installed in parent} \implies \text{Same provider available in every child requiring model access}$$

Whenever OmO launches a child process or helper that consumes models or inspects the model catalog, `omox` guarantees the child receives the resolved absolute entrypoints of package-managed provider extensions while preserving complete child isolation.

---

Made with ❤️ by [ranggabiner](https://ranggabiner.com)

