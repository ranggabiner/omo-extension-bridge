import fs from 'node:fs';
import * as parser from '@babel/parser';
import { scanOmoTaskJs } from '../semantic-scanner.mjs';

/**
 * Modular surgical AST repair for DAG task extension slicing in omo-task.js.
 *
 * - Uses scanOmoTaskJs from semantic-scanner.mjs to find dagSlice.
 * - If dagSlice is not present, returns { needed: false, modified: false }.
 * - If present, replaces `(e.extensions ?? []).slice(1)` with `(e.extensions ?? [])`.
 * - Leaves ordinary task/RPC runners untouched.
 * - Parses patched buffer with @babel/parser.
 * - Returns { needed: true, modified: true, patchedSource, appliedTargets: ['dagSlice'] }.
 *
 * @param {string|object} sourceOrOptions
 * @param {object} [options={}]
 * @returns {{ needed: boolean, modified: boolean, patchedSource?: string, appliedTargets?: string[] }}
 */
export function repairTask(sourceOrOptions, options = {}) {
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
    throw new TypeError('repairTask expects sourceCode string or valid options object');
  }

  const scan = scanOmoTaskJs(sourceCode);
  if (!scan.dagSlice) {
    return {
      needed: false,
      modified: false,
      appliedTargets: [],
      patchedSource: sourceCode,
    };
  }

  const sliceTarget = scan.dagSlice;
  const replacement = '(e.extensions ?? [])';
  const patchedSource =
    sourceCode.slice(0, sliceTarget.start) + replacement + sourceCode.slice(sliceTarget.end);

  // Parse patched buffer with @babel/parser to verify syntax
  try {
    parser.parse(patchedSource, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: false,
    });
  } catch (parseErr) {
    const err = new Error(`POST_PATCH_PARSE_ERROR in task.mjs: ${parseErr.message}`);
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
    appliedTargets: ['dagSlice'],
  };
}

export default repairTask;
