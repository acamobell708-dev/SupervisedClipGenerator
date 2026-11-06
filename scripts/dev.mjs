import { context } from 'esbuild';

const ctx = await context({
  entryPoints: ['src/client/main.jsx'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  jsx: 'automatic',
  outfile: 'public/assets/app.js',
  sourcemap: true,
  logLevel: 'info',
});
await ctx.watch();
await import('../src/server.js');
console.log('Frontend rebuilds on changes. Restart npm run dev after editing server-side files.');
