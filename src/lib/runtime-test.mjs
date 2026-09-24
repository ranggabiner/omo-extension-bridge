import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';

/**
 * Runs an out-of-process worker smoke test to verify extension propagation.
 * Proves that an out-of-process child can:
 * 1. Load the provider extension
 * 2. Register models in catalog probe
 * 3. Complete a minimal prompt
 * 4. Return output
 *
 * @param {object} params
 * @param {string} params.extensionPath Absolute path to extension entrypoint
 * @param {string} params.model Target model (e.g. 'antigravity/gemini-3.8-flash')
 * @param {string} params.agentDir OmO agent directory
 * @param {number} [params.timeoutMs=15000] Maximum timeout in milliseconds
 * @returns {Promise<{
 *   success: boolean,
 *   model: string,
 *   extensionPath: string,
 *   catalogProbeOk: boolean,
 *   rpcExecutionOk: boolean,
 *   response: string|null,
 *   durationMs: number,
 *   error: string|null
 * }>}
 */
export async function runWorkerSmokeTest({
  extensionPath,
  model,
  agentDir,
  timeoutMs = 15000,
}) {
  const startTime = Date.now();

  if (!extensionPath || !fs.existsSync(extensionPath)) {
    return {
      success: false,
      model,
      extensionPath: extensionPath || '',
      catalogProbeOk: false,
      rpcExecutionOk: false,
      response: null,
      durationMs: 0,
      error: `Extension entrypoint not found: ${extensionPath}`,
    };
  }

  // Phase 1: Catalog probe check
  const providerName = model.includes('/') ? model.split('/')[0] : model;
  const catalogCheck = await new Promise((resolve) => {
    let p;
    try {
      const probeArgs = [
        '--no-extensions',
        '--extension',
        extensionPath,
        '--no-skills',
        '--no-prompt-templates',
        '--no-context-files',
        '--list-models',
        providerName,
      ];
      p = spawn('senpi', probeArgs, {
        env: {
          ...process.env,
          SENPI_CODING_AGENT_DIR: agentDir,
          OMO_CODING_AGENT_DIR: agentDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return resolve({ ok: false, error: err.message });
    }

    let stdout = '';
    let stderr = '';
    p.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    p.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      try {
        p.kill('SIGTERM');
      } catch {}
      resolve({ ok: false, error: 'Catalog probe timed out' });
    }, Math.min(8000, timeoutMs));

    p.on('close', (code) => {
      clearTimeout(timer);
      const outputLower = stdout.toLowerCase();
      const hasProvider = outputLower.includes(providerName.toLowerCase());
      resolve({
        ok: code === 0 && hasProvider,
        error: code !== 0 ? `Probe exited with code ${code}: ${stderr.trim()}` : null,
      });
    });

    p.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });

  if (!catalogCheck.ok) {
    return {
      success: false,
      model,
      extensionPath,
      catalogProbeOk: false,
      rpcExecutionOk: false,
      response: null,
      durationMs: Date.now() - startTime,
      error: catalogCheck.error || `Provider "${providerName}" missing from catalog probe output`,
    };
  }

  // Phase 2: Out-of-process RPC child prompt
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        'senpi',
        [
          '--mode',
          'rpc',
          '--no-extensions',
          '--extension',
          extensionPath,
          '--model',
          model,
          '--thinking',
          'off',
          '--no-session',
          '--no-tools',
          '--no-skills',
          '--no-prompt-templates',
          '--no-context-files',
        ],
        {
          env: {
            ...process.env,
            SENPI_CODING_AGENT_DIR: agentDir,
            OMO_CODING_AGENT_DIR: agentDir,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
    } catch (err) {
      return resolve({
        success: false,
        model,
        extensionPath,
        catalogProbeOk: true,
        rpcExecutionOk: false,
        response: null,
        durationMs: Date.now() - startTime,
        error: `Failed to spawn child: ${err.message}`,
      });
    }

    const rl = readline.createInterface({ input: child.stdout });
    let assistantText = '';
    let stderr = '';
    let settled = false;

    child.stderr?.on('data', (d) => {
      stderr += d.toString();
      if (/Error:\s+Model\s+["'].*?["']\s+not\s+found/i.test(stderr)) {
        finish(false, `Model not found in child: ${stderr.trim()}`);
      }
    });

    const timer = setTimeout(() => {
      finish(false, `RPC smoke test timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    function finish(success, error = null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
      } catch {}

      resolve({
        success,
        model,
        extensionPath,
        catalogProbeOk: true,
        rpcExecutionOk: success,
        response: assistantText.trim() || null,
        durationMs: Date.now() - startTime,
        error,
      });
    }

    rl.on('line', (line) => {
      if (settled) return;
      try {
        const msg = JSON.parse(line);
        // Handle UI requests from extensions
        if (msg.type === 'extension_ui_request') {
          const resp = {
            type: 'extension_ui_response',
            id: msg.id,
            cancelled: true,
          };
          child.stdin.write(JSON.stringify(resp) + '\n');
        } else if (msg.type === 'message_end' && msg.message?.role === 'assistant') {
          const texts = (msg.message.content || [])
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('');
          assistantText = texts;
        } else if (msg.type === 'turn_end' || msg.type === 'agent_end') {
          finish(true);
        } else if (msg.type === 'response' && msg.success === false) {
          finish(false, msg.error || 'RPC command rejected');
        }
      } catch {}
    });

    child.on('error', (err) => finish(false, err.message));
    child.on('close', (code) => {
      if (!settled) {
        finish(
          assistantText.length > 0,
          code !== 0 ? `Process exited with code ${code}` : null
        );
      }
    });

    // Send the prompt
    const promptMsg = JSON.stringify({
      id: 'omox-smoke',
      type: 'prompt',
      message: 'Reply with exactly: OMOX_OK',
    }) + '\n';

    child.stdin.write(promptMsg);
  });
}
