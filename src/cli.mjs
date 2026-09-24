#!/usr/bin/env node

import { runVerify } from './verify.mjs';
import { runApply } from './apply.mjs';
import { runRollback } from './rollback.mjs';
import { runUpdate } from './update.mjs';
import { statusToExitCode, EXIT_CODES } from './lib/status.mjs';
import { getOmoxVersion } from './lib/version.mjs';

function printHelp() {
  const version = getOmoxVersion();
  console.log(`omox - OmO package-extension propagation compatibility bridge (v${version})

Usage:
  omox <command> [options]

Commands:
  verify       Inspect OmO compatibility without modifying it.
  apply        Apply the compatibility patch when safely required.
  rollback     Restore the exact state before the latest omox apply.
  update       Update omox itself from the official GitHub repository.

Note:
  omox update does NOT update OmO.

Options:
  --source <source>     Custom package source for update (default: github:ranggabiner/omo-extension-bridge#main)
  --pm <bun|npm>        Force specific package manager for update
  --skip-runtime-test   Skip out-of-process worker smoke test
  --timeout <ms>        Timeout for runtime smoke test in milliseconds (default: 30000)
  --omo-root <path>     Explicit path to OmO package root directory
  --agent-dir <path>    Explicit path to OmO agent directory
  --backup-root <path>  Explicit directory for storing/reading backups
  --json                Output result as structured JSON
  --verbose             Display extra diagnostics
  --version, -v         Show version number
  --help, -h            Show this help text

Exit codes:
  0   Success (NATIVE_OK / PATCHED_OK / successful apply / successful rollback / update)
  10  NEEDS_PATCH (known affected OmO installation detected)
  20  INCOMPATIBLE (unknown or unsupported OmO structure)
  30  VERIFY_FAILED (structural or runtime test failed)
  40  NO_BACKUP (no valid rollback backup available)
  50  CLI / internal error
`);
}

function parseArgs(args) {
  let command = null;
  const options = {
    skipRuntimeTest: false,
    timeoutMs: 30000,
    omoPackageRoot: null,
    agentDir: null,
    backupRootDir: null,
    source: null,
    overridePm: null,
    json: false,
    verbose: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (arg === '--skip-runtime-test') {
      options.skipRuntimeTest = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--timeout') {
      const val = parseInt(args[++i], 10);
      if (!isNaN(val)) options.timeoutMs = val;
    } else if (arg === '--omo-root') {
      options.omoPackageRoot = args[++i];
    } else if (arg === '--agent-dir') {
      options.agentDir = args[++i];
    } else if (arg === '--backup-root') {
      options.backupRootDir = args[++i];
    } else if (arg === '--source') {
      options.source = args[++i];
    } else if (arg === '--pm') {
      options.overridePm = args[++i];
    } else if (!arg.startsWith('-') && !command) {
      command = arg;
    }
  }

  return { command, options };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (options.version) {
    console.log(getOmoxVersion());
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (options.help) {
    printHelp();
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (!command) {
    printHelp();
    process.exit(EXIT_CODES.CLI_ERROR);
  }

  try {
    switch (command) {
      case 'verify': {
        const result = await runVerify(options);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(result.report);
        }
        process.exit(statusToExitCode(result.status));
        break;
      }

      case 'apply': {
        const result = await runApply(options);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(result.report);
        }
        process.exit(statusToExitCode(result.status));
        break;
      }

      case 'rollback': {
        const result = await runRollback(options);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(result.report);
        }
        process.exit(result.exitCode);
        break;
      }

      case 'update': {
        const result = await runUpdate(options);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(result.report);
        }
        process.exit(result.exitCode);
        break;
      }

      default: {
        console.error(`Unknown command: "${command}"\n`);
        printHelp();
        process.exit(EXIT_CODES.CLI_ERROR);
      }
    }
  } catch (error) {
    if (options.json) {
      console.error(JSON.stringify({ error: error.message }, null, 2));
    } else {
      console.error(`\nError: ${error.message}`);
      if (options.verbose && error.stack) {
        console.error(`\nStack trace:\n${error.stack}`);
      }
    }
    process.exit(EXIT_CODES.CLI_ERROR);
  }
}

main();
