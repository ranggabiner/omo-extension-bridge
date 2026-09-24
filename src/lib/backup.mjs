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
 * @param {string} params.omoVersion
 * @param {string[]} params.filesToBackup Array of absolute or relative paths
 * @param {string} [params.omoxVersion='1.0.0']
 * @param {string} [params.backupRootDir]
 * @returns {{ backupDir: string, manifest: object }}
 */
export function createBackup({
  omoPackageRoot,
  omoVersion,
  filesToBackup,
  omoxVersion = '1.0.0',
  backupRootDir,
}) {
  const rootDir = backupRootDir || getDefaultBackupRootDir();
  const timestampIso = new Date().toISOString();
  const dirName = timestampIso.replace(/[:.]/g, '-');
  const backupDir = path.join(rootDir, dirName);

  fs.mkdirSync(backupDir, { recursive: true });

  const manifest = {
    omoxVersion,
    omoVersion,
    omoPackageRoot: path.resolve(omoPackageRoot),
    timestamp: timestampIso,
    backupDir,
    files: [],
  };

  for (const filePath of filesToBackup) {
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(omoPackageRoot, filePath);

    if (!fs.existsSync(absPath)) continue;

    const relPath = path.relative(omoPackageRoot, absPath);
    const destPath = path.join(backupDir, relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const stat = fs.statSync(absPath);
    const mode = stat.mode & 0o777;
    const content = fs.readFileSync(absPath);
    const fileHash = sha256File(absPath);

    fs.writeFileSync(destPath, content, { mode });

    manifest.files.push({
      relativePath: relPath,
      originalPath: absPath,
      backupPath: destPath,
      sha256Before: fileHash,
      mode,
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
 * @returns {Array<{ backupDir: string, timestamp: string, manifest: object }>}
 */
export function listBackups(backupRootDir) {
  const rootDir = backupRootDir || getDefaultBackupRootDir();
  if (!fs.existsSync(rootDir)) return [];

  const results = [];
  try {
    const entries = fs.readdirSync(rootDir);
    for (const entry of entries) {
      const fullDir = path.join(rootDir, entry);
      const manifestPath = path.join(fullDir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
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

  // Verify all backup files exist and match sha256Before
  for (const file of manifest.files) {
    if (!fs.existsSync(file.backupPath)) {
      throw new Error(`Corrupted backup: missing file ${file.backupPath}`);
    }
    const currentHash = sha256File(file.backupPath);
    if (currentHash !== file.sha256Before) {
      throw new Error(
        `Corrupted backup: hash mismatch on ${file.backupPath}. Expected ${file.sha256Before}, got ${currentHash}`
      );
    }
  }

  // Restore each file
  for (const file of manifest.files) {
    fs.mkdirSync(path.dirname(file.originalPath), { recursive: true });
    const content = fs.readFileSync(file.backupPath);
    fs.writeFileSync(file.originalPath, content);
    if (typeof file.mode === 'number') {
      try {
        fs.chmodSync(file.originalPath, file.mode);
      } catch {}
    }

    // Verify restored file hash
    const restoredHash = sha256File(file.originalPath);
    if (restoredHash !== file.sha256Before) {
      throw new Error(
        `Restoration verification failed for ${file.originalPath}. Hash mismatch.`
      );
    }

    restoredFiles.push(file.originalPath);
  }

  return { restoredFiles, manifest };
}
