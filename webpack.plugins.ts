import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import { execSync } from 'node:child_process';
import webpack from 'webpack';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const commitHash = execSync('git rev-parse HEAD').toString().trim();

export const plugins = [
  new ForkTsCheckerWebpackPlugin({
    logger: 'webpack-infrastructure',
  }),
  new webpack.DefinePlugin({
    __COMMIT_HASH__: JSON.stringify(commitHash),
    __NPM_PACKAGE_VERSION__: JSON.stringify(process.env.npm_package_version),
  }),
];
