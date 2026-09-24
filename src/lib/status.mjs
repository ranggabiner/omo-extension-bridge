/**
 * Status definitions and exit codes for omox.
 */

export const STATUS = Object.freeze({
  NATIVE_OK: 'NATIVE_OK',
  PATCHED_OK: 'PATCHED_OK',
  NEEDS_PATCH: 'NEEDS_PATCH',
  INCOMPATIBLE: 'INCOMPATIBLE',
  VERIFY_FAILED: 'VERIFY_FAILED',
});

export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,        // NATIVE_OK / PATCHED_OK / successful apply / successful rollback
  NEEDS_PATCH: 10,   // NEEDS_PATCH
  INCOMPATIBLE: 20,  // INCOMPATIBLE
  VERIFY_FAILED: 30, // VERIFY_FAILED
  NO_BACKUP: 40,     // No valid rollback backup available
  CLI_ERROR: 50,     // Usage / internal CLI error
});

/**
 * Map an overall status string to its documented exit code.
 * @param {string} status
 * @returns {number}
 */
export function statusToExitCode(status) {
  switch (status) {
    case STATUS.NATIVE_OK:
    case STATUS.PATCHED_OK:
      return EXIT_CODES.SUCCESS;
    case STATUS.NEEDS_PATCH:
      return EXIT_CODES.NEEDS_PATCH;
    case STATUS.INCOMPATIBLE:
      return EXIT_CODES.INCOMPATIBLE;
    case STATUS.VERIFY_FAILED:
      return EXIT_CODES.VERIFY_FAILED;
    default:
      return EXIT_CODES.CLI_ERROR;
  }
}
