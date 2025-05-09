# Meet Ping Extension

Google Meet用のピン機能を提供するChrome拡張機能です。会議中に素早く視覚的な合図を送ることができます。

## 機能

- Google Meetの会議中に視覚的なピン（疑問、任せて、撤退、助けて、いい感じ、トドメだ、情報が必要、作戦変更）を送信できます
- リアルタイムでの共有：同じ会議に参加し、拡張機能をインストールしている参加者全員にピンが表示されます
- Firebase認証とリアルタイムデータベースを使用した安全な通信
- 組織内限定で使用するためのドメイン制限機能

## セットアップ手順

### 1. Firebaseプロジェクトの設定

1.  [Firebase Console](https://console.firebase.google.com/)にアクセスします
2.  「プロジェクトを追加」をクリックして新しいプロジェクトを作成します
3.  プロジェクト作成後、「ウェブ」アプリケーションを追加します
4.  表示されるFirebase設定情報を`src/firebase-config.js`ファイルに記入します

### 2. Firebase認証の設定

1.  Firebaseコンソールの「Authentication」セクションに移動します
2.  「Sign-in method」タブで「Google」プロバイダーを有効化します
3.  ウェブクライアントIDを `manifest.json` の `oauth2.client_id` に設定します。
4.  承認済みドメインに`google.com`が含まれていることを確認します
5.  組織内利用の場合は、Googleプロバイダーの設定内で「ドメイン制限」を有効化し、会社のドメイン（例: `yourcompany.com`）を`src/firebase-config.js`の`COMPANY_DOMAIN`定数に設定します

### 3. Realtime Databaseの作成とセキュリティルールの設定

1.  Firebaseコンソールの「Realtime Database」セクションに移動します
2.  データベースを作成します
3.  「ルール」タブをクリックし、以下のセキュリティルールを設定します（`@あなたのドメイン.com` を実際のドメインに置き換えてください）：

```json
{
  "rules": {
    "meetings": {
      "$meetingId": {
        "pins": {
          ".read": "auth != null && auth.token.email.endsWith('@あなたのドメイン.com')",

          "$pinId": {
            ".write": "auth != null && auth.token.email.endsWith('@あなたのドメイン.com') && (!data.exists() || data.child('createdBy/uid').val() === auth.uid)",

            // データ構造の検証 (createdByにuid, displayName, email、timestampを含む)
            ".validate": "newData.hasChildren(['type', 'createdBy', 'timestamp']) && newData.child('type').isString() && newData.child('createdBy').hasChildren(['uid', 'displayName', 'email']) && newData.child('timestamp').isNumber()",

            ".read": "auth != null && auth.token.email.endsWith('@あなたのドメイン.com')"
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

### 4. アイコンの準備

`icons` ディレクトリに、以下の名前でピンに対応するPNG画像ファイル（推奨サイズ: 24x24 または 48x48）を配置してください。

-   `question.png` (疑問)
-   `onMyWay.png` (任せて)
-   `danger.png` (撤退)
-   `assist.png` (助けて)
-   `goodJob.png` (いい感じ)
-   `finishHim.png` (トドメだ)
-   `needInfo.png` (情報が必要)
-   `changePlan.png` (作戦変更)
-   `center-pin.png` (メニュー中央のアイコン)

### 5. 拡張機能のインストール

#### 開発モード（推奨）
1.  Chromeブラウザで `chrome://extensions` を開きます
2.  右上の「デベロッパーモード」をオンにします
3.  プロジェクトルートで `npm install` を実行し、依存関係をインストールします。
4.  `npm run build` を実行して拡張機能をビルドします (`dist` フォルダが生成されます)。
5.  Chrome拡張機能ページで「パッケージ化されていない拡張機能を読み込む」ボタンをクリックします
6.  生成された `dist` フォルダを選択します

#### 組織内配布
1.  `npm run build` を実行します。
2.  `dist` フォルダ全体を ZIP ファイルに圧縮します
3.  [Chromeウェブストア デベロッパー ダッシュボード](https://chrome.google.com/webstore/developer/dashboard)にアクセスします
4.  「新しいアイテム」を追加し、ZIPファイルをアップロードします
5.  「公開設定」で「限定公開」を選択し、配布対象となる組織のドメインを指定します

## 使い方

1.  Google Meetの会議に参加します
2.  拡張機能が有効になっていることを確認します
3.  ツールバーの拡張機能アイコンをクリックし、ポップアップを開きます
    -   ログインしていない場合は、「Googleアカウントでログイン」ボタンをクリックします
4.  ログインが完了すると、Meet画面の左下にピンメニューボタン (`!`) が表示されます
5.  ピンメニューボタンをクリックすると、円形のピンメニューが開きます
6.  送りたいピンのアイコン（❓, 👍, 💣, ℹ️ など）をクリックします
7.  クリックしたピンが画面右上に表示され、同じ会議の他の参加者（拡張機能をインストールしている人）にもリアルタイムで表示されます
8.  ピンは一定時間表示された後、自動的に消えます (現在の実装では自動削除なし、手動削除のみ)
9.  自分が作成したピンは、表示されている間にクリックすることで手動で削除できます

## 注意事項

- **セキュリティ:** Firebase設定情報（APIキーなど）をコード内に直接記述することにはリスクが伴います。組織内での利用に限定し、必要に応じてより安全な設定管理方法を検討してください。
- **ドメイン制限:** この拡張機能は、設定された特定のドメインのGoogleアカウントでのみ利用可能にすることができます。`src/firebase-config.js` の `COMPANY_DOMAIN` 定数とFirebaseのセキュリティルールを正しく設定してください。
- **Google Meetのアップデート:** Google Meetのウェブサイト構造が変更されると、UIの表示位置がずれたり、機能しなくなったりする可能性があります。

## 開発者向け情報

- この拡張機能はChrome Manifest V3を使用しています
- Firebase v11 (Modular SDK) を使用しています
- UIは基本的なDOM操作とCSSで構築されています

## ライセンス

MIT License
```

**補足:**

*   **アイコンファイル:** 上記のコードは新しいアイコンファイル (`goodJob.png`, `finishHim.png`, `needInfo.png`, `changePlan.png`) が `icons` ディレクトリに存在することを前提としています。これらのファイルを実際に作成して配置する必要があります。
*   **CSS調整:** ピンメニューのオプションが増えたため、`styles.css` の `#ping-menu` の `width` と `height`、または `PING_MENU_POSITIONS` の `distance` を調整して、オプションがきれいに円周上に配置されるようにする必要があるかもしれません。
*   **ビルド:** コードを変更したら、必ず `npm run build` を実行して `dist` フォルダの内容を更新し、Chromeに再読み込みさせてください。

これでピンの種類が8つになり、指定されたラベルで表示されるようになります。