import http from 'node:http';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const PORT = 23120;
const TRIGGER_FILE = '/tmp/zotero-cover-grid-reload.trigger';

function triggerReload() {
  try {
    // 1. Compile bundle
    execSync('node scripts/build.mjs', { stdio: 'inherit' });
    // 2. Touch trigger file
    fs.writeFileSync(TRIGGER_FILE, String(Date.now()));
    console.log(`[remote-server] Rebuilt and touched ${TRIGGER_FILE}`);
    return { ok: true, message: 'Rebuilt and reload triggered in Zotero!' };
  } catch (err) {
    console.error('[remote-server] Build failed:', err);
    return { ok: false, error: String(err) };
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/reload' || url.pathname === '/api/reload') {
    const result = triggerReload();
    res.writeHead(result.ok ? 200 : 500);
    res.end(JSON.stringify(result, null, 2));
    return;
  }

  if (url.pathname === '/' || url.pathname === '/status') {
    res.writeHead(200);
    res.end(JSON.stringify({
      name: 'zotero-cover-grid-remote-server',
      status: 'ready',
      endpoints: {
        reload: '/reload (triggers build & live hot-reload in Zotero)'
      }
    }, null, 2));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[remote-server] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[remote-server] To reload from any external device or mobile browser:`);
  console.log(`               curl http://<this-machine-ip>:${PORT}/reload`);
  console.log(`               or open that URL in your phone/tablet browser!`);
});
