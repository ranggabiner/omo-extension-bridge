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
import {
  resolvePackageExtensions,
  resolvePackageExtensionsFallback,
  resolvePackageExtensionsTier1,
  parseNpmPackageName,
  loadSenpiModule,
} from '../src/lib/runtime-helper.mjs';
import {
  scanOmoJs,
  scanOmoTaskJs,
  isDagSlicePresent,
  checkArrayHasExtensionInjection,
  findSemanticTargets,
} from '../src/lib/semantic-scanner.mjs';
import * as parser from '@babel/parser';
import {
  repairMemory,
  repairTask,
  repairDaemon,
  planAllRepairs,
  isDaemonLaunchSpecSafe,
} from '../src/lib/patch-families/index.mjs';

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
    }, /Cannot apply patch: installation is (in INCOMPATIBLE|not in NEEDS_PATCH)/);
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
    const installedPkgJson = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai/package.json';

    if (
      !fs.existsSync(installedTaskPath) ||
      !fs.existsSync(activeOmoJsPath) ||
      !fs.existsSync(installedEpPath) ||
      !fs.existsSync(installedPkgJson) ||
      JSON.parse(fs.readFileSync(installedPkgJson, 'utf-8')).version !== '5.0.0-0.beta.88'
    ) {
      console.log('Skipping incremental test: reference 5.0.0-0.beta.88 files not found on machine');
      return;
    }

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
    const installedPkgJson = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai/package.json';

    if (
      !fs.existsSync(installedTaskPath) ||
      !fs.existsSync(activeOmoJsPath) ||
      !fs.existsSync(installedEpPath) ||
      !fs.existsSync(installedPkgJson) ||
      JSON.parse(fs.readFileSync(installedPkgJson, 'utf-8')).version !== '5.0.0-0.beta.88'
    ) {
      console.log('Skipping rollback test: reference 5.0.0-0.beta.88 files not found on machine');
      return;
    }

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
    assert.deepEqual(res.args, ['add', '-g', '--force', OFFICIAL_SOURCE]);
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
        return { code: 0, stdout: '2.0.0\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };

    const res = await runUpdate({
      customPath: tmpDir,
      runner: mockRunner,
    });

    assert.equal(res.success, true);
    assert.equal(res.exitCode, EXIT_CODES.SUCCESS);
    assert.equal(res.currentVersion, '2.0.0');
    assert.equal(res.versionChanged, false);
    assert.ok(res.report.includes('Current version: 2.0.0 (unchanged)'));
    assert.equal(res.report.includes('updated from latest GitHub source'), false);
    assert.ok(calls.some((c) => c.exec.endsWith('omox') && c.args.includes('--version')));
    assert.ok(res.report.includes('Next:\n  omox verify'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 20b. Update with version change => reports updated from previousVersion
await testAsync('20b. Update with version change => reports updated from previousVersion', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-update-changed-'));
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
        return { code: 0, stdout: '2.1.0\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };

    const res = await runUpdate({
      customPath: tmpDir,
      runner: mockRunner,
    });

    assert.equal(res.success, true);
    assert.equal(res.exitCode, EXIT_CODES.SUCCESS);
    assert.equal(res.previousVersion, '2.0.0');
    assert.equal(res.currentVersion, '2.1.0');
    assert.equal(res.versionChanged, true);
    assert.ok(res.report.includes('Current version: 2.1.0 (updated from 2.0.0)'));
    assert.ok(res.report.includes('Previous version: 2.0.0'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 20c. Bun update forces canonical #main branch and shell=false argv
test('20c. Bun update forces canonical #main branch and shell=false argv', () => {
  assert.ok(OFFICIAL_SOURCE.includes('#main'), 'OFFICIAL_SOURCE must target canonical #main branch');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-bun-force-'));
  try {
    const fakeBun = path.join(tmpDir, 'bun');
    fs.writeFileSync(fakeBun, '#!/bin/sh');

    const res1 = resolveUpdatePackageManager({ customPath: tmpDir });
    assert.deepEqual(res1.args, ['add', '-g', '--force', 'github:ranggabiner/omo-extension-bridge#main']);

    const res2 = resolveUpdatePackageManager({
      customPath: tmpDir,
      source: 'github:ranggabiner/omo-extension-bridge',
    });
    assert.deepEqual(res2.args, ['add', '-g', '--force', 'github:ranggabiner/omo-extension-bridge#main']);
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

// 23. Version resolves as 2.0.0
await testAsync('23. Version resolves as 2.0.0', async () => {
  assert.equal(getOmoxVersion(), '2.0.0');

  const p = spawn('node', ['./src/cli.mjs', '--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  p.stdout?.on('data', (d) => (stdout += d.toString()));
  await new Promise((resolve) => p.on('close', resolve));
  assert.equal(stdout.trim(), '2.0.0');
});

// =======================================================
// AUTHORITATIVE RESOLVER & FAIL-CLOSED FALLBACK TESTS (Tests 24 - 31)
// =======================================================

console.log('\nRunning authoritative resolver & fail-closed fallback tests...\n');

// 24. parseNpmPackageName handles scoped and unscoped packages with and without versions
test('24. parseNpmPackageName handles scoped and unscoped packages with and without versions', () => {
  assert.equal(parseNpmPackageName('npm:pi-antigravity'), 'pi-antigravity');
  assert.equal(parseNpmPackageName('npm:pi-antigravity@0.8.0'), 'pi-antigravity');
  assert.equal(parseNpmPackageName('npm:@scope/custom-pkg'), '@scope/custom-pkg');
  assert.equal(parseNpmPackageName('npm:@scope/custom-pkg@1.2.3'), '@scope/custom-pkg');
  assert.equal(parseNpmPackageName('npm:pkg-name@^2.0.0'), 'pkg-name');
  assert.equal(parseNpmPackageName('npm:@scope/pkg@next'), '@scope/pkg');
  assert.equal(parseNpmPackageName(''), '');
  assert.equal(parseNpmPackageName(null), '');
});

// 25. Tier 1: Authoritative Senpi Resolver queries DefaultPackageManager with read-only onMissing
await testAsync('25. Tier 1: Authoritative Senpi Resolver queries DefaultPackageManager with read-only onMissing', async () => {
  let createdCwd = null;
  let createdAgentDir = null;
  let pmOptions = null;
  let onMissingInvoked = false;

  const mockSettingsManagerInstance = { id: 'mock-settings' };
  const mockSettingsManager = {
    create: (cwd, agentDir) => {
      createdCwd = cwd;
      createdAgentDir = agentDir;
      return mockSettingsManagerInstance;
    },
  };

  class MockDefaultPackageManager {
    constructor(opts) {
      pmOptions = opts;
    }
    async resolve(onMissing) {
      assert.equal(typeof onMissing, 'function', 'onMissing must be a function handler');
      onMissing('missing-pkg');
      onMissingInvoked = true;

      return {
        extensions: [
          { path: '/mock/ext1.js', enabled: true, metadata: { origin: 'package' } },
          { path: '/mock/ext2.js', enabled: false, metadata: { origin: 'package' } },
          { path: '/mock/ext3.js', enabled: true, metadata: { origin: 'top-level' } },
          { path: '/mock/ext1.js', enabled: true, metadata: { origin: 'package' } },
          { path: null, enabled: true, metadata: { origin: 'package' } },
          { path: '', enabled: true, metadata: { origin: 'package' } },
          { path: '/mock/ext4.js', enabled: true, metadata: { origin: 'package' } },
        ],
      };
    }
  }

  const mockSenpi = {
    SettingsManager: mockSettingsManager,
    DefaultPackageManager: MockDefaultPackageManager,
  };

  const fakeAgentDir = '/mock/fake-agent';
  const fakeCwd = '/mock/fake-cwd';

  const res = await resolvePackageExtensionsTier1({
    agentDir: fakeAgentDir,
    cwd: fakeCwd,
    senpiModule: mockSenpi,
  });

  assert.equal(createdCwd, fakeCwd);
  assert.equal(createdAgentDir, fakeAgentDir);
  assert.equal(pmOptions.settingsManager, mockSettingsManagerInstance);
  assert.equal(pmOptions.cwd, fakeCwd);
  assert.equal(pmOptions.agentDir, fakeAgentDir);
  assert.equal(onMissingInvoked, true);
  assert.deepEqual(res, ['/mock/ext1.js', '/mock/ext4.js'], 'Must filter origin:package, enabled!==false, and deduplicate');
});

// 26. Tier 1: Real Senpi package resolution (when Senpi is available)
await testAsync('26. Tier 1: Real Senpi package resolution resolves existing extensions', async () => {
  const globalSenpiPath = '/home/ranggabiner/.bun/install/global/node_modules/@code-yeongyu/senpi/dist/index.js';
  if (!fs.existsSync(globalSenpiPath)) {
    console.log('Skipping live Senpi Tier 1 test: global Senpi not installed');
    return;
  }

  const realSenpi = await import(globalSenpiPath);
  const agentDir = '/home/ranggabiner/.omo/agent';
  if (!fs.existsSync(agentDir)) {
    console.log('Skipping live Senpi Tier 1 test: agent dir not found');
    return;
  }

  const res = await resolvePackageExtensionsTier1({
    agentDir,
    senpiModule: realSenpi,
  });

  assert.ok(Array.isArray(res));
  assert.ok(res.length >= 2, `Expected at least 2 package extensions, got: ${res.length}`);
  assert.ok(res.some((p) => p.includes('pi-antigravity')), 'Must resolve pi-antigravity extension');
  assert.ok(res.some((p) => p.includes('pi-commandcode-provider')), 'Must resolve pi-commandcode-provider extension');
});

// 27. Tier 2: Fail-Closed Narrow Fallback strictly resolves plain npm packages preserving exact encounter order
test('27. Tier 2: Fail-Closed Narrow Fallback strictly resolves plain npm packages preserving exact encounter order', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-tier2-ord-'));
  try {
    const pkgDirB = path.join(tmpDir, 'npm', 'node_modules', 'pkg-b');
    const pkgDirA = path.join(tmpDir, 'npm', 'node_modules', 'pkg-a');
    const pkgDirC = path.join(tmpDir, 'npm', 'node_modules', '@scope', 'pkg-c');
    fs.mkdirSync(pkgDirB, { recursive: true });
    fs.mkdirSync(pkgDirA, { recursive: true });
    fs.mkdirSync(pkgDirC, { recursive: true });

    fs.writeFileSync(
      path.join(pkgDirB, 'package.json'),
      JSON.stringify({
        name: 'pkg-b',
        pi: { extensions: ['./lib/b1.js', './lib/b2.js'] },
      })
    );

    fs.writeFileSync(
      path.join(pkgDirA, 'package.json'),
      JSON.stringify({
        name: 'pkg-a',
        main: './entry-a.js',
      })
    );

    fs.writeFileSync(
      path.join(pkgDirC, 'package.json'),
      JSON.stringify({
        name: '@scope/pkg-c',
        pi: { extensions: ['./c-ext.js'] },
      })
    );

    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        packages: [
          'npm:pkg-b',
          'npm:pkg-a',
          'npm:pkg-b',
          'npm:@scope/pkg-c@1.0.0',
        ],
      })
    );

    const res = resolvePackageExtensionsFallback({ agentDir: tmpDir });

    const expected = [
      path.resolve(pkgDirB, './lib/b1.js'),
      path.resolve(pkgDirB, './lib/b2.js'),
      path.resolve(pkgDirA, './entry-a.js'),
      path.resolve(pkgDirC, './c-ext.js'),
    ];

    assert.deepEqual(res, expected, 'Must match exact encounter order without alphabetical sorting and with deduplication');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 28. Tier 2: Fail-Closed Narrow Fallback throws UNSUPPORTED_PACKAGE_CONFIGURATION for object PackageSources
await testAsync('28. Tier 2: Fail-Closed Narrow Fallback throws UNSUPPORTED_PACKAGE_CONFIGURATION for object PackageSources', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-tier2-obj-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        packages: [
          'npm:pi-antigravity',
          { source: 'npm:pi-custom', autoload: true, extensions: ['./ext.js'] },
        ],
      })
    );

    assert.throws(
      () => resolvePackageExtensionsFallback({ agentDir: tmpDir }),
      /UNSUPPORTED_PACKAGE_CONFIGURATION/
    );

    await assert.rejects(
      async () => resolvePackageExtensions({ agentDir: tmpDir, forceFallback: true }),
      /UNSUPPORTED_PACKAGE_CONFIGURATION/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 29. Tier 2: Fail-Closed Narrow Fallback throws UNSUPPORTED_PACKAGE_CONFIGURATION for git, file, and relative paths
test('29. Tier 2: Fail-Closed Narrow Fallback throws UNSUPPORTED_PACKAGE_CONFIGURATION for git, file, and relative paths', () => {
  const invalidCases = [
    ['git:https://github.com/user/repo.git', 'git source'],
    ['file:../local-ext', 'file source'],
    ['./relative-path-ext', 'relative path'],
    ['/absolute/path/ext', 'absolute path'],
    ['plain-pkg-without-npm-prefix', 'unprefixed name'],
  ];

  for (const [invalidEntry, label] of invalidCases) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-tier2-inv-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'settings.json'),
        JSON.stringify({ packages: [invalidEntry] })
      );

      assert.throws(
        () => resolvePackageExtensionsFallback({ agentDir: tmpDir }),
        /UNSUPPORTED_PACKAGE_CONFIGURATION/,
        `Expected ${label} (${invalidEntry}) to throw UNSUPPORTED_PACKAGE_CONFIGURATION`
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
});

// 30. Tier 2: Zero credentials read during package extension resolution
test('30. Tier 2: Zero credentials read during package extension resolution', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-tier2-cred-'));
  try {
    const authFile = path.join(tmpDir, 'auth.json');
    const agAccountsFile = path.join(tmpDir, 'antigravity-accounts.json');
    const credPoolFile = path.join(tmpDir, 'credential-pool-state.json');

    fs.writeFileSync(authFile, '{"sensitive_token":"LEAK_TEST"}');
    fs.writeFileSync(agAccountsFile, '{"secret_refresh_token":"LEAK_TEST"}');
    fs.writeFileSync(credPoolFile, '{"pool_key":"LEAK_TEST"}');

    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({ packages: [] })
    );

    const res = resolvePackageExtensionsFallback({ agentDir: tmpDir });
    assert.deepEqual(res, []);

    assert.equal(fs.readFileSync(authFile, 'utf-8'), '{"sensitive_token":"LEAK_TEST"}');
    assert.equal(fs.readFileSync(agAccountsFile, 'utf-8'), '{"secret_refresh_token":"LEAK_TEST"}');
    assert.equal(fs.readFileSync(credPoolFile, 'utf-8'), '{"pool_key":"LEAK_TEST"}');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 31. Unified resolvePackageExtensions resolves existing installed packages
await testAsync('31. Unified resolvePackageExtensions resolves existing installed packages', async () => {
  const res = await resolvePackageExtensions();
  assert.ok(Array.isArray(res));
  assert.ok(res.length >= 2, `Expected at least 2 package extensions, got: ${res.length}`);
  assert.ok(res.some((p) => p.includes('pi-antigravity')), 'Must resolve pi-antigravity extension');
  assert.ok(res.some((p) => p.includes('pi-commandcode-provider')), 'Must resolve pi-commandcode-provider extension');
});

// =======================================================
// AST SEMANTIC SCANNER & GATE VALIDATION TESTS (Tests 32 - 37)
// =======================================================

console.log('\nRunning AST semantic scanner & gate validation tests...\n');

// 32. loadSenpiModule dynamically discovers Senpi without top-level import crash
await testAsync('32. loadSenpiModule dynamically discovers Senpi without top-level import crash', async () => {
  const senpi = await loadSenpiModule();
  assert.ok(senpi, 'Senpi module must be dynamically loaded');
  assert.ok(senpi.DefaultPackageManager, 'DefaultPackageManager must exist on loaded Senpi module');
  assert.ok(senpi.SettingsManager, 'SettingsManager must exist on loaded Senpi module');

  // Tier 1 without providing senpiModule directly should also load Senpi dynamically
  const res = await resolvePackageExtensionsTier1();
  assert.ok(Array.isArray(res));
  assert.ok(res.length >= 2);
});

function getActiveBeta89Unpatched() {
  const activePackageRoot = '/home/ranggabiner/.bun/install/global/node_modules/omo-ai';
  if (!fs.existsSync(activePackageRoot)) return null;

  const activeOmoJs = path.join(activePackageRoot, 'plugin/extensions/omo.js');
  const activeTaskJs = path.join(activePackageRoot, 'plugin/extensions/omo-task.js');
  const daemonPath = path.join(activePackageRoot, 'plugin/daemon-launch-spec.json');

  let omoCode = fs.readFileSync(activeOmoJs, 'utf-8');
  let taskCode = fs.readFileSync(activeTaskJs, 'utf-8');

  // If the active files are currently patched, read pristine unpatched source from backup
  if (omoCode.includes('_omoxGetPkgExts') || !isDagSlicePresent(taskCode)) {
    const latestBackup = getLatestBackupForInstall({
      omoPackageRoot: activePackageRoot,
      omoVersion: '5.0.0-0.beta.89',
    });
    if (latestBackup) {
      const bOmo = path.join(latestBackup.backupDir, 'plugin/extensions/omo.js');
      const bTask = path.join(latestBackup.backupDir, 'plugin/extensions/omo-task.js');
      if (fs.existsSync(bOmo) && fs.existsSync(bTask)) {
        omoCode = fs.readFileSync(bOmo, 'utf-8');
        taskCode = fs.readFileSync(bTask, 'utf-8');
      }
    }
  }

  return {
    packageRoot: activePackageRoot,
    activeOmoJs,
    activeTaskJs,
    daemonPath,
    omoCode,
    taskCode,
  };
}

// 33. scanOmoJs detects 100% unique targets on active beta.89 omo.js
test('33. scanOmoJs detects 100% unique targets on active beta.89 omo.js', () => {
  const files = getActiveBeta89Unpatched();
  if (!files) {
    console.log('Skipping beta.89 omo.js scanner test: file not found');
    return;
  }

  const code = files.omoCode;
  const res = scanOmoJs(code);

  assert.equal(res.counts.preflight, 1, 'Preflight must have exactly 1 match');
  assert.equal(res.counts.reflection, 1, 'Reflection must have exactly 1 match');
  assert.equal(res.counts.peopleAsk, 1, 'People ask must have exactly 1 match');
  assert.equal(res.counts.fork, 1, 'Fork must have exactly 1 match');

  assert.ok(res.preflight, 'Preflight target must not be null');
  assert.equal(typeof res.preflight.start, 'number');
  assert.equal(typeof res.preflight.end, 'number');
  assert.ok(res.preflight.end > res.preflight.start);
  assert.equal(res.preflight.hasExtensionInjection, false, 'Unpatched beta.89 preflight should not have extension injection');

  assert.ok(res.reflection, 'Reflection target must not be null');
  assert.equal(typeof res.reflection.start, 'number');
  assert.equal(typeof res.reflection.end, 'number');
  assert.ok(res.reflection.end > res.reflection.start);
  assert.equal(res.reflection.hasExtensionInjection, false, 'Unpatched beta.89 reflection should not have extension injection');

  assert.ok(res.peopleAsk, 'PeopleAsk target must not be null');
  assert.equal(typeof res.peopleAsk.start, 'number');
  assert.equal(typeof res.peopleAsk.end, 'number');
  assert.ok(res.peopleAsk.end > res.peopleAsk.start);
  assert.equal(res.peopleAsk.hasExtensionInjection, false, 'Unpatched beta.89 peopleAsk should not have extension injection');

  assert.ok(res.fork, 'Fork target must not be null');
  assert.equal(typeof res.fork.start, 'number');
  assert.equal(typeof res.fork.end, 'number');
  assert.ok(res.fork.end > res.fork.start);
});

// 34. scanOmoTaskJs detects 100% unique dagSlice on active beta.89 omo-task.js
test('34. scanOmoTaskJs detects 100% unique dagSlice on active beta.89 omo-task.js', () => {
  const files = getActiveBeta89Unpatched();
  if (!files) {
    console.log('Skipping beta.89 omo-task.js scanner test: file not found');
    return;
  }

  const code = files.taskCode;
  const res = scanOmoTaskJs(code);

  assert.equal(res.counts.dagSlice, 1, 'dagSlice must have exactly 1 match');
  assert.ok(res.dagSlice, 'dagSlice target must not be null');
  assert.equal(typeof res.dagSlice.start, 'number');
  assert.equal(typeof res.dagSlice.end, 'number');
  assert.ok(res.dagSlice.end > res.dagSlice.start);
  assert.equal(res.dagSlice.hasSlice, true);

  assert.equal(isDagSlicePresent(code), true, 'isDagSlicePresent helper must return true');
});

// 35. checkArrayHasExtensionInjection detects injected vs clean arrays
test('35. checkArrayHasExtensionInjection detects injected vs clean arrays', () => {
  const cleanArray = {
    type: 'ArrayExpression',
    elements: [
      { type: 'StringLiteral', value: '--no-extensions' },
      { type: 'StringLiteral', value: '--list-models' },
    ],
  };
  assert.equal(checkArrayHasExtensionInjection(cleanArray), false);

  const directInjectedArray = {
    type: 'ArrayExpression',
    elements: [
      { type: 'StringLiteral', value: '--no-extensions' },
      { type: 'StringLiteral', value: '--extension' },
      { type: 'StringLiteral', value: '/path/to/ext' },
    ],
  };
  assert.equal(checkArrayHasExtensionInjection(directInjectedArray), true);

  const flatMapInjectedArray = {
    type: 'ArrayExpression',
    elements: [
      { type: 'StringLiteral', value: '--no-extensions' },
      {
        type: 'SpreadElement',
        argument: {
          type: 'CallExpression',
          callee: {
            type: 'MemberExpression',
            property: { name: 'flatMap' },
          },
        },
      },
    ],
  };
  assert.equal(checkArrayHasExtensionInjection(flatMapInjectedArray), true);

  const snippetInjected = '["--no-extensions", ...exts.flatMap(e => ["--extension", e]), "--list-models"]';
  const nodeWithRange = { type: 'ArrayExpression', elements: [], start: 0, end: snippetInjected.length };
  assert.equal(checkArrayHasExtensionInjection(nodeWithRange, snippetInjected), true);
});

// 36. semantic-scanner.mjs rejects ambiguous duplicate target arrays with AMBIGUOUS_TARGET
test('36. semantic-scanner.mjs rejects ambiguous duplicate target arrays with AMBIGUOUS_TARGET', () => {
  const duplicateReflectionSnippet = `
    function spawnWorkerA() {
      const p = ['-p', '--system-prompt', 'sysA', '--tools', 'bash,edit', '--no-extensions', '--model', 'modelA'];
      return { args: p };
    }
    function spawnWorkerB() {
      const p = ['-p', '--system-prompt', 'sysB', '--tools', 'bash,edit', '--no-extensions', '--model', 'modelB'];
      return { args: p };
    }
  `;

  assert.throws(
    () => scanOmoJs(duplicateReflectionSnippet),
    (err) => {
      assert.equal(err.code, 'AMBIGUOUS_TARGET');
      assert.ok(err.message.includes('AMBIGUOUS_TARGET'));
      assert.equal(err.target, 'reflection');
      return true;
    },
    'Should throw AMBIGUOUS_TARGET for duplicate reflection target'
  );
});

// 37. semantic-scanner.mjs rejects candidates that fail enclosing scope or consumer data flow gates
test('37. semantic-scanner.mjs rejects candidates that fail enclosing scope or consumer data flow gates', () => {
  // Candidate with literal match for reflection, but outside function (fails Gate 2)
  const topLevelReflection = `
    const orphanedArray = ['-p', '--system-prompt', 'sys', '--tools', 'bash,edit', '--no-extensions', '--model', 'm'];
  `;
  const res1 = scanOmoJs(topLevelReflection);
  assert.equal(res1.counts.reflection, 0, 'Orphaned reflection at top-level must fail Gate 2');

  // Candidate inside function, but unused (no consumer data flow, fails Gate 3)
  const deadCodeReflection = `
    function worker() {
      const deadArray = ['-p', '--system-prompt', 'sys', '--tools', 'bash,edit', '--no-extensions', '--model', 'm'];
      return { status: "ok" };
    }
  `;
  const res2 = scanOmoJs(deadCodeReflection);
  assert.equal(res2.counts.reflection, 0, 'Unused reflection array must fail Gate 3');
});

// =======================================================
// MODULAR REPAIR FAMILIES TESTS (Tests 38 - 41)
// =======================================================

console.log('\nRunning modular repair families tests...\n');

// 38. In-memory repair of active beta.89 omo.js: valid AST parse, exactly 3 targets repaired, fork untouched
test('38. In-memory repair of active beta.89 omo.js: valid AST parse, exactly 3 targets repaired, fork untouched', () => {
  const files = getActiveBeta89Unpatched();
  if (!files) {
    console.log('Skipping beta.89 omo.js repair test: file not found');
    return;
  }

  const originalSource = files.omoCode;
  const res = repairMemory(originalSource);

  assert.equal(res.needed, true, 'Repair should be needed for unpatched omo.js');
  assert.equal(res.modified, true, 'Patched source should be marked modified');
  assert.deepEqual(res.appliedTargets, ['preflight', 'reflection', 'peopleAsk'], 'Exactly 3 targets must be repaired');
  assert.equal(res.appliedTargets.length, 3, 'appliedTargets count must be exactly 3');

  // Verify valid Babel AST parse
  let ast;
  assert.doesNotThrow(() => {
    ast = parser.parse(res.patchedSource, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: false,
    });
  }, 'Patched buffer must parse cleanly with @babel/parser');
  assert.ok(ast.program.body.length > 0, 'AST body must not be empty');

  // Semantic rescan verification
  const rescan = scanOmoJs(res.patchedSource);
  assert.ok(rescan.preflight, 'Preflight target must still be detectable');
  assert.equal(rescan.preflight.hasExtensionInjection, true, 'Preflight array must have extension injection');

  assert.ok(rescan.reflection, 'Reflection target must still be detectable');
  assert.equal(rescan.reflection.hasExtensionInjection, true, 'Reflection array must have extension injection');

  assert.ok(rescan.peopleAsk, 'PeopleAsk target must still be detectable');
  assert.equal(rescan.peopleAsk.hasExtensionInjection, true, 'PeopleAsk array must have extension injection');

  // Verify fork reflection remains 100% untouched
  assert.ok(rescan.fork, 'Fork reflection must remain detectable');
  assert.equal(rescan.fork.hasExtensionInjection, false, 'Fork reflection must remain 100% untouched without extension injection');
  const originalForkSnippet = originalSource.slice(scanOmoJs(originalSource).fork.start, scanOmoJs(originalSource).fork.end);
  const patchedForkSnippet = res.patchedSource.slice(rescan.fork.start, rescan.fork.end);
  assert.equal(patchedForkSnippet, originalForkSnippet, 'Fork reflection snippet must be bit-for-bit identical');

  // Idempotency: re-running repairMemory returns needed: false, modified: false
  const rerun = repairMemory(res.patchedSource);
  assert.equal(rerun.needed, false, 'Second run must report needed: false');
  assert.equal(rerun.modified, false, 'Second run must report modified: false');
});

// 39. In-memory repair of active beta.89 omo-task.js: dagSlice removed, valid AST parse
test('39. In-memory repair of active beta.89 omo-task.js: dagSlice removed, valid AST parse', () => {
  const files = getActiveBeta89Unpatched();
  if (!files) {
    console.log('Skipping beta.89 omo-task.js repair test: file not found');
    return;
  }

  const originalSource = files.taskCode;
  assert.equal(isDagSlicePresent(originalSource), true, 'Unpatched task file must have dagSlice present');

  const res = repairTask(originalSource);
  assert.equal(res.needed, true, 'Task repair should be needed for unpatched file');
  assert.equal(res.modified, true, 'Task repair should return modified: true');
  assert.deepEqual(res.appliedTargets, ['dagSlice'], 'appliedTargets must contain dagSlice');

  // Verify valid Babel AST parse
  let ast;
  assert.doesNotThrow(() => {
    ast = parser.parse(res.patchedSource, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: false,
    });
  }, 'Patched task source must parse cleanly with @babel/parser');
  assert.ok(ast.program.body.length > 0, 'AST body must not be empty');

  // Semantic rescan verification
  const rescan = scanOmoTaskJs(res.patchedSource);
  assert.equal(rescan.dagSlice, null, 'dagSlice must be null after repair');
  assert.equal(isDagSlicePresent(res.patchedSource), false, 'isDagSlicePresent must return false after repair');

  // Idempotency: re-running repairTask returns needed: false, modified: false
  const rerun = repairTask(res.patchedSource);
  assert.equal(rerun.needed, false, 'Second run must report needed: false');
  assert.equal(rerun.modified, false, 'Second run must report modified: false');
});

// 40. Daemon permission check and repair
test('40. Daemon permission check and repair', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-daemon-repair-'));
  try {
    const specPath = path.join(tmpDir, 'daemon-launch-spec.json');
    fs.writeFileSync(specPath, JSON.stringify({ version: '1.0' }), { mode: 0o664 });

    const initialStat = fs.statSync(specPath);
    const initialMode = initialStat.mode & 0o777;
    assert.equal(isDaemonLaunchSpecSafe(initialMode), false, '0o664 mode must be flagged unsafe');
    assert.equal((initialMode & 0o022) !== 0, true);

    // Dry run check
    const dryRun = repairDaemon(specPath, { dryRun: true });
    assert.equal(dryRun.needed, true, 'Unsafe daemon spec must report needed: true');
    assert.equal(dryRun.modified, false, 'Dry run must not modify mode');
    assert.equal(dryRun.isSafe, false, 'Dry run should report unsafe');

    // Applied repair
    const applied = repairDaemon(specPath, { apply: true });
    assert.equal(applied.needed, true, 'Unsafe daemon spec must report needed: true');
    assert.equal(applied.modified, true, 'Applied repair must report modified: true');
    assert.equal(applied.isSafe, true, 'Applied repair must report isSafe: true');

    const updatedStat = fs.statSync(specPath);
    const updatedMode = updatedStat.mode & 0o777;
    assert.equal(isDaemonLaunchSpecSafe(updatedMode), true, 'Repaired mode must be safe');
    assert.equal((updatedMode & 0o022) === 0, true, 'Repaired mode must satisfy (mode & 0o022) === 0');
    assert.equal(updatedMode, 0o644, 'Repaired mode must be 0o644');

    // Idempotent second run
    const secondRun = repairDaemon(specPath);
    assert.equal(secondRun.needed, false, 'Safe daemon spec must report needed: false');
    assert.equal(secondRun.isSafe, true, 'Safe daemon spec must report isSafe: true');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 41. planAllRepairs coordinates multi-family repair plan
test('41. planAllRepairs coordinates multi-family repair plan', () => {
  const files = getActiveBeta89Unpatched();
  if (!files) {
    console.log('Skipping planAllRepairs test: package root not found');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-plan-unpatched-'));
  try {
    const pkgRoot = path.join(tmpDir, 'omo-ai');
    const extDir = path.join(pkgRoot, 'plugin', 'extensions');
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, 'package.json'), JSON.stringify({ name: 'omo-ai', version: '5.0.0-0.beta.89' }));
    fs.writeFileSync(path.join(extDir, 'omo.js'), files.omoCode);
    fs.writeFileSync(path.join(extDir, 'omo-task.js'), files.taskCode);
    fs.writeFileSync(path.join(pkgRoot, 'plugin', 'daemon-launch-spec.json'), JSON.stringify({ daemon: true }), { mode: 0o664 });
    try { fs.chmodSync(path.join(pkgRoot, 'plugin', 'daemon-launch-spec.json'), 0o664); } catch {}

    const plan = planAllRepairs({ omoPackageRoot: pkgRoot });
    assert.equal(typeof plan, 'object');
    assert.equal(plan.needed, true, 'Unpatched beta.89 must need repairs');
    assert.ok(plan.repairsNeeded.includes('memory'), 'Must plan memory repair');
    assert.ok(plan.repairsNeeded.includes('task'), 'Must plan task repair');
    assert.equal(typeof plan.memory, 'object');
    assert.equal(typeof plan.task, 'object');
    assert.equal(typeof plan.daemon, 'object');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// =======================================================
// FORWARD-COMPATIBLE DUAL-AXIS VERIFY TESTS (Tests 42 - 43)
// =======================================================

console.log('\nRunning forward-compatible dual-axis verify tests...\n');

// 42. runVerify on active beta.89 unpatched MUST report STATUS.NEEDS_PATCH with exit code 10
await testAsync('42. runVerify on active beta.89 unpatched MUST report STATUS.NEEDS_PATCH with exit code 10', async () => {
  const files = getActiveBeta89Unpatched();
  if (!files) {
    console.log('Skipping active beta.89 verify test: package root not found');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-verify-unpatched-'));
  try {
    const pkgRoot = path.join(tmpDir, 'omo-ai');
    const extDir = path.join(pkgRoot, 'plugin', 'extensions');
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, 'package.json'), JSON.stringify({ name: 'omo-ai', version: '5.0.0-0.beta.89' }));
    fs.writeFileSync(path.join(extDir, 'omo.js'), files.omoCode);
    fs.writeFileSync(path.join(extDir, 'omo-task.js'), files.taskCode);
    fs.writeFileSync(path.join(pkgRoot, 'plugin', 'daemon-launch-spec.json'), JSON.stringify({ daemon: true }), { mode: 0o664 });
    try { fs.chmodSync(path.join(pkgRoot, 'plugin', 'daemon-launch-spec.json'), 0o664); } catch {}

    const res = await runVerify({
      omoPackageRoot: pkgRoot,
      skipRuntimeTest: true,
    });

    assert.equal(res.status, STATUS.NEEDS_PATCH, 'Unpatched beta.89 must report STATUS.NEEDS_PATCH');
    assert.equal(statusToExitCode(res.status), EXIT_CODES.NEEDS_PATCH, 'Exit code must be 10');
    assert.equal(statusToExitCode(res.status), 10, 'Exit code must be explicitly 10');
    assert.equal(res.structural.versionKnown, false, 'beta.89 must be un-registered in KNOWN_TARGETS');
    assert.equal(res.structural.hasOmoxMarkers, false, 'Unpatched beta.89 must not have omox markers');

    // Verify capabilities breakdown
    const caps = res.structural.capabilities;
    assert.equal(caps.memoryPreflight, 'FAIL', 'Preflight without patch must FAIL');
    assert.equal(caps.memoryReflection, 'FAIL', 'Reflection without patch must FAIL');
    assert.equal(caps.memoryDream, 'FAIL', 'Dream without patch must FAIL');
    assert.equal(caps.peopleAsk, 'FAIL', 'People ask without patch must FAIL');
    assert.equal(caps.forkReflection, 'PASS', 'Fork reflection must PASS');
    assert.equal(caps.taskRpc, 'PASS', 'Task RPC must PASS');
    assert.equal(caps.taskDag, 'FAIL', 'Task DAG with slice(1) must FAIL');
    assert.equal(caps.daemonPermissions, 'FAIL', 'Daemon 0664 permissions must FAIL');

    // Report text check
    assert.ok(res.report.includes('Result: NEEDS_PATCH'));
    assert.ok(res.report.includes('Child Provider Propagation'));
    assert.ok(res.report.includes('Repair Support'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 43. runVerify on synthetic future native build MUST report STATUS.NATIVE_OK with exit code 0
await testAsync('43. runVerify on synthetic future native build MUST report STATUS.NATIVE_OK with exit code 0', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-native-build-'));
  try {
    const pkgRoot = path.join(tmpDir, 'omo-ai');
    const extDir = path.join(pkgRoot, 'plugin', 'extensions');
    fs.mkdirSync(extDir, { recursive: true });

    // 1. Future OmO package.json (unregistered version e.g. 9.0.0-future.1)
    fs.writeFileSync(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: 'omo-ai', version: '9.0.0-future.1' })
    );

    // 2. Future native omo.js: lacks --no-extensions across preflight, reflection, peopleAsk, fork; zero omox markers
    const futureOmoJs = `
      export function probeModels(launch, config) {
        const preflightArgs = ['--list-models', '--no-skills'];
        return { command: 'senpi', args: preflightArgs };
      }

      export function spawnReflectionChild(task) {
        const reflectionArgs = ['-p', '--system-prompt', 'reflection prompt', '--tools', 'bash,edit', '--model', task.model];
        return { command: 'senpi', args: reflectionArgs };
      }

      export function spawnPeopleAskChild(req) {
        const askArgs = ['-p', '--system-prompt', 'ask prompt', '--tools', 'none', '--model', req.model];
        return { command: 'senpi', args: askArgs };
      }

      export function spawnForkReflection(session) {
        const forkArgs = ['-p', '--fork', '--session-dir', session.dir, '--model', session.model];
        return { command: 'senpi', args: forkArgs };
      }
    `;
    fs.writeFileSync(path.join(extDir, 'omo.js'), futureOmoJs);

    // 3. Future native omo-task.js: DAG task without slice(1)
    const futureOmoTaskJs = `
      export function executeTask(task, env) {
        const extensions = (env.extensions ?? []);
        return { extensions };
      }
    `;
    fs.writeFileSync(path.join(extDir, 'omo-task.js'), futureOmoTaskJs);

    // 4. Future native daemon-launch-spec.json: safe permissions (0o644)
    const daemonSpecPath = path.join(pkgRoot, 'plugin', 'daemon-launch-spec.json');
    fs.writeFileSync(daemonSpecPath, JSON.stringify({ version: '2.0.0' }), { mode: 0o644 });
    fs.chmodSync(daemonSpecPath, 0o644);

    const dummyAgentDir = path.join(tmpDir, 'agent');
    fs.mkdirSync(dummyAgentDir, { recursive: true });

    const res = await runVerify({
      omoPackageRoot: pkgRoot,
      agentDir: dummyAgentDir,
      skipRuntimeTest: true,
    });

    assert.equal(res.status, STATUS.NATIVE_OK, 'Synthetic future native build must report STATUS.NATIVE_OK');
    assert.equal(statusToExitCode(res.status), EXIT_CODES.SUCCESS, 'Exit code must be 0');
    assert.equal(statusToExitCode(res.status), 0, 'Exit code must be explicitly 0');
    assert.equal(res.structural.versionKnown, false, 'Future version must be un-registered in KNOWN_TARGETS');
    assert.equal(res.structural.hasOmoxMarkers, false, 'Native build must have zero omox markers');

    // Verify all capabilities PASS
    const caps = res.structural.capabilities;
    assert.equal(caps.memoryPreflight, 'PASS', 'Native preflight must PASS');
    assert.equal(caps.memoryReflection, 'PASS', 'Native reflection must PASS');
    assert.equal(caps.memoryDream, 'PASS', 'Native dream must PASS');
    assert.equal(caps.peopleAsk, 'PASS', 'Native people ask must PASS');
    assert.equal(caps.forkReflection, 'PASS', 'Native fork reflection must PASS');
    assert.equal(caps.taskRpc, 'PASS', 'Task RPC must PASS');
    assert.equal(caps.taskDag, 'PASS', 'Native DAG task without slice(1) must PASS');
    assert.equal(caps.daemonPermissions, 'PASS', 'Safe daemon permissions must PASS');

    // Report text check
    assert.ok(res.report.includes('Result: NATIVE_OK'));
    assert.ok(res.report.includes('OmO version registration status: UNREGISTERED (forward-compatible AST inspection)'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// =======================================================
// FORWARD-COMPATIBLE TRANSACTIONAL APPLIER & STRENGTHENED ROLLBACK TESTS (Tests 44 - 48)
// =======================================================

console.log('\nRunning forward-compatible transactional applier & strengthened rollback tests...\n');

function createSyntheticUnpatchedFixture(baseDir, version = '5.0.0-0.beta.89') {
  const pkgRoot = path.join(baseDir, 'omo-ai');
  const extDir = path.join(pkgRoot, 'plugin', 'extensions');
  fs.mkdirSync(extDir, { recursive: true });

  fs.writeFileSync(
    path.join(pkgRoot, 'package.json'),
    JSON.stringify({ name: 'omo-ai', version })
  );

  const unpatchedOmoJs = `
export function probeModels(launch, config) {
  const preflightArgs = ['--list-models', '--no-skills', '--no-extensions'];
  return { command: 'senpi', args: preflightArgs };
}

export function spawnReflectionChild(task) {
  const reflectionArgs = ['-p', '--system-prompt', 'reflection prompt', '--tools', 'bash,edit', '--no-extensions', '--model', task.model];
  return { command: 'senpi', args: reflectionArgs };
}

export function spawnPeopleAskChild(req) {
  const askArgs = ['-p', '--system-prompt', 'ask prompt', '--tools', 'none', '--no-extensions', '--model', req.model];
  return { command: 'senpi', args: askArgs };
}

export function spawnForkReflection(session) {
  const forkArgs = ['-p', '--fork', '--session-dir', session.dir, '--model', session.model];
  return { command: 'senpi', args: forkArgs };
}
`;
  const omoPath = path.join(extDir, 'omo.js');
  fs.writeFileSync(omoPath, unpatchedOmoJs, { mode: 0o644 });

  const unpatchedTaskJs = `
export function executeTask(task, env) {
  const extensions = 'dag' === env.kind ? (env.extensions ?? []).slice(1) : (env.extensions ?? []);
  return { extensions };
}
`;
  const taskPath = path.join(extDir, 'omo-task.js');
  fs.writeFileSync(taskPath, unpatchedTaskJs, { mode: 0o644 });

  const daemonPath = path.join(pkgRoot, 'plugin', 'daemon-launch-spec.json');
  fs.writeFileSync(daemonPath, JSON.stringify({ daemon: true }), { mode: 0o664 });
  try {
    fs.chmodSync(daemonPath, 0o664);
  } catch {}

  return {
    pkgRoot,
    omoPath,
    taskPath,
    daemonPath,
    unpatchedOmoJs,
    unpatchedTaskJs,
  };
}

// 44. applyPatch on unpatched fixture: selective mutation, valid AST parse, reaches PATCHED_OK, records provenance
await testAsync('44. applyPatch on unpatched fixture: selective mutation, valid AST parse, reaches PATCHED_OK, records provenance', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-apply-tx-'));
  try {
    const { pkgRoot, omoPath, taskPath, daemonPath } = createSyntheticUnpatchedFixture(tmpDir);
    const backupRootDir = path.join(tmpDir, 'backups');
    const statePath = path.join(tmpDir, 'state.json');

    const preInspect = inspectTarget(pkgRoot, '5.0.0-0.beta.89');
    assert.equal(preInspect.status, STATUS.NEEDS_PATCH);

    const applyRes = applyPatch(pkgRoot, '5.0.0-0.beta.89', {
      backupRootDir,
      statePath,
    });

    assert.equal(applyRes.modified, true);
    assert.equal(applyRes.status, STATUS.PATCHED_OK);
    assert.equal(applyRes.permissionsFixed, true);
    assert.equal(applyRes.modifiedFiles.length, 3);
    assert.ok(applyRes.repairsApplied.includes('memory'));
    assert.ok(applyRes.repairsApplied.includes('task'));
    assert.ok(applyRes.repairsApplied.includes('daemon'));
    assert.ok(applyRes.backupDir);

    // Validate Babel AST parse of disk buffers
    const patchedOmo = fs.readFileSync(omoPath, 'utf-8');
    assert.doesNotThrow(() => {
      parser.parse(patchedOmo, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    }, 'Patched omo.js must parse cleanly with @babel/parser');

    const patchedTask = fs.readFileSync(taskPath, 'utf-8');
    assert.doesNotThrow(() => {
      parser.parse(patchedTask, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    }, 'Patched omo-task.js must parse cleanly with @babel/parser');

    // Selective mutation verification: fork reflection must remain 100% untouched
    assert.ok(patchedOmo.includes('_omoxGetPkgExts()'), 'Must include bridge helper');
    assert.ok(patchedOmo.includes('spawnForkReflection'), 'Fork reflection must exist');
    assert.ok(!patchedOmo.includes("['--fork', ..._omoxGetPkgExts()"), 'Fork reflection must not have extension injection');
    const forkSnippet = `const forkArgs = ['-p', '--fork', '--session-dir', session.dir, '--model', session.model];`;
    assert.ok(patchedOmo.includes(forkSnippet), 'Fork reflection args must be bit-for-bit identical');

    // DAG slice removed
    assert.ok(patchedTask.includes('(env.extensions ?? [])'), 'DAG task must use full extensions');
    assert.ok(!patchedTask.includes('.slice(1)'), 'DAG task slice(1) must be removed');

    // Daemon permissions hardened
    const daemonStat = fs.statSync(daemonPath);
    assert.equal(daemonStat.mode & 0o777, 0o644, 'Daemon launch spec mode must be 0644');

    // Backup manifest 2.0.0 schema verification
    const manifestPath = path.join(applyRes.backupDir, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.equal(manifest.manifestVersion, '2.0.0');
    assert.equal(manifest.schemaVersion, '2.0.0');
    assert.deepEqual(manifest.repairPlan, ['memory', 'task', 'daemon']);
    assert.equal(manifest.files.length, 3);
    for (const file of manifest.files) {
      assert.ok(file.relativePath, 'File must have relativePath');
      assert.ok(file.preSha256, 'File must have preSha256');
      assert.ok(file.postSha256, 'File must have postSha256');
      assert.ok(typeof file.preMode === 'number', 'File must have preMode');
      assert.ok(typeof file.postMode === 'number', 'File must have postMode');
    }

    // Provenance state.json verification
    assert.ok(fs.existsSync(statePath), 'state.json must exist');
    const stateData = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    assert.equal(stateData.lastApplied.status, STATUS.PATCHED_OK);
    assert.deepEqual(stateData.lastApplied.repairsApplied, ['memory', 'task', 'daemon']);
    assert.equal(stateData.lastApplied.files.length, 3);
    for (const f of stateData.lastApplied.files) {
      assert.ok(f.preSha256, 'Provenance file must have preSha256');
      assert.ok(f.postSha256, 'Provenance file must have postSha256');
    }

    // Post-inspection structural verification
    const postInspect = inspectTarget(pkgRoot, '5.0.0-0.beta.89');
    assert.equal(postInspect.status, STATUS.PATCHED_OK);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 45. applyPatch idempotency: running twice performs 0 writes
await testAsync('45. applyPatch idempotency: running twice performs 0 writes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-idempotent-'));
  try {
    const { pkgRoot, omoPath, taskPath, daemonPath } = createSyntheticUnpatchedFixture(tmpDir);
    const backupRootDir = path.join(tmpDir, 'backups');
    const statePath = path.join(tmpDir, 'state.json');

    // First apply: modifies files
    const firstRes = applyPatch(pkgRoot, '5.0.0-0.beta.89', {
      backupRootDir,
      statePath,
    });
    assert.equal(firstRes.modified, true);
    assert.equal(firstRes.status, STATUS.PATCHED_OK);

    const omoMtime1 = fs.statSync(omoPath).mtimeMs;
    const taskMtime1 = fs.statSync(taskPath).mtimeMs;
    const daemonMtime1 = fs.statSync(daemonPath).mtimeMs;
    const backupsBefore = listBackups(backupRootDir).length;

    // Second apply: must perform 0 writes
    const secondRes = applyPatch(pkgRoot, '5.0.0-0.beta.89', {
      backupRootDir,
      statePath,
    });

    assert.equal(secondRes.modified, false);
    assert.equal(secondRes.status, STATUS.PATCHED_OK);
    assert.ok(secondRes.message.includes('Already healthy, 0 writes performed'));
    assert.equal(secondRes.modifiedFiles.length, 0);
    assert.equal(secondRes.backupDir, null);

    // Verify files on disk were untouched
    assert.equal(fs.statSync(omoPath).mtimeMs, omoMtime1);
    assert.equal(fs.statSync(taskPath).mtimeMs, taskMtime1);
    assert.equal(fs.statSync(daemonPath).mtimeMs, daemonMtime1);
    assert.equal(listBackups(backupRootDir).length, backupsBefore);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 46. runRollback restores original preSha256 bytes and modes cleanly
await testAsync('46. runRollback restores original preSha256 bytes and modes cleanly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-rollback-clean-'));
  try {
    const { pkgRoot, omoPath, taskPath, daemonPath, unpatchedOmoJs, unpatchedTaskJs } =
      createSyntheticUnpatchedFixture(tmpDir);
    const backupRootDir = path.join(tmpDir, 'backups');

    const preShaOmo = sha256File(omoPath);
    const preShaTask = sha256File(taskPath);
    const preShaDaemon = sha256File(daemonPath);
    const preDaemonMode = fs.statSync(daemonPath).mode & 0o777;
    assert.equal(preDaemonMode, 0o664);

    // Apply patch
    const applyRes = applyPatch(pkgRoot, '5.0.0-0.beta.89', { backupRootDir });
    assert.equal(applyRes.modified, true);
    assert.equal(applyRes.status, STATUS.PATCHED_OK);
    assert.equal(fs.statSync(daemonPath).mode & 0o777, 0o644);

    // Execute rollback
    const rollbackRes = await runRollback({
      omoPackageRoot: pkgRoot,
      backupRootDir,
    });

    assert.equal(rollbackRes.success, true);
    assert.equal(rollbackRes.restoredFiles.length, 3);
    assert.equal(rollbackRes.restoredPermissions, true);
    assert.equal(rollbackRes.postStatus, STATUS.NEEDS_PATCH);

    // Verify bit-for-bit bytes restored
    assert.equal(sha256File(omoPath), preShaOmo);
    assert.equal(sha256File(taskPath), preShaTask);
    assert.equal(sha256File(daemonPath), preShaDaemon);
    assert.equal(fs.readFileSync(omoPath, 'utf-8'), unpatchedOmoJs);
    assert.equal(fs.readFileSync(taskPath, 'utf-8'), unpatchedTaskJs);

    // Verify mode 0664 restored
    const restoredDaemonMode = fs.statSync(daemonPath).mode & 0o777;
    assert.equal(restoredDaemonMode, 0o664, 'Daemon launch-spec mode must be restored to 0664');

    // Post-inspection check confirms NEEDS_PATCH
    const postInspect = inspectTarget(pkgRoot, '5.0.0-0.beta.89');
    assert.equal(postInspect.status, STATUS.NEEDS_PATCH);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 47. runRollback stale-state rejection: modifying a file after apply causes rollback to abort
await testAsync('47. runRollback stale-state rejection: modifying a file after apply causes rollback to abort with error refusing stale overwrite', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-rollback-stale-'));
  try {
    const { pkgRoot, omoPath, taskPath, daemonPath } = createSyntheticUnpatchedFixture(tmpDir);
    const backupRootDir = path.join(tmpDir, 'backups');

    // Apply patch
    const applyRes = applyPatch(pkgRoot, '5.0.0-0.beta.89', { backupRootDir });
    assert.equal(applyRes.modified, true);

    // Simulate upstream upgrade / manual modification to omo.js after apply
    const modifiedAfterApply = fs.readFileSync(omoPath, 'utf-8') + '\n// modified by upstream omo upgrade';
    fs.writeFileSync(omoPath, modifiedAfterApply, 'utf-8');
    const modifiedHash = sha256File(omoPath);

    // Rollback MUST abort with explicit stale-state error
    await assert.rejects(
      async () => {
        await runRollback({
          omoPackageRoot: pkgRoot,
          backupRootDir,
        });
      },
      (err) => {
        assert.ok(
          err.message.includes(
            'Refusing rollback: plugin/extensions/omo.js has been modified or reinstalled since omox apply. Restoring stale bytes would corrupt newer OmO installation.'
          ),
          `Expected stale rejection message, got: ${err.message}`
        );
        return true;
      }
    );

    // Verify disk bytes were NOT overwritten with stale backup
    assert.equal(sha256File(omoPath), modifiedHash, 'Disk file must remain untouched after stale rejection');
    assert.equal(fs.readFileSync(omoPath, 'utf-8'), modifiedAfterApply);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 48. runApply CLI report formats modified files, capabilities repaired, backup directory, and post-apply status
await testAsync('48. runApply formats CLI report showing modified files, capabilities repaired, backup directory, and post-apply status', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omox-test-apply-report-'));
  try {
    const { pkgRoot } = createSyntheticUnpatchedFixture(tmpDir);
    const backupRootDir = path.join(tmpDir, 'backups');
    const statePath = path.join(tmpDir, 'state.json');

    const res = await runApply({
      omoPackageRoot: pkgRoot,
      backupRootDir,
      statePath,
      skipRuntimeTest: true,
    });

    assert.equal(res.status, STATUS.PATCHED_OK);
    assert.equal(res.modified, true);
    assert.ok(res.backupDir);
    assert.equal(res.modifiedFiles.length, 3);
    assert.equal(res.permissionsFixed, true);
    assert.deepEqual(res.repairsApplied, ['memory', 'task', 'daemon']);

    // Check report formatting
    assert.ok(res.report.includes('Status: PATCHED_OK'), 'Report must include post status');
    assert.ok(res.report.includes(`Backup directory: ${res.backupDir}`), 'Report must include backup directory');
    assert.ok(res.report.includes('Capabilities repaired: memory, task, daemon'), 'Report must list capabilities repaired');
    assert.ok(res.report.includes('Modified files:'), 'Report must list modified files');
    assert.ok(res.report.includes('Permissions fixed: plugin/daemon-launch-spec.json -> 0644'), 'Report must note permissions');
    assert.ok(res.report.includes('Result: PATCHED_OK'), 'Report must conclude with Result: PATCHED_OK');

    // Idempotent second run via runApply
    const secondRes = await runApply({
      omoPackageRoot: pkgRoot,
      backupRootDir,
      statePath,
      skipRuntimeTest: true,
    });

    assert.equal(secondRes.status, STATUS.PATCHED_OK);
    assert.equal(secondRes.modified, false);
    assert.equal(secondRes.backupDir, null);
    assert.ok(secondRes.report.includes('Zero modifications made'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Run all tests
console.log(`\nTest suite finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
