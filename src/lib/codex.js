import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export function getCodexBin() {
  return process.env.OPENCODEX_CODEX_BIN || 'codex';
}

export async function runCommandCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function runCommandToFile(command, args, options = {}) {
  const stdoutPath = options.stdoutPath;
  if (stdoutPath) {
    await mkdir(path.dirname(stdoutPath), { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const stdoutStream = stdoutPath ? createWriteStream(stdoutPath, { flags: 'w' }) : null;
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutStream?.write(text);
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      stdoutStream?.end();
      reject(error);
    });

    child.on('close', (code) => {
      stdoutStream?.end();
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
