import { readFileSync, writeFileSync } from 'fs';
import { findLMStudioHome } from './find-lmstudio-home';
import { join } from 'path';

const lmstudioHome = findLMStudioHome();
export const pluginsFolderPath = join(lmstudioHome, 'extensions', 'plugins');
export const lmsKey2Path = join(lmstudioHome, '.internal', 'lms-key-2');
export const cliPrefPath = join(lmstudioHome, '.internal', 'cli-pref.json');
export const appInstallLocationFilePath = join(
  lmstudioHome,
  '.internal',
  'app-install-location.json',
);
export const defaultModelsFolder = join(lmstudioHome, 'models');
export const serverCtlPath = join(
  lmstudioHome,
  '.internal',
  'http-server-ctl.json',
);
export const serverConfigPath = join(
  lmstudioHome,
  '.internal',
  'http-server-config.json',
);
export const modelData = join(lmstudioHome, '.internal', 'model-data.json');
const modelDataExample = {
  json: [
    [
      'lmstudio-community/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf',
      { transitive: true },
    ] as [string, { transitive: boolean }],
  ],
  meta: { values: ['map'] },
};
type ModelDataStruct = typeof modelDataExample;
/**
 * 使用LM Studio GUI删除模型时
 * LM Studio GUI 会在model-data.json中标记模型被删除
 * 但是import时不会去掉标记，导致导入的模型无法显示
 * 所以这里需要我们手动去除一下标记
 * 因为使用了LM Studio 未公开的API，所以未来LM Studio更新后可能会有bug
 * TODO 要关注LM Studio更新对这里的影响
 */
export function fixModelList(keyword: string) {
  const modelDataObj = JSON.parse(
    readFileSync(modelData, {
      encoding: 'utf8',
    }),
  ) as ModelDataStruct;
  modelDataObj;
  for (const item of modelDataObj.json) {
    if (item[0].indexOf(keyword) >= 0) {
      item[1].transitive = false;
      break;
    }
  }
  writeFileSync(modelData, JSON.stringify(modelDataObj), { encoding: 'utf8' });
}
