import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sha256File } from './hashes.mjs';

/**
 * Default backup root directory in ~/.omo/omox/backups/
 * @returns {string}
 */
export function getDefaultBackupRootDir() {
  return path.join(os.homedir(), '.omo', 'omox', 'backups');
}

/**
 * Creates an external, isolated backup of files before modification.
 *
 * @param {object} params
 * @param {string} params.omoPackageRoot
 * @param {string} [params.omoVersion]
 * @param {Array<string|object>} params.filesToBackup Array of paths or file descriptor objects
 * @param {string} [params.omoxVersion='2.0.0']
 * @param {string} [params.manifestVersion='2.0.0']
 * @param {any} [params.repairPlan]
 * @param {string} [params.backupRootDir]
 * @returns {{ backupDir: string, manifest: object }}
 */
export function createBackup({
  omoPackageRoot,
  omoVersion = 'unknown',
  filesToBackup,
  omoxVersion = '2.0.0',
  manifestVersion = '2.0.0',
  repairPlan = null,
  backupRootDir,
}) {
  const rootDir = backupRootDir || getDefaultBackupRootDir();
  const timestampIso = new Date().toISOString();
  const dirName = timestampIso.replace(/[:.]/g, '-');
  const backupDir = path.join(rootDir, dirName);

  fs.mkdirSync(backupDir, { recursive: true });

  const manifest = {
    manifestVersion,
    schemaVersion: manifestVersion,
    omoxVersion,
    omoVersion,
    omoPackageRoot: path.resolve(omoPackageRoot),
    timestamp: timestampIso,
    backupDir,
    repairPlan: repairPlan || null,
    files: [],
  };

  for (const item of filesToBackup) {
    const isObj = typeof item === 'object' && item !== null;
    const rawPath = isObj
      ? item.originalPath || item.path || item.filePath
      : item;
    const itemPostSha256 = isObj ? item.postSha256 : null;
    const itemPostMode = isObj ? item.postMode : null;

    const absPath = path.isAbsolute(rawPath)
      ? rawPath
      : path.join(omoPackageRoot, rawPath);

    if (!fs.existsSync(absPath)) continue;

    const relPath = path.relative(omoPackageRoot, absPath);
    const destPath = path.join(backupDir, relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const stat = fs.statSync(absPath);
    const preMode = stat.mode & 0o777;
    const content = fs.readFileSync(absPath);
    const preSha256 = sha256File(absPath);

    fs.writeFileSync(destPath, content, { mode: preMode });

    manifest.files.push({
      relativePath: relPath,
      originalPath: absPath,
      backupPath: destPath,
      preSha256,
      sha256Before: preSha256,
      postSha256: itemPostSha256 ?? null,
      preMode,
      mode: preMode,
      postMode:
        itemPostMode !== undefined && itemPostMode !== null
          ? itemPostMode
          : preMode,
    });
  }

  const manifestPath = path.join(backupDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return { backupDir, manifest };
}

/**
 * List all existing backups ordered by timestamp (newest first).
 *
 * @param {string} [backupRootDir]
 * @param {object} [options={}]
 * @param {boolean} [options.includeArchived=false]
 * @returns {Array<{ backupDir: string, timestamp: string, manifest: object }>}
 */
export function listBackups(backupRootDir, options = {}) {
  const rootDir = backupRootDir || getDefaultBackupRootDir();
  if (!fs.existsSync(rootDir)) return [];

  const results = [];
  try {
    const entries = fs.readdirSync(rootDir);
    for (const entry of entries) {
      if (!options.includeArchived && entry.endsWith('.archived')) continue;
      const fullDir = path.join(rootDir, entry);
      const manifestPath = path.join(fullDir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          if (!options.includeArchived && manifest.archived) continue;
          results.push({
            backupDir: fullDir,
            timestamp: manifest.timestamp || entry,
            manifest,
          });
        } catch {}
      }
    }
  } catch {}

  return results.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
}

/**
 * Find the latest backup matching the given OmO package root and version.
 *
 * @param {object} params
 * @param {string} params.omoPackageRoot
 * @param {string} params.omoVersion
 * @param {string} [params.backupRootDir]
 * @returns {{ backupDir: string, manifest: object }|null}
 */
export function getLatestBackupForInstall({ omoPackageRoot, omoVersion, backupRootDir }) {
  const backups = listBackups(backupRootDir);
  const resolvedRoot = path.resolve(omoPackageRoot);

  for (const b of backups) {
    if (
      b.manifest.omoPackageRoot === resolvedRoot &&
      b.manifest.omoVersion === omoVersion
    ) {
      return b;
    }
  }

  return null;
}

/**
 * Restores a backup from backup directory.
 * Verifies backup integrity before and after restoration.
 *
 * @param {string} backupDir
 * @returns {{ restoredFiles: string[], manifest: object }}
 */
export function restoreBackup(backupDir) {
  const manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Backup manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const restoredFiles = [];

  // Verify all backup files exist and match sha256Before / preSha256
  for (const file of manifest.files) {
    if (!fs.existsSync(file.backupPath)) {
      throw new Error(`Corrupted backup: missing file ${file.backupPath}`);
    }
    const currentHash = sha256File(file.backupPath);
    const expectedPre = file.preSha256 || file.sha256Before;
    if (currentHash !== expectedPre) {
      throw new Error(
        `Corrupted backup: hash mismatch on ${file.backupPath}. Expected ${expectedPre}, got ${currentHash}`
      );
    }
  }

  // Restore each file atomically via temporary file and rename
  for (const file of manifest.files) {
    fs.mkdirSync(path.dirname(file.originalPath), { recursive: true });
    const content = fs.readFileSync(file.backupPath);
    const preMode = typeof file.preMode === 'number' ? file.preMode : file.mode;

    const tmpDest = `${file.originalPath}.tmp-omox-restore-${Date.now()}`;
    fs.writeFileSync(tmpDest, content);
    if (typeof preMode === 'number') {
      try {
        fs.chmodSync(tmpDest, preMode);
      } catch {}
    }
    fs.renameSync(tmpDest, file.originalPath);

    // Verify restored file hash
    const restoredHash = sha256File(file.originalPath);
    const expectedPre = file.preSha256 || file.sha256Before;
    if (restoredHash !== expectedPre) {
      throw new Error(
        `Restoration verification failed for ${file.originalPath}. Hash mismatch.`
      );
    }

    restoredFiles.push(file.originalPath);
  }

  return { restoredFiles, manifest };
}
