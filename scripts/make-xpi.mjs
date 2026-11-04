import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';

const sourceDir = 'build/addon';
const distDir = 'build';
const outPath = path.join(distDir, 'zotero-cover-grid.xpi');

if (!fs.existsSync(path.join(sourceDir, 'manifest.json')) || !fs.existsSync(path.join(sourceDir, 'bootstrap.js'))) {
  throw new Error('[make-xpi] CRITICAL: manifest.json or bootstrap.js missing in build/addon!');
}

const output = fs.createWriteStream(outPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`[make-xpi] Generated XPI: ${outPath} (${(archive.pointer() / 1024).toFixed(1)} KB)`);
});

archive.on('error', (err) => { throw err; });
archive.pipe(output);
archive.directory(sourceDir, false);
await archive.finalize();
