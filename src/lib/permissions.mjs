import fs from 'node:fs';

/**
 * Check whether a numeric file mode satisfies the Senpi daemon launch-spec security constraint:
 * must not be writable by group or world ((mode & 0o022) === 0).
 *
 * @param {number} mode
 * @returns {boolean}
 */
export function isSafeMode(mode) {
  if (typeof mode !== 'number') return false;
  return (mode & 0o022) === 0;
}

/**
 * Inspect permissions of daemon-launch-spec.json.
 *
 * @param {string} filePath
 * @returns {{ exists: boolean, mode: number|null, modeOctal: string|null, isSafe: boolean, path: string }}
 */
export function checkLaunchSpecPermissions(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      mode: null,
      modeOctal: null,
      isSafe: true, // Non-existent file isn't insecure
      path: filePath,
    };
  }

  try {
    const stat = fs.statSync(filePath);
    const mode = stat.mode & 0o777;
    const modeOctal = '0' + mode.toString(8);
    const isSafe = isSafeMode(mode);

    return {
      exists: true,
      mode,
      modeOctal,
      isSafe,
      path: filePath,
    };
  } catch (error) {
    return {
      exists: true,
      mode: null,
      modeOctal: null,
      isSafe: false,
      error: error.message,
      path: filePath,
    };
  }
}

/**
 * Ensure launch-spec permissions are safe (default: 0o644).
 *
 * @param {string} filePath
 * @param {number} [targetMode=0o644]
 * @returns {{ modified: boolean, previousMode: number, newMode: number }}
 */
export function ensureSafePermissions(filePath, targetMode = 0o644) {
  if (!fs.existsSync(filePath)) {
    return { modified: false, previousMode: null, newMode: null };
  }

  const stat = fs.statSync(filePath);
  const currentMode = stat.mode & 0o777;

  if (isSafeMode(currentMode)) {
    return { modified: false, previousMode: currentMode, newMode: currentMode };
  }

  fs.chmodSync(filePath, targetMode);
  return { modified: true, previousMode: currentMode, newMode: targetMode };
}
