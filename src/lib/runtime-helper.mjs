import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

/**
 * Strips comments from JSONC text for safe extraction.
 * @param {string} jsonc
 * @returns {string}
 */
function stripJsoncComments(jsonc) {
  return jsonc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\\:])\/\/.*$/gm, '$1');
}

/**
 * Parses package name from npm specifier (e.g. "npm:pi-antigravity" -> "pi-antigravity",
 * "npm:@scope/pkg@1.0.0" -> "@scope/pkg").
 *
 * @param {string} entry
 * @returns {string}
 */
export function parseNpmPackageName(entry) {
  if (typeof entry !== 'string') return '';
  const spec = entry.startsWith('npm:') ? entry.slice(4).trim() : entry.trim();
  if (spec.startsWith('@')) {
    const slashIdx = spec.indexOf('/');
    if (slashIdx === -1) return spec;
    const atIdx = spec.indexOf('@', slashIdx + 1);
    return atIdx !== -1 ? spec.slice(0, atIdx) : spec;
  }
  const atIdx = spec.indexOf('@');
  return atIdx !== -1 ? spec.slice(0, atIdx) : spec;
}

/**
 * Dynamically loads @code-yeongyu/senpi module.
 * a) Tries canonical import '@code-yeongyu/senpi'.
 * b) If omoPackageRoot is provided or detectable (e.g. via OMO_PACKAGE_DIR or global Bun path),
 *    checks sibling `../@code-yeongyu/senpi/dist/index.js` or nested `node_modules/@code-yeongyu/senpi/dist/index.js`.
 *
 * @param {object} [options]
 * @returns {Promise<object|null>}
 */
export async function loadSenpiModule(options = {}) {
  // a) Direct canonical import
  try {
    return await import('@code-yeongyu/senpi');
  } catch {}

  // b) Look for sibling or nested relative to omoPackageRoot
  const env = options.env || (options.OMO_PACKAGE_DIR ? options : process.env);
  const roots = [];
  if (options.omoPackageRoot) {
    roots.push(options.omoPackageRoot);
  }
  if (env.OMO_PACKAGE_DIR) {
    roots.push(env.OMO_PACKAGE_DIR);
  }
  roots.push(path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', 'omo-ai'));

  for (const root of roots) {
    if (!root || typeof root !== 'string') continue;
    const candidates = [
      path.resolve(root, '../@code-yeongyu/senpi/dist/index.js'),
      path.resolve(root, 'node_modules/@code-yeongyu/senpi/dist/index.js'),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        try {
          return await import(pathToFileURL(cand).href);
        } catch {}
      }
    }
  }

  return null;
}

/**
 * Tier 1: Authoritative Senpi Package Resolver.
 * Uses DefaultPackageManager and SettingsManager from @code-yeongyu/senpi.
 *
 * @param {object|string} [options]
 * @returns {Promise<string[]>}
 */
export async function resolvePackageExtensionsTier1(options = {}) {
  const opts = typeof options === 'string' ? { agentDir: options } : (options || {});
  const env = opts.env || (opts.OMO_CODING_AGENT_DIR || opts.SENPI_CODING_AGENT_DIR ? opts : process.env);
  const cwd = opts.cwd || process.cwd();
  const home = os.homedir();
  const agentDir = opts.agentDir ||
    env.OMO_CODING_AGENT_DIR ||
    env.SENPI_CODING_AGENT_DIR ||
    path.join(home, '.omo', 'agent');

  let senpi = opts.senpiModule;
  if (!senpi) {
    senpi = await loadSenpiModule(opts);
  }
  if (!senpi) {
    throw new Error('Senpi module (@code-yeongyu/senpi) could not be loaded');
  }

  const { DefaultPackageManager, SettingsManager } = senpi;
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const pm = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const onMissing = () => {};
  const resolved = await pm.resolve(onMissing);
  const extensions = resolved?.extensions || [];

  const paths = [];
  const seen = new Set();
  for (const ext of extensions) {
    if (ext && ext.enabled !== false && ext.metadata?.origin === 'package' && ext.path) {
      if (!seen.has(ext.path)) {
        seen.add(ext.path);
        paths.push(ext.path);
      }
    }
  }

  return paths;
}

/**
 * Tier 2: Fail-Closed Narrow Fallback.
 * Strictly validates that all package entries in settings.json are explicit npm: strings.
 * Throws UNSUPPORTED_PACKAGE_CONFIGURATION if any entry is an object PackageSource, git:, file:, or relative path.
 *
 * @param {object|string} [options]
 * @returns {string[]}
 */
export function resolvePackageExtensionsFallback(options = {}) {
  const opts = typeof options === 'string' ? { agentDir: options } : (options || {});
  const env = opts.env || (opts.OMO_CODING_AGENT_DIR || opts.SENPI_CODING_AGENT_DIR ? opts : process.env);
  const home = os.homedir();
  const agentDir = opts.agentDir ||
    env.OMO_CODING_AGENT_DIR ||
    env.SENPI_CODING_AGENT_DIR ||
    path.join(home, '.omo', 'agent');

  const settingsPath = path.join(agentDir, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    return [];
  }

  let settingsRaw;
  try {
    settingsRaw = fs.readFileSync(settingsPath, 'utf8');
  } catch (err) {
    throw new Error(`UNSUPPORTED_PACKAGE_CONFIGURATION: Unable to read settings.json: ${err.message}`);
  }

  let settings;
  try {
    settings = JSON.parse(stripJsoncComments(settingsRaw));
  } catch (err) {
    throw new Error(`UNSUPPORTED_PACKAGE_CONFIGURATION: Malformed JSON in settings.json: ${err.message}`);
  }

  if (!settings || typeof settings !== 'object') {
    return [];
  }

  if (settings.packageSources !== undefined && settings.packageSources !== null) {
    throw new Error(`UNSUPPORTED_PACKAGE_CONFIGURATION: 'packageSources' field in settings.json is not supported in narrow fallback`);
  }
  if (settings.packageDeltas !== undefined && settings.packageDeltas !== null) {
    throw new Error(`UNSUPPORTED_PACKAGE_CONFIGURATION: 'packageDeltas' field in settings.json is not supported in narrow fallback`);
  }

  const packages = settings.packages;
  if (packages === undefined || packages === null) {
    return [];
  }

  if (!Array.isArray(packages)) {
    throw new Error(`UNSUPPORTED_PACKAGE_CONFIGURATION: 'packages' field in settings.json must be an array, got: ${typeof packages}`);
  }

  // Strictly validate all entries before resolving
  for (const entry of packages) {
    if (entry === null || typeof entry !== 'string') {
      throw new Error(`UNSUPPORTED_PACKAGE_CONFIGURATION: Object package source or non-string entry is not supported in narrow fallback: ${JSON.stringify(entry)}`);
    }
    if (!entry.startsWith('npm:')) {
      throw new Error(`UNSUPPORTED_PACKAGE_CONFIGURATION: Unsupported non-npm package source: ${entry}`);
    }
    const spec = entry.slice(4).trim();
    if (!spec) {
      throw new Error(`UNSUPPORTED_PACKAGE_CONFIGURATION: Empty npm package specifier: ${entry}`);
    }
    if (spec.startsWith('git:') || spec.startsWith('git+') || spec.startsWith('file:') || spec.startsWith('http:') || spec.startsWith('https:') || spec.startsWith('.') || spec.startsWith('/')) {
      throw new Error(`UNSUPPORTED_PACKAGE_CONFIGURATION: Unsupported package path or URL: ${entry}`);
    }
  }

  const paths = [];
  const seen = new Set();

  for (const entry of packages) {
    const pkgName = parseNpmPackageName(entry);
    if (!pkgName) continue;

    const pkgDir = path.join(agentDir, 'npm', 'node_modules', pkgName);
    const pkgJsonPath = path.join(pkgDir, 'package.json');

    if (!fs.existsSync(pkgJsonPath)) {
      continue;
    }

    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    } catch {
      continue;
    }

    const declared = pkg.pi?.extensions || (pkg.main ? [pkg.main] : []);
    const declaredList = Array.isArray(declared) ? declared : (typeof declared === 'string' ? [declared] : []);

    for (const relPath of declaredList) {
      if (typeof relPath !== 'string' || !relPath.trim()) continue;
      const fullPath = path.resolve(pkgDir, relPath);
      if (!seen.has(fullPath)) {
        seen.add(fullPath);
        paths.push(fullPath);
      }
    }
  }

  return paths;
}

export const resolvePackageExtensionsTier2 = resolvePackageExtensionsFallback;

/**
 * Authoritative Package Extension Resolver.
 * Tries Tier 1 (canonical @code-yeongyu/senpi import). If that fails, uses Tier 2 fail-closed narrow fallback.
 *
 * @param {object|string} [options]
 * @returns {Promise<string[]>}
 */
export async function resolvePackageExtensions(options = {}) {
  const opts = typeof options === 'string' ? { agentDir: options } : (options || {});
  const env = opts.env || (opts.OMO_CODING_AGENT_DIR || opts.SENPI_CODING_AGENT_DIR ? opts : process.env);
  const cwd = opts.cwd || process.cwd();
  const home = os.homedir();
  const agentDir = opts.agentDir ||
    env.OMO_CODING_AGENT_DIR ||
    env.SENPI_CODING_AGENT_DIR ||
    path.join(home, '.omo', 'agent');

  let senpi = opts.senpiModule;
  if (!opts.forceFallback && senpi === undefined) {
    senpi = await loadSenpiModule(opts);
  }

  if (senpi && !opts.forceFallback) {
    try {
      return await resolvePackageExtensionsTier1({ ...opts, senpiModule: senpi, cwd, agentDir, env });
    } catch {
      // Fall through to Tier 2 if Tier 1 execution fails
    }
  }

  return resolvePackageExtensionsFallback({ ...opts, cwd, agentDir, env });
}

export default resolvePackageExtensions;
