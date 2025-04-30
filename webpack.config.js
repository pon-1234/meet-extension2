const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const Dotenv = require('dotenv-webpack'); // dotenv-webpack をインポート

// dotenvを直接使用して.envファイルを読み込む
require('dotenv').config();

module.exports = {
  mode: 'production', // or 'development'
  entry: {
    background: './src/background.js',
    popup: './src/popup.js',
    content: './src/content.js'
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  optimization: {
    minimize: true // 本番ビルドでは圧縮を有効化
  },
  module: {
    rules: [
      // 必要に応じて他のローダーを追加
    ]
  },
  resolve: {
    fallback: {
      'http': false,
      'https': false,
      'url': false,
      'util': false,
      'stream': false,
      'zlib': false,
      'assert': false,
      'buffer': false,
      'crypto': false
    }
  },
  plugins: [
    new Dotenv({
      path: path.resolve(__dirname, '.env'), // .envファイルのパスを明示的に指定
      systemvars: true, // システム環境変数も使用可能にする
    }), // ★ Dotenvプラグインを追加して.envファイルを読み込む
    new CopyPlugin({
      patterns: [
        // ★ manifest.json のコピー時に transform を使用して client_id を置換
        {
          from: 'manifest.json', // ルートのmanifest.jsonを参照
          to: 'manifest.json',
          transform(content, path) {
            const manifest = JSON.parse(content.toString());
            // process.env は dotenv-webpack によって .env の値が読み込まれている
            if (process.env.OAUTH_CLIENT_ID) {
              manifest.oauth2.client_id = process.env.OAUTH_CLIENT_ID;
            } else {
              console.error("CRITICAL ERROR: OAUTH_CLIENT_ID is missing in .env file. Manifest will contain placeholder.");
              manifest.oauth2.client_id = "YOUR_OAUTH_CLIENT_ID_MISSING_IN_ENV"; // エラー時やデフォルト値
            }
            // 他のmanifestの値も必要ならここで置換可能
            return JSON.stringify(manifest, null, 2); // 整形して返す
          },
        },
        { from: 'popup.html', to: 'popup.html' },
        { from: 'popup.css', to: 'popup.css' },
        { from: 'styles.css', to: 'styles.css' },
        { from: 'icons', to: 'icons' },
        { from: 'sounds', to: 'sounds' },
      ],
    }),
    // --- 以下の NormalModuleReplacementPlugin の設定は変更不要 ---
    new webpack.NormalModuleReplacementPlugin(
      /@firebase[\\/]auth[\\/]dist[\\/].*?[\\/](iframe|gapi)-loader\.js/,
      require.resolve('./src/empty-module.js')
    ),
    new webpack.NormalModuleReplacementPlugin(
      /@firebase[\\/]auth[\\/]dist[\\/].*?[\\/]recaptcha-loader\.js/,
      require.resolve('./src/empty-module.js')
    ),
    new webpack.NormalModuleReplacementPlugin(
      /https:\/\/apis\.google\.com\/js\/api\.js/,
      require.resolve('./src/empty-module.js')
    ),
    new webpack.NormalModuleReplacementPlugin(
      /https:\/\/www\.google\.com\/recaptcha\/(api|enterprise)\.js/,
      require.resolve('./src/empty-module.js')
    )
  ],
  // mode が 'development' の場合は devtool: 'cheap-module-source-map' などにする
  devtool: false, // 本番ビルドではソースマップを無効化
};