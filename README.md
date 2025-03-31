# Meet Ping Extension

Google Meet用のピン機能を提供するChrome拡張機能です。会議中に素早く視覚的な合図を送ることができます。

## 機能

- Google Meetの会議中に視覚的なピン（警告、方向、質問、助けて）を送信できます
- リアルタイムでの共有：同じ拡張機能をインストールしている参加者全員にピンが表示されます
- Firebase認証とリアルタイムデータベースを使用した安全な通信
- 組織内限定で使用するためのドメイン制限機能

## セットアップ手順

### 1. Firebaseプロジェクトの設定

1. [Firebase Console](https://console.firebase.google.com/)にアクセスします
2. 「プロジェクトを追加」をクリックして新しいプロジェクトを作成します
3. プロジェクト作成後、「ウェブ」アプリケーションを追加します
4. 表示されるFirebase設定情報を`firebase-config.js`ファイルに記入します

### 2. Firebase認証の設定

1. Firebaseコンソールの「Authentication」セクションに移動します
2. 「Sign-in method」タブで「Google」プロバイダーを有効化します
3. 承認済みドメインに`google.com`が含まれていることを確認します
4. 組織内利用の場合は、Googleプロバイダーの設定内で「ドメイン制限」を有効化し、会社のドメイン（例: `example.com`）を追加します

### 3. Realtime Databaseの作成とセキュリティルールの設定

1. Firebaseコンソールの「Realtime Database」セクションに移動します
2. データベースを作成します
3. 「ルール」タブをクリックし、以下のセキュリティルールを設定します（会社のドメインに合わせて修正してください）：

```json
{
  "rules": {
    "meetings": {
      "$meetingId": {
        "pins": {
          ".read": "auth != null && auth.token.email.endsWith('@会社のドメイン.com')",

          "$pinId": {
            ".write": "auth != null && auth.token.email.endsWith('@会社のドメイン.com') && (!data.exists() || data.child('createdBy/uid').val() === auth.uid)",

            ".validate": "newData.hasChildren(['type', 'createdAt', 'createdBy']) && newData.child('type').isString() && newData.child('createdBy').hasChildren(['uid', 'displayName', 'email'])",

            ".read": "auth != null && auth.token.email.endsWith('@会社のドメイン.com')"
          }
        }
      }
    }
  }
}
```

このセキュリティルールにより：
- 認証済みの特定ドメインユーザーのみがピンを読み書きできる
- ユーザーは自分が作成したピンのみを削除できる
- データ構造のバリデーションが行われる

### 4. 拡張機能のインストール

#### 開発モード（推奨）
1. Chromeブラウザで `chrome://extensions` を開きます
2. 右上の「デベロッパーモード」をオンにします
3. 「パッケージ化されていない拡張機能を読み込む」ボタンをクリックします
4. この拡張機能のファイル一式が含まれるフォルダを選択します

#### 組織内配布
1. 拡張機能のフォルダ全体を ZIP ファイルに圧縮します
2. [Chromeウェブストア デベロッパー ダッシュボード](https://chrome.google.com/webstore/developer/dashboard)にアクセスします
3. 「新しいアイテム」を追加し、ZIPファイルをアップロードします
4. 「公開設定」で「限定公開」を選択し、配布対象となる組織のドメインを指定します

## 使い方

1. Google Meetの会議に参加します
2. 拡張機能が有効になっていることを確認します
3. ツールバーの拡張機能アイコンをクリックし、ポップアップを開きます
   - ログインしていない場合は、「Googleアカウントでログイン」ボタンをクリックします
4. ログインが完了すると、Meet画面の左下にピンメニューボタン (`!`) が表示されます
5. ピンメニューボタンをクリックすると、円形のピンメニューが開きます
6. 送りたいピンのアイコン（⚠️, ➡️, ❓, 🆘）をクリックします
7. クリックしたピンが画面右上に表示され、他の参加者にもリアルタイムで表示されます
8. ピンは一定時間（約30秒）で自動的に消えます
9. 自分が作成したピンは、表示されている間にクリックすることで手動で削除できます

## 注意事項

- **セキュリティ:** Firebase設定情報（APIキーなど）をコード内に直接記述することにはリスクが伴います。組織内での利用に限定し、必要に応じてより安全な設定管理方法を検討してください。
- **ドメイン制限:** この拡張機能は、設定された特定のドメインのGoogleアカウントでのみ利用可能にすることができます。
- **Google Meetのアップデート:** Google Meetのウェブサイト構造が変更されると、UIの表示位置がずれたり、機能しなくなったりする可能性があります。

## 開発者向け情報

- この拡張機能はChrome Manifest V3を使用しています
- Firebase v9 compat（v8互換）ライブラリを使用しています
- UIはCSS Flexboxを使用して構築されています

## ライセンス

MIT License
