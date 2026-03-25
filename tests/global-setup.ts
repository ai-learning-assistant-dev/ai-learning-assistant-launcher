/**
 * Playwright 全局设置
 * 检查打包应用资源是否存在
 */
import { existsSync } from 'fs';
import { join } from 'path';

async function globalSetup() {
  // 主进程入口在 asar 归档中
  const asarPath = join(
    process.cwd(),
    'out/AI-Learning-Assistant-Launcher-win32-x64/resources/app.asar'
  );
  
  if (!existsSync(asarPath)) {
    console.error('\n❌ 错误: 未找到打包应用');
    console.error(`路径: ${asarPath}`);
    console.error('\n请先运行以下命令构建应用:\n');
    console.error('  npm run package    # 打包应用\n');
    throw new Error('应用未构建，无法运行测试');
  }
  
  console.log('✅ 检测到打包应用，准备运行测试...');
  console.log(`   应用: ${asarPath}\n`);
}

export default globalSetup;
