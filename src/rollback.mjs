import { detectOmo } from './lib/detect-omo.mjs';
import { getLatestBackupForInstall, restoreBackup, listBackups } from './lib/backup.mjs';
import { inspectTarget } from './lib/patch.mjs';
import { EXIT_CODES } from './lib/status.mjs';

/**
 * Executes the rollback command.
 * Restores the exact pre-apply state from the latest compatible backup.
 *
 * @param {object} [options={}]
 * @param {string} [options.omoPackageRoot]
 * @param {string} [options.omoExecutable]
 * @param {string} [options.agentDir]
 * @param {string} [options.backupRootDir]
 * @returns {Promise<{
 *   success: boolean,
 *   exitCode: number,
 *   backupDir: string|null,
 *   restoredFiles: string[],
 *   postStatus: string|null,
 *   report: string
 * }>}
 */
export async function runRollback(options = {}) {
  const omo = detectOmo({
    omoPackageRoot: options.omoPackageRoot,
    omoExecutable: options.omoExecutable,
    agentDir: options.agentDir,
  });

  const latestBackup = getLatestBackupForInstall({
    omoPackageRoot: omo.omoPackageRoot,
    omoVersion: omo.omoVersion,
    backupRootDir: options.backupRootDir,
  });

  if (!latestBackup) {
    const allBackups = listBackups(options.backupRootDir);
    const lines = [
      'OmO Extension Bridge - Rollback',
      '',
      `OmO Version: ${omo.omoVersion}`,
      `OmO Root: ${omo.omoPackageRoot}`,
      '',
      'Error: No compatible omox backup found for this installation.',
    ];

    if (allBackups.length > 0) {
      lines.push('');
      lines.push(`Found ${allBackups.length} other backup(s) for different paths/versions:`);
      for (const b of allBackups.slice(0, 5)) {
        lines.push(
          `  - ${b.timestamp}: OmO ${b.manifest.omoVersion} at ${b.manifest.omoPackageRoot}`
        );
      }
    }

    return {
      success: false,
      exitCode: EXIT_CODES.NO_BACKUP,
      backupDir: null,
      restoredFiles: [],
      postStatus: null,
      report: lines.join('\n'),
    };
  }

  // Restore the backup
  const restoreResult = restoreBackup(latestBackup.backupDir);

  // Run safe structural verification after rollback
  const postInspect = inspectTarget(omo.omoPackageRoot, omo.omoVersion);

  const reportLines = [
    'OmO Extension Bridge - Rollback',
    '',
    `OmO Version: ${omo.omoVersion}`,
    `Restored from backup: ${latestBackup.backupDir}`,
    `Timestamp: ${latestBackup.timestamp}`,
    '',
    'Restored files:',
    ...restoreResult.restoredFiles.map((f) => `  - ${f}`),
    '',
    `Post-rollback structural status: ${postInspect.status}`,
    'Result: Rollback completed successfully.',
  ];

  return {
    success: true,
    exitCode: EXIT_CODES.SUCCESS,
    backupDir: latestBackup.backupDir,
    restoredFiles: restoreResult.restoredFiles,
    postStatus: postInspect.status,
    report: reportLines.join('\n'),
  };
}
