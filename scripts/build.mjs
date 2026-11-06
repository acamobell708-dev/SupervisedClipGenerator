import { build } from 'esbuild';

await build({
  entryPoints: ['src/client/main.jsx'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  jsx: 'automatic',
  outfile: 'public/assets/app.js',
  minify: process.env.NODE_ENV === 'production',
  sourcemap: true,
  logLevel: 'info',
});
