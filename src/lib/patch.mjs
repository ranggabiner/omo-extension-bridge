import fs from 'node:fs';
import path from 'node:path';
import { KNOWN_TARGETS, sha256File, sha256 } from './hashes.mjs';
import { checkLaunchSpecPermissions, ensureSafePermissions } from './permissions.mjs';
import { PATCH_DATA } from './patch-data.mjs';
import { STATUS } from './status.mjs';

/**
 * Inspect an OmO installation and return structural status and file diagnostics.
 *
 * @param {string} omoPackageRoot
 * @param {string} omoVersion
 * @returns {{
 *   status: string,
 *   isCompatible: boolean,
 *   versionKnown: boolean,
 *   targetDef: object|null,
 *   files: Record<string, {
 *     status: 'PATCHED'|'NEEDS_PATCH'|'NATIVE'|'UNKNOWN'|'MISSING',
 *     currentHash: string|null,
 *     expectedPatchedHash: string|null,
 *     expectedUnpatchedHash: string|null,
 *     hasPatchedSignatures: boolean,
 *     hasUnpatchedAnchors: boolean,
 *   }>,
 *   launchSpec: {
 *     exists: boolean,
 *     mode: number|null,
 *     modeOctal: string|null,
 *     isSafe: boolean,
 *     path: string
 *   }
 * }}
 */
export function inspectTarget(omoPackageRoot, omoVersion) {
  const targetDef = KNOWN_TARGETS[omoVersion] || null;
  const launchSpecPath = path.join(
    omoPackageRoot,
    targetDef?.daemonSpecRelativePath || 'plugin/daemon-launch-spec.json'
  );
  const launchSpec = checkLaunchSpecPermissions(launchSpecPath);

  if (!targetDef) {
    // Check if a non-registered version might natively support extension propagation
    const taskPath = path.join(omoPackageRoot, 'plugin', 'extensions', 'omo-task.js');
    let isNativeCandidate = false;
    if (fs.existsSync(taskPath)) {
      try {
        const content = fs.readFileSync(taskPath, 'utf-8');
        // If resolveInheritedExtensions is present natively and slice(1) bug is absent
        if (
          content.includes('resolveInheritedExtensions') &&
          !content.includes('(e.extensions??[]).slice(1)') &&
          launchSpec.isSafe
        ) {
          isNativeCandidate = true;
        }
      } catch {}
    }

    return {
      status: isNativeCandidate ? STATUS.NATIVE_OK : STATUS.INCOMPATIBLE,
      isCompatible: isNativeCandidate,
      versionKnown: false,
      targetDef: null,
      files: {},
      launchSpec,
    };
  }

  const filesReport = {};
  let anyNeedsPatch = false;
  let anyUnknown = false;
  let allPatched = true;
  let allNative = true;

  for (const [relPath, fileDef] of Object.entries(targetDef.files)) {
    const absPath = path.join(omoPackageRoot, relPath);
    if (!fs.existsSync(absPath)) {
      filesReport[relPath] = {
        status: 'MISSING',
        currentHash: null,
        expectedPatchedHash: fileDef.patchedHash,
        expectedUnpatchedHash: fileDef.unpatchedHash,
        hasPatchedSignatures: false,
        hasUnpatchedAnchors: false,
      };
      anyUnknown = true;
      allPatched = false;
      allNative = false;
      continue;
    }

    const currentHash = sha256File(absPath);
    let content = '';
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {}

    const hasPatchedSignatures = fileDef.patchedAnchor
      ? content.includes(fileDef.patchedAnchor)
      : false;
    const hasUnpatchedAnchors = fileDef.unpatchedAnchor
      ? content.includes(fileDef.unpatchedAnchor)
      : false;
    const hasNativeIndicator = fileDef.nativeIndicator
      ? content.includes(fileDef.nativeIndicator)
      : false;

    let fileStatus = 'UNKNOWN';

    if (currentHash === fileDef.patchedHash || hasPatchedSignatures) {
      fileStatus = 'PATCHED';
      allNative = false;
    } else if (currentHash === fileDef.unpatchedHash || hasUnpatchedAnchors) {
      fileStatus = 'NEEDS_PATCH';
      anyNeedsPatch = true;
      allPatched = false;
      allNative = false;
    } else if (hasNativeIndicator && !content.includes('(e.extensions??[]).slice(1)')) {
      fileStatus = 'NATIVE';
      allPatched = false;
    } else {
      fileStatus = 'UNKNOWN';
      anyUnknown = true;
      allPatched = false;
      allNative = false;
    }

    filesReport[relPath] = {
      status: fileStatus,
      currentHash,
      expectedPatchedHash: fileDef.patchedHash,
      expectedUnpatchedHash: fileDef.unpatchedHash,
      hasPatchedSignatures,
      hasUnpatchedAnchors,
    };
  }

  // Check launch spec permissions
  const daemonNeedsFix = launchSpec.exists && !launchSpec.isSafe;

  let overallStatus = STATUS.INCOMPATIBLE;
  if (anyUnknown) {
    overallStatus = STATUS.INCOMPATIBLE;
  } else if (allNative && launchSpec.isSafe) {
    overallStatus = STATUS.NATIVE_OK;
  } else if (allPatched && launchSpec.isSafe) {
    overallStatus = STATUS.PATCHED_OK;
  } else if (anyNeedsPatch || daemonNeedsFix) {
    overallStatus = STATUS.NEEDS_PATCH;
  } else {
    overallStatus = STATUS.INCOMPATIBLE;
  }

  return {
    status: overallStatus,
    isCompatible: overallStatus !== STATUS.INCOMPATIBLE,
    versionKnown: true,
    targetDef,
    files: filesReport,
    launchSpec,
  };
}

/**
 * Applies the compatibility patch to the target OmO installation.
 * FAIL-CLOSED: throws if preflight checks fail, if any hunk fails to match,
 * or if post-patch hash verification fails.
 *
 * @param {string} omoPackageRoot
 * @param {string} omoVersion
 * @returns {{ modifiedFiles: string[], permissionsFixed: boolean }}
 */
export function applyPatch(omoPackageRoot, omoVersion) {
  const preflight = inspectTarget(omoPackageRoot, omoVersion);
  if (preflight.status !== STATUS.NEEDS_PATCH) {
    throw new Error(
      `Cannot apply patch: installation is not in NEEDS_PATCH state (currently ${preflight.status})`
    );
  }

  const versionHunks = PATCH_DATA[omoVersion];
  if (!versionHunks) {
    throw new Error(`No patch definitions available for OmO version ${omoVersion}`);
  }

  const modifiedFiles = [];

  // Apply file patches
  for (const [relPath, hunks] of Object.entries(versionHunks)) {
    const fileDef = preflight.targetDef?.files?.[relPath];
    const absPath = path.join(omoPackageRoot, relPath);

    if (!fs.existsSync(absPath)) {
      throw new Error(`Target file to patch does not exist: ${absPath}`);
    }

    let content = fs.readFileSync(absPath, 'utf-8');

    // If file is already patched, skip modifying it
    if (fileDef && sha256(content) === fileDef.patchedHash) {
      continue;
    }

    // Verify all hunks match before making any replacement
    for (let i = 0; i < hunks.length; i++) {
      const hunk = hunks[i];
      const matchCount = content.split(hunk.oldText).length - 1;
      if (matchCount !== 1) {
        throw new Error(
          `Structural anchor verification failed in ${relPath} for "${hunk.name}". Expected 1 match, found ${matchCount}.`
        );
      }
    }

    // Apply hunks sequentially
    for (const hunk of hunks) {
      content = content.replace(hunk.oldText, hunk.newText);
    }

    // Post-apply integrity check
    if (fileDef?.patchedHash) {
      const resultingHash = sha256(content);
      if (resultingHash !== fileDef.patchedHash) {
        throw new Error(
          `Post-patch hash verification failed for ${relPath}. Expected ${fileDef.patchedHash}, got ${resultingHash}.`
        );
      }
    }

    // Write patched content
    fs.writeFileSync(absPath, content, 'utf-8');
    modifiedFiles.push(absPath);
  }

  // Ensure daemon launch-spec permissions
  let permissionsFixed = false;
  const launchSpecPath = path.join(
    omoPackageRoot,
    preflight.targetDef?.daemonSpecRelativePath || 'plugin/daemon-launch-spec.json'
  );
  if (fs.existsSync(launchSpecPath)) {
    const permResult = ensureSafePermissions(launchSpecPath, 0o644);
    if (permResult.modified) {
      permissionsFixed = true;
      modifiedFiles.push(launchSpecPath);
    }
  }

  // Final post-patch inspection
  const postInspection = inspectTarget(omoPackageRoot, omoVersion);
  if (postInspection.status !== STATUS.PATCHED_OK) {
    throw new Error(
      `Post-patch verification did not reach PATCHED_OK state (ended with ${postInspection.status})`
    );
  }

  return {
    modifiedFiles,
    permissionsFixed,
  };
}
