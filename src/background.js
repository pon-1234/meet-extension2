// src/background.js (trim()追加 & デバッグログ強化 & return文再確認)

// Firebase SDKをインポート
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  GoogleAuthProvider,
  signOut,
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

    firebaseInitialized = true; // 初期化フラグを設定
    setupAuthListener(); // 認証リスナー設定
    console.log('BG: Firebase初期化完了 (永続性: メモリ内)');
    return { success: true };

  } catch (error) {
    console.error('BG: Firebase初期化中の致命的エラー:', error);
    firebaseInitialized = false;
    return { success: false, error: error };
  }
}

// --- 認証状態リスナー設定 ---
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

// --- notifyAuthStatusToAllContexts, notifyAuthStatusToContentScripts, notifyAuthStatusToPopup ---
function notifyAuthStatusToAllContexts() {
    notifyAuthStatusToContentScripts();
    notifyAuthStatusToPopup();
}
function notifyAuthStatusToContentScripts() {
  chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'authStatusChanged', user: currentUser })
        .catch(error => {
            // lastError チェックは不要 (catch自体がエラーハンドリング)
            if (!error.message?.includes('Receiving end does not exist') && !error.message?.includes('Extension context invalidated')) {
                 console.warn(`BG: タブ ${tab.id} への認証状態通知エラー: ${error.message || error}`);
            }
        });
    });
  });
}
function notifyAuthStatusToPopup() {
    chrome.runtime.sendMessage({ action: 'authStatusChanged', user: currentUser })
      .catch(error => {
          // lastError チェックは不要 (catch自体がエラーハンドリング)
          if (!error.message?.includes('Receiving end does not exist') && !error.message?.includes('Extension context invalidated')) {
              console.warn(`BG: ポップアップへの認証状態通知エラー: ${error.message || error}`);
          }
      });
}

// --- データベースリスナー関連 ---
function startDbListener(meetingId) {
    if (!currentUser || !database || !meetingId) {
        console.log(`BG: ${meetingId} のリスナーを開始できません - User:${!!currentUser}, DB:${!!database}`);
        return;
    }
    if (activeListeners[meetingId]) {
        console.log(`BG: ${meetingId} のリスナーは既に開始されています`);
        return;
    }
    console.log(`BG: ${meetingId} のDBリスナーを開始します`);
    const pinsRef = ref(database, `meetings/${meetingId}/pins`);
    const listenerCallbacks = {};

    listenerCallbacks.added = onChildAdded(pinsRef, (snapshot) => {
        console.log(`BG: Pin added in ${meetingId}: ${snapshot.key}`);
        const pinId = snapshot.key;
        const pin = snapshot.val();
        notifyPinUpdateToContentScripts(meetingId, 'pinAdded', { pinId, pin });
    }, (error) => {
        console.error(`BG: DBリスナーエラー (child_added) for ${meetingId}:`, error);
        if (error.code === 'PERMISSION_DENIED') notifyPermissionErrorToContentScripts(meetingId);
        stopDbListener(meetingId);
    });

    listenerCallbacks.removed = onChildRemoved(pinsRef, (snapshot) => {
        console.log(`BG: Pin removed in ${meetingId}: ${snapshot.key}`);
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
            // Service Workerが停止する直前に呼ばれるとエラーになることがあるが、無視して良い場合が多い
            if (!offError.message?.includes('Extension context invalidated')) {
                 console.warn(`BG: リスナー解除中にエラー (無視): ${offError.message}`);
            }
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
                    console.log(`BG: アクティブなMeetタブを検出: ${meetingId}, リスナーを開始`);
                    startDbListener(meetingId);
                }
            }
        });
    });
}

// --- Content Script への通知ヘルパー ---
function notifyPinUpdateToContentScripts(targetMeetingId, action, data) {
    chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
        tabs.forEach(tab => {
            if (tab.url && tab.url.includes(targetMeetingId)) {
                chrome.tabs.sendMessage(tab.id, { action, ...data })
                    .catch(error => {
                        if (!error.message?.includes('Receiving end does not exist') && !error.message?.includes('Extension context invalidated')) {
                            console.warn(`BG: Pin更新通知エラー (${action}) to tab ${tab.id}: ${error.message || error}`);
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
                        if (!error.message?.includes('Receiving end does not exist') && !error.message?.includes('Extension context invalidated')) {
                            console.warn(`BG: 権限エラー通知エラー to tab ${tab.id}: ${error.message || error}`);
                        }
                    });
            }
        });
    });
}

// --- Googleログイン処理 ---
async function signInWithGoogle() {
  console.log("BG: Googleログインを開始します");
  try {
    const initResult = await initializeFirebase();
    if (!initResult.success) {
      console.error("BG: Firebase初期化エラーのためログイン中止:", initResult.error);
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
    console.log("BG: Got auth token from Chrome Identity API.");
    const credential = GoogleAuthProvider.credential(null, authToken);
    console.log("BG: Signing in with Firebase credential...");
    await signInWithCredential(auth, credential);
    console.log("BG: Googleログイン成功 (Firebase側)");
    return { success: true };
  } catch (error) {
    console.error("BG: Googleログインプロセス中にエラー:", error);
    return { success: false, error: error };
  }
}

// --- URLからMeeting IDを抽出 ---
function extractMeetingIdFromUrl(url) {
  const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
  const match = url.match(meetRegex);
  return match ? match[1] : null;
}

// --- タブ更新リスナー ---
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes("meet.google.com/")) {
    const meetingId = extractMeetingIdFromUrl(tab.url);
    if (meetingId) {
      console.log(`BG: Meetタブ更新完了: ${meetingId} (Tab ID: ${tabId})`);
      chrome.tabs.sendMessage(tabId, { action: 'authStatusChanged', user: currentUser })
        .catch(error => {
          if (!error.message?.includes('Receiving end does not exist') && !error.message?.includes('Extension context invalidated')) {
            console.warn(`BG: タブ更新時の認証状態通知エラー: ${error.message || error}`);
          }
        });
      if (currentUser) {
        startDbListener(meetingId);
      }
    } else {
        console.log(`BG: Meetタブ更新完了 (会議ページではない): ${tab.url}`);
    }
  }
});


// --- メッセージリスナー (デバッグログ強化 & return文再確認 & trim() 追加) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      // Firebase 初期化チェック
      console.log("BG: Message received:", message.action, "Firebase Initialized:", firebaseInitialized); // ★ログ追加
      const initResult = await initializeFirebase();
      if (!initResult.success || !firebaseInitialized) {
        console.error("BG: Firebase not initialized, aborting message processing."); // ★ログ追加
        sendResponse({ success: false, error: `Firebase初期化エラー: ${initResult.error?.message || '不明'}` });
        return; // ★ return
      }

      // ★★★ アクションを変数に入れ、型と内容をログ出力 ★★★
      const action = message.action;
      console.log(`BG: Checking action: "${action}" (Type: ${typeof action})`);

      if (action === 'getAuthStatus') {
        console.log("BG: Processing getAuthStatus...");
        console.log("BG: Current user for getAuthStatus:", currentUser ? currentUser.email : 'null');
        sendResponse({ user: currentUser });
        console.log("BG: Sent response for getAuthStatus");
        return; // ★ return
      }

      if (action === 'requestLogin') {
        console.log("BG: Processing requestLogin...");
        sendResponse({ started: true }); // 先に応答を返す
        const loginResult = await signInWithGoogle();
         if (!loginResult.success) {
           console.error("BG: Login failed, notifying popup if possible.");
           chrome.runtime.sendMessage({
             action: 'loginFailed',
             error: loginResult.error?.message || '不明なエラー'
           }).catch(() => {});
         } else {
           console.log("BG: Login process finished (auth state change will notify UI).");
         }
        return; // ★ return
      }

      if (action === 'requestLogout') {
        console.log("BG: Processing requestLogout...");
        try {
          await signOut(auth);
          console.log("BG: Logout successful.");
          sendResponse({ success: true });
        } catch (error) {
          console.error("BG: Logout error:", error);
          sendResponse({ success: false, error: error.message || 'ログアウト中にエラーが発生しました' });
        }
        return; // ★ return
      }

      // これ以降のアクションはログインが必要
      if (!currentUser) {
        console.warn("BG: Action requires login, but user is null:", action);
        sendResponse({ success: false, error: 'ログインが必要です' });
        return; // ★ return
      }

      // ★★★ 比較前に trim() を試す ★★★
      if (typeof action === 'string' && action.trim() === 'createPin') {
        console.log("BG: Processing createPin..."); // ★ ここが出力されるはず
        const { meetingId, pinData } = message;
        console.log(`BG: createPin - Meeting ID: ${meetingId}, Data:`, pinData);
        console.log("BG: createPin - Current user:", currentUser ? currentUser.email : 'null');

        if (!meetingId || !pinData || !pinData.type) {
          console.error("BG: createPin - Missing parameters.");
          sendResponse({ success: false, error: '必要なパラメータが不足しています' });
          return; // ★ return
        }

        try {
          const pinWithUser = {
            type: pinData.type,
            createdBy: {
              uid: currentUser.uid,
              displayName: currentUser.displayName,
              email: currentUser.email
            },
            createdAt: Date.now()
          };
          console.log("BG: createPin - Attempting to set data:", JSON.stringify(pinWithUser));

          const pinsRef = ref(database, `meetings/${meetingId}/pins`);
          const newPinRef = push(pinsRef);
          console.log(`BG: createPin - Calling set() for pin ID: ${newPinRef.key}`);

          await set(newPinRef, pinWithUser); // Firebase書き込み

          console.log(`BG: createPin - Set successful for pin ID: ${newPinRef.key}`);
          sendResponse({ success: true, pinId: newPinRef.key });

        } catch (error) {
          console.error("BG: createPin - Error during Firebase set:", error);
          sendResponse({
              success: false,
              error: error.message || 'ピンの作成中にエラーが発生しました',
              code: error.code
          });
        }
        return; // ★ return
      }

      // ★★★ removePin も action 変数と比較 ★★★
      if (typeof action === 'string' && action.trim() === 'removePin') {
        console.log("BG: Processing removePin...");
        const { meetingId, pinId } = message;
         if (!meetingId || !pinId) {
           console.error("BG: removePin - Missing parameters.");
           sendResponse({ success: false, error: '必要なパラメータが不足しています' });
           return; // ★ return
         }
        try {
          const pinRef = ref(database, `meetings/${meetingId}/pins/${pinId}`);
          console.log(`BG: removePin - Calling remove for ${meetingId}/${pinId}`);
          await remove(pinRef);
          console.log(`BG: removePin - Remove successful for ${meetingId}/${pinId}`);
          sendResponse({ success: true });
        } catch (error) {
          console.error("BG: removePin - Error during Firebase remove:", error);
          sendResponse({
              success: false,
              error: error.message || 'ピンの削除中にエラーが発生しました',
              code: error.code
          });
        }
        return; // ★ return
      }

      // どのifにも一致しなかった場合
      console.warn("BG: Unknown message action received:", action);
      sendResponse({ success: false, error: '不明なメッセージタイプ' });
      // ここは最後の処理なので return 不要

    } catch (error) {
      console.error("BG: Unexpected error in message listener:", error);
      sendResponse({ success: false, error: `予期しないエラー: ${error.message || error}` });
      // ここも最後の処理なので return 不要
    }
  })();

  return true; // 非同期処理のため true を返す
});


// --- 拡張機能インストール/起動時の処理 ---
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("BG: 拡張機能がインストール/更新されました", details.reason);
  // 初期化は Service Worker 起動時に行われるので、ここでは不要な場合もある
  await initializeFirebase();
});

// Service Worker起動時にFirebase初期化を試みる
initializeFirebase().then(result => {
  console.log("BG: 起動時のFirebase初期化結果:", result.success ? '成功' : '失敗', result.error || '');
});