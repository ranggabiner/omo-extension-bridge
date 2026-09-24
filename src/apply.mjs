import { detectOmo } from './lib/detect-omo.mjs';
import { detectExtensions } from './lib/detect-extensions.mjs';
import { inspectTarget, applyPatch } from './lib/patch.mjs';
import { createBackup, restoreBackup } from './lib/backup.mjs';
import { runWorkerSmokeTest } from './lib/runtime-test.mjs';
import { STATUS } from './lib/status.mjs';

/**
 * Executes the apply command.
 * Transactional and fail-closed: creates an external backup, applies patches,
 * verifies structural & runtime health, and automatically rolls back if anything fails.
 *
 * @param {object} [options={}]
 * @param {string} [options.omoPackageRoot]
 * @param {string} [options.omoExecutable]
 * @param {string} [options.agentDir]
 * @param {string} [options.backupRootDir]
 * @param {boolean} [options.skipRuntimeTest=false]
 * @param {number} [options.timeoutMs=30000]
 * @returns {Promise<{
 *   status: string,
 *   modified: boolean,
 *   backupDir: string|null,
 *   modifiedFiles: string[],
 *   permissionsFixed: boolean,
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
        `OmO Version: ${omo.omoVersion}`,
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
        `OmO Version: ${omo.omoVersion}`,
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
        `OmO Version: ${omo.omoVersion}`,
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

  // Identify files to backup
  const filesToBackup = [
    ...Object.keys(preflight.targetDef?.files || {}),
    preflight.targetDef?.daemonSpecRelativePath || 'plugin/daemon-launch-spec.json',
  ];

  // Create isolated backup before modifying anything
  const backup = createBackup({
    omoPackageRoot: omo.omoPackageRoot,
    omoVersion: omo.omoVersion,
    filesToBackup,
    omoxVersion: '1.0.0',
    backupRootDir: options.backupRootDir,
  });

  // Apply transaction
  try {
    const patchResult = applyPatch(omo.omoPackageRoot, omo.omoVersion);

    // Verify post-patch structural health
    const postInspect = inspectTarget(omo.omoPackageRoot, omo.omoVersion);
    if (postInspect.status !== STATUS.PATCHED_OK) {
      throw new Error(
        `Post-patch structural verification failed (ended in ${postInspect.status})`
      );
    }

    // Optional runtime smoke test
    let runtimeOk = true;
    let runtimeMsg = '';
    if (!options.skipRuntimeTest) {
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
    }

    const reportLines = [
      'OmO Extension Bridge - Apply',
      '',
      `OmO Version: ${omo.omoVersion}`,
      `Backup created: ${backup.backupDir}`,
      `Patched files:`,
      ...patchResult.modifiedFiles.map((f) => `  - ${f}`),
    ];
    if (patchResult.permissionsFixed) {
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
      backupDir: backup.backupDir,
      modifiedFiles: patchResult.modifiedFiles,
      permissionsFixed: patchResult.permissionsFixed,
      report: reportLines.join('\n'),
    };
  } catch (err) {
    // FAIL-CLOSED: automatically restore backup immediately
    try {
      restoreBackup(backup.backupDir);
    } catch (restoreErr) {
      throw new Error(
        `Apply failed (${err.message}) and automated rollback failed: ${restoreErr.message}`
      );
    }
    throw new Error(
      `Apply failed and was rolled back to original state: ${err.message}`
    );
  }
}
