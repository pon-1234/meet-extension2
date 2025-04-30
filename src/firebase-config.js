// firebase-config.js - モジュラー形式 & .env 読み込み (COMPANY_DOMAIN含む)

// Webpack (dotenv-webpack) によってビルド時に .env の値が注入される
const firebaseApiKey = process.env.FIREBASE_API_KEY;
const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
const databaseURL = process.env.FIREBASE_DATABASE_URL;
const projectId = process.env.FIREBASE_PROJECT_ID;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
const messagingSenderId = process.env.FIREBASE_MESSAGING_SENDER_ID;
const appId = process.env.FIREBASE_APP_ID;
const companyDomain = process.env.COMPANY_DOMAIN; // COMPANY_DOMAINも環境変数から読み込む

// .envファイルに値がない場合のチェック (任意ですが推奨)
if (!firebaseApiKey) {
  console.error("CRITICAL ERROR: Firebase API Key (FIREBASE_API_KEY) is missing in .env file.");
}
if (!authDomain) {
  console.error("CRITICAL ERROR: Firebase Auth Domain (FIREBASE_AUTH_DOMAIN) is missing in .env file.");
}
// 他の必須項目についても同様にチェックを追加できます
if (!companyDomain) {
  console.warn("WARNING: Company domain (COMPANY_DOMAIN) is not set in .env. Domain restriction might not work as expected.");
}


export const firebaseConfig = {
  apiKey: firebaseApiKey,
  authDomain: authDomain,
  databaseURL: databaseURL,
  projectId: projectId,
  storageBucket: storageBucket,
  messagingSenderId: messagingSenderId,
  appId: appId
};

// COMPANY_DOMAIN も環境変数から読み込んだ値を使用
export const COMPANY_DOMAIN = companyDomain;