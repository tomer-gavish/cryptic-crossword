const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
    entry: {
      app: {
        import: './src/app.ts'
      }
    },
    watchOptions: {
        aggregateTimeout: 10000,
        poll: 3000,
        ignored: /node_modules/,
      },
    output: {
      filename: '[name].bundle.js',
      chunkFilename: '[name].chunk.js',
      path: path.resolve(__dirname, 'dist'),
      // Must be explicit. The default ('auto') derives the base URL from
      // document.currentScript, which is null for <script type="module"> —
      // exactly how index.html loads the runtime. Webpack then guessed from
      // whatever script had most recently executed and tried to fetch lazy
      // chunks from the Google Analytics origin. Relative so it keeps working
      // under a GitHub Pages project path.
      publicPath: 'dist/'
    },
    optimization: {
      runtimeChunk: 'single',
      minimize: true,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            output: {
              comments: false,
            },
          },
          extractComments: false,
        }),
      ],
    },
    devServer: {
        static: path.resolve(__dirname),
        devMiddleware: {
            publicPath: '/dist/',
            writeToDisk: false,
         },
        port: 8080,
        hot: false
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/
        }
      ]
    },
    resolve: {
      extensions: [ '.tsx', '.ts', '.js' ]
    }
  };