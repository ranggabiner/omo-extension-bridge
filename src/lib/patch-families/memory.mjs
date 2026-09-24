import fs from 'node:fs';
import * as parser from '@babel/parser';
import { scanOmoJs, checkArrayHasExtensionInjection } from '../semantic-scanner.mjs';

export const OMOX_MEMORY_IMPORTS = `import * as _omoxFs from "node:fs";\nimport * as _omoxPath from "node:path";\n`;

export const OMOX_MEMORY_HELPER = `/* @omox-bridge-v2 */
function _omoxGetPkgExts() {
  try {
    const _home = process.env.HOME || (process.platform === "win32" ? process.env.USERPROFILE : "") || "";
    const _agentDir = process.env.OMO_CODING_AGENT_DIR || process.env.SENPI_CODING_AGENT_DIR || _omoxPath.join(_home, ".omo", "agent");
    const _settingsPath = _omoxPath.join(_agentDir, "settings.json");
    if (!_omoxFs.existsSync(_settingsPath)) return [];
    const _raw = _omoxFs.readFileSync(_settingsPath, "utf8");
    const _clean = _raw.replace(/\\/\\*[\\s\\S]*?\\*\\//g, "").replace(/(^|[^\\\\:])\\/\\/.*$/gm, "$1");
    const _settings = JSON.parse(_clean);
    if (!Array.isArray(_settings?.packages)) return [];
    const _paths = [];
    const _seen = new Set();
    for (const _entry of _settings.packages) {
      if (typeof _entry !== "string") continue;
      const _spec = _entry.startsWith("npm:") ? _entry.slice(4).trim() : _entry.trim();
      let _pkgName = _spec;
      if (_spec.startsWith("@")) {
        const _slash = _spec.indexOf("/");
        if (_slash !== -1) {
          const _at = _spec.indexOf("@", _slash + 1);
          _pkgName = _at !== -1 ? _spec.slice(0, _at) : _spec;
        }
      } else {
        const _at = _spec.indexOf("@");
        if (_at !== -1) _pkgName = _spec.slice(0, _at);
      }
      if (!_pkgName) continue;
      const _pkgDir = _omoxPath.join(_agentDir, "npm", "node_modules", _pkgName);
      const _pkgJsonPath = _omoxPath.join(_pkgDir, "package.json");
      if (!_omoxFs.existsSync(_pkgJsonPath)) continue;
      let _pkg;
      try {
        _pkg = JSON.parse(_omoxFs.readFileSync(_pkgJsonPath, "utf8"));
      } catch {
        continue;
      }
      const _decl = _pkg?.pi?.extensions || (_pkg?.main ? [_pkg.main] : []);
      const _list = Array.isArray(_decl) ? _decl : (typeof _decl === "string" ? [_decl] : []);
      for (const _rel of _list) {
        if (typeof _rel !== "string" || !_rel.trim()) continue;
        const _full = _omoxPath.resolve(_pkgDir, _rel);
        if (!_seen.has(_full)) {
          _seen.add(_full);
          _paths.push(_full);
        }
      }
    }
    return _paths;
  } catch {
    return [];
  }
}
`;

export const EXTENSION_SPREAD_SNIPPET = `..._omoxGetPkgExts().flatMap(e => ["--extension", e])`;

/**
 * Modular surgical AST repair for memory model preflight, reflection, and peopleAsk arrays in omo.js.
 *
 * - Uses scanOmoJs from semantic-scanner.mjs to find targets (preflight, reflection, peopleAsk, fork).
 * - If targets are already patched (checkArrayHasExtensionInjection), returns { needed: false, modified: false }.
 * - If targets exist uniquely:
 *   - Injects static standard ESM imports and self-contained helper at top of omo.js:
 *     // @omox-bridge-v2
 *     function _omoxGetPkgExts() { ... }
 *   - Injects `..._omoxGetPkgExts().flatMap(e => ["--extension", e])` into:
 *     - preflight array
 *     - reflection array
 *     - peopleAsk array
 *   - Leaves fork reflection 100% untouched.
 *   - Applies edits in descending offset order.
 *   - Parses patched buffer with @babel/parser to verify syntax.
 *   - Returns { needed: true, modified: true, patchedSource, appliedTargets: ['preflight', 'reflection', 'peopleAsk'] }.
 *
 * @param {string|object} sourceOrOptions
 * @param {object} [options={}]
 * @returns {{ needed: boolean, modified: boolean, patchedSource?: string, appliedTargets?: string[], reason?: string }}
 */
export function repairMemory(sourceOrOptions, options = {}) {
  let sourceCode;
  let filePath = null;
  let shouldWrite = false;

  if (typeof sourceOrOptions === 'string') {
    if (sourceOrOptions.length < 1000 && !sourceOrOptions.includes('\n') && fs.existsSync(sourceOrOptions)) {
      filePath = sourceOrOptions;
      sourceCode = fs.readFileSync(filePath, 'utf-8');
      shouldWrite = Boolean(options.write);
    } else {
      sourceCode = sourceOrOptions;
      filePath = options.filePath || null;
      shouldWrite = Boolean(options.write && filePath);
    }
  } else if (sourceOrOptions && typeof sourceOrOptions === 'object') {
    filePath = sourceOrOptions.filePath || null;
    sourceCode = sourceOrOptions.sourceCode || (filePath ? fs.readFileSync(filePath, 'utf-8') : '');
    shouldWrite = Boolean(sourceOrOptions.write && filePath);
  }

  if (typeof sourceCode !== 'string') {
    throw new TypeError('repairMemory expects sourceCode string or valid options object');
  }

  const scan = scanOmoJs(sourceCode);
  const requiredTargets = ['preflight', 'reflection', 'peopleAsk'];
  const missing = requiredTargets.filter((t) => !scan[t]);

  if (missing.length > 0) {
    return {
      needed: false,
      modified: false,
      reason: `MISSING_TARGETS: ${missing.join(', ')}`,
      appliedTargets: [],
      patchedSource: sourceCode,
    };
  }

  // Check if targets are already patched
  const targetsToPatch = [];
  for (const name of requiredTargets) {
    const target = scan[name];
    const isPatched = target.hasExtensionInjection || checkArrayHasExtensionInjection(target.node, sourceCode);
    if (!isPatched) {
      targetsToPatch.push(name);
    }
  }

  if (targetsToPatch.length === 0) {
    return {
      needed: false,
      modified: false,
      appliedTargets: [],
      patchedSource: sourceCode,
    };
  }

  const edits = [];
  const appliedTargets = [];

  for (const name of targetsToPatch) {
    const target = scan[name];
    const noExtEl = target.node.elements.find(
      (el) => el && el.type === 'StringLiteral' && el.value === '--no-extensions'
    );

    if (noExtEl) {
      edits.push({
        name,
        start: noExtEl.start,
        end: noExtEl.end,
        newText: `"--no-extensions",${EXTENSION_SPREAD_SNIPPET}`,
      });
      appliedTargets.push(name);
    } else {
      edits.push({
        name,
        start: target.node.start + 1,
        end: target.node.start + 1,
        newText: `"--no-extensions",${EXTENSION_SPREAD_SNIPPET},`,
      });
      appliedTargets.push(name);
    }
  }

  // Injects static standard ESM imports and self-contained helper at top of omo.js
  if (!sourceCode.includes('/* @omox-bridge-v2 */') && !sourceCode.includes('_omoxGetPkgExts')) {
    edits.push({
      name: 'header',
      start: 0,
      end: 0,
      newText: OMOX_MEMORY_IMPORTS + OMOX_MEMORY_HELPER,
    });
  }

  // Applies edits in descending offset order
  edits.sort((a, b) => b.start - a.start);

  let patchedSource = sourceCode;
  for (const edit of edits) {
    patchedSource = patchedSource.slice(0, edit.start) + edit.newText + patchedSource.slice(edit.end);
  }

  // Parses patched buffer with @babel/parser to verify syntax
  try {
    parser.parse(patchedSource, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: false,
    });
  } catch (parseErr) {
    const err = new Error(`POST_PATCH_PARSE_ERROR in memory.mjs: ${parseErr.message}`);
    err.code = 'POST_PATCH_PARSE_ERROR';
    err.originalError = parseErr;
    throw err;
  }

  if (shouldWrite && filePath) {
    fs.writeFileSync(filePath, patchedSource, 'utf-8');
  }

  return {
    needed: true,
    modified: true,
    patchedSource,
    appliedTargets,
  };
}

export default repairMemory;
