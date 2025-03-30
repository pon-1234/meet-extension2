// Firebase初期化とバックグラウンド処理

// Firebase SDKと設定ファイルをインポート
try {
  importScripts(
    'firebase/firebase-app-compat.js',
    'firebase/firebase-auth-compat.js',
    'firebase/firebase-database-compat.js',
    'firebase-config.js' // 設定ファイルを追加
  );
} catch (e) {
  console.error('Firebase SDKまたは設定ファイルのインポートエラー:', e);
}

// グローバル変数
let firebaseInitialized = false;
let auth = null; // Firebase Auth インスタンスを保持
let database = null; // Firebase Database インスタンスを保持
let currentUser = null; // 認証済みユーザー情報

// Firebaseの初期化 (一度だけ実行)
function initializeFirebase() {
  console.log('バックグラウンドでFirebaseを初期化中...');
  if (!firebaseInitialized && typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined') {
    try {
      if (!firebase.apps.length) {
         firebase.initializeApp(firebaseConfig);
         console.log('Firebase Appが初期化されました');
      } else {
         firebase.app(); // 既に初期化されている場合は既存のインスタンスを取得
         console.log('Firebase Appは既に初期化されています');
      }
      auth = firebase.auth(); // Authインスタンスを取得・保持
      database = firebase.database(); // Databaseインスタンスを取得・保持
      firebaseInitialized = true;
      console.log('Firebase Auth/Databaseインスタンスを取得しました');
      setupAuthListener(); // 認証リスナーを設定
    } catch (error) {
      console.error('Firebase初期化エラー:', error);
    }
  } else if (firebaseInitialized) {
      console.log("Firebaseは既に初期化済みです。");
  } else {
      console.error("Firebase SDKまたは設定が読み込まれていません。");
  }
}

// 認証状態のリスナーを設定
function setupAuthListener() {
  if (!auth) {
      console.error("Authリスナー設定失敗: Authが初期化されていません");
      return;
  }
  auth.onAuthStateChanged((user) => {
    if (user && user.email.endsWith(`@${COMPANY_DOMAIN}`)) { // ドメイン制限
      currentUser = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      };
      console.log("Background: User authenticated:", currentUser.email);
    } else {
      if (user) {
        console.warn("Background: User logged in but not from allowed domain:", user.email);
        auth.signOut().catch(err => console.error("Sign out error:", err));
      } else {
        console.log("Background: User logged out.");
      }
      currentUser = null;
    }
    notifyAuthStatusToContentScripts();
    notifyAuthStatusToPopup(); // Popupにも通知
  }, (error) => {
      console.error("Auth state change error:", error);
      currentUser = null;
      notifyAuthStatusToContentScripts();
      notifyAuthStatusToPopup(); // Popupにも通知
  });
}

// 認証状態をアクティブなMeetタブのContent Scriptに通知
function notifyAuthStatusToContentScripts() {
  chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'authStatusChanged', user: currentUser })
        .catch(error => console.warn(`Could not send auth status to content tab ${tab.id}: ${error.message || error}`));
    });
  });
}

// 認証状態をPopupに通知
function notifyAuthStatusToPopup() {
    chrome.runtime.sendMessage({ action: 'authStatusChanged', user: currentUser })
      .catch(error => console.warn(`Could not send auth status to popup: ${error.message || error}`));
}


// Googleログイン処理 (chrome.identity APIを使用)
function signInWithGoogle() {
  return new Promise((resolve, reject) => {
    if (!auth) {
      console.error("Firebase Auth not initialized.");
      return reject(new Error("Firebase Auth not initialized."));
    }

    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        const errorMsg = chrome.runtime.lastError?.message || "Failed to get auth token. User might have cancelled.";
        console.error("chrome.identity.getAuthToken error:", errorMsg);
        reject(new Error(errorMsg));
        return;
      }

      // FirebaseにGoogleのOAuth2アクセストークンでログイン
      const credential = firebase.auth.GoogleAuthProvider.credential(null, token);

      auth.signInWithCredential(credential)
        .then((userCredential) => {
          console.log("Sign in successful with chrome.identity:", userCredential.user?.email);
          // 実際のユーザー情報の更新と通知は onAuthStateChanged で行われる
          resolve(true); // ログインプロセス開始成功
        })
        .catch((error) => {
          console.error("Firebase signInWithCredential error:", error);
          reject(error); // Firebase側のエラーをreject
        });
    });
  });
}


// メッセージリスナー (Content ScriptやPopupからの要求を処理)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  initializeFirebase(); // メッセージ受信時に初期化されているか確認

  if (!firebaseInitialized) {
      sendResponse({ status: "error", message: "Firebase not initialized" });
      return true; // 非同期を示す必要はないが、早期リターン
  }

  if (message.action === 'getAuthStatus') {
    sendResponse({ user: currentUser });
    return true; // 非同期応答を示す
  }
  else if (message.action === 'requestLogin') {
    signInWithGoogle()
        .then(success => sendResponse({ started: success }))
        .catch(error => {
            console.error("Login request failed in background:", error);
            sendResponse({ started: false, error: error.message });
        });
    return true; // 非同期応答を示す (Promiseを返すため)
  } else if (message.action === 'requestLogout') { // ログアウトリクエストを追加
      if (auth) {
          auth.signOut()
              .then(() => sendResponse({ success: true }))
              .catch(error => {
                  console.error("Logout error:", error);
                  sendResponse({ success: false, error: error.message });
              });
      } else {
          sendResponse({ success: false, error: "Auth not initialized" });
      }
      return true; // 非同期応答
  }
  // 他のメッセージタイプ ...

  // 同期的な応答がない場合は false を返すか、何も返さない
  // sendResponse({ status: 'unknown_action' });
  // return false;
});

// 拡張機能インストール/アップデート時の処理
chrome.runtime.onInstalled.addListener(() => {
  console.log('Meet LoL-Style Ping Extension がインストール/アップデートされました');
  initializeFirebase(); // インストール時に初期化
});

// Service Worker起動時の処理
initializeFirebase();
console.log("Background service worker started/restarted.");
