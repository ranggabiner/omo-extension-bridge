import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

/**
 * Searches system PATH for the `omo` executable.
 * @returns {string|null}
 */
export function findOmoInPath() {
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  const candidates = process.platform === 'win32'
    ? ['omo.cmd', 'omo.exe', 'omo.bat', 'omo.ps1', 'omo']
    : ['omo'];

  for (const dir of pathDirs) {
    if (!dir) continue;
    for (const binName of candidates) {
      const fullPath = path.join(dir, binName);
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          return fullPath;
        }
      } catch {}
    }
  }
  return null;
}

/**
 * Resolves the actual JavaScript entrypoint from an executable or launcher shim.
 * Supports Bun shims, shell wrappers, symlinks, etc.
 * @param {string} scriptPath
 * @returns {string}
 */
export function resolveEntryFromScript(scriptPath) {
  try {
    const real = fs.realpathSync(scriptPath);
    if (fs.existsSync(real)) {
      const content = fs.readFileSync(real, 'utf-8');
      // Bun launcher shim format: `# entry: /path/to/bin/omo.js`
      const entryMatch = content.match(/#\s*entry:\s*([^\r\n]+)/);
      if (entryMatch && entryMatch[1]) {
        const resolved = entryMatch[1].trim();
        if (fs.existsSync(resolved)) return resolved;
      }

      // Shell exec format: `exec ... '/path/to/bin/omo.js'`
      const execMatch = content.match(/exec\s+['"]?[^'"]*['"]?\s+['"]([^'"]+bin\/omo\.js)['"]/);
      if (execMatch && execMatch[1]) {
        if (fs.existsSync(execMatch[1])) return execMatch[1];
      }
    }
    return real;
  } catch {
    return scriptPath;
  }
}

/**
 * Ascends directory tree from a file/directory looking for omo-ai package.json.
 * @param {string} startDir
 * @returns {{ root: string, pkg: object }|null}
 */
export function findPackageRoot(startDir) {
  let curr = path.resolve(startDir);
  while (curr && curr !== path.dirname(curr)) {
    const pkgPath = path.join(curr, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'omo-ai' || (pkg.bin && (pkg.bin === 'bin/omo.js' || pkg.bin.omo))) {
          return { root: curr, pkg };
        }
      } catch {}
    }
    curr = path.dirname(curr);
  }
  return null;
}

/**
 * Common global install locations as fallback.
 * @returns {string[]}
 */
export function getFallbackSearchDirs() {
  const home = os.homedir();
  const dirs = [
    path.join(home, '.bun', 'install', 'global', 'node_modules', 'omo-ai'),
    path.join(home, '.npm-global', 'lib', 'node_modules', 'omo-ai'),
    path.join(home, '.local', 'share', 'pnpm', 'global', '5', 'node_modules', 'omo-ai'),
    '/usr/local/lib/node_modules/omo-ai',
    '/usr/lib/node_modules/omo-ai',
  ];

  // Try npm root -g if available
  try {
    const npmRoot = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (npmRoot) {
      dirs.push(path.join(npmRoot, 'omo-ai'));
    }
  } catch {}

  return dirs;
}

/**
 * Resolves Senpi version from OmO package root or environment.
 * @param {string} omoPackageRoot
 * @param {object} omoPkg
 * @returns {string|null}
 */
export function resolveSenpiVersion(omoPackageRoot, omoPkg) {
  // Check nested @code-yeongyu/senpi package.json
  const nestedPkgPath = path.join(omoPackageRoot, 'node_modules', '@code-yeongyu', 'senpi', 'package.json');
  if (fs.existsSync(nestedPkgPath)) {
    try {
      const senpiPkg = JSON.parse(fs.readFileSync(nestedPkgPath, 'utf-8'));
      if (senpiPkg.version) return senpiPkg.version;
    } catch {}
  }

  // Check peer node_modules (e.g. In Bun global install)
  const peerPkgPath = path.join(omoPackageRoot, '..', '@code-yeongyu', 'senpi', 'package.json');
  if (fs.existsSync(peerPkgPath)) {
    try {
      const senpiPkg = JSON.parse(fs.readFileSync(peerPkgPath, 'utf-8'));
      if (senpiPkg.version) return senpiPkg.version;
    } catch {}
  }

  // Check declared dependency in omo-ai package.json
  if (omoPkg?.dependencies?.['@code-yeongyu/senpi']) {
    return omoPkg.dependencies['@code-yeongyu/senpi'];
  }

  // Fallback to senpi binary in PATH
  try {
    const out = execSync('senpi --version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (out) return out;
  } catch {}

  return null;
}

/**
 * Resolves the Senpi executable associated with the OmO package,
 * inspecting package.json bin fields in nested and peer dependency layouts,
 * with PATH fallback.
 *
 * @param {string} [omoPackageRoot]
 * @returns {string|null}
 */
export function resolveSenpiExecutable(omoPackageRoot) {
  if (omoPackageRoot) {
    // 1. Check nested and peer package directories
    const candidateDirs = [
      path.join(omoPackageRoot, 'node_modules', '@code-yeongyu', 'senpi'),
      path.join(omoPackageRoot, 'node_modules', 'senpi'),
      path.join(omoPackageRoot, '..', '@code-yeongyu', 'senpi'),
      path.join(omoPackageRoot, '..', 'senpi'),
    ];

    for (const senpiDir of candidateDirs) {
      const pkgJsonPath = path.join(senpiDir, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
          let binRel = null;
          if (typeof pkg.bin === 'string') {
            binRel = pkg.bin;
          } else if (typeof pkg.bin === 'object' && pkg.bin !== null) {
            binRel = pkg.bin.senpi || pkg.bin.pi || Object.values(pkg.bin)[0];
          }

          if (binRel) {
            const binPath = path.resolve(senpiDir, binRel);
            if (fs.existsSync(binPath)) {
              return binPath;
            }
          }
        } catch {}
      }
    }

    // 2. Check .bin directories in nested and peer node_modules
    const candidateBins = [
      path.join(omoPackageRoot, 'node_modules', '.bin', 'senpi'),
      path.join(omoPackageRoot, '..', '.bin', 'senpi'),
    ];
    if (process.platform === 'win32') {
      candidateBins.unshift(
        path.join(omoPackageRoot, 'node_modules', '.bin', 'senpi.cmd'),
        path.join(omoPackageRoot, '..', '.bin', 'senpi.cmd')
      );
    }

    for (const binPath of candidateBins) {
      if (fs.existsSync(binPath)) {
        try {
          if (fs.statSync(binPath).isFile()) return binPath;
        } catch {}
      }
    }
  }

  // 3. Fall back to senpi from PATH
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  const candidates = process.platform === 'win32'
    ? ['senpi.cmd', 'senpi.exe', 'senpi.bat', 'senpi.ps1', 'senpi']
    : ['senpi'];

  for (const dir of pathDirs) {
    if (!dir) continue;
    for (const binName of candidates) {
      const fullPath = path.join(dir, binName);
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          return fullPath;
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Dynamically detects OmO installation details.
 *
 * @param {object} [options={}]
 * @param {string} [options.omoPackageRoot] Explicit package root override
 * @param {string} [options.omoExecutable] Explicit executable override
 * @param {string} [options.agentDir] Explicit agent dir override
 * @returns {{
 *   omoExecutable: string|null,
 *   omoPackageRoot: string,
 *   omoVersion: string,
 *   senpiVersion: string|null,
 *   agentDir: string,
 *   nodeVersion: string
 * }}
 */
export function detectOmo(options = {}) {
  let executable = options.omoExecutable || process.env.OMO_BIN || null;
  let packageRoot = options.omoPackageRoot || null;
  let omoPkg = null;

  if (packageRoot) {
    const pkgPath = path.join(packageRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        omoPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      } catch (err) {
        throw new Error(`Failed to parse OmO package.json at ${pkgPath}: ${err.message}`);
      }
    } else {
      throw new Error(`OmO package root does not contain package.json: ${packageRoot}`);
    }
  } else {
    // Attempt PATH resolution
    if (!executable) {
      executable = findOmoInPath();
    }

    if (executable) {
      const resolvedEntry = resolveEntryFromScript(executable);
      const found = findPackageRoot(path.dirname(resolvedEntry));
      if (found) {
        packageRoot = found.root;
        omoPkg = found.pkg;
      }
    }

    // Attempt fallback locations
    if (!packageRoot) {
      const fallbacks = getFallbackSearchDirs();
      for (const dir of fallbacks) {
        if (fs.existsSync(path.join(dir, 'package.json'))) {
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
            if (pkg.name === 'omo-ai') {
              packageRoot = dir;
              omoPkg = pkg;
              if (!executable && fs.existsSync(path.join(dir, 'bin', 'omo.js'))) {
                executable = path.join(dir, 'bin', 'omo.js');
              }
              break;
            }
          } catch {}
        }
      }
    }
  }

  if (!packageRoot || !omoPkg) {
    throw new Error(
      'Could not locate active OmO installation. Checked PATH and standard global package directories. ' +
      'Please ensure `omo` is installed and in PATH, or specify via OMO_BIN or --omo-root.'
    );
  }

  const omoVersion = omoPkg.version || 'unknown';
  const senpiVersion = resolveSenpiVersion(packageRoot, omoPkg);
  const senpiExecutable = options.senpiExecutable || resolveSenpiExecutable(packageRoot);

  const home = os.homedir();
  const agentDir = options.agentDir ||
    process.env.OMO_CODING_AGENT_DIR ||
    process.env.SENPI_CODING_AGENT_DIR ||
    path.join(home, '.omo', 'agent');

  return {
    omoExecutable: executable,
    omoPackageRoot: path.resolve(packageRoot),
    omoVersion,
    senpiVersion,
    senpiExecutable,
    agentDir: path.resolve(agentDir),
    nodeVersion: process.version,
  };
}
