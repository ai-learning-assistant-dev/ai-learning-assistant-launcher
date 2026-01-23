import { type Configuration } from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';
import CopyPlugin from 'copy-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';

export const mainConfig: Configuration = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/main/index.ts',
  // Put your normal webpack config below here
  module: {
    rules,
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: 'node_modules/node-datachannel',
          to: 'node_modules/node-datachannel',
        },
      ],
    }),
    ...plugins,
  ],
  externals: {
    'node-datachannel': 'node-datachannel',
  },
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.json', '.svg'],
  },
  optimization: {
    minimizer: [
      new TerserPlugin({
        exclude: /node_modules\/node-datachannel\/test/,
      }),
    ],
  },
};
