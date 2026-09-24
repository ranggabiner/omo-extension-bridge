import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { STATUS, EXIT_CODES, statusToExitCode } from '../src/lib/status.mjs';
import { isSafeMode, checkLaunchSpecPermissions, ensureSafePermissions } from '../src/lib/permissions.mjs';
import { sha256, sha256File, KNOWN_TARGETS, getKnownTarget } from '../src/lib/hashes.mjs';
import { findPackageRoot, resolveEntryFromScript } from '../src/lib/detect-omo.mjs';
import { detectExtensions } from '../src/lib/detect-extensions.mjs';
import { createBackup, restoreBackup, listBackups, getLatestBackupForInstall } from '../src/lib/backup.mjs';
import { inspectTarget, applyPatch } from '../src/lib/patch.mjs';
import { PATCH_DATA } from '../src/lib/patch-data.mjs';
import { runVerify } from '../src/verify.mjs';
import { runApply } from '../src/apply.mjs';
import { runRollback } from '../src/rollback.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed++;
  }
}

console.log('Running omox unit and smoke tests...\n');

// 1. Status and exit codes
test('statusToExitCode maps all standard statuses to documented exit codes', () => {
  assert.equal(statusToExitCode(STATUS.NATIVE_OK), EXIT_CODES.SUCCESS);
  assert.equal(statusToExitCode(STATUS.PATCHED_OK), EXIT_CODES.SUCCESS);
  assert.equal(statusToExitCode(STATUS.NEEDS_PATCH), EXIT_CODES.NEEDS_PATCH);
  assert.equal(statusToExitCode(STATUS.INCOMPATIBLE), EXIT_CODES.INCOMPATIBLE);
  assert.equal(statusToExitCode(STATUS.VERIFY_FAILED), EXIT_CODES.VERIFY_FAILED);
  assert.equal(statusToExitCode('UNKNOWN'), EXIT_CODES.CLI_ERROR);
});

// 2. Safe permission validation
test('isSafeMode enforces (mode & 0o022) === 0', () => {
  assert.equal(isSafeMode(0o644), true);
  assert.equal(isSafeMode(0o600), true);
  assert.equal(isSafeMode(0o400), true);
  assert.equal(isSafeMode(0o664), false, 'Group-writable mode 0664 must be rejected');
  assert.equal(isSafeMode(0o666), false, 'World-writable mode 0666 must be rejected');
  assert.equal(isSafeMode(0o777), false, '0777 must be rejected');
});

test('checkLaunchSpecPermissions and ensureSafePermissions work on filesystem', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-perm-'));
  try {
    const specFile = path.join(tmpDir, 'daemon-launch-spec.json');
    fs.writeFileSync(specFile, '{"test":true}', { mode: 0o664 });

    const check1 = checkLaunchSpecPermissions(specFile);
    assert.equal(check1.exists, true);
    assert.equal(check1.isSafe, false);
    assert.equal(check1.modeOctal, '0664');

    const updateRes = ensureSafePermissions(specFile, 0o644);
    assert.equal(updateRes.modified, true);
    assert.equal(updateRes.previousMode, 0o664);
    assert.equal(updateRes.newMode, 0o644);

    const check2 = checkLaunchSpecPermissions(specFile);
    assert.equal(check2.isSafe, true);
    assert.equal(check2.modeOctal, '0644');

    // Running ensure again should be a no-op
    const updateRes2 = ensureSafePermissions(specFile, 0o644);
    assert.equal(updateRes2.modified, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 3. Hashes and signatures
test('sha256 and sha256File compute accurate cryptographic digests', () => {
  assert.equal(
    sha256('hello world'),
    'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-hash-'));
  try {
    const f = path.join(tmpDir, 'sample.txt');
    fs.writeFileSync(f, 'hello world');
    assert.equal(
      sha256File(f),
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
    );
    assert.equal(sha256File(path.join(tmpDir, 'nonexistent.txt')), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('KNOWN_TARGETS contains target definition for 5.0.0-0.beta.88', () => {
  const target = getKnownTarget('5.0.0-0.beta.88');
  assert.ok(target, 'Target definition must exist');
  assert.ok(target.files['plugin/extensions/omo-task.js']);
  assert.ok(target.files['bin/lib/engine-prepare.js']);
  assert.equal(
    target.files['plugin/extensions/omo-task.js'].unpatchedHash,
    '77b6747d35aa92e8618e4fe011dac36eddbfd4fe6edfbb2ad39ceb0639f63562'
  );
  assert.equal(
    target.files['plugin/extensions/omo-task.js'].patchedHash,
    '868cfbe5a066f47cf5aff27c1f93a3ba6e398306dae7e3cb44410ba9cf309202'
  );
  assert.equal(
    target.files['bin/lib/engine-prepare.js'].unpatchedHash,
    'b66b1c9c3418db58e0d4c03f3b43192ccba1bdd5f26633121ece82d8e207ddcb'
  );
  assert.equal(
    target.files['bin/lib/engine-prepare.js'].patchedHash,
    'c1a5bdfe09c3089c8ad5aa9e80b55e4eaeb6a05394e896249e60be86a043e53f'
  );
});

// 4. OmO path detection seams
test('findPackageRoot detects omo-ai package root ascending directory tree', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-detect-'));
  try {
    const pkgRoot = path.join(tmpDir, 'mock-omo');
    const binDir = path.join(pkgRoot, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: 'omo-ai', version: '5.0.0-test' })
    );
    fs.writeFileSync(path.join(binDir, 'omo.js'), '// omo entrypoint');

    const found = findPackageRoot(binDir);
    assert.ok(found);
    assert.equal(found.root, pkgRoot);
    assert.equal(found.pkg.name, 'omo-ai');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveEntryFromScript parses Bun launcher shim header', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-shim-'));
  try {
    const targetScript = path.join(tmpDir, 'real-entry.js');
    fs.writeFileSync(targetScript, '// real entry');

    const shimScript = path.join(tmpDir, 'omo-shim');
    fs.writeFileSync(
      shimScript,
      `#!/bin/sh\n# entry: ${targetScript}\nexec node "${targetScript}" "$@"\n`
    );

    const resolved = resolveEntryFromScript(shimScript);
    assert.equal(resolved, targetScript);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 5. Generic extension detection
test('detectExtensions identifies package extensions without reading credentials', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-exts-'));
  try {
    const agentDir = path.join(tmpDir, 'agent');
    const pkgDir = path.join(agentDir, 'npm', 'node_modules', 'pi-custom-prov');
    fs.mkdirSync(pkgDir, { recursive: true });

    fs.writeFileSync(
      path.join(agentDir, 'settings.json'),
      JSON.stringify({
        packages: ['npm:pi-custom-prov'],
      })
    );

    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({
        name: 'pi-custom-prov',
        version: '1.2.3',
        pi: {
          extensions: ['./src/index.ts'],
        },
      })
    );

    // Write fake credentials file to verify it is NOT touched
    fs.writeFileSync(path.join(agentDir, 'auth.json'), '{"SECRET":"SHOULD_NOT_LEAK"}');

    const exts = detectExtensions({ agentDir });
    assert.equal(exts.packages.length, 1);
    assert.equal(exts.packages[0].name, 'pi-custom-prov');
    assert.equal(exts.packages[0].version, '1.2.3');
    assert.equal(
      exts.packages[0].extensions[0],
      path.join(pkgDir, 'src', 'index.ts')
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 6. External backup and rollback restoration
await testAsync('createBackup creates isolated external backups and restoreBackup restores exactly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-bk-'));
  try {
    const pkgRoot = path.join(tmpDir, 'mock-pkg');
    const backupRoot = path.join(tmpDir, 'external-backups');
    fs.mkdirSync(path.join(pkgRoot, 'subdir'), { recursive: true });

    const fileA = path.join(pkgRoot, 'fileA.txt');
    const fileB = path.join(pkgRoot, 'subdir', 'fileB.txt');
    fs.writeFileSync(fileA, 'initial content A', { mode: 0o644 });
    fs.writeFileSync(fileB, 'initial content B', { mode: 0o600 });

    const initialHashA = sha256File(fileA);
    const initialHashB = sha256File(fileB);

    const backup = createBackup({
      omoPackageRoot: pkgRoot,
      omoVersion: '5.0.0-mock',
      filesToBackup: [fileA, 'subdir/fileB.txt'],
      backupRootDir: backupRoot,
    });

    assert.ok(fs.existsSync(backup.backupDir));
    const manifestPath = path.join(backup.backupDir, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath));

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.equal(manifest.omoVersion, '5.0.0-mock');
    assert.equal(manifest.files.length, 2);

    // Modify original files
    fs.writeFileSync(fileA, 'MODIFIED content A');
    fs.writeFileSync(fileB, 'MODIFIED content B');
    assert.notEqual(sha256File(fileA), initialHashA);

    // Test listBackups and getLatestBackupForInstall
    const latest = getLatestBackupForInstall({
      omoPackageRoot: pkgRoot,
      omoVersion: '5.0.0-mock',
      backupRootDir: backupRoot,
    });
    assert.ok(latest);
    assert.equal(latest.backupDir, backup.backupDir);

    // Restore backup
    const restoreRes = restoreBackup(backup.backupDir);
    assert.equal(restoreRes.restoredFiles.length, 2);

    // Check restored files match original hashes and modes
    assert.equal(sha256File(fileA), initialHashA);
    assert.equal(sha256File(fileB), initialHashB);
    assert.equal(fs.statSync(fileA).mode & 0o777, 0o644);
    assert.equal(fs.statSync(fileB).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 7. Fail-closed: INCOMPATIBLE performs zero writes
await testAsync('runApply performs zero writes when installation is INCOMPATIBLE', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-incompat-'));
  try {
    const pkgRoot = path.join(tmpDir, 'mock-unknown-pkg');
    fs.mkdirSync(path.join(pkgRoot, 'plugin', 'extensions'), { recursive: true });
    fs.writeFileSync(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: 'omo-ai', version: '9.9.9-unknown' })
    );
    const taskPath = path.join(pkgRoot, 'plugin', 'extensions', 'omo-task.js');
    fs.writeFileSync(taskPath, '// unexpected content');

    const res = await runApply({
      omoPackageRoot: pkgRoot,
      skipRuntimeTest: true,
    });

    assert.equal(res.status, STATUS.INCOMPATIBLE);
    assert.equal(res.modified, false);
    assert.equal(fs.readFileSync(taskPath, 'utf-8'), '// unexpected content');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 8. Fail-closed: NATIVE_OK performs zero writes
await testAsync('runApply performs zero writes when installation is NATIVE_OK', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-native-'));
  try {
    const pkgRoot = path.join(tmpDir, 'mock-native-pkg');
    fs.mkdirSync(path.join(pkgRoot, 'plugin', 'extensions'), { recursive: true });
    fs.writeFileSync(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: 'omo-ai', version: '6.0.0-future' })
    );
    const taskPath = path.join(pkgRoot, 'plugin', 'extensions', 'omo-task.js');
    fs.writeFileSync(
      taskPath,
      '// future native code\nfunction test() { resolveInheritedExtensions(); }'
    );
    const daemonSpec = path.join(pkgRoot, 'plugin', 'daemon-launch-spec.json');
    fs.writeFileSync(daemonSpec, '{}', { mode: 0o644 });

    const res = await runApply({
      omoPackageRoot: pkgRoot,
      skipRuntimeTest: true,
    });

    assert.equal(res.status, STATUS.NATIVE_OK);
    assert.equal(res.modified, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 9. Fail-closed: unknown signatures on a known version are rejected and never patched
await testAsync('applyPatch rejects modified files with unknown signatures on a known version', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-bad-sig-'));
  try {
    const pkgRoot = path.join(tmpDir, 'omo-ai');
    fs.mkdirSync(path.join(pkgRoot, 'plugin', 'extensions'), { recursive: true });
    fs.mkdirSync(path.join(pkgRoot, 'bin', 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: 'omo-ai', version: '5.0.0-0.beta.88' })
    );
    fs.writeFileSync(
      path.join(pkgRoot, 'plugin', 'extensions', 'omo-task.js'),
      '// corrupted minified file that does not match anchors'
    );
    fs.writeFileSync(
      path.join(pkgRoot, 'bin', 'lib', 'engine-prepare.js'),
      '// also corrupted'
    );

    const inspect = inspectTarget(pkgRoot, '5.0.0-0.beta.88');
    assert.equal(inspect.status, STATUS.INCOMPATIBLE);

    assert.throws(() => {
      applyPatch(pkgRoot, '5.0.0-0.beta.88');
    }, /Cannot apply patch: installation is not in NEEDS_PATCH state/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 10. End-to-end Apply -> Verify -> Rollback transaction cycle on unpatched fixture
await testAsync('End-to-end Apply -> Verify -> Rollback transaction on unpatched OmO fixture', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-e2e-'));
  try {
    const pkgRoot = path.join(tmpDir, 'omo-ai');
    const agentDir = path.join(tmpDir, 'agent');
    const backupRoot = path.join(tmpDir, 'backups');

    fs.mkdirSync(path.join(pkgRoot, 'plugin', 'extensions'), { recursive: true });
    fs.mkdirSync(path.join(pkgRoot, 'bin', 'lib'), { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });

    // Write package.json
    fs.writeFileSync(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: 'omo-ai', version: '5.0.0-0.beta.88' })
    );

    // Read real unpatched reference files from the current system
    const refBakPath = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai/plugin/extensions/omo-task.js.bak';
    const installedEpPath = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai/bin/lib/engine-prepare.js';
    if (!fs.existsSync(refBakPath) || !fs.existsSync(installedEpPath)) {
      console.log('Skipping e2e fixture test: reference files not found on machine');
      return;
    }

    const unpatchedTaskContent = fs.readFileSync(refBakPath, 'utf-8');

    // Invert the 3 engine-prepare hunks from installedEp to get the exact unpatched cleanEp
    let cleanEpContent = fs.readFileSync(installedEpPath, 'utf-8');
    for (const h of PATCH_DATA['5.0.0-0.beta.88']['bin/lib/engine-prepare.js']) {
      cleanEpContent = cleanEpContent.replace(h.newText, h.oldText);
    }

    const taskFile = path.join(pkgRoot, 'plugin', 'extensions', 'omo-task.js');
    const epFile = path.join(pkgRoot, 'bin', 'lib', 'engine-prepare.js');
    const daemonFile = path.join(pkgRoot, 'plugin', 'daemon-launch-spec.json');

    fs.writeFileSync(taskFile, unpatchedTaskContent, { mode: 0o644 });
    fs.writeFileSync(epFile, cleanEpContent, { mode: 0o644 });
    // Simulate insecure daemon launch spec (0664)
    fs.writeFileSync(daemonFile, '{"command":"node"}', { mode: 0o664 });

    const initialTaskHash = sha256File(taskFile);
    const initialEpHash = sha256File(epFile);
    assert.equal(initialTaskHash, '77b6747d35aa92e8618e4fe011dac36eddbfd4fe6edfbb2ad39ceb0639f63562');
    assert.equal(initialEpHash, 'b66b1c9c3418db58e0d4c03f3b43192ccba1bdd5f26633121ece82d8e207ddcb');

    // 1. Verify before apply: must be NEEDS_PATCH
    const v1 = await runVerify({
      omoPackageRoot: pkgRoot,
      agentDir,
      skipRuntimeTest: true,
    });
    assert.equal(v1.status, STATUS.NEEDS_PATCH, 'Unpatched fixture must report NEEDS_PATCH');

    // 2. Apply: should create backup, patch files, fix permissions, and succeed
    const applyRes = await runApply({
      omoPackageRoot: pkgRoot,
      agentDir,
      backupRootDir: backupRoot,
      skipRuntimeTest: true,
    });
    assert.equal(applyRes.status, STATUS.PATCHED_OK);
    assert.equal(applyRes.modified, true);
    assert.ok(applyRes.backupDir);

    // Verify file hashes after apply match expected patched hashes
    assert.equal(
      sha256File(taskFile),
      '868cfbe5a066f47cf5aff27c1f93a3ba6e398306dae7e3cb44410ba9cf309202'
    );
    assert.equal(
      sha256File(epFile),
      'c1a5bdfe09c3089c8ad5aa9e80b55e4eaeb6a05394e896249e60be86a043e53f'
    );
    assert.equal(fs.statSync(daemonFile).mode & 0o777, 0o644, 'Permissions must be 0644');

    // 3. Verify after apply: must be PATCHED_OK
    const v2 = await runVerify({
      omoPackageRoot: pkgRoot,
      agentDir,
      skipRuntimeTest: true,
    });
    assert.equal(v2.status, STATUS.PATCHED_OK, 'Patched fixture must report PATCHED_OK');

    // 4. Rollback: should restore the exact unpatched state and permissions
    const rollbackRes = await runRollback({
      omoPackageRoot: pkgRoot,
      agentDir,
      backupRootDir: backupRoot,
    });
    assert.equal(rollbackRes.success, true);
    assert.equal(rollbackRes.exitCode, EXIT_CODES.SUCCESS);

    // Verify restored hashes match initial unpatched files exactly
    assert.equal(sha256File(taskFile), initialTaskHash);
    assert.equal(sha256File(epFile), initialEpHash);
    assert.equal(fs.statSync(daemonFile).mode & 0o777, 0o664, 'Original 0664 mode must be restored');

    // 5. Verify after rollback: must return to NEEDS_PATCH
    const v3 = await runVerify({
      omoPackageRoot: pkgRoot,
      agentDir,
      skipRuntimeTest: true,
    });
    assert.equal(v3.status, STATUS.NEEDS_PATCH, 'Rolled-back fixture must return to NEEDS_PATCH');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Run all tests
console.log(`\nTest suite finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
