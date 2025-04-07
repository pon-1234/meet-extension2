const path = require('path');

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
  }
};
