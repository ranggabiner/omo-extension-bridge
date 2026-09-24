import fs from 'node:fs';

/**
 * Validates whether numeric file permissions satisfy security constraint:
 * must not be writable by group or world ((mode & 0o022) === 0).
 *
 * @param {number} mode
 * @returns {boolean}
 */
export function isDaemonLaunchSpecSafe(mode) {
  if (typeof mode !== 'number') return false;
  return (mode & 0o022) === 0;
}

/**
 * Checks mode of daemon-launch-spec.json via fs.statSync.
 * If (mode & 0o022) === 0, returns { needed: false, isSafe: true }.
 * If unsafe, executes fs.chmodSync(path, 0o644) when applied.
 *
 * @param {string|object} targetPathOrOptions
 * @param {object} [options={}]
 * @returns {{
 *   needed: boolean,
 *   isSafe: boolean,
 *   modified?: boolean,
 *   mode?: number,
 *   previousMode?: number,
 *   newMode?: number,
 *   path?: string,
 *   exists?: boolean
 * }}
 */
export function repairDaemon(targetPathOrOptions, options = {}) {
  let filePath = null;
  let apply = true;

  if (typeof targetPathOrOptions === 'string') {
    filePath = targetPathOrOptions;
    if (options.apply !== undefined) apply = Boolean(options.apply);
    if (options.dryRun !== undefined) apply = !options.dryRun;
  } else if (targetPathOrOptions && typeof targetPathOrOptions === 'object') {
    filePath = targetPathOrOptions.filePath || targetPathOrOptions.path || null;
    if (targetPathOrOptions.apply !== undefined) apply = Boolean(targetPathOrOptions.apply);
    if (targetPathOrOptions.dryRun !== undefined) apply = !targetPathOrOptions.dryRun;
  }

  if (!filePath && options) {
    filePath = options.filePath || options.path || null;
  }

  if (!filePath) {
    throw new Error('repairDaemon requires a target file path');
  }

  if (!fs.existsSync(filePath)) {
    return {
      needed: false,
      isSafe: true,
      exists: false,
      path: filePath,
    };
  }

  const stat = fs.statSync(filePath);
  const mode = stat.mode;

  if ((mode & 0o022) === 0) {
    return {
      needed: false,
      isSafe: true,
      mode: mode & 0o777,
      path: filePath,
    };
  }

  if (apply) {
    fs.chmodSync(filePath, 0o644);
    const updatedStat = fs.statSync(filePath);
    return {
      needed: true,
      modified: true,
      isSafe: true,
      previousMode: mode & 0o777,
      newMode: updatedStat.mode & 0o777,
      path: filePath,
    };
  }

  return {
    needed: true,
    modified: false,
    isSafe: false,
    mode: mode & 0o777,
    path: filePath,
  };
}

export default repairDaemon;
