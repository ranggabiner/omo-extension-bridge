import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Compute SHA-256 hash of a string or buffer.
 * @param {string|Buffer} data
 * @returns {string} hex digest
 */
export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Compute SHA-256 hash of a file.
 * @param {string} filePath
 * @returns {string|null} hex digest or null if file does not exist
 */
export function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return sha256(content);
}

/**
 * Registry of known OmO versions and target files with exact hashes and structural anchors.
 */
export const KNOWN_TARGETS = Object.freeze({
  '5.0.0-0.beta.88': {
    version: '5.0.0-0.beta.88',
    description: 'OmO Native 5.0.0-0.beta.88 on @code-yeongyu/senpi 2026.9.23-5',
    files: {
      'plugin/extensions/omo-task.js': {
        unpatchedHash: '77b6747d35aa92e8618e4fe011dac36eddbfd4fe6edfbb2ad39ceb0639f63562',
        patchedHash: '868cfbe5a066f47cf5aff27c1f93a3ba6e398306dae7e3cb44410ba9cf309202',
        unpatchedAnchor: '(e.extensions??[]).slice(1):e.extensions??[];for(let e of n)e.length>0&&t.push("--extension",e);',
        patchedAnchor: '(e.extensions??[]).filter(e=>_w(e)!==z_):e.extensions??[];for(let e of[...new Set(n)])e.length>0&&t.push("--extension",e);',
        nativeIndicator: 'resolveInheritedExtensions',
      },
      'bin/lib/engine-prepare.js': {
        unpatchedHash: 'b66b1c9c3418db58e0d4c03f3b43192ccba1bdd5f26633121ece82d8e207ddcb',
        patchedHash: 'c1a5bdfe09c3089c8ad5aa9e80b55e4eaeb6a05394e896249e60be86a043e53f',
        unpatchedAnchor: 'export function prepareInstalledEngine(senpiRoot) {\n  floorClaudeCodeVersion(senpiRoot)',
        patchedAnchor: 'export function ensureLaunchSpecPermissions() {',
        nativeIndicator: 'ensureLaunchSpecPermissions',
      },
    },
    daemonSpecRelativePath: 'plugin/daemon-launch-spec.json',
  },
});

/**
 * Lookup known target definition for an OmO version.
 * @param {string} version
 * @returns {object|null}
 */
export function getKnownTarget(version) {
  if (!version) return null;
  return KNOWN_TARGETS[version] || null;
}
