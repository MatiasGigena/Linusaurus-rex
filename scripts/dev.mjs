import { context } from 'esbuild';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import electron from 'electron';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contexts = [];
let child;
let server;
let closing = false;
async function cleanup(code = 0) {
  if (closing) return;
  closing = true;
  child?.kill('SIGTERM');
  await Promise.allSettled([...contexts.map((context) => context.dispose()), server?.close()]);
  process.exit(code);
}
process.on('SIGINT', () => void cleanup());
process.on('SIGTERM', () => void cleanup());
try {
  const main = await context({ entryPoints: [join(root, 'electron/main.ts')], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: join(root, 'dist-electron/main.js'), logLevel: 'info' });
  const preload = await context({ entryPoints: [join(root, 'electron/preload.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(root, 'dist-electron/preload.cjs'), logLevel: 'info' });
  contexts.push(main, preload);
  await Promise.all([main.rebuild(), preload.rebuild()]);
  await Promise.all(contexts.map((context) => context.watch()));
  server = await createServer({ root, server: { host: '127.0.0.1', port: 5173, strictPort: false } });
  await server.listen();
  server.printUrls();
  const url = server.resolvedUrls.local[0];
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  child = spawn(electron, [root], { cwd: root, stdio: 'inherit', env: { ...environment, ELECTRON_RENDERER_URL: url } });
  child.once('error', (error) => { console.error(error); void cleanup(1); });
  child.once('exit', (code) => void cleanup(code ?? 0));
} catch (error) {
  console.error(error);
  await cleanup(1);
}
