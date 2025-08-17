import { Exec } from '../exec';

const commandLine = new Exec();
export async function isWSLInstall() {
  let wslWork = false;
  try {
    const output = await commandLine.exec('wsl.exe', ['--status'], {
      encoding: 'utf16le',
      shell: true,
    });
    console.debug('isWSLInstall', output);
    if (
      output.stdout.indexOf('Wsl/WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED') >= 0 ||
      output.stdout.indexOf('wsl.exe --install') >= 0
    ) {
      wslWork = false;
    } else {
      wslWork = true;
    }
  } catch (e) {
    console.warn('isWSLInstall', e);
    wslWork = false;
  }

  return wslWork;
}

export async function wslVersion() {
  try {
    const output = await commandLine.exec('wsl.exe', ['--version'], {
      encoding: 'utf16le',
      shell: true,
    });
    console.debug('wslVersion', output);
    return output.stdout;
  } catch (e) {
    console.warn(e);
  }
  return '';
}
