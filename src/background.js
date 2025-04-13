// src/background.js (修正後 - 永続性設定削除)

// Firebase SDKをインポート
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  GoogleAuthProvider,
  signOut,
  // setPersistence, // 不要になった
  // browserSessionPersistence // 不要になった
} from 'firebase/auth';
import {
  getDatabase,
  ref,
  onChildAdded,
  onChildRemoved,
  off,
  push,
  set,
  remove
} from 'firebase/database';

// 設定ファイルをインポート
import { firebaseConfig, COMPANY_DOMAIN } from './firebase-config';

let firebaseInitialized = false;
let auth = null;
let database = null;
let currentUser = null;
let activeListeners = {};

// Firebase 初期化関数 (async)
async function initializeFirebase() {
  console.log('BG: Firebaseを初期化中...');
  if (firebaseInitialized) {
    console.log("BG: Firebaseは既に初期化済みです");
    return { success: true };
  }

  try {
    // Firebase アプリの初期化
    const app = initializeApp(firebaseConfig);
    console.log('BG: Firebase Appが初期化されました');

    auth = getAuth(app);
    database = getDatabase(app);
    console.log('BG: Firebase Auth/Databaseインスタンスを取得しました');

    // ★★★ 永続性設定の呼び出しを削除 ★★★
    // try {
    //   console.log('BG: 永続性設定 (SESSION) を試みます...');
    //   await setPersistence(auth, browserSessionPersistence);
    //   console.log('BG: 永続性を SESSION に設定しました');
    // } catch (error) {
    //   console.warn('BG: 永続性設定 (SESSION) エラー (無視して続行):', error);
    // }
    // ★★★ ここまで削除 ★★★

    firebaseInitialized = true; // 初期化フラグを設定
    setupAuthListener(); // 認証リスナー設定
    console.log('BG: Firebase初期化完了 (永続性: メモリ内)'); // メッセージ変更
    return { success: true };

  } catch (error) {
    console.error('BG: Firebase初期化中の致命的エラー:', error);
    firebaseInitialized = false;
    return { success: false, error: error };
  }
}

// --- 認証状態リスナー設定 (変更なし) ---
function setupAuthListener() {
  if (!auth) { console.error("BG: Auth listener setup failed - Auth not initialized"); return; }

  onAuthStateChanged(auth, (user) => {
    console.log("BG: onAuthStateChanged triggered. user:", user ? user.email : 'null');
    const previousUser = currentUser;
    let isAllowedDomain = false;

    if (user && user.email) {
        if (COMPANY_DOMAIN) {
            console.log(`BG: Checking email "${user.email}" against domain "@${COMPANY_DOMAIN}"`);
            isAllowedDomain = user.email.endsWith(`@${COMPANY_DOMAIN}`);
            console.log(`BG: Domain check result: ${isAllowedDomain}`);
        } else {
            console.warn("BG: COMPANY_DOMAIN is not defined or empty. Domain check skipped, allowing user.");
            isAllowedDomain = true;
        }
    } else {
        console.log("BG: User logged out or email is missing.");
        isAllowedDomain = false;
    }

    if (isAllowedDomain) {
      currentUser = { uid: user.uid, email: user.email, displayName: user.displayName || user.email.split('@')[0] };
      console.log("BG: User authenticated:", currentUser.email);
      startListenersForActiveMeetTabs();
    } else {
      if (user) {
        console.warn("BG: User logged in but not from allowed domain:", user.email);
        signOut(auth).catch(err => console.error("BG: Sign out error due to domain mismatch:", err));
      }
      currentUser = null;
      stopAllListeners();
    }

    if (JSON.stringify(previousUser) !== JSON.stringify(currentUser)) {
        console.log("BG: Auth status changed, notifying contexts.");
        notifyAuthStatusToAllContexts();
    }
  }, (error) => {
    console.error("BG: 認証状態変更リスナーエラー:", error);
    currentUser = null;
    stopAllListeners();
    notifyAuthStatusToAllContexts();
  });
}

// --- notifyAuthStatusToAllContexts, notifyAuthStatusToContentScripts, notifyAuthStatusToPopup (変更なし) ---
function notifyAuthStatusToAllContexts() {
    notifyAuthStatusToContentScripts();
    notifyAuthStatusToPopup();
}
function notifyAuthStatusToContentScripts() {
  chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'authStatusChanged', user: currentUser })
        .catch(error => {
            if (!error.message?.includes('Receiving end does not exist')) {
                 console.warn(`BG: タブ ${tab.id} への認証状態通知エラー: ${error.message || error}`);
            }
        });
    });
  });
}
function notifyAuthStatusToPopup() {
    chrome.runtime.sendMessage({ action: 'authStatusChanged', user: currentUser })
      .catch(error => {
          if (!error.message?.includes('Receiving end does not exist')) {
              console.warn(`BG: ポップアップへの認証状態通知エラー: ${error.message || error}`);
          }
      });
}


// --- データベースリスナー関連 (変更なし) ---
function startDbListener(meetingId) {
    if (!currentUser || !database || !meetingId) {
        console.log(`BG: ${meetingId} のリスナーを開始できません - User:${!!currentUser}, DB:${!!database}`);
        return;
    }
    if (activeListeners[meetingId]) {
        return;
    }
    console.log(`BG: ${meetingId} のDBリスナーを開始します`);
    const pinsRef = ref(database, `meetings/${meetingId}/pins`);
    const listenerCallbacks = {};
    listenerCallbacks.added = onChildAdded(pinsRef, (snapshot) => {
        const pinId = snapshot.key;
        const pin = snapshot.val();
        notifyPinUpdateToContentScripts(meetingId, 'pinAdded', { pinId, pin });
    }, (error) => {
        console.error(`BG: DBリスナーエラー (child_added) for ${meetingId}:`, error);
        if (error.code === 'PERMISSION_DENIED') notifyPermissionErrorToContentScripts(meetingId);
        stopDbListener(meetingId);
    });
    listenerCallbacks.removed = onChildRemoved(pinsRef, (snapshot) => {
        const pinId = snapshot.key;
        notifyPinUpdateToContentScripts(meetingId, 'pinRemoved', { pinId });
    }, (error) => {
        console.error(`BG: DBリスナーエラー (child_removed) for ${meetingId}:`, error);
        if (error.code === 'PERMISSION_DENIED') notifyPermissionErrorToContentScripts(meetingId);
        stopDbListener(meetingId);
    });
    activeListeners[meetingId] = { ref: pinsRef, listeners: listenerCallbacks };
}
function stopDbListener(meetingId) {
    const listenerInfo = activeListeners[meetingId];
    if (listenerInfo) {
        console.log(`BG: ${meetingId} のDBリスナーを停止します`);
        try {
            off(listenerInfo.ref, 'child_added', listenerInfo.listeners.added);
            off(listenerInfo.ref, 'child_removed', listenerInfo.listeners.removed);
        } catch (offError) {
            console.warn(`BG: リスナー解除中にエラー (無視): ${offError.message}`);
        }
        delete activeListeners[meetingId];
    }
}
function stopAllListeners() {
    console.log("BG: 全てのDBリスナーを停止します");
    Object.keys(activeListeners).forEach(stopDbListener);
}
function startListenersForActiveMeetTabs() {
    if (!currentUser) return;
    chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
        tabs.forEach(tab => {
            if (tab.url && tab.url.includes('meet.google.com/')) {
                const meetingId = extractMeetingIdFromUrl(tab.url);
                if (meetingId) {
                    console.log(`BG: アクティブなMeetタブを検出: ${meetingId}`);
                    startDbListener(meetingId);
                }
            }
        });
    });
}

// --- Content Script への通知ヘルパー (変更なし) ---
function notifyPinUpdateToContentScripts(targetMeetingId, action, data) {
    chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
        tabs.forEach(tab => {
            if (tab.url && tab.url.includes(targetMeetingId)) {
                chrome.tabs.sendMessage(tab.id, { action, ...data })
                    .catch(error => {
                        if (!error.message?.includes('Receiving end does not exist')) {
                            console.warn(`BG: Pin更新通知エラー (${action}): ${error.message || error}`);
                        }
                    });
            }
        });
    });
}
function notifyPermissionErrorToContentScripts(targetMeetingId) {
    chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
        tabs.forEach(tab => {
            if (tab.url && tab.url.includes(targetMeetingId)) {
                chrome.tabs.sendMessage(tab.id, { action: 'dbPermissionError' })
                    .catch(error => {
                        if (!error.message?.includes('Receiving end does not exist')) {
                            console.warn(`BG: 権限エラー通知エラー: ${error.message || error}`);
                        }
                    });
            }
        });
    });
}


// --- Googleログイン処理 (変更なし) ---
async function signInWithGoogle() {
  console.log("BG: Googleログインを開始します");
  try {
    const initResult = await initializeFirebase();
    if (!initResult.success) {
      console.error("BG: Firebase初期化エラー:", initResult.error);
      return { success: false, error: initResult.error };
    }
    const authToken = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(token);
      });
    });
    const credential = GoogleAuthProvider.credential(null, authToken);
    await signInWithCredential(auth, credential);
    console.log("BG: Googleログイン成功");
    return { success: true };
  } catch (error) {
    console.error("BG: Googleログインエラー:", error); // エラーログ改善
    return { success: false, error: error };
  }
}

// --- URLからMeeting IDを抽出 (変更なし) ---
function extractMeetingIdFromUrl(url) {
  const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
  const match = url.match(meetRegex);
  return match ? match[1] : null;
}

// --- タブ更新リスナー (変更なし) ---
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes("meet.google.com/")) {
    const meetingId = extractMeetingIdFromUrl(tab.url);
    if (meetingId) {
      console.log(`BG: Meetタブが更新されました: ${meetingId}`);
      chrome.tabs.sendMessage(tabId, { action: 'authStatusChanged', user: currentUser })
        .catch(error => {
          if (!error.message?.includes('Receiving end does not exist')) {
            console.warn(`BG: タブ更新時の認証状態通知エラー: ${error.message || error}`);
          }
        });
      if (currentUser) {
        startDbListener(meetingId);
      }
    }
  }
});

// --- メッセージリスナー (変更なし) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const initResult = await initializeFirebase();
      if (!initResult.success || !firebaseInitialized) {
        sendResponse({ success: false, error: `Firebase初期化エラー: ${initResult.error?.message || '不明'}` });
        return;
      }

      if (message.action === 'getAuthStatus') {
        console.log("BG: 認証状態リクエストを受信", sender.tab ? `from tab ${sender.tab.id}` : 'from popup');
        sendResponse({ user: currentUser });
        return;
      }

      if (message.action === 'requestLogin') {
        console.log("BG: ログインリクエストを受信");
        sendResponse({ started: true });
        const loginResult = await signInWithGoogle();
        if (!loginResult.success) {
          chrome.runtime.sendMessage({
            action: 'loginFailed',
            error: loginResult.error?.message || '不明なエラー'
          }).catch(() => {});
        }
        return;
      }

      if (message.action === 'requestLogout') {
        console.log("BG: ログアウトリクエストを受信");
        try {
          await signOut(auth);
          console.log("BG: ログアウト成功");
          sendResponse({ success: true });
        } catch (error) {
          console.error("BG: ログアウトエラー:", error);
          sendResponse({ success: false, error: error.message || 'ログアウト中にエラーが発生しました' });
        }
        return;
      }

      if (!currentUser) {
        console.warn("BG: ユーザーがログインしていないため、操作を実行できません", message.action);
        sendResponse({ success: false, error: 'ログインが必要です' });
        return;
      }

      if (message.action === 'createPin') {
        const { meetingId, pinData } = message;
        if (!meetingId || !pinData) {
          sendResponse({ success: false, error: '必要なパラメータが不足しています' });
          return;
        }
        try {
          const pinWithUser = {
            ...pinData,
            createdBy: {
              uid: currentUser.uid,
              displayName: currentUser.displayName,
              email: currentUser.email
            },
            createdAt: Date.now() // Firebase ServerValue.TIMESTAMP の代替
          };
          const pinsRef = ref(database, `meetings/${meetingId}/pins`);
          const newPinRef = push(pinsRef);
          await set(newPinRef, pinWithUser);
          console.log(`BG: ピンを作成しました: ${meetingId}/${newPinRef.key}`);
          sendResponse({ success: true, pinId: newPinRef.key });
        } catch (error) {
          console.error("BG: ピン作成エラー:", error);
          sendResponse({ success: false, error: error.message || 'ピンの作成中にエラーが発生しました' });
        }
        return;
      }

      if (message.action === 'removePin') {
        const { meetingId, pinId } = message;
        if (!meetingId || !pinId) {
          sendResponse({ success: false, error: '必要なパラメータが不足しています' });
          return;
        }
        try {
          const pinRef = ref(database, `meetings/${meetingId}/pins/${pinId}`);
          await remove(pinRef);
          console.log(`BG: ピンを削除しました: ${meetingId}/${pinId}`);
          sendResponse({ success: true });
        } catch (error) {
          console.error("BG: ピン削除エラー:", error);
          sendResponse({ success: false, error: error.message || 'ピンの削除中にエラーが発生しました' });
        }
        return;
      }

      console.warn("BG: 不明なメッセージを受信:", message);
      sendResponse({ success: false, error: '不明なメッセージタイプ' });

    } catch (error) {
      console.error("BG: メッセージ処理中の予期しないエラー:", error);
      sendResponse({ success: false, error: `予期しないエラー: ${error.message || error}` });
    }
  })();

  return true; // 非同期処理のため true を返す
});


// --- 拡張機能インストール/起動時の処理 (変更なし) ---
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("BG: 拡張機能がインストール/更新されました", details.reason);
  await initializeFirebase();
});

initializeFirebase().then(result => {
  console.log("BG: 起動時のFirebase初期化結果:", result.success ? '成功' : '失敗', result.error || '');
});