import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getOmoxVersion } from './lib/version.mjs';
import { EXIT_CODES } from './lib/status.mjs';

export const OFFICIAL_SOURCE = 'github:ranggabiner/omo-extension-bridge';

/**
 * Robustly find an executable in PATH across Linux, macOS, and Windows.
 *
 * @param {string} command
 * @param {string} [customPath]
 * @returns {string|null} Absolute path to executable or null
 */
export function findExecutableInPath(command, customPath) {
  const pathEnv = customPath ?? process.env.PATH ?? '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);

  const isWindows = process.platform === 'win32';
  const extensions = isWindows ? ['.cmd', '.exe', '.bat', ''] : [''];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const fullPath = path.join(dir, `${command}${ext}`);
      try {
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            return fullPath;
          }
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Determine the package manager to use for omox self-update.
 * Priority: Bun > npm.
 *
 * @param {object} [options={}]
 * @param {string} [options.customPath]
 * @param {string} [options.overridePm]
 * @returns {{ pm: 'bun'|'npm', executable: string, args: string[] }}
 */
export function resolveUpdatePackageManager(options = {}) {
  const customPath = options.customPath ?? process.env.PATH;

  if (options.overridePm === 'bun') {
    const bunPath = findExecutableInPath('bun', customPath);
    if (!bunPath) throw new Error('Bun was explicitly requested but not found in PATH');
    return {
      pm: 'bun',
      executable: bunPath,
      args: ['add', '-g', options.source || OFFICIAL_SOURCE],
    };
  }

  if (options.overridePm === 'npm') {
    const npmPath = findExecutableInPath('npm', customPath);
    if (!npmPath) throw new Error('npm was explicitly requested but not found in PATH');
    return {
      pm: 'npm',
      executable: npmPath,
      args: ['install', '-g', options.source || OFFICIAL_SOURCE],
    };
  }

  // 1. Try Bun
  const bunPath = findExecutableInPath('bun', customPath);
  if (bunPath) {
    return {
      pm: 'bun',
      executable: bunPath,
      args: ['add', '-g', options.source || OFFICIAL_SOURCE],
    };
  }

  // 2. Fallback to npm
  const npmPath = findExecutableInPath('npm', customPath);
  if (npmPath) {
    return {
      pm: 'npm',
      executable: npmPath,
      args: ['install', '-g', options.source || OFFICIAL_SOURCE],
    };
  }

  throw new Error(
    'Unable to update omox automatically: neither Bun nor npm is available in PATH.'
  );
}

/**
 * Executes the `omox update` command.
 *
 * @param {object} [options={}]
 * @param {string} [options.source=OFFICIAL_SOURCE]
 * @param {string} [options.customPath]
 * @param {string} [options.overridePm]
 * @param {number} [options.timeoutMs=120000]
 * @param {Function} [options.runner] Optional custom spawn runner for unit tests
 * @returns {Promise<{
 *   success: boolean,
 *   previousVersion: string,
 *   currentVersion: string,
 *   packageManager: string,
 *   report: string,
 *   exitCode: number
 * }>}
 */
export async function runUpdate(options = {}) {
  const source = options.source || OFFICIAL_SOURCE;
  const previousVersion = getOmoxVersion();

  let pmConfig;
  try {
    pmConfig = resolveUpdatePackageManager({
      customPath: options.customPath,
      overridePm: options.overridePm,
      source,
    });
  } catch (err) {
    return {
      success: false,
      previousVersion,
      currentVersion: previousVersion,
      packageManager: 'none',
      report: `OmO Extension Bridge - Update Failed\n\n${err.message}`,
      exitCode: EXIT_CODES.CLI_ERROR,
      error: err.message,
    };
  }

  const runner =
    options.runner ||
    ((exec, args, runOpts) =>
      new Promise((resolve) => {
        let child;
        try {
          child = spawn(exec, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: runOpts?.env || process.env,
          });
        } catch (err) {
          return resolve({ code: 1, stdout: '', stderr: err.message });
        }

        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d) => (stdout += d.toString()));
        child.stderr?.on('data', (d) => (stderr += d.toString()));

        const timer = setTimeout(() => {
          try {
            child.kill('SIGTERM');
          } catch {}
          resolve({ code: 1, stdout, stderr: `${stderr}\nUpdate timed out` });
        }, options.timeoutMs || 120000);

        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          resolve({ code: 1, stdout, stderr: err.message });
        });
      }));

  // Run the package manager installation command
  const installResult = await runner(pmConfig.executable, pmConfig.args, {
    env: options.env || process.env,
  });

  if (installResult.code !== 0) {
    const errDetail = (installResult.stderr || installResult.stdout || 'Process exited with non-zero code').trim();
    return {
      success: false,
      previousVersion,
      currentVersion: previousVersion,
      packageManager: pmConfig.pm,
      report: [
        'OmO Extension Bridge - Update Failed',
        '',
        `Source: ${source}`,
        `Package manager: ${pmConfig.pm}`,
        `Command: ${pmConfig.executable} ${pmConfig.args.join(' ')}`,
        `Error: ${errDetail}`,
      ].join('\n'),
      exitCode: EXIT_CODES.CLI_ERROR,
      error: errDetail,
    };
  }

  // After successful install, resolve new omox and query its version
  let currentVersion = previousVersion;
  const newOmoxPath = findExecutableInPath('omox', options.customPath);

  if (newOmoxPath) {
    const versionCheck = await runner(newOmoxPath, ['--version'], {
      env: options.env || process.env,
    });
    if (versionCheck.code === 0 && versionCheck.stdout.trim()) {
      currentVersion = versionCheck.stdout.trim().split(/\r?\n/)[0].trim();
    }
  }

  const lines = [
    'OmO Extension Bridge',
    '',
    'Updating omox...',
    `  Source: ${source}`,
    `  Package manager: ${pmConfig.pm}`,
    '',
    'Update complete.',
    '',
    `Previous version: ${previousVersion}`,
    previousVersion === currentVersion
      ? `Current version: ${currentVersion} (updated from latest GitHub source)`
      : `Current version: ${currentVersion}`,
    '',
    'Next:',
    '  omox verify',
  ];

  return {
    success: true,
    previousVersion,
    currentVersion,
    packageManager: pmConfig.pm,
    report: lines.join('\n'),
    exitCode: EXIT_CODES.SUCCESS,
  };
}
