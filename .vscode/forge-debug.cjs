'use strict';

// Debug-only bootstrap. Normal npm start and application code are unchanged.
const childProcess = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const originalSpawn = childProcess.spawn;

childProcess.spawn = function (command, args, options) {
  const executable = path.basename(String(command)).toLowerCase();
  if (executable === 'electron.exe' || executable === 'electron') {
    const env = { ...process.env, ...(options && options.env) };
    // Only Electron gets a fixed inspector port. Do not propagate the Forge
    // debug session's injected bootloader or accidentally run Electron as Node.
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VSCODE_INSPECTOR_OPTIONS;
    env.NODE_OPTIONS = '--inspect-brk=127.0.0.1:9229 --trace-warnings';
    // Chromium switches belong to Electron's command line, not NODE_OPTIONS.
    // Put them before Forge's application path; bind the debug endpoint locally.
    const electronArgs = [
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9222',
      ...(args || []),
    ];
    const child = originalSpawn.call(this, command, electronArgs, { ...options, env });
    // VS Code starts the explicit Attach configuration on this marker. Attach
    // retries while Electron is opening its inspector; inspect-brk holds entry.
    console.log('ELECTRON_MAIN_DEBUG_ATTACH:9229');
    return child;
  }
  return originalSpawn.apply(this, arguments);
};

// Fail visibly rather than attaching to an unrelated process on the same port.
const probe = net.createServer();
probe.once('error', (error) => {
  console.error('Cannot reserve 127.0.0.1:9229 for Electron debugging:', error.message);
  process.exitCode = 1;
});
probe.listen(9229, '127.0.0.1', () => {
  probe.close(() => {
    process.env.NODE_ENV = 'development';
    process.argv = [process.execPath, require.resolve('@electron-forge/cli/dist/electron-forge-start.js')];
    require('@electron-forge/cli/dist/electron-forge-start.js');
  });
});
