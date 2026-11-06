import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.venv-subtitles', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(binary, args, quiet = false, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {cwd: root, shell: false, windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'inherit'] : quiet ? 'ignore' : 'inherit'});
    let output = '';
    child.stdout?.on('data', chunk => {output = (output + chunk.toString()).slice(-65536);});
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(output) : reject(new Error(`${binary} exited with code ${code}`)));
  });
}

async function downloadDirectModel(model) {
  if (!/^(tiny|base|small|medium)(\.en)?$/.test(model)) throw new Error('Automatic direct-download fallback supports tiny/base/small/medium models only.');
  // Some networks allow the official file resolver but interrupt the Hub listing API.
  // Use Windows certificate trust, keep HTTPS verification enabled, and pin one revision.
  const curl = ['--http1.1', '--tlsv1.2', '--tls-max', '1.2', '--proto', '=https', '--proto-redir', '=https', '--silent', '--show-error', '--fail'];
  const base = `https://huggingface.co/Systran/faster-whisper-${model}/resolve/`;
  const headers = await run('curl.exe', [...curl, '--head', '--max-time', '30', `${base}main/config.json`], false, true);
  const revision = headers.match(/^x-repo-commit:\s*([a-f0-9]{40})/im)?.[1];
  if (!revision) throw new Error('Could not determine the public model revision. Please retry setup.');
  const directory = path.join(root, '.cache/whisper-models', `direct-${createHash('sha256').update(model).digest('hex').slice(0, 16)}`);
  await mkdir(directory, {recursive: true});
  for (const filename of ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt']) {
    console.log(`Downloading ${model}/${filename} from the official model repository…`);
    const target = path.join(directory, filename);
    const url = `${base}${revision}/${filename}`;
    await run('curl.exe', [...curl, '--location', '--max-time', '300', '--retry', '2', '--output', `${target}.part`, url]);
    if (filename === 'model.bin') {
      const weightsHeaders = await run('curl.exe', [...curl, '--head', '--max-time', '30', url], false, true);
      const expected = weightsHeaders.match(/^x-linked-etag:\s*"?([a-f0-9]{64})/im)?.[1];
      if (!expected) throw new Error('Could not verify the speech model checksum. Please retry setup.');
      const actual = createHash('sha256').update(await readFile(`${target}.part`)).digest('hex');
      if (actual !== expected) throw new Error('Speech model checksum did not match. Please retry setup.');
    }
    await rename(`${target}.part`, target);
  }
  await writeFile(path.join(directory, 'complete.json'), JSON.stringify({model, revision}));
}
try {
  if (!existsSync(python)) {
    const candidates = process.platform === 'win32'
      ? [['py', '-3.12'], ['py', '-3.11'], ['py', '-3.10'], ['python']]
      : [['python3'], ['python']];
    let interpreter;
    for (const candidate of candidates) {
      try { await run(candidate[0], [...candidate.slice(1), '--version'], true); interpreter = candidate; break; } catch {}
    }
    if (!interpreter) throw new Error('Install Python 3.10–3.12, then run npm run setup:subtitles again.');
    console.log('Creating isolated .venv-subtitles environment…');
    await run(interpreter[0], [...interpreter.slice(1), '-m', 'venv', path.dirname(path.dirname(python))]);
  }
  // Modern pip uses system certificate trust. Older Windows Python installations
  // can ship pip versions whose private CA bundle misses a locally trusted issuer.
  try {
    await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '--retries', '0', '--upgrade', 'pip']);
  } catch {
    console.log('Trying the default Python installer to bootstrap current pip securely…');
    const bootstrap = path.join(root, '.cache/bootstrap');
    await run(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'pip', 'download', '--disable-pip-version-check',
      '--no-cache-dir', '--only-binary=:all:', '--no-deps', '--dest', bootstrap, 'pip']);
    await run(python, ['-m', 'pip', 'install', '--no-index', '--find-links', bootstrap, '--upgrade', 'pip']);
  }
  await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '-r', 'requirements-subtitles.txt']);
  console.log('Downloading/verifying local speech model (first setup requires internet)…');
  const model = process.env.WHISPER_MODEL?.trim() || 'base';
  const prepare = ['scripts/transcribe.py', '--prepare', '--model', model,
    '--model-dir', path.join(root, '.cache/whisper-models'), '--cache-dir', path.join(root, '.cache/transcripts')];
  try { await run(python, prepare); }
  catch (error) {
    if (process.platform !== 'win32') throw error;
    console.log('Trying the official file resolver with Windows curl…');
    await downloadDirectModel(model);
    await run(python, prepare);
  }
  console.log('Setup complete. Restart the app, then enable Add white subtitles. No API key or GPU needed.');
} catch (error) {
  console.error(`Local subtitle setup failed: ${error.message}`);
  process.exitCode = 1;
}
