# omo-extension-bridge (`omox`)

Safe, provider-agnostic CLI utility that verifies, applies, and rolls back package-extension propagation compatibility fixes for OmO Native.

---

## What is `omo-extension-bridge`?

`omo-extension-bridge` (exposed as the `omox` CLI) is a small, safe diagnostic and patching utility. It inspects your active [OmO](https://github.com/code-yeongyu/oh-my-openagent) installation, verifies whether package-managed Pi/Senpi extensions are properly propagated to out-of-process child workers (subagents, background tasks, DAG runners, and team members), and applies targeted compatibility patches when needed.

### What it is NOT

- **NOT an Antigravity provider**: This project does not provide or implement models or authentication.
- **NOT a fork of `pi-antigravity`**: It does not duplicate, wrap, or modify `pi-antigravity` code.
- **NOT a permanent fork of OmO**: It is an interim compatibility bridge designed to become completely obsolete once upstream OmO natively supports package extension inheritance across child runners.

---

## Why It Exists (The Core Issue)

Pi/Senpi extensions installed via packages (e.g. `npm:pi-antigravity`, `npm:pi-commandcode-provider`) are dynamically loaded by the parent OmO session. However, in certain OmO versions (such as `5.0.0-0.beta.88`), out-of-process child processes (spawned for background tasks, subagents, DAG nodes, or team workers) were launched with:

```bash
senpi --mode rpc --no-extensions --no-ask-user \
  --extension <internal-omo-plugin> \
  --model antigravity/gemini-3.8-flash
```

Because package-managed extensions were not explicitly forwarded or inherited by child runners:
1. The child process failed to register the custom provider.
2. The child produced `Error: Model "<provider>/<model>" not found`.
3. In RPC mode, the child process stayed alive awaiting input, causing the parent task to hang indefinitely.
4. Additionally, `plugin/daemon-launch-spec.json` could be installed with group-writable permissions (`0664`), causing Senpi host daemons to reject the launch spec with `launch_spec_insecure`.

`omox` resolves these problems cleanly and safely:
- Ensures package-managed extensions are dynamically resolved and forwarded to child process runners, host runners, and DAG/team tasks.
- Avoids brittle `slice(1)` extension truncation and deduplicates extension arguments.
- Adds fail-fast detection if a child process reports model-not-found errors.
- Enforces safe `0644` permissions on `daemon-launch-spec.json`.

---

## Tested Integrations & Versions

- **Primary tested provider**: `pi-antigravity` (`antigravity/gemini-3.8-flash`)
- **Secondary tested provider**: `pi-commandcode-provider`
- **Supported / tested OmO versions**: `5.0.0-0.beta.88` on `@code-yeongyu/senpi 2026.9.23-5`
- **Supported runtimes**: Node.js >= 22 (runs on Node or Bun)

---

## Installation

### With Bun
```bash
bun add -g github:ranggabiner/omo-extension-bridge
```

### With npm
```bash
npm install -g github:ranggabiner/omo-extension-bridge
```

### Or clone and run locally
```bash
git clone https://github.com/ranggabiner/omo-extension-bridge.git
cd omo-extension-bridge
npm link
```

---

## Quick Start & Usage Flow

```bash
# 1. Inspect the installation without modifying anything
omox verify
```

- If result is **`NATIVE_OK`**:
  Your OmO installation already implements extension propagation natively. **Do nothing!**
- If result is **`PATCHED_OK`**:
  Your OmO installation is already properly patched and functioning. **Do nothing!**
- If result is **`NEEDS_PATCH`**:
  Apply the safe patch:
  ```bash
  omox apply
  ```
  Then re-verify:
  ```bash
  omox verify
  ```
- If you ever need to revert:
  ```bash
  omox rollback
  ```

---

## CLI Commands & Flags

### `omox verify`
Inspects the active installation without modifying anything.
- Checks OmO version, package root, Senpi version, and active agent directory.
- Discovers installed package-managed extensions in `settings.json`.
- Inspects `plugin/extensions/omo-task.js` and `bin/lib/engine-prepare.js`.
- Checks `plugin/daemon-launch-spec.json` permissions (`(mode & 0o022) === 0`).
- Performs an optional out-of-process worker smoke test if `pi-antigravity` is detected.

```bash
omox verify
omox verify --skip-runtime-test
omox verify --json
```

### `omox apply`
Applies the compatibility patch. **Fail-closed transaction**:
1. Preflight check: verifies current version and hashes match a known affected target.
2. Creates an isolated external backup in `~/.omo/omox/backups/<timestamp>/`.
3. Applies precise structural hunks to target files.
4. Corrects `daemon-launch-spec.json` permissions to `0644`.
5. Verifies resulting hashes match expected patched hashes.
6. Runs out-of-process worker smoke test.
7. **If ANY step fails**: automatically and immediately restores the exact backup and exits non-zero.

```bash
omox apply
omox apply --skip-runtime-test
```

### `omox rollback`
Restores the exact pre-apply state from the latest compatible backup.
- Locates the most recent backup matching the active OmO install root and version.
- Validates backup integrity and pre-apply SHA-256 hashes.
- Restores original files and file permissions.
- Runs post-rollback verification.

```bash
omox rollback
```

### Global Options
- `--skip-runtime-test`: Skips the out-of-process worker smoke test.
- `--timeout <ms>`: Timeout for worker smoke test in milliseconds (default: 15000).
- `--omo-root <path>`: Explicit override for OmO package root.
- `--agent-dir <path>`: Explicit override for OmO agent directory.
- `--backup-root <path>`: Custom directory for storing and reading backups.
- `--json`: Output structured JSON for scripting / CI.
- `--verbose`: Print detailed diagnostic logs.
- `--help, -h`: Show help text.
- `--version, -v`: Show version.

---

## Status Meanings & Exit Codes

| Status | Meaning | Exit Code | Action |
|---|---|---|---|
| `NATIVE_OK` | Installed OmO already implements the required behavior natively. | `0` | None needed. |
| `PATCHED_OK` | The omox compatibility patch is present and verified. | `0` | None needed. |
| `NEEDS_PATCH` | A known affected OmO version was identified and can be safely patched. | `10` | Run `omox apply`. |
| `INCOMPATIBLE` | Unknown or modified OmO files. Unsafe to patch automatically. | `20` | Do not patch; check version. |
| `VERIFY_FAILED` | Files appear patched or native, but worker runtime test failed. | `30` | Check provider credentials or logs. |
| *No backup* | Rollback requested but no compatible backup exists. | `40` | Inspect backup directory. |
| *CLI error* | Invalid arguments or internal error. | `50` | Check `omox --help`. |

---

## What Gets Modified During `omox apply`

Only two files inside the detected OmO package root are modified, plus file permissions:
1. `plugin/extensions/omo-task.js`:
   - Adds `resolveInheritedExtensions` support to RPC child runner and host runner.
   - Replaces brittle `slice(1)` extension slicing with filter and `new Set` deduplication.
   - Adds child process fail-fast on `Model not found`.
2. `bin/lib/engine-prepare.js`:
   - Adds `ensureLaunchSpecPermissions()` to enforce safe `0644` permissions on startup.
3. `plugin/daemon-launch-spec.json`:
   - File mode updated from `0664` to `0644`.

**Files that are NEVER modified:**
- `~/.omo/omo.jsonc`
- `~/.omo/agent/auth.json`
- `~/.omo/agent/antigravity-accounts.json`
- `~/.omo/agent/settings.json`
- Any credentials, tokens, or provider sources.

---

## Backup & Safety Model

- **Location**: Backups are stored **outside** the repository and **outside** global `node_modules` at:
  ```
  ~/.omo/omox/backups/<timestamp>/
  ```
- **Contents**:
  - Exact copies of original files prior to modification.
  - Original numeric file modes (e.g. `0664`).
  - Pre-modification and post-modification SHA-256 hashes.
  - `manifest.json` recording `omoxVersion`, `omoVersion`, `timestamp`, and file metadata.
- **Never included in backups**: No secrets, tokens, OAuth files, or user transcripts.
- **Transactional safety**: If any part of `omox apply` fails (syntax, anchor mismatch, hash mismatch, or runtime test failure), `omox` rolls back automatically to the pristine state.

---

## What Happens After an OmO Upgrade?

When you upgrade OmO (e.g. via `bun add -g omo-ai@beta` or npm):
1. The global package directory is replaced with fresh upstream files.
2. Run `omox verify`:
   - If upstream included the native fix, `omox verify` will report **`NATIVE_OK`**. You do not need to do anything!
   - If upstream still has the unpatched issue, `omox verify` will report **`NEEDS_PATCH`**, allowing you to safely run `omox apply`.
   - If upstream changed structure in an unverified way, `omox verify` will report **`INCOMPATIBLE`** and refuse to apply any speculative edits.

---

## Upstream Deprecation Plan

This project's goal is to become obsolete. Once upstream OmO incorporates:
1. Dynamic inherited package extension resolution in child process and host runners,
2. Safe launch-spec file mode enforcement, and
3. Removal of brittle index-based extension slicing,

`omox verify` will report `NATIVE_OK` across all installations, and this utility will no longer be needed.

---

## License

MIT © Rangga Biner
