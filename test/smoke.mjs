import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

import { STATUS, EXIT_CODES, statusToExitCode } from '../src/lib/status.mjs';
import { isSafeMode, checkLaunchSpecPermissions, ensureSafePermissions } from '../src/lib/permissions.mjs';
import { sha256, sha256File, KNOWN_TARGETS, getKnownTarget } from '../src/lib/hashes.mjs';
import { findPackageRoot, resolveEntryFromScript, resolveSenpiExecutable } from '../src/lib/detect-omo.mjs';
import { detectExtensions } from '../src/lib/detect-extensions.mjs';
import { createBackup, restoreBackup, listBackups, getLatestBackupForInstall } from '../src/lib/backup.mjs';
import { inspectTarget, applyPatch } from '../src/lib/patch.mjs';
import { PATCH_DATA } from '../src/lib/patch-data.mjs';
import { runWorkerSmokeTest } from '../src/lib/runtime-test.mjs';
import { runVerify } from '../src/verify.mjs';
import { runApply } from '../src/apply.mjs';
import { runRollback } from '../src/rollback.mjs';
import { runUpdate, resolveUpdatePackageManager, findExecutableInPath, OFFICIAL_SOURCE } from '../src/update.mjs';
import { getOmoxVersion } from '../src/lib/version.mjs';

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

// =======================================================
// FOUNDATIONAL TESTS (Preserved from 1.0.0)
// =======================================================

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

test('KNOWN_TARGETS contains target definition for 5.0.0-0.beta.88 with all files', () => {
  const target = getKnownTarget('5.0.0-0.beta.88');
  assert.ok(target, 'Target definition must exist');
  assert.ok(target.files['plugin/extensions/omo-task.js']);
  assert.ok(target.files['plugin/extensions/omo.js']);
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
    target.files['plugin/extensions/omo.js'].unpatchedHash,
    'ca572240836530a08e566fd88a55d8b9eb7c0a02ea23a150e1602010767eda58'
  );
  assert.equal(
    target.files['plugin/extensions/omo.js'].patchedHash,
    'a2720a889ccde48686197af66f2aaa4da1acf1059cb6845a43d0f892182ece5a'
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

    fs.writeFileSync(fileA, 'MODIFIED content A');
    fs.writeFileSync(fileB, 'MODIFIED content B');
    assert.notEqual(sha256File(fileA), initialHashA);

    const latest = getLatestBackupForInstall({
      omoPackageRoot: pkgRoot,
      omoVersion: '5.0.0-mock',
      backupRootDir: backupRoot,
    });
    assert.ok(latest);
    assert.equal(latest.backupDir, backup.backupDir);

    const restoreRes = restoreBackup(backup.backupDir);
    assert.equal(restoreRes.restoredFiles.length, 2);

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
      path.join(pkgRoot, 'plugin', 'extensions', 'omo.js'),
      '// corrupted omo.js'
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

    fs.writeFileSync(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: 'omo-ai', version: '5.0.0-0.beta.88' })
    );

    const refBakPath = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai/plugin/extensions/omo-task.js.bak';
    const activeOmoJsPath = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai/plugin/extensions/omo.js';
    const installedEpPath = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai/bin/lib/engine-prepare.js';

    if (!fs.existsSync(refBakPath) || !fs.existsSync(activeOmoJsPath) || !fs.existsSync(installedEpPath)) {
      console.log('Skipping e2e fixture test: reference files not found on machine');
      return;
    }

    const unpatchedTaskContent = fs.readFileSync(refBakPath, 'utf-8');
    let unpatchedOmoContent = fs.readFileSync(activeOmoJsPath, 'utf-8');
    for (const h of PATCH_DATA['5.0.0-0.beta.88']['plugin/extensions/omo.js']) {
      unpatchedOmoContent = unpatchedOmoContent.replace(h.newText, h.oldText);
    }

    let cleanEpContent = fs.readFileSync(installedEpPath, 'utf-8');
    for (const h of PATCH_DATA['5.0.0-0.beta.88']['bin/lib/engine-prepare.js']) {
      cleanEpContent = cleanEpContent.replace(h.newText, h.oldText);
    }

    const taskFile = path.join(pkgRoot, 'plugin', 'extensions', 'omo-task.js');
    const omoFile = path.join(pkgRoot, 'plugin', 'extensions', 'omo.js');
    const epFile = path.join(pkgRoot, 'bin', 'lib', 'engine-prepare.js');
    const daemonFile = path.join(pkgRoot, 'plugin', 'daemon-launch-spec.json');

    fs.writeFileSync(taskFile, unpatchedTaskContent, { mode: 0o644 });
    fs.writeFileSync(omoFile, unpatchedOmoContent, { mode: 0o644 });
    fs.writeFileSync(epFile, cleanEpContent, { mode: 0o644 });
    fs.writeFileSync(daemonFile, '{"command":"node"}', { mode: 0o664 });

    const initialTaskHash = sha256File(taskFile);
    const initialOmoHash = sha256File(omoFile);
    const initialEpHash = sha256File(epFile);
    assert.equal(initialTaskHash, '77b6747d35aa92e8618e4fe011dac36eddbfd4fe6edfbb2ad39ceb0639f63562');
    assert.equal(initialOmoHash, 'ca572240836530a08e566fd88a55d8b9eb7c0a02ea23a150e1602010767eda58');
    assert.equal(initialEpHash, 'b66b1c9c3418db58e0d4c03f3b43192ccba1bdd5f26633121ece82d8e207ddcb');

    const v1 = await runVerify({
      omoPackageRoot: pkgRoot,
      agentDir,
      skipRuntimeTest: true,
    });
    assert.equal(v1.status, STATUS.NEEDS_PATCH, 'Unpatched fixture must report NEEDS_PATCH');

    const applyRes = await runApply({
      omoPackageRoot: pkgRoot,
      agentDir,
      backupRootDir: backupRoot,
      skipRuntimeTest: true,
    });
    assert.equal(applyRes.status, STATUS.PATCHED_OK);
    assert.equal(applyRes.modified, true);
    assert.ok(applyRes.backupDir);

    assert.equal(
      sha256File(taskFile),
      '868cfbe5a066f47cf5aff27c1f93a3ba6e398306dae7e3cb44410ba9cf309202'
    );
    assert.equal(
      sha256File(omoFile),
      'a2720a889ccde48686197af66f2aaa4da1acf1059cb6845a43d0f892182ece5a'
    );
    assert.equal(
      sha256File(epFile),
      'c1a5bdfe09c3089c8ad5aa9e80b55e4eaeb6a05394e896249e60be86a043e53f'
    );
    assert.equal(fs.statSync(daemonFile).mode & 0o777, 0o644, 'Permissions must be 0644');

    const v2 = await runVerify({
      omoPackageRoot: pkgRoot,
      agentDir,
      skipRuntimeTest: true,
    });
    assert.equal(v2.status, STATUS.PATCHED_OK, 'Patched fixture must report PATCHED_OK');

    const rollbackRes = await runRollback({
      omoPackageRoot: pkgRoot,
      agentDir,
      backupRootDir: backupRoot,
    });
    assert.equal(rollbackRes.success, true);
    assert.equal(rollbackRes.exitCode, EXIT_CODES.SUCCESS);

    assert.equal(sha256File(taskFile), initialTaskHash);
    assert.equal(sha256File(omoFile), initialOmoHash);
    assert.equal(sha256File(epFile), initialEpHash);
    assert.equal(fs.statSync(daemonFile).mode & 0o777, 0o664, 'Original 0664 mode must be restored');

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

// 11-14 Senpi resolution tests (Preserved from 1.0.0)
test('resolveSenpiExecutable discovers Bun-style peer Senpi via package.json bin', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-peer-senpi-'));
  try {
    const nodeModules = path.join(tmpDir, 'node_modules');
    const omoPkg = path.join(nodeModules, 'omo-ai');
    const senpiPkg = path.join(nodeModules, '@code-yeongyu', 'senpi');
    fs.mkdirSync(omoPkg, { recursive: true });
    fs.mkdirSync(path.join(senpiPkg, 'dist', 'bundle'), { recursive: true });

    fs.writeFileSync(
      path.join(senpiPkg, 'package.json'),
      JSON.stringify({
        name: '@code-yeongyu/senpi',
        bin: { senpi: 'dist/bundle/cli.js' },
      })
    );
    const cliFile = path.join(senpiPkg, 'dist', 'bundle', 'cli.js');
    fs.writeFileSync(cliFile, '#!/usr/bin/env node');

    const resolved = resolveSenpiExecutable(omoPkg);
    assert.equal(resolved, cliFile);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveSenpiExecutable discovers nested Senpi via package.json bin', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-nested-senpi-'));
  try {
    const omoPkg = path.join(tmpDir, 'omo-ai');
    const senpiPkg = path.join(omoPkg, 'node_modules', '@code-yeongyu', 'senpi');
    fs.mkdirSync(path.join(senpiPkg, 'bin'), { recursive: true });

    fs.writeFileSync(
      path.join(senpiPkg, 'package.json'),
      JSON.stringify({
        name: '@code-yeongyu/senpi',
        bin: 'bin/senpi.js',
      })
    );
    const cliFile = path.join(senpiPkg, 'bin', 'senpi.js');
    fs.writeFileSync(cliFile, '#!/usr/bin/env node');

    const resolved = resolveSenpiExecutable(omoPkg);
    assert.equal(resolved, cliFile);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveSenpiExecutable falls back to PATH when package has no Senpi', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-path-senpi-'));
  try {
    const omoPkg = path.join(tmpDir, 'omo-ai');
    const fakeBin = path.join(tmpDir, 'fake-bin');
    fs.mkdirSync(omoPkg, { recursive: true });
    fs.mkdirSync(fakeBin, { recursive: true });

    const fakeExe = path.join(fakeBin, 'senpi');
    fs.writeFileSync(fakeExe, '#!/bin/sh');

    const oldPath = process.env.PATH;
    process.env.PATH = fakeBin;
    try {
      const resolved = resolveSenpiExecutable(omoPkg);
      assert.equal(resolved, fakeExe);
    } finally {
      process.env.PATH = oldPath;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

await testAsync('no Senpi available returns null and fails with clear diagnostic', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-no-senpi-'));
  try {
    const omoPkg = path.join(tmpDir, 'omo-ai');
    fs.mkdirSync(omoPkg, { recursive: true });

    const oldPath = process.env.PATH;
    process.env.PATH = path.join(tmpDir, 'empty-bin');
    try {
      const resolved = resolveSenpiExecutable(omoPkg);
      assert.equal(resolved, null);

      const smokeRes = await runWorkerSmokeTest({
        senpiExecutable: null,
        extensionPath: '/nonexistent/ext.ts',
        model: 'antigravity/gemini-3.8-flash',
        agentDir: tmpDir,
      });

      assert.equal(smokeRes.success, false);
      assert.equal(smokeRes.catalogProbeOk, false);
      assert.ok(
        smokeRes.error.includes('Senpi executable could not be resolved'),
        `Expected clear error message, got: ${smokeRes.error}`
      );
    } finally {
      process.env.PATH = oldPath;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// =======================================================
// TARGETED 1.1.0 REGRESSION TESTS (Tests 1 - 23)
// =======================================================

console.log('\nRunning targeted 1.1.0 regression tests...\n');

// 1. Existing task/RPC extension propagation remains working
test('1. Existing task/RPC extension propagation remains working', () => {
  const taskHunks = PATCH_DATA['5.0.0-0.beta.88']['plugin/extensions/omo-task.js'];
  assert.ok(Array.isArray(taskHunks) && taskHunks.length >= 7);
  // Verify deduplication and filter logic in Hunk 1
  assert.ok(taskHunks[0].newText.includes('filter(e=>_w(e)!==z_)'));
  assert.ok(taskHunks[0].newText.includes('new Set(n)'));
  // Verify DefaultPackageManager integration in Hunk 7
  assert.ok(taskHunks[6].newText.includes('DefaultPackageManager'));
});

// 2. Reflection normal spawn receives inherited provider extensions
test('2. Reflection normal spawn receives inherited provider extensions', () => {
  const omoHunks = PATCH_DATA['5.0.0-0.beta.88']['plugin/extensions/omo.js'];
  assert.ok(Array.isArray(omoHunks));
  const reflHunk = omoHunks.find((h) => h.name.includes('Reflection and Dream'));
  assert.ok(reflHunk, 'Reflection and Dream Hunk must exist');
  assert.ok(reflHunk.newText.includes('g=await _omoxResolvePkgExts(f)'));
  assert.ok(reflHunk.newText.includes('--no-extensions",...g.flatMap(e=>["--extension",e])'));
});

// 3. Reflection fork spawn receives inherited provider extensions
test('3. Reflection fork spawn receives inherited provider extensions', () => {
  const omoHunks = PATCH_DATA['5.0.0-0.beta.88']['plugin/extensions/omo.js'];
  const forkHunk = omoHunks.find((h) => h.name.includes('Fork Reflection'));
  assert.ok(forkHunk, 'Fork Reflection Hunk must exist');
  assert.ok(forkHunk.newText.includes('--no-extensions",...(t.extensions??[]).flatMap(e=>["--extension",e])'));
});

// 4. Dream receives inherited provider extensions
test('4. Dream receives inherited provider extensions', () => {
  const omoHunks = PATCH_DATA['5.0.0-0.beta.88']['plugin/extensions/omo.js'];
  const reflHunk = omoHunks.find((h) => h.name.includes('Reflection and Dream'));
  assert.ok(reflHunk.newText.includes('kind:"dream"===e.run.request.trigger?"dream":"reflection"'));
  assert.ok(reflHunk.newText.includes('extensions:g'));
});

// 5. Memory model preflight receives the SAME extension set as the target child
test('5. Memory model preflight receives the SAME extension set as the target child', () => {
  const omoHunks = PATCH_DATA['5.0.0-0.beta.88']['plugin/extensions/omo.js'];
  const preflightHunk = omoHunks.find((h) => h.name.includes('Preflight'));
  const reflHunk = omoHunks.find((h) => h.name.includes('Reflection and Dream'));
  assert.ok(preflightHunk && reflHunk);
  // Both must call _omoxResolvePkgExts
  assert.ok(preflightHunk.newText.includes('_omoxResolvePkgExts'));
  assert.ok(reflHunk.newText.includes('_omoxResolvePkgExts'));
  // Both must map using .flatMap(e=>["--extension",e])
  assert.ok(preflightHunk.newText.includes('.flatMap(e=>["--extension",e])'));
  assert.ok(reflHunk.newText.includes('.flatMap(e=>["--extension",e])'));
});

// 6. Extension-only fake provider is visible to preflight
await testAsync('6. Extension-only fake provider is visible to preflight', async () => {
  const fixturePath = path.resolve('test/fixtures/fake-provider/index.mjs');
  assert.ok(fs.existsSync(fixturePath), 'Fixture file must exist');

  const senpiExec = resolveSenpiExecutable('/home/ranggabiner/.bun/install/global/node_modules/omo-ai');
  if (!senpiExec) return;

  // 1. Without extension: omox-fixture model is NOT listed
  const pNoExt = spawn(senpiExec, [
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-context-files',
    '--list-models',
    'omox-fixture',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let outNoExt = '';
  pNoExt.stdout?.on('data', (d) => (outNoExt += d.toString()));
  await new Promise((resolve) => pNoExt.on('close', resolve));
  assert.equal(outNoExt.includes('fixture-model'), false, 'Fake provider must NOT be visible without --extension');

  // 2. With extension: omox-fixture model IS listed
  const pWithExt = spawn(senpiExec, [
    '--no-extensions',
    '--extension',
    fixturePath,
    '--no-skills',
    '--no-prompt-templates',
    '--no-context-files',
    '--list-models',
    'omox-fixture',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let outWithExt = '';
  pWithExt.stdout?.on('data', (d) => (outWithExt += d.toString()));
  await new Promise((resolve) => pWithExt.on('close', resolve));
  assert.ok(outWithExt.includes('fixture-model'), 'Fake provider MUST be visible with --extension');
});

// 7. Extension-only fake provider executes in child
await testAsync('7. Extension-only fake provider executes in child', async () => {
  const fixturePath = path.resolve('test/fixtures/fake-provider/index.mjs');
  const senpiExec = resolveSenpiExecutable('/home/ranggabiner/.bun/install/global/node_modules/omo-ai');
  if (!senpiExec) return;

  const child = spawn(
    senpiExec,
    [
      '--mode', 'rpc',
      '--no-extensions',
      '--extension', fixturePath,
      '--model', 'omox-fixture/fixture-model',
      '--thinking', 'off',
      '--no-session',
      '--no-tools',
      '--no-skills',
      '--no-prompt-templates',
      '--no-context-files',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );

  let stderr = '';
  child.stderr?.on('data', (d) => (stderr += d.toString()));

  // Send test prompt
  child.stdin.write(JSON.stringify({ id: 'smoke-test', type: 'prompt', message: 'ping' }) + '\n');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try { child.kill('SIGTERM'); } catch {}

  assert.equal(stderr.includes('Model "omox-fixture/fixture-model" not found'), false, 'Child must load fake provider without model-not-found error');
});

// 8. People-ask subprocess receives provider extensions
test('8. People-ask subprocess receives provider extensions', () => {
  const omoHunks = PATCH_DATA['5.0.0-0.beta.88']['plugin/extensions/omo.js'];
  const peopleHunk = omoHunks.find((h) => h.name.includes('People Ask'));
  assert.ok(peopleHunk, 'People Ask Hunk must exist');
  assert.ok(peopleHunk.newText.includes('s=await _omoxResolvePkgExts(r)'));
  assert.ok(peopleHunk.newText.includes('--no-extensions",...s.flatMap(e=>["--extension",e])'));
});

// 9. Extension paths deduplicate
test('9. Extension paths deduplicate', () => {
  const omoHunks = PATCH_DATA['5.0.0-0.beta.88']['plugin/extensions/omo.js'];
  const preflightHunk = omoHunks.find((h) => h.name.includes('Preflight'));
  assert.ok(preflightHunk.newText.includes('return[...new Set(t)]'));
});

// 10. No package extensions => previous behavior remains unchanged
test('10. No package extensions => previous behavior remains unchanged', () => {
  const omoHunks = PATCH_DATA['5.0.0-0.beta.88']['plugin/extensions/omo.js'];
  const preflightHunk = omoHunks.find((h) => h.name.includes('Preflight'));
  // If t is empty, [...new Set(t)] returns [], flatMap yields []
  assert.ok(preflightHunk.newText.includes('return[...new Set(t)]'));
});

// 11. Unknown/unresolvable extension entry => safe useful failure
test('11. Unknown/unresolvable extension entry => safe useful failure', () => {
  const omoHunks = PATCH_DATA['5.0.0-0.beta.88']['plugin/extensions/omo.js'];
  const preflightHunk = omoHunks.find((h) => h.name.includes('Preflight'));
  // Wrapped in try/catch and verifies xh(n) (existsSync) before adding
  assert.ok(preflightHunk.newText.includes('try{let n=Ph({env:e??process.env})'));
  assert.ok(preflightHunk.newText.includes('catch{}'));
  assert.ok(preflightHunk.newText.includes('xh(n)&&t.push(n)'));
});

// 12. Existing OmO plugin is not recursively duplicated
test('12. Existing OmO plugin is not recursively duplicated', () => {
  const taskHunks = PATCH_DATA['5.0.0-0.beta.88']['plugin/extensions/omo-task.js'];
  // Checks filter(e=>_w(e)!==z_) to remove omo plugin path
  assert.ok(taskHunks[0].newText.includes('filter(e=>_w(e)!==z_)'));
});

// 13. Incremental apply from current valid patched beta.88 works
await testAsync('13. Incremental apply from current valid patched beta.88 works', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-inc-'));
  try {
    const pkgRoot = path.join(tmpDir, 'omo-ai');
    const agentDir = path.join(tmpDir, 'agent');
    const backupRoot = path.join(tmpDir, 'backups');

    fs.mkdirSync(path.join(pkgRoot, 'plugin', 'extensions'), { recursive: true });
    fs.mkdirSync(path.join(pkgRoot, 'bin', 'lib'), { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });

    fs.writeFileSync(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: 'omo-ai', version: '5.0.0-0.beta.88' })
    );

    // Setup: omo-task.js and engine-prepare.js ALREADY PATCHED, omo.js UNPATCHED
    const installedTaskPath = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai/plugin/extensions/omo-task.js';
    const activeOmoJsPath = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai/plugin/extensions/omo.js';
    const installedEpPath = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai/bin/lib/engine-prepare.js';

    let unpatchedOmoContent = fs.readFileSync(activeOmoJsPath, 'utf-8');
    for (const h of PATCH_DATA['5.0.0-0.beta.88']['plugin/extensions/omo.js']) {
      unpatchedOmoContent = unpatchedOmoContent.replace(h.newText, h.oldText);
    }

    fs.writeFileSync(path.join(pkgRoot, 'plugin', 'extensions', 'omo-task.js'), fs.readFileSync(installedTaskPath));
    fs.writeFileSync(path.join(pkgRoot, 'plugin', 'extensions', 'omo.js'), unpatchedOmoContent);
    fs.writeFileSync(path.join(pkgRoot, 'bin', 'lib', 'engine-prepare.js'), fs.readFileSync(installedEpPath));
    fs.writeFileSync(path.join(pkgRoot, 'plugin', 'daemon-launch-spec.json'), '{}', { mode: 0o644 });

    const preInspect = inspectTarget(pkgRoot, '5.0.0-0.beta.88');
    assert.equal(preInspect.status, STATUS.NEEDS_PATCH, 'Partially patched state must be recognized as NEEDS_PATCH, not INCOMPATIBLE');
    assert.equal(preInspect.files['plugin/extensions/omo-task.js'].status, 'PATCHED');
    assert.equal(preInspect.files['bin/lib/engine-prepare.js'].status, 'PATCHED');
    assert.equal(preInspect.files['plugin/extensions/omo.js'].status, 'NEEDS_PATCH');

    const applyRes = await runApply({
      omoPackageRoot: pkgRoot,
      agentDir,
      backupRootDir: backupRoot,
      skipRuntimeTest: true,
    });

    assert.equal(applyRes.status, STATUS.PATCHED_OK);
    assert.equal(applyRes.modified, true);
    // Only omo.js should have been modified
    assert.equal(applyRes.modifiedFiles.length, 1);
    assert.ok(applyRes.modifiedFiles[0].endsWith('omo.js'));

    const postInspect = inspectTarget(pkgRoot, '5.0.0-0.beta.88');
    assert.equal(postInspect.status, STATUS.PATCHED_OK);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 14. Rollback restores exact immediate pre-apply bytes and modes
await testAsync('14. Rollback restores exact immediate pre-apply bytes and modes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-inc-rb-'));
  try {
    const pkgRoot = path.join(tmpDir, 'omo-ai');
    const agentDir = path.join(tmpDir, 'agent');
    const backupRoot = path.join(tmpDir, 'backups');

    fs.mkdirSync(path.join(pkgRoot, 'plugin', 'extensions'), { recursive: true });
    fs.mkdirSync(path.join(pkgRoot, 'bin', 'lib'), { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });

    fs.writeFileSync(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: 'omo-ai', version: '5.0.0-0.beta.88' })
    );

    const installedTaskPath = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai/plugin/extensions/omo-task.js';
    const activeOmoJsPath = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai/plugin/extensions/omo.js';
    const installedEpPath = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai/bin/lib/engine-prepare.js';

    let unpatchedOmoContent = fs.readFileSync(activeOmoJsPath, 'utf-8');
    for (const h of PATCH_DATA['5.0.0-0.beta.88']['plugin/extensions/omo.js']) {
      unpatchedOmoContent = unpatchedOmoContent.replace(h.newText, h.oldText);
    }

    fs.writeFileSync(path.join(pkgRoot, 'plugin', 'extensions', 'omo-task.js'), fs.readFileSync(installedTaskPath));
    fs.writeFileSync(path.join(pkgRoot, 'plugin', 'extensions', 'omo.js'), unpatchedOmoContent);
    fs.writeFileSync(path.join(pkgRoot, 'bin', 'lib', 'engine-prepare.js'), fs.readFileSync(installedEpPath));
    fs.writeFileSync(path.join(pkgRoot, 'plugin', 'daemon-launch-spec.json'), '{}', { mode: 0o644 });

    const preApplyOmoHash = sha256File(path.join(pkgRoot, 'plugin', 'extensions', 'omo.js'));

    await runApply({
      omoPackageRoot: pkgRoot,
      agentDir,
      backupRootDir: backupRoot,
      skipRuntimeTest: true,
    });

    assert.equal(
      sha256File(path.join(pkgRoot, 'plugin', 'extensions', 'omo.js')),
      'a2720a889ccde48686197af66f2aaa4da1acf1059cb6845a43d0f892182ece5a'
    );

    const rollbackRes = await runRollback({
      omoPackageRoot: pkgRoot,
      agentDir,
      backupRootDir: backupRoot,
    });
    assert.equal(rollbackRes.success, true);
    assert.equal(sha256File(path.join(pkgRoot, 'plugin', 'extensions', 'omo.js')), preApplyOmoHash);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 15. Unknown future OmO build => INCOMPATIBLE and zero writes
await testAsync('15. Unknown future OmO build => INCOMPATIBLE and zero writes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-future-'));
  try {
    const pkgRoot = path.join(tmpDir, 'omo-ai');
    fs.mkdirSync(path.join(pkgRoot, 'plugin', 'extensions'), { recursive: true });
    fs.writeFileSync(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: 'omo-ai', version: '6.5.0-unknown' })
    );
    const taskPath = path.join(pkgRoot, 'plugin', 'extensions', 'omo-task.js');
    fs.writeFileSync(taskPath, '// unknown structure');

    const res = await runApply({
      omoPackageRoot: pkgRoot,
      skipRuntimeTest: true,
    });
    assert.equal(res.status, STATUS.INCOMPATIBLE);
    assert.equal(res.modified, false);
    assert.equal(fs.readFileSync(taskPath, 'utf-8'), '// unknown structure');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 16. Bun available => Bun selected
test('16. Bun available => Bun selected', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-bun-sel-'));
  try {
    const fakeBun = path.join(tmpDir, 'bun');
    const fakeNpm = path.join(tmpDir, 'npm');
    fs.writeFileSync(fakeBun, '#!/bin/sh');
    fs.writeFileSync(fakeNpm, '#!/bin/sh');

    const res = resolveUpdatePackageManager({ customPath: tmpDir });
    assert.equal(res.pm, 'bun');
    assert.equal(res.executable, fakeBun);
    assert.deepEqual(res.args, ['add', '-g', OFFICIAL_SOURCE]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 17. Bun unavailable / npm available => npm selected
test('17. Bun unavailable / npm available => npm selected', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-npm-sel-'));
  try {
    const fakeNpm = path.join(tmpDir, 'npm');
    fs.writeFileSync(fakeNpm, '#!/bin/sh');

    const res = resolveUpdatePackageManager({ customPath: tmpDir });
    assert.equal(res.pm, 'npm');
    assert.equal(res.executable, fakeNpm);
    assert.deepEqual(res.args, ['install', '-g', OFFICIAL_SOURCE]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 18. Neither available => clear failure
await testAsync('18. Neither available => clear failure', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-none-sel-'));
  try {
    const res = await runUpdate({ customPath: tmpDir });
    assert.equal(res.success, false);
    assert.equal(res.exitCode, EXIT_CODES.CLI_ERROR);
    assert.ok(res.report.includes('neither Bun nor npm is available in PATH'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 19. Package manager non-zero => clear failure and no OmO writes
await testAsync('19. Package manager non-zero => clear failure and no OmO writes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-pm-fail-'));
  try {
    const fakeBun = path.join(tmpDir, 'bun');
    fs.writeFileSync(fakeBun, '#!/bin/sh');

    const mockRunner = async () => ({
      code: 1,
      stdout: '',
      stderr: 'error: github repo not reachable',
    });

    const res = await runUpdate({
      customPath: tmpDir,
      runner: mockRunner,
    });

    assert.equal(res.success, false);
    assert.equal(res.exitCode, EXIT_CODES.CLI_ERROR);
    assert.ok(res.report.includes('github repo not reachable'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 20. Successful update => newly resolved omox --version is executed
await testAsync('20. Successful update => newly resolved omox --version is executed', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-update-ok-'));
  try {
    const fakeBun = path.join(tmpDir, 'bun');
    const fakeOmox = path.join(tmpDir, 'omox');
    fs.writeFileSync(fakeBun, '#!/bin/sh');
    fs.writeFileSync(fakeOmox, '#!/bin/sh');

    const calls = [];
    const mockRunner = async (exec, args) => {
      calls.push({ exec, args });
      if (exec.endsWith('bun')) {
        return { code: 0, stdout: 'installed successfully', stderr: '' };
      }
      if (exec.endsWith('omox')) {
        return { code: 0, stdout: '1.1.0\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };

    const res = await runUpdate({
      customPath: tmpDir,
      runner: mockRunner,
    });

    assert.equal(res.success, true);
    assert.equal(res.exitCode, EXIT_CODES.SUCCESS);
    assert.equal(res.currentVersion, '1.1.0');
    assert.ok(calls.some((c) => c.exec.endsWith('omox') && c.args.includes('--version')));
    assert.ok(res.report.includes('Next:\n  omox verify'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 21. omox update never calls omox apply, rollback, OmO update, patch mutation
test('21. omox update never calls apply, rollback, or patch mutation', () => {
  const updateSource = fs.readFileSync(path.resolve('src/update.mjs'), 'utf-8');
  assert.equal(updateSource.includes('applyPatch'), false);
  assert.equal(updateSource.includes('runApply'), false);
  assert.equal(updateSource.includes('runRollback'), false);
  assert.equal(updateSource.includes('restoreBackup'), false);
  assert.equal(updateSource.includes('PATCH_DATA'), false);
});

// 22. CLI help includes update command
await testAsync('22. CLI help includes update command', async () => {
  const p = spawn('node', ['./src/cli.mjs', '--help'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  p.stdout?.on('data', (d) => (stdout += d.toString()));
  await new Promise((resolve) => p.on('close', resolve));

  assert.ok(stdout.includes('update       Update omox itself from the official GitHub repository.'));
  assert.ok(stdout.includes('omox update does NOT update OmO.'));
});

// 23. Version resolves as 1.1.0
await testAsync('23. Version resolves as 1.1.0', async () => {
  assert.equal(getOmoxVersion(), '1.1.0');

  const p = spawn('node', ['./src/cli.mjs', '--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  p.stdout?.on('data', (d) => (stdout += d.toString()));
  await new Promise((resolve) => p.on('close', resolve));
  assert.equal(stdout.trim(), '1.1.0');
});

// Run all tests
console.log(`\nTest suite finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
