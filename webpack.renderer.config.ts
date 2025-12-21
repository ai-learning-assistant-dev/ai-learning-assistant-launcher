import type { Configuration } from 'webpack';
import * as path from 'path';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

rules.push();

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.svg'],
    alias: {
      // 根据环境变量决定是否使用mock版本
      '@use-vm': process.env.TEST_MODE === '1'
        ? path.resolve(__dirname, 'src/renderer/containers/use-vm/index.mock.tsx')
        : path.resolve(__dirname, 'src/renderer/containers/use-vm/index.tsx')
    }
  },
};
