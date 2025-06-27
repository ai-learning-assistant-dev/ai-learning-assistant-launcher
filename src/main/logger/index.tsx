import log from 'electron-log/main';
import { appPath } from '../exec';
import path from 'node:path';
log.transports.file.resolvePathFn = () => path.join(appPath, 'launcher.log');
export default function init() {
  Object.assign(console, log.functions);
}
