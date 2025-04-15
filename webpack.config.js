const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin'); // copy-webpack-plugin をインポート

module.exports = {
  mode: 'production', // 本番ビルド用
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
      // string-replace-loader は NormalModuleReplacementPlugin で代替するため削除してもOK
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
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'popup.html', to: 'popup.html' },
        { from: 'popup.css', to: 'popup.css' },
        { from: 'styles.css', to: 'styles.css' },
        { from: 'icons', to: 'icons' },
        { from: 'sounds', to: 'sounds' },
      ],
    }),
    // ★★★ NormalModuleReplacementPlugin を有効化し、対象を修正 ★★★
    // Firebase Auth SDK (v9 modular でも内部的に古いローダーを含む可能性がある) の
    // 外部スクリプトローダー関連の処理を空のモジュールに置き換える試み。
    // '@firebase/auth' パッケージ内の特定の内部挙動を無効化します。
    // 対象とする正規表現はSDKのバージョンによって変わる可能性があるため注意が必要です。
    new webpack.NormalModuleReplacementPlugin(
      // GAPIローダーに関連する可能性のある内部モジュール (推測)
      /@firebase[\\/]auth[\\/]dist[\\/].*?[\\/](iframe|gapi)-loader\.js/,
      require.resolve('./src/empty-module.js') // 空のモジュールへのパス
    ),
    new webpack.NormalModuleReplacementPlugin(
      // reCAPTCHAローダーに関連する可能性のある内部モジュール (推測)
      /@firebase[\\/]auth[\\/]dist[\\/].*?[\\/]recaptcha-loader\.js/,
       require.resolve('./src/empty-module.js') // 空のモジュールへのパス
    ),
    // 念のため、URL文字列自体を直接含む可能性のあるモジュールも対象にする (効果は限定的かも)
    new webpack.NormalModuleReplacementPlugin(
      /https:\/\/apis\.google\.com\/js\/api\.js/,
      require.resolve('./src/empty-module.js')
    ),
     new webpack.NormalModuleReplacementPlugin(
      /https:\/\/www\.google\.com\/recaptcha\/(api|enterprise)\.js/,
      require.resolve('./src/empty-module.js')
    )
  ],
  devtool: false, // 本番ビルドではソースマップを無効化
};