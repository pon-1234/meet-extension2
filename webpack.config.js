const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: {
    background: './src/background.js',
    popup: './src/popup.js',
    content: './src/content.js'
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist')
  },
  optimization: {
    // reCAPTCHAに関連する未使用コードを削除するために最適化を有効化
    usedExports: true,
    minimize: true
  },
  // 外部スクリプトの読み込みを防止する設定
  module: {
    rules: [
      {
        test: /\.js$/,
        use: [
          {
            loader: 'string-replace-loader',
            options: {
              multiple: [
                { search: 'https://www.google.com/recaptcha/api.js', replace: '//REMOVED-URL', flags: 'g' },
                { search: 'https://www.google.com/recaptcha/enterprise.js', replace: '//REMOVED-URL', flags: 'g' },
                { search: 'https://apis.google.com/js/api.js', replace: '//REMOVED-URL', flags: 'g' }
              ]
            }
          }
        ]
      }
    ]
  },
  // Firebase SDKの外部依存を解決するための設定
  resolve: {
    fallback: {
      // 必要に応じてブラウザAPIのポリフィルを無効化
      'http': false,
      'https': false,
      'url': false
    }
  },
  // 定数置換を使用して外部URLを無効化
  plugins: [
    new webpack.DefinePlugin({
      // FirebaseのRecaptchaVerifierを無効化
      'https://www.google.com/recaptcha/api.js': JSON.stringify('//REMOVED-URL'),
      'https://www.google.com/recaptcha/enterprise.js': JSON.stringify('//REMOVED-URL'),
      'https://apis.google.com/js/api.js': JSON.stringify('//REMOVED-URL')
    }),
    // 外部URLを置換するプラグイン
    new webpack.NormalModuleReplacementPlugin(
      /https:\/\/www\.google\.com\/recaptcha\/api\.js/,
      require.resolve('./src/empty-module.js')
    ),
    new webpack.NormalModuleReplacementPlugin(
      /https:\/\/www\.google\.com\/recaptcha\/enterprise\.js/,
      require.resolve('./src/empty-module.js')
    ),
    new webpack.NormalModuleReplacementPlugin(
      /https:\/\/apis\.google\.com\/js\/api\.js/,
      require.resolve('./src/empty-module.js')
    )
  ]
};
