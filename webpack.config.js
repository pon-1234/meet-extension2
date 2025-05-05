// webpack.config.js

const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const Dotenv = require('dotenv-webpack');
require('dotenv').config();

module.exports = {
  mode: 'production', // 本番モードに戻す
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
          { // reCAPTCHAのURLを除去 - 完全なパターン
              test: /\.js$/,
              loader: 'string-replace-loader',
              options: {
                  search: 'recaptchaV2Script:',
                  replace: 'recaptchaV2Script_disabled:',
                  flags: 'g'
              },
              enforce: 'pre'
          },
          { // reCAPTCHA EnterpriseのURLを除去 - 完全なパターン
              test: /\.js$/,
              loader: 'string-replace-loader',
              options: {
                  search: 'recaptchaEnterpriseScript:',
                  replace: 'recaptchaEnterpriseScript_disabled:',
                  flags: 'g'
              },
              enforce: 'pre'
          },
          { // reCAPTCHAのURLを除去 - 完全なURL
              test: /\.js$/,
              loader: 'string-replace-loader',
              options: {
                  search: 'https://www.google.com/recaptcha/api.js',
                  replace: '',
                  flags: 'g'
              },
              enforce: 'pre'
          },
          { // reCAPTCHA EnterpriseのURLを除去 - 完全なURL
              test: /\.js$/,
              loader: 'string-replace-loader',
              options: {
                  search: 'https://www.google.com/recaptcha/enterprise.js?render=',
                  replace: '',
                  flags: 'g'
              },
              enforce: 'pre'
          },
          { // reCAPTCHAドメインの参照を除去
              test: /\.js$/,
              loader: 'string-replace-loader',
              options: {
                  search: 'www.google.com/recaptcha',
                  replace: 'example.invalid/removed',
                  flags: 'g'
              },
              enforce: 'pre'
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
         'FIREBASE_AUTH_SUPPORTS_RECAPTCHA': JSON.stringify(false), // reCAPTCHA機能を無効化
         'FIREBASE_AUTH_SUPPORTS_GAPI': JSON.stringify(false), // GAPI機能を無効化
         // サービスワーカー環境であることを示す（これにより不要なブラウザAPI呼び出しが抑制される場合がある）
         'typeof navigator': JSON.stringify('undefined'),
         // reCAPTCHAのURLを空文字列に置き換え
         'https://www.google.com/recaptcha/api.js': JSON.stringify(''),
         'https://www.google.com/recaptcha/enterprise.js?render=': JSON.stringify(''),
    }),
    // 既存の NormalModuleReplacementPlugin は維持し、強化する
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
    ),
    // RecaptchaVerifierクラスを空モジュールに置換
    new webpack.NormalModuleReplacementPlugin(
      /@firebase[\\/]auth[\\/]dist[\\/].*?[\\/]recaptcha[\\/]recaptcha-verifier\.js/,
      require.resolve('./src/empty-module.js')
    ),
    // RecaptchaConfig関連のものを空モジュールに置換
    new webpack.NormalModuleReplacementPlugin(
      /@firebase[\\/]auth[\\/]dist[\\/].*?[\\/]recaptcha[\\/].*\.js/,
      require.resolve('./src/empty-module.js')
    )
  ],
  devtool: false, // 本番ビルドではソースマップを無効化
};