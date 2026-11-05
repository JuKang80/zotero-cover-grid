import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const isProd = process.argv.includes('--prod');
const outDir = 'build/addon';

fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync('addon')) {
  fs.cpSync('addon', outDir, { recursive: true });
}

await esbuild.build({
  entryPoints: ['src/bootstrap.ts'],
  bundle: true,
  format: 'iife',
  globalName: '__ZoteroCoverGridExport__',
  outfile: path.join(outDir, 'bootstrap.js'),
  target: ['firefox128', 'es2022'],
  minify: isProd,
  sourcemap: !isProd ? 'inline' : false,
  footer: {
    js: 'var { install, startup, shutdown, uninstall, onMainWindowLoad, onMainWindowUnload } = __ZoteroCoverGridExport__;'
  },
  external: [
    'resource://*',
    'chrome://*'
  ],
  loader: {
    '.css': 'text'
  },
  logLevel: 'info',
});

console.log(`[build.mjs] Compiled bootstrap.js (${isProd ? 'prod' : 'dev'})`);
