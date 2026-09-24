import fs from 'node:fs';
import path from 'node:path';

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
 * Detect package-managed extensions, CLI extensions, and internal OmO extensions.
 *
 * @param {object} params
 * @param {string} params.agentDir
 * @param {string} [params.omoPackageRoot]
 * @returns {{
 *   packages: Array<{ raw: string, name: string, version: string, installedPath: string, extensions: string[] }>,
 *   hasAntigravity: boolean,
 *   antigravityModel: string|null,
 *   antigravityEntry: string|null,
 *   internalExtensions: string[],
 *   configuredModels: string[]
 * }}
 */
export function detectExtensions({ agentDir, omoPackageRoot }) {
  const packages = [];
  const settingsPath = path.join(agentDir, 'settings.json');

  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const rawPackages = Array.isArray(settings.packages) ? settings.packages : [];

      for (const raw of rawPackages) {
        if (typeof raw !== 'string') continue;
        const cleanName = raw.replace(/^(npm|git|file):/, '');
        const pkgDir = path.join(agentDir, 'npm', 'node_modules', cleanName);
        const pkgJsonPath = path.join(pkgDir, 'package.json');

        if (fs.existsSync(pkgJsonPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
            const declaredExts = pkg.pi?.extensions || (pkg.main ? [pkg.main] : []);
            const exts = declaredExts.map((e) => path.resolve(pkgDir, e));

            packages.push({
              raw,
              name: cleanName,
              version: pkg.version || 'unknown',
              installedPath: pkgDir,
              extensions: exts,
            });
          } catch {
            packages.push({
              raw,
              name: cleanName,
              version: 'unreadable',
              installedPath: pkgDir,
              extensions: [],
            });
          }
        }
      }
    } catch {}
  }

  // Find internal extensions if omoPackageRoot is provided
  const internalExtensions = [];
  if (omoPackageRoot) {
    const pluginExtDir = path.join(omoPackageRoot, 'plugin', 'extensions');
    if (fs.existsSync(pluginExtDir)) {
      try {
        const files = fs.readdirSync(pluginExtDir);
        for (const file of files) {
          if (file.endsWith('.js') && !file.endsWith('.bak')) {
            internalExtensions.push(path.join(pluginExtDir, file));
          }
        }
      } catch {}
    }
  }

  // Detect Antigravity package and configured model
  const agPackage = packages.find((p) => p.name === 'pi-antigravity');
  const hasAntigravity = Boolean(agPackage);
  let antigravityEntry = null;
  if (agPackage && agPackage.extensions.length > 0) {
    antigravityEntry = agPackage.extensions[0];
  }

  // Discover configured models from omo.jsonc or settings.json
  const configuredModels = [];
  let antigravityModel = null;

  const omoJsoncPath = path.join(path.dirname(agentDir), 'omo.jsonc');
  if (fs.existsSync(omoJsoncPath)) {
    try {
      const content = fs.readFileSync(omoJsoncPath, 'utf-8');
      const stripped = stripJsoncComments(content);
      // Scan for model patterns
      const modelRegex = /"model":\s*"([^"]+)"/g;
      let match;
      while ((match = modelRegex.exec(stripped)) !== null) {
        const m = match[1];
        if (!configuredModels.includes(m)) {
          configuredModels.push(m);
        }
        if (!antigravityModel && m.startsWith('antigravity/')) {
          antigravityModel = m;
        }
      }
    } catch {}
  }

  if (hasAntigravity && !antigravityModel) {
    // Default known fallback model
    antigravityModel = 'antigravity/gemini-3.8-flash';
  }

  return {
    packages,
    hasAntigravity,
    antigravityModel,
    antigravityEntry,
    internalExtensions,
    configuredModels,
  };
}
