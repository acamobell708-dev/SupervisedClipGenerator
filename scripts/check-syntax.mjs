import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), {withFileTypes: true})) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== '__pycache__') files.push(...await sourceFiles(relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

try {
  const files = (await Promise.all(['src', 'scripts', 'tests', 'public/styles'].map(sourceFiles))).flat().sort();
  let checked = 0;
  const pythonFiles = [];
  for (const file of files) {
    const extension = path.extname(file);
    if (extension === '.js' || extension === '.mjs') {
      execFileSync(process.execPath, ['--check', file], {cwd: root, windowsHide: true, stdio: 'inherit'});
      checked++;
    } else if (extension === '.jsx' || extension === '.css') {
      const result = await transform(await readFile(path.join(root, file), 'utf8'), {
        loader: extension === '.jsx' ? 'jsx' : 'css', sourcefile: file, logLevel: 'silent',
      });
      if (result.warnings.length) throw new Error(`${file}: ${result.warnings.map(warning => warning.text).join('; ')}`);
      checked++;
    } else if (extension === '.py') {
      pythonFiles.push(file);
    }
  }
  if (pythonFiles.length) {
    execFileSync(process.env.SYNTAX_PYTHON || 'python', ['-m', 'py_compile', ...pythonFiles], {
      cwd: root, windowsHide: true, stdio: 'inherit',
    });
    checked += pythonFiles.length;
  }
  for (const file of ['package.json', 'package-lock.json']) {
    JSON.parse(await readFile(path.join(root, file), 'utf8'));
    checked++;
  }
  console.log(`Syntax checks passed for ${checked} JavaScript, JSX, CSS, Python and JSON files.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
