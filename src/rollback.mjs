import fs from 'node:fs';
import path from 'node:path';
import { detectOmo } from './lib/detect-omo.mjs';
import {
  getLatestBackupForInstall,
  listBackups,
  getDefaultBackupRootDir,
} from './lib/backup.mjs';
import { sha256File } from './lib/hashes.mjs';
import { inspectTarget } from './lib/patch.mjs';
import { EXIT_CODES } from './lib/status.mjs';

/**
 * Executes the rollback command.
 * Restores the exact pre-apply state from the latest compatible backup
 * with stale-state postSha256 verification guards.
 *
 * @param {object} [options={}]
 * @param {string} [options.omoPackageRoot]
 * @param {string} [options.omoExecutable]
 * @param {string} [options.agentDir]
 * @param {string} [options.backupRootDir]
 * @param {string} [options.backupId]
 * @returns {Promise<{
 *   success: boolean,
 *   exitCode: number,
 *   backupDir: string|null,
 *   restoredFiles: string[],
 *   restoredPermissions: boolean,
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

  const rootDir = options.backupRootDir || getDefaultBackupRootDir();
  let targetBackup = null;

  if (options.backupId) {
    const allBackups = listBackups(rootDir, { includeArchived: true });
    targetBackup = allBackups.find(
      (b) =>
        path.basename(b.backupDir) === options.backupId ||
        b.backupDir.endsWith(options.backupId) ||
        b.manifest?.timestamp === options.backupId
    );
  }

  if (!targetBackup) {
    targetBackup = getLatestBackupForInstall({
      omoPackageRoot: omo.omoPackageRoot,
      omoVersion: omo.omoVersion,
      backupRootDir: rootDir,
    });
  }

  if (!targetBackup) {
    const allBackups = listBackups(rootDir);
    const resolvedRoot = path.resolve(omo.omoPackageRoot);
    targetBackup = allBackups.find((b) => b.manifest.omoPackageRoot === resolvedRoot) || null;
  }

  if (!targetBackup) {
    const allBackups = listBackups(rootDir);
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
      restoredPermissions: false,
      postStatus: null,
      report: lines.join('\n'),
    };
  }

  const manifest = targetBackup.manifest;

  // Stale-State Guard: For each file in manifest, check sha256File(diskPath) === fileEntry.postSha256
  for (const fileEntry of manifest.files) {
    const diskPath =
      fileEntry.originalPath || path.join(omo.omoPackageRoot, fileEntry.relativePath);
    const expectedPostSha256 = fileEntry.postSha256;
    if (expectedPostSha256) {
      if (!fs.existsSync(diskPath)) {
        throw new Error(
          `Refusing rollback: ${fileEntry.relativePath} has been modified or reinstalled since omox apply. Restoring stale bytes would corrupt newer OmO installation.`
        );
      }
      const currentHash = sha256File(diskPath);
      if (currentHash !== expectedPostSha256) {
        throw new Error(
          `Refusing rollback: ${fileEntry.relativePath} has been modified or reinstalled since omox apply. Restoring stale bytes would corrupt newer OmO installation.`
        );
      }
    }
  }

  // Atomically restore preSha256 bytes and preMode
  const restoredFiles = [];
  let restoredPermissions = false;

  for (const fileEntry of manifest.files) {
    const diskPath =
      fileEntry.originalPath || path.join(omo.omoPackageRoot, fileEntry.relativePath);
    if (!fs.existsSync(fileEntry.backupPath)) {
      throw new Error(`Corrupted backup: missing file ${fileEntry.backupPath}`);
    }

    const expectedPre = fileEntry.preSha256 || fileEntry.sha256Before;
    const backupHash = sha256File(fileEntry.backupPath);
    if (backupHash !== expectedPre) {
      throw new Error(
        `Corrupted backup: hash mismatch on ${fileEntry.backupPath}. Expected ${expectedPre}, got ${backupHash}`
      );
    }

    const content = fs.readFileSync(fileEntry.backupPath);
    const preMode = typeof fileEntry.preMode === 'number' ? fileEntry.preMode : fileEntry.mode;

    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
    const tmpDest = `${diskPath}.tmp-omox-rollback-${Date.now()}`;
    fs.writeFileSync(tmpDest, content);
    if (typeof preMode === 'number') {
      try {
        fs.chmodSync(tmpDest, preMode);
      } catch {}
    }
    fs.renameSync(tmpDest, diskPath);

    // Verify restored file hash
    const restoredHash = sha256File(diskPath);
    if (restoredHash !== expectedPre) {
      throw new Error(
        `Restoration verification failed for ${diskPath}. Hash mismatch.`
      );
    }

    if (
      typeof fileEntry.postMode === 'number' &&
      typeof fileEntry.preMode === 'number' &&
      fileEntry.preMode !== fileEntry.postMode
    ) {
      restoredPermissions = true;
    }

    restoredFiles.push(diskPath);
  }

  // Archive or clean up restored backup
  const targetBackupDir = targetBackup.backupDir;
  try {
    manifest.archived = true;
    manifest.archivedAt = new Date().toISOString();
    manifest.restored = true;
    manifest.restoredAt = manifest.archivedAt;
    const manifestPath = path.join(targetBackupDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    const archiveDir = `${targetBackupDir}.archived`;
    fs.renameSync(targetBackupDir, archiveDir);
  } catch {}

  // Post-rollback check: inspectTarget should return STATUS.NEEDS_PATCH (or original state)
  const postInspect = inspectTarget(omo.omoPackageRoot, omo.omoVersion);

  const reportLines = [
    'OmO Extension Bridge - Rollback',
    '',
    `OmO Version: ${omo.omoVersion}`,
    `Restored from backup: ${targetBackupDir}`,
    `Timestamp: ${manifest.timestamp}`,
    '',
    'Restored files:',
    ...restoredFiles.map((f) => `  - ${f}`),
    ...(restoredPermissions ? ['Restored permissions: launch-spec mode restored to pre-apply mode'] : []),
    '',
    `Post-rollback structural status: ${postInspect.status}`,
    'Result: Rollback completed successfully.',
  ];

  return {
    success: true,
    exitCode: EXIT_CODES.SUCCESS,
    backupDir: targetBackupDir,
    restoredFiles,
    restoredPermissions,
    postStatus: postInspect.status,
    report: reportLines.join('\n'),
  };
}
