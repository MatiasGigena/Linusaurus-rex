import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const application = process.argv[2] ? resolve(process.argv[2]) : join(root, 'node_modules/electron/dist/electron');
await access(application, constants.X_OK);
if (!process.argv[2]) await access(join(root, 'dist-electron/main.js'));
const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
const applications = join(dataHome, 'applications');
const icons = join(dataHome, 'icons/hicolor/512x512/apps');
await Promise.all([mkdir(applications, { recursive: true }), mkdir(icons, { recursive: true })]);
await copyFile(join(root, 'resources/icon.png'), join(icons, 'linusaurus-rex.png'));
// Desktop Exec has its own quoting rules; reject line breaks and quote reserved characters.
function quote(value) {
  if (/[\r\n]/.test(value)) throw new Error('Launcher paths cannot contain newlines');
  return `"${value.replace(/(["\\`$])/g, '\\$1').replace(/%/g, '%%')}"`;
}
const command = process.argv[2] ? quote(application) : `${quote(application)} ${quote(root)}`;
const file = join(applications, 'linusaurus-rex.desktop');
await writeFile(file, `[Desktop Entry]\nType=Application\nName=Linusaurus Rex\nComment=Graphical client for existing Rex terminal sessions\nExec=${command}\nIcon=linusaurus-rex\nTerminal=false\nCategories=Development;TerminalEmulator;\nStartupWMClass=linusaurus-rex\n`, { mode: 0o644 });
console.log(`Installed launcher: ${file}`);
console.log(process.argv[2] ? 'Keep the AppImage at its current path.' : 'Keep this checkout and node_modules at their current paths.');
