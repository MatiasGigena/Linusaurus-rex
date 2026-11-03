import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type CommandRunner = (args: string[], stdin?: string) => Promise<string>;

const MAX_OUTPUT = 16 * 1024 * 1024;
const MAX_ERROR = 16 * 1024;

/** Rex is always invoked directly; terminal input and JSON travel through stdin. */
export class RexCommandRunner {
  private children = new Set<ChildProcessWithoutNullStreams>();
  private disposed = false;

  constructor(private executable = 'rex', private timeoutMs = 6_000) {}

  run: CommandRunner = (args, stdin) => new Promise((resolve, reject) => {
    if (this.disposed) return reject(new Error('Rex client has been closed.'));
    const env = { ...process.env };
    // A desktop launched from Rex must never implicitly target its launch pane.
    for (const key of ['REX_SESSION', 'REX_BLOCK', 'REX_CLIENT', 'REX_SERVER']) delete env[key];
    const child = spawn(this.executable, args, { env, shell: false, windowsHide: true });
    this.children.add(child);
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let bytes = 0;
    let errorBytes = 0;
    let settled = false;
    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.children.delete(child);
      if (error) reject(error); else resolve(value ?? '');
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Rex did not respond in time. Check the server connection.'));
    }, this.timeoutMs);
    child.on('error', error => finish(new Error(
      (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'The rex executable was not found on PATH. Install Rex or launch from a shell with Rex available.'
        : `Cannot run Rex: ${error.message}`,
    )));
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) {
        child.kill();
        finish(new Error('Rex output exceeds the 16 MiB client limit.'));
      } else output.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (errorBytes < MAX_ERROR) errors.push(chunk.subarray(0, MAX_ERROR - errorBytes));
      errorBytes += chunk.length;
    });
    child.on('close', code => {
      if (code === 0) finish(undefined, Buffer.concat(output).toString('utf8'));
      else finish(new Error(Buffer.concat(errors).toString('utf8').trim() || `Rex exited with code ${code ?? 'unknown'}.`));
    });
    // A failed connection may close stdin before the caller's bytes are consumed.
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });

  dispose() {
    this.disposed = true;
    for (const child of this.children) child.kill();
    this.children.clear();
  }
}
