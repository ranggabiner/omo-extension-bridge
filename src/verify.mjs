import { detectOmo } from './lib/detect-omo.mjs';
import { detectExtensions } from './lib/detect-extensions.mjs';
import { inspectTarget } from './lib/patch.mjs';
import { runWorkerSmokeTest } from './lib/runtime-test.mjs';
import { STATUS } from './lib/status.mjs';

/**
 * Executes the verify command (strictly read-only).
 *
 * @param {object} [options={}]
 * @param {string} [options.omoPackageRoot]
 * @param {string} [options.omoExecutable]
 * @param {string} [options.agentDir]
 * @param {boolean} [options.skipRuntimeTest=false]
 * @param {number} [options.timeoutMs=30000]
 * @returns {Promise<{
 *   status: string,
 *   omo: object,
 *   extensions: object,
 *   structural: object,
 *   runtimeTest: object|null,
 *   report: string
 * }>}
 */
export async function runVerify(options = {}) {
  const omo = detectOmo({
    omoPackageRoot: options.omoPackageRoot,
    omoExecutable: options.omoExecutable,
    agentDir: options.agentDir,
  });

  const extensions = detectExtensions({
    agentDir: omo.agentDir,
    omoPackageRoot: omo.omoPackageRoot,
  });

  const structural = inspectTarget(omo.omoPackageRoot, omo.omoVersion);

  let overallStatus = structural.status;
  let runtimeTest = null;

  // Run runtime smoke test if Antigravity is installed and runtime test not skipped
  if (
    !options.skipRuntimeTest &&
    extensions.hasAntigravity &&
    extensions.antigravityEntry &&
    (overallStatus === STATUS.PATCHED_OK || overallStatus === STATUS.NATIVE_OK)
  ) {
    const targetModel = extensions.antigravityModel || 'antigravity/gemini-3.8-flash';
    try {
      runtimeTest = await runWorkerSmokeTest({
        senpiExecutable: omo.senpiExecutable,
        extensionPath: extensions.antigravityEntry,
        model: targetModel,
        agentDir: omo.agentDir,
        timeoutMs: options.timeoutMs || 30000,
      });

      if (!runtimeTest.success) {
        overallStatus = STATUS.VERIFY_FAILED;
      }
    } catch (err) {
      runtimeTest = {
        success: false,
        model: targetModel,
        extensionPath: extensions.antigravityEntry,
        catalogProbeOk: false,
        rpcExecutionOk: false,
        response: null,
        durationMs: 0,
        error: err.message,
      };
      overallStatus = STATUS.VERIFY_FAILED;
    }
  }

  // Format terminal report
  const lines = [];
  lines.push('OmO Extension Bridge');
  lines.push('');
  lines.push('OmO');
  lines.push(`  Version: ${omo.omoVersion}`);
  if (omo.senpiVersion) {
    lines.push(`  Senpi Version: ${omo.senpiVersion}`);
  }
  if (omo.senpiExecutable) {
    lines.push(`  Senpi Binary: ${omo.senpiExecutable}`);
  }
  lines.push(`  Root: ${omo.omoPackageRoot}`);
  lines.push(`  Agent Dir: ${omo.agentDir}`);
  lines.push('');

  lines.push('Extensions');
  const pkgCount = extensions.packages.length;
  lines.push(
    `  Package-managed discovery: ${pkgCount > 0 ? `FOUND (${pkgCount} packages)` : 'NONE'}`
  );
  if (pkgCount > 0) {
    for (const p of extensions.packages) {
      lines.push(`    - ${p.name}@${p.version}`);
    }
  }
  lines.push('');

  const taskFile = structural.files['plugin/extensions/omo-task.js'];
  const omoFile = structural.files['plugin/extensions/omo.js'];

  const taskOk = taskFile?.status === 'PATCHED' || taskFile?.status === 'NATIVE';
  const taskStatus = taskOk ? 'PASS' : taskFile?.status === 'NEEDS_PATCH' ? 'NEEDS_PATCH' : 'UNKNOWN';

  const omoOk = omoFile?.status === 'PATCHED' || omoFile?.status === 'NATIVE';
  const omoStatus = omoOk ? 'PASS' : omoFile?.status === 'NEEDS_PATCH' ? 'NEEDS_PATCH' : 'UNKNOWN';

  lines.push('Child Provider Propagation');
  lines.push(`  Task/RPC: ${taskStatus}`);
  lines.push(`  Team/Workpool/Revival: ${taskStatus}`);
  lines.push(`  Memory model preflight: ${omoStatus}`);
  lines.push(`  Memory reflection: ${omoStatus}`);
  lines.push(`  Memory dream: ${omoStatus}`);
  lines.push(`  People ask: ${omoStatus}`);
  lines.push('');

  lines.push('Daemon');
  lines.push(
    `  Launch spec permissions: ${structural.launchSpec.modeOctal || 'N/A'}`
  );
  lines.push(
    `  Security check: ${structural.launchSpec.isSafe ? 'PASS' : 'FAIL (group/world writable)'}`
  );
  lines.push('');

  if (extensions.hasAntigravity) {
    lines.push('Antigravity');
    lines.push(`  Installed: yes`);
    if (extensions.antigravityModel) {
      lines.push(`  Configured model: ${extensions.antigravityModel}`);
    }
    if (runtimeTest) {
      lines.push(
        `  Parent catalog: ${runtimeTest.catalogProbeOk ? 'PASS' : 'FAIL'}`
      );
      lines.push(
        `  Task worker: ${runtimeTest.rpcExecutionOk ? `PASS (${runtimeTest.durationMs}ms)` : `FAIL (${runtimeTest.error || 'error'})`}`
      );
      lines.push(
        `  Reflection child: ${omoOk ? 'PASS' : 'NEEDS_PATCH'}`
      );
    } else if (options.skipRuntimeTest) {
      lines.push('  Task worker: SKIPPED (--skip-runtime-test)');
    } else {
      lines.push(
        `  Task worker: SKIPPED (status is ${overallStatus})`
      );
    }
    lines.push('');
  }

  lines.push(`Result: ${overallStatus}`);

  const report = lines.join('\n');

  return {
    status: overallStatus,
    omo,
    extensions,
    structural,
    runtimeTest,
    report,
  };
}
