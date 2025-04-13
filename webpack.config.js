const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin'); // copy-webpack-plugin をインポート

module.exports = {
  mode: 'production', // 本番ビルド用。開発中は 'development' に変更推奨
  entry: {
    background: './src/background.js',
    popup: './src/popup.js',
    content: './src/content.js'
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true, // dist ディレクトリをビルド前にクリーンアップ
  },
  optimization: {
    // reCAPTCHAに関連する未使用コードを削除するために最適化を有効化
    // development モードではコメントアウトした方がデバッグしやすい場合がある
    // usedExports: true,
    minimize: true // production モードでのみ true 推奨
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        // Firebase SDK のファイルから不要な外部URL参照を除外する設定
        // node_modules 内の Firebase SDK を対象外にし、src 内のファイルのみ対象とする
        exclude: /node_modules/,
        use: [
          {
            loader: 'string-replace-loader',
            options: {
              multiple: [
                // Firebase SDK内の特定の外部JS読み込みを無効化するための文字列置換
                // 正規表現を少し厳密にして意図しない置換を防ぐ
                { search: /https:\/\/www\.google\.com\/recaptcha\/(api|enterprise)\.js/g, replace: '//REMOVED-URL-BY-REPLACE-LOADER', flags: 'g' },
                { search: /https:\/\/apis\.google\.com\/js\/api\.js/g, replace: '//REMOVED-URL-BY-REPLACE-LOADER', flags: 'g' }
              ]
            }
          }
        ]
      }
    ]
  },
  resolve: {
    fallback: {
      // Node.js コアモジュールのポリフィルを無効化 (ブラウザ環境のため)
      'http': false,
      'https': false,
      'url': false,
      'util': false, // Firebase v9 モジュラーで不要な場合が多い
      'stream': false,
      'zlib': false,
      'assert': false,
      'buffer': false,
      'crypto': false
      // 必要に応じて他の Node.js モジュールも false に設定
    }
  },
  plugins: [
    // 静的ファイルを dist にコピー
    new CopyPlugin({
      patterns: [
        // マニフェストファイル (ルートのものをコピー)
        { from: 'manifest.json', to: 'manifest.json' },
        // ポップアップ関連ファイル (ルートのものをコピー)
        { from: 'popup.html', to: 'popup.html' },
        { from: 'popup.css', to: 'popup.css' },
        // コンテンツスクリプト用CSS (ルートのものをコピー)
        { from: 'styles.css', to: 'styles.css' },
        // アイコンとサウンドファイル
        { from: 'icons', to: 'icons' },
        { from: 'sounds', to: 'sounds' },
        // src 内の HTML/CSS はコピーしない (Webpack で処理される JS から参照される想定)
      ],
    }),
    // DefinePlugin と NormalModuleReplacementPlugin は高度な設定
    // string-replace-loader で問題が解決しない場合に検討
    // new webpack.DefinePlugin({
    //   // Firebase SDK 内の特定のグローバル参照を置換 (必要な場合)
    //   // 'process.env.NODE_ENV': JSON.stringify('production'),
    // }),
    // new webpack.NormalModuleReplacementPlugin(
    //    // 正規表現で置き換えたいモジュールを指定
    //    /https:\/\/www\.google\.com\/recaptcha\/api\.js/,
    //    // 置き換え先の空モジュール
    //    require.resolve('./src/empty-module.js') // パスを確認
    // ),
    // new webpack.NormalModuleReplacementPlugin(
    //    /https:\/\/www\.google\.com\/recaptcha\/enterprise\.js/,
    //    require.resolve('./src/empty-module.js')
    // ),
    // new webpack.NormalModuleReplacementPlugin(
    //    /https:\/\/apis\.google\.com\/js\/api\.js/,
    //    require.resolve('./src/empty-module.js')
    // )
  ],
  // 開発時のデバッグ用に source map を設定 (任意)
  devtool: false, // production モードの場合は false か他の形式に
  // devtool: 'cheap-module-source-map', // development モードの場合
};