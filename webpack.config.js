// webpack.config.js

const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const Dotenv = require('dotenv-webpack');
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
    clean: true, // distフォルダをビルド前にクリーンアップ
  },
  optimization: {
    minimize: true // 本番ビルドでは圧縮を有効化
  },
  module: {
      rules: [
          { // string-replace-loader を念のため最初の方に
              test: /\.js$/,
              loader: 'string-replace-loader',
              options: {
                  search: 'https://apis.google.com/js/api.js', // GAPIの読み込み試行箇所を置換
                  replace: '',
                  flags: 'g'
              },
              enforce: 'pre' // 他のローダーより先に適用
          },
          {
              test: /\.js$/,
              exclude: /node_modules/,
              use: {
                  loader: 'babel-loader',
                  options: {
                      presets: ['@babel/preset-env']
                  }
              }
          },
          // 他のルール... (string-replace-loaderの他の設定はコメントアウトされているので不要)
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
      path: path.resolve(__dirname, '.env'),
      systemvars: true,
    }),
    new CopyPlugin({
        patterns: [
            {
              from: 'manifest.json',
              to: 'manifest.json',
              transform(content, path) {
                const manifest = JSON.parse(content.toString());
                if (process.env.OAUTH_CLIENT_ID) {
                  manifest.oauth2.client_id = process.env.OAUTH_CLIENT_ID;
                } else {
                  console.error("CRITICAL ERROR: OAUTH_CLIENT_ID is missing in .env file. Manifest will contain placeholder.");
                  manifest.oauth2.client_id = "YOUR_OAUTH_CLIENT_ID_MISSING_IN_ENV";
                }
                return JSON.stringify(manifest, null, 2);
              },
            },
            { from: 'popup.html', to: 'popup.html' },
            { from: 'popup.css', to: 'popup.css' },
            { from: 'styles.css', to: 'styles.css' },
            { from: 'icons', to: 'icons' },
            { from: 'sounds', to: 'sounds' },
          ],
    }),
    // ★ DefinePlugin を追加して Firebase SDK の挙動を制御
    new webpack.DefinePlugin({
         'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
         // Firebase Auth SDK v9+ で reCAPTCHA や GAPI の読み込みを抑制するためのフラグ
         // (これらの正確な名前や効果はSDKバージョンにより変動する可能性あり)
         // 'FIREBASE_AUTH_SUPPORTS_RECAPTCHA': JSON.stringify(false), // 試す価値あり
         // 'FIREBASE_AUTH_SUPPORTS_GAPI': JSON.stringify(false), // 試す価値あり
         // サービスワーカー環境であることを示す（これにより不要なブラウザAPI呼び出しが抑制される場合がある）
         'typeof navigator': JSON.stringify('undefined'),
    }),
    // 既存の NormalModuleReplacementPlugin は維持する
    new webpack.NormalModuleReplacementPlugin(
      /@firebase[\\/]auth[\\/]dist[\\/].*?[\\/](iframe|gapi)-loader\.js/,
      require.resolve('./src/empty-module.js')
    ),
    new webpack.NormalModuleReplacementPlugin(
      /@firebase[\\/]auth[\\/]dist[\\/].*?[\\/]recaptcha-loader\.js/,
      require.resolve('./src/empty-module.js')
    ),
    new webpack.NormalModuleReplacementPlugin(
      // reCAPTCHA の URL を直接参照している箇所も空モジュールに置換
      /https:\/\/www\.google\.com\/recaptcha\/(api|enterprise)\.js(\?render=)?/,
      require.resolve('./src/empty-module.js')
    )
  ],
  devtool: false, // 本番ビルドではソースマップを無効化
};