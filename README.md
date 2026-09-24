# omo-extension-bridge (`omox`)

Safe, provider-agnostic CLI utility that bridges package-managed provider extensions into isolated OmO child processes, with zero configuration and exact transactional rollback.

---

## 1. What `omox` Does

`omox` bridges package-managed provider extensions (such as `pi-antigravity`, `pi-commandcode-provider`, and custom provider packages) into isolated OmO child processes that otherwise launch with automatic extension discovery disabled (`--no-extensions`).

It preserves child isolation:
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

`omox` verifies and patches known child-provider propagation paths for supported OmO builds, including:
- **Task & RPC Workers**: Ordinary process workers, category workers, subagents, DAG runners
- **Team & Workpools**: Team member processes, workpool workers, cold revival / respawn
- **Memory Model Preflight**: Preflight catalog probe (`--list-models`) ensuring preflight provider visibility matches child visibility
- **Memory Reflection & Dream**: Normal supervisor reflection spawns and fork-mode reflection spawns
- **People Ask**: Interactive and automated memory people-ask subprocesses

> `omox` does not promise support for arbitrary unknown future OmO internals. It targets verified versions and fails closed.

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
| `NATIVE_OK` | OmO natively implements provider extension propagation | Do nothing | `0` |
| `PATCHED_OK` | Compatibility patch is applied and fully verified | Do nothing | `0` |
| `NEEDS_PATCH` | Known OmO build detected needing compatibility patch | Run `omox apply` | `10` |
| `INCOMPATIBLE` | Unknown or modified OmO structure detected | Do not patch automatically | `20` |
| `VERIFY_FAILED` | Structural integrity or worker smoke test failed | Inspect error details | `30` |

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
  bun add -g github:ranggabiner/omo-extension-bridge#v1.1.0
  ```

Installing from `main` gets the latest commit; installing by tag gives a reproducible, pinned release.

---

## 11. Safety Model & Supported Builds

- **Version & Signature Aware**: Computes SHA-256 digests of all target files before modification.
- **Fail-Closed**: If an anchor does not match with exact multiplicity (1 match), patching halts with zero writes.
- **Incremental State Aware**: Recognizes partially patched or previously patched states as valid incremental pre-states without requiring a pristine re-install.
- **Daemon Permission Guard**: Audits `daemon-launch-spec.json` and ensures `0644` permissions so the local daemon refuses execution if world/group writable.
- **Supported Builds**: Currently verified on OmO Native `5.0.0-0.beta.88` running on `@code-yeongyu/senpi` `2026.9.23-5`.

---

## 12. Child Provider Propagation Guarantee

The core invariant enforced by `omox`:

$$\text{Package provider installed in parent} \implies \text{Same provider available in every child requiring model access}$$

Whenever OmO launches a child process or helper that consumes models or inspects the model catalog, `omox` guarantees the child receives the resolved absolute entrypoints of package-managed provider extensions while preserving complete child isolation.
