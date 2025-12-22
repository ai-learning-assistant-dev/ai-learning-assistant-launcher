const { spawn } = require('child_process');
const path = require('path');

// 获取命令行参数
const pageName = process.argv[2] || 'hello';

// 启动Electron应用，使用cross-env设置环境变量
const child = spawn('npx', ['cross-env', 'TEST_PAGE=true', 'TEST_MODE=1', `TEST_PAGE_NAME=${pageName}`, 'electron-forge', 'start'], {
  stdio: 'inherit',
  shell: true
});

child.on('close', (code) => {
  console.log(`Test page process exited with code ${code}`);
});