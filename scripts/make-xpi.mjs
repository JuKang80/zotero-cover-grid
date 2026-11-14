import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import archiver from 'archiver';

const sourceDir = 'build/addon';
const distDir = 'build';
const outPath = path.join(distDir, 'zotero-cover-grid.xpi');
const PLUGIN_XPI_NAME = 'zotero-cover-grid@antigravity.user.xpi';

function syncToZoteroProfiles(xpiPath) {
  try {
    const profilesRoot = path.join(os.homedir(), 'Library', 'Application Support', 'Zotero', 'Profiles');
    if (!fs.existsSync(profilesRoot)) return;

    const entries = fs.readdirSync(profilesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profileDir = path.join(profilesRoot, entry.name);
      try {
        const extDir = path.join(profileDir, 'extensions');
        fs.mkdirSync(extDir, { recursive: true });
        const proxyFile = path.join(extDir, 'zotero-cover-grid@antigravity.user');
        if (fs.existsSync(proxyFile) && fs.statSync(proxyFile).isFile()) {
          fs.rmSync(proxyFile, { force: true });
        }
        const destXpi = path.join(extDir, PLUGIN_XPI_NAME);
        fs.copyFileSync(xpiPath, destXpi);
        console.log(`[make-xpi] Synced XPI to profile: ${destXpi}`);
      } catch {
        // Ignore individual profile sync error (e.g. sandbox restriction)
      }
      try {
        fs.rmSync(path.join(profileDir, 'startupCache'), { recursive: true, force: true });
      } catch {
        // Ignore startupCache cleanup error
      }
    }
  } catch {
    // Non-fatal in sandboxed build/test environments where ~/Library is inaccessible
  }
}

if (!fs.existsSync(path.join(sourceDir, 'manifest.json')) || !fs.existsSync(path.join(sourceDir, 'bootstrap.js'))) {
  throw new Error('[make-xpi] CRITICAL: manifest.json or bootstrap.js missing in build/addon!');
}

await new Promise((resolve, reject) => {
  const output = fs.createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  output.on('close', () => {
    console.log(`[make-xpi] Generated XPI: ${outPath} (${(archive.pointer() / 1024).toFixed(1)} KB)`);
    resolve(undefined);
  });

  output.on('error', reject);
  archive.on('error', reject);

  archive.pipe(output);
  archive.glob('**/*', {
    cwd: sourceDir,
    ignore: ['updates.json']
  });
  archive.finalize();
});

syncToZoteroProfiles(outPath);
