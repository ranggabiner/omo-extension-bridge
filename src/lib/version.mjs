import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json');

let cachedVersion = null;

/**
 * Returns current omox version from package.json metadata.
 * @returns {string}
 */
export function getOmoxVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    cachedVersion = pkg.version || '2.0.0';
  } catch {
    cachedVersion = '2.0.0';
  }
  return cachedVersion;
}
