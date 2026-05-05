/**
 * Base webpack config used across other specific configs
 */

import type { Configuration } from 'webpack';
import webpack from './webpack.instance';
import TsconfigPathsPlugins from 'tsconfig-paths-webpack-plugin';
import webpackPaths from './webpack.paths';
import { dependencies as externals } from '../../release/app/package.json';

const configuration: Configuration = {
  // `kshana-ink` is required by the embedded main-process integration.
  // Externalize ALL kshana-ink subpaths (`./manager`, `./core/llm`,
  // `./runners`, `./agent/pi`) so webpack doesn't try to bundle the
  // CJS artifacts (which have peer-dep imports that fail at bundle
  // time). At runtime, Node resolves them via require() the same as
  // any other electron dep.
  externals: [
    ...Object.keys(externals || {}),
    ({ request }: { request?: string }, callback: (err?: Error | null, result?: string) => void) => {
      if (request && /^kshana-core(\/|$)/.test(request)) {
        return callback(null, `commonjs ${request}`);
      }
      callback();
    },
  ] as never[],

  stats: 'errors-only',

  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            // Remove this line to enable type checking in webpack builds
            transpileOnly: true,
            compilerOptions: {
              module: 'nodenext',
              moduleResolution: 'nodenext',
            },
          },
        },
      },
    ],
  },

  output: {
    path: webpackPaths.srcPath,
    // https://github.com/webpack/webpack/issues/1114
    library: { type: 'commonjs2' },
  },

  /**
   * Determine the array of extensions that should be used to resolve modules.
   */
  resolve: {
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx'],
    modules: [webpackPaths.srcPath, 'node_modules'],
    // There is no need to add aliases here, the paths in tsconfig get mirrored
    plugins: [new TsconfigPathsPlugins()],
  },

  plugins: [new webpack.EnvironmentPlugin({ NODE_ENV: 'production' })],
};

export default configuration;
