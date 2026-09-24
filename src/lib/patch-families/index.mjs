import fs from 'node:fs';
import path from 'node:path';
import { repairMemory, OMOX_MEMORY_IMPORTS, OMOX_MEMORY_HELPER, EXTENSION_SPREAD_SNIPPET } from './memory.mjs';
import { repairTask } from './task.mjs';
import { repairDaemon, isDaemonLaunchSpecSafe } from './daemon.mjs';

export {
  repairMemory,
  OMOX_MEMORY_IMPORTS,
  OMOX_MEMORY_HELPER,
  EXTENSION_SPREAD_SNIPPET,
  repairTask,
  repairDaemon,
  isDaemonLaunchSpecSafe,
};

/**
 * Plans (and optionally applies) all modular repairs for OmO:
 * - memory: preflight, reflection, peopleAsk in omo.js
 * - task: DAG task extension slice in omo-task.js
 * - daemon: permission hardening on daemon-launch-spec.json
 *
 * @param {string|object} [options={}]
 * @returns {{
 *   needed: boolean,
 *   repairsNeeded: string[],
 *   totalNeeded: number,
 *   memory: object,
 *   task: object,
 *   daemon: object,
 *   paths: { memoryPath: string|null, taskPath: string|null, daemonPath: string|null }
 * }}
 */
export function planAllRepairs(options = {}) {
  const opts = typeof options === 'string' ? { omoPackageRoot: options } : (options || {});
  const omoPackageRoot = opts.omoPackageRoot || null;

  let memorySource = opts.memorySource || null;
  let taskSource = opts.taskSource || null;
  let daemonPath = opts.daemonPath || null;
  let memoryPath = opts.memoryPath || null;
  let taskPath = opts.taskPath || null;

  if (omoPackageRoot) {
    if (!memoryPath) memoryPath = path.join(omoPackageRoot, 'plugin', 'extensions', 'omo.js');
    if (!taskPath) taskPath = path.join(omoPackageRoot, 'plugin', 'extensions', 'omo-task.js');
    if (!daemonPath) daemonPath = path.join(omoPackageRoot, 'plugin', 'daemon-launch-spec.json');
  }

  // 1. Evaluate memory repair
  let memoryPlan;
  if (memorySource) {
    memoryPlan = repairMemory(memorySource, { ...opts, write: false });
  } else if (memoryPath && fs.existsSync(memoryPath)) {
    const code = fs.readFileSync(memoryPath, 'utf-8');
    memoryPlan = repairMemory(code, { ...opts, write: false, filePath: memoryPath });
  } else {
    memoryPlan = { needed: false, modified: false, reason: 'FILE_NOT_FOUND', path: memoryPath };
  }

  // 2. Evaluate task repair
  let taskPlan;
  if (taskSource) {
    taskPlan = repairTask(taskSource, { ...opts, write: false });
  } else if (taskPath && fs.existsSync(taskPath)) {
    const code = fs.readFileSync(taskPath, 'utf-8');
    taskPlan = repairTask(code, { ...opts, write: false, filePath: taskPath });
  } else {
    taskPlan = { needed: false, modified: false, reason: 'FILE_NOT_FOUND', path: taskPath };
  }

  // 3. Evaluate daemon repair
  let daemonPlan;
  if (daemonPath && fs.existsSync(daemonPath)) {
    daemonPlan = repairDaemon(daemonPath, { dryRun: true });
  } else {
    daemonPlan = { needed: false, isSafe: true, reason: 'FILE_NOT_FOUND', path: daemonPath };
  }

  const repairsNeeded = [];
  if (memoryPlan.needed) repairsNeeded.push('memory');
  if (taskPlan.needed) repairsNeeded.push('task');
  if (daemonPlan.needed) repairsNeeded.push('daemon');

  if (opts.apply) {
    if (memoryPlan.needed && memoryPath) {
      repairMemory(memoryPath, { write: true });
    }
    if (taskPlan.needed && taskPath) {
      repairTask(taskPath, { write: true });
    }
    if (daemonPlan.needed && daemonPath) {
      repairDaemon(daemonPath, { apply: true });
    }
  }

  return {
    needed: repairsNeeded.length > 0,
    repairsNeeded,
    totalNeeded: repairsNeeded.length,
    memory: memoryPlan,
    task: taskPlan,
    daemon: daemonPlan,
    paths: {
      memoryPath,
      taskPath,
      daemonPath,
    },
  };
}

export default {
  repairMemory,
  repairTask,
  repairDaemon,
  planAllRepairs,
};
