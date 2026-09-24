import { detectOmo } from './lib/detect-omo.mjs';
import { detectExtensions } from './lib/detect-extensions.mjs';
import { inspectTarget, applyPatch } from './lib/patch.mjs';
import { restoreBackup } from './lib/backup.mjs';
import { runWorkerSmokeTest } from './lib/runtime-test.mjs';
import { STATUS } from './lib/status.mjs';

/**
 * Executes the apply command.
 * Transactional and forward-compatible: calls applyPatch to selectively repair
 * broken capabilities, formats CLI report showing modified files, capabilities repaired,
 * backup directory, and post-apply status.
 *
 * @param {object} [options={}]
 * @param {string} [options.omoPackageRoot]
 * @param {string} [options.omoExecutable]
 * @param {string} [options.agentDir]
 * @param {string} [options.backupRootDir]
 * @param {string} [options.statePath]
 * @param {string} [options.stateFile]
 * @param {boolean} [options.skipRuntimeTest=false]
 * @param {number} [options.timeoutMs=30000]
 * @returns {Promise<{
 *   status: string,
 *   modified: boolean,
 *   backupDir: string|null,
 *   modifiedFiles: string[],
 *   permissionsFixed: boolean,
 *   repairsApplied?: string[],
 *   report: string
 * }>}
 */
export async function runApply(options = {}) {
  const omo = detectOmo({
    omoPackageRoot: options.omoPackageRoot,
    omoExecutable: options.omoExecutable,
    agentDir: options.agentDir,
  });

  const preflight = inspectTarget(omo.omoPackageRoot, omo.omoVersion);

  if (preflight.status === STATUS.NATIVE_OK) {
    return {
      status: STATUS.NATIVE_OK,
      modified: false,
      backupDir: null,
      modifiedFiles: [],
      permissionsFixed: false,
      report: [
        'OmO Extension Bridge - Apply',
        '',
        `OmO Version: ${omo.omoVersion || 'unknown'}`,
        'Status: NATIVE_OK',
        'Installed OmO already implements the required behavior natively.',
        'Zero modifications made.',
      ].join('\n'),
    };
  }

  if (preflight.status === STATUS.PATCHED_OK) {
    return {
      status: STATUS.PATCHED_OK,
      modified: false,
      backupDir: null,
      modifiedFiles: [],
      permissionsFixed: false,
      report: [
        'OmO Extension Bridge - Apply',
        '',
        `OmO Version: ${omo.omoVersion || 'unknown'}`,
        'Status: PATCHED_OK',
        'Installation already contains the verified compatibility patch.',
        'Zero modifications made.',
      ].join('\n'),
    };
  }

  if (preflight.status === STATUS.INCOMPATIBLE) {
    return {
      status: STATUS.INCOMPATIBLE,
      modified: false,
      backupDir: null,
      modifiedFiles: [],
      permissionsFixed: false,
      report: [
        'OmO Extension Bridge - Apply',
        '',
        `OmO Version: ${omo.omoVersion || 'unknown'}`,
        'Status: INCOMPATIBLE',
        'Installed OmO structure/signatures are unknown or unsafe to patch automatically.',
        'Zero modifications made.',
      ].join('\n'),
    };
  }

  if (preflight.status !== STATUS.NEEDS_PATCH) {
    throw new Error(
      `Cannot apply patch: unexpected preflight status "${preflight.status}". Zero modifications made.`
    );
  }

  const patchResult = applyPatch(omo.omoPackageRoot, omo.omoVersion, {
    backupRootDir: options.backupRootDir,
    statePath: options.statePath || options.stateFile,
  });

  if (!patchResult.modified) {
    return {
      status: patchResult.status,
      modified: false,
      backupDir: null,
      modifiedFiles: [],
      permissionsFixed: false,
      report: [
        'OmO Extension Bridge - Apply',
        '',
        `OmO Version: ${omo.omoVersion || 'unknown'}`,
        `Status: ${patchResult.status}`,
        patchResult.message || 'Already healthy, 0 writes performed.',
        'Zero modifications made.',
      ].join('\n'),
    };
  }

  // Optional runtime smoke test
  let runtimeMsg = '';
  if (!options.skipRuntimeTest) {
    try {
      const extensions = detectExtensions({
        agentDir: omo.agentDir,
        omoPackageRoot: omo.omoPackageRoot,
      });

      if (extensions.hasAntigravity && extensions.antigravityEntry) {
        const runtimeTest = await runWorkerSmokeTest({
          senpiExecutable: omo.senpiExecutable,
          extensionPath: extensions.antigravityEntry,
          model: extensions.antigravityModel || 'antigravity/gemini-3.8-flash',
          agentDir: omo.agentDir,
          timeoutMs: options.timeoutMs || 30000,
        });

        if (!runtimeTest.success) {
          throw new Error(
            `Post-patch runtime smoke test failed: ${runtimeTest.error || 'worker failed'}`
          );
        }
        runtimeMsg = `\nWorker smoke test: PASS (${runtimeTest.durationMs}ms)`;
      }
    } catch (runtimeErr) {
      if (patchResult.backupDir) {
        try {
          restoreBackup(patchResult.backupDir);
        } catch (rollbackErr) {
          throw new Error(
            `Runtime smoke test failed (${runtimeErr.message}) and automated rollback failed: ${rollbackErr.message}`
          );
        }
      }
      throw new Error(
        `Apply failed and was rolled back to original state: ${runtimeErr.message}`
      );
    }
  }

  const reportLines = [
    'OmO Extension Bridge - Apply',
    '',
    `OmO Version: ${omo.omoVersion || 'unknown'}`,
    `Status: ${patchResult.status}`,
    `Backup directory: ${patchResult.backupDir || 'none'}`,
    `Capabilities repaired: ${(patchResult.repairsApplied || []).join(', ') || 'none'}`,
    '',
    'Modified files:',
    ...(patchResult.modifiedFiles.length > 0
      ? patchResult.modifiedFiles.map((f) => `  - ${f}`)
      : ['  (none)']),
  ];
  if (patchResult.permissionsFixed) {
    reportLines.push('');
    reportLines.push('Permissions fixed: plugin/daemon-launch-spec.json -> 0644');
  }
  if (runtimeMsg) {
    reportLines.push(runtimeMsg);
  }
  reportLines.push('');
  reportLines.push('Result: PATCHED_OK');

  return {
    status: STATUS.PATCHED_OK,
    modified: true,
    backupDir: patchResult.backupDir,
    modifiedFiles: patchResult.modifiedFiles,
    permissionsFixed: patchResult.permissionsFixed,
    repairsApplied: patchResult.repairsApplied,
    report: reportLines.join('\n'),
  };
}
