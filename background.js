// Firebase初期化とバックグラウンド処理

// Firebase SDKをインポート
try {
  importScripts(
    'firebase/firebase-app-compat.js',
    'firebase/firebase-auth-compat.js',
    'firebase/firebase-database-compat.js',
    'firebase-config.js'
  );
} catch (e) {
  console.error('Firebase SDKのインポートエラー:', e);
}

// Firebaseの初期化
function initializeFirebase() {
  console.log('バックグラウンドでFirebaseを初期化中...');
  try {
    if (typeof firebase !== 'undefined' && !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
      console.log('Firebaseが初期化されました');
    }
  } catch (error) {
    console.error('Firebase初期化エラー:', error);
  }
}

// 拡張機能インストール時の処理
chrome.runtime.onInstalled.addListener(() => {
  console.log('Meet LoL-Style Ping Extension がインストールされました');
  initializeFirebase(); // インストール時に初期化
});

// メッセージリスナー（コンテンツスクリプトとの通信用）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getMeetingId') {
    // 現在のタブからMeeting IDを取得するロジックを実装できます
    sendResponse({ status: 'success', meetingId: null });
    return true;
  }
  
  if (message.action === 'getFirebaseConfig') {
    // Firebase設定情報を返す
    sendResponse({ status: 'success', config: firebaseConfig });
    return true;
  }
  
  if (message.action === 'log') {
    console.log('Content Script Log:', message.data);
    sendResponse({ status: 'logged' });
    return true;
  }
});
