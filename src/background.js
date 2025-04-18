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
      const initResult = await initializeFirebase(); // initializeFirebaseは先に実行
      console.log("BG: Message received:", message.action, "Firebase Initialized:", firebaseInitialized);

      if (!initResult.success || !firebaseInitialized) {
        console.error("BG: Firebase not initialized, cannot process message:", message.action);
        sendResponse({ success: false, error: "バックグラウンド処理の準備ができていません" });
        return; // 初期化失敗時は処理中断
      }

      const action = message.action; // アクションを変数に格納

      // アクションごとの処理
      if (typeof action === 'string' && action.trim() === 'getAuthStatus') {
        console.log("BG: Processing getAuthStatus...");
        sendResponse({ user: currentUser });
        return; // 応答後に関数終了
      } else if (typeof action === 'string' && action.trim() === 'signIn') {
        console.log("BG: Processing signIn...");
        const result = await signInWithGoogle();
        sendResponse(result);
        return; // 応答後に関数終了
      } else if (typeof action === 'string' && action.trim() === 'signOut') {
        console.log("BG: Processing signOut...");
        if (auth) {
          await signOut(auth);
          console.log("BG: User signed out successfully.");
          currentUser = null; // currentUserもクリア
          stopAllListeners(); // リスナー停止
          notifyAuthStatusToAllContexts(); // 状態変更を通知
          sendResponse({ success: true });
        } else {
          console.warn("BG: SignOut requested but Auth is not initialized.");
          sendResponse({ success: false, error: "認証システムが初期化されていません" });
        }
        return; // 応答後に関数終了
      } else if (typeof action === 'string' && action.trim() === 'startListening') {
          const { meetingId } = message;
          console.log(`BG: Processing startListening for ${meetingId}...`);
          if (meetingId) {
              startDbListener(meetingId);
              sendResponse({ success: true, message: `Listener started for ${meetingId}` });
          } else {
              sendResponse({ success: false, error: "Meeting ID is required" });
          }
          return;
      } else if (typeof action === 'string' && action.trim() === 'stopListening') {
          const { meetingId } = message;
          console.log(`BG: Processing stopListening for ${meetingId}...`);
          if (meetingId) {
              stopDbListener(meetingId);
              sendResponse({ success: true, message: `Listener stopped for ${meetingId}` });
          } else {
              sendResponse({ success: false, error: "Meeting ID is required" });
          }
          return;
      } else if (typeof action === 'string' && action.trim() === 'createPin') {
        const { meetingId, pinData } = message;
        // ★デバッグログ追加: どのタイプのピン作成リクエストか
        console.log(`BG: Processing createPin for type: ${pinData?.type} in meeting: ${meetingId}`);

        if (!meetingId || !pinData || !pinData.type) {
          console.error("BG: createPin - Missing parameters.");
          sendResponse({ success: false, error: "必須パラメータ(meetingId, pinData.type)が不足しています" });
          return;
        }
        if (!currentUser) {
          console.warn("BG: createPin - User not authenticated.");
          sendResponse({ success: false, error: "認証されていません" });
          return;
        }
        if (!database) {
          console.error("BG: createPin - Database not initialized.");
          sendResponse({ success: false, error: "データベースが初期化されていません" });
          return;
        }

        console.log(`BG: Attempting to create pin in ${meetingId} for user ${currentUser.uid}`);

        const pinsRef = ref(database, `meetings/${meetingId}/pins`);
        const newPinRef = push(pinsRef);

        const pinPayload = {
          ...pinData,
          userId: currentUser.uid,
          userName: currentUser.displayName || currentUser.email.split('@')[0],
          timestamp: Date.now()
        };

        console.log("BG: Setting pin payload:", pinPayload);

        try {
          await set(newPinRef, pinPayload);
          console.log(`BG: Pin created successfully in ${meetingId}: ${newPinRef.key}`);
          sendResponse({ success: true, pinId: newPinRef.key });
        } catch (error) {
          console.error(`BG: ピン作成エラー (${meetingId}):`, error);
          if (error.code === 'PERMISSION_DENIED') {
               sendResponse({ success: false, error: "データベースへの書き込み権限がありません。" });
          } else {
               sendResponse({ success: false, error: `DB書き込みエラー: ${error.message}` });
          }
        }
        // 非同期処理完了後なので return は不要
      } else if (typeof action === 'string' && action.trim() === 'removePin') {
        console.log("BG: Processing removePin...");
        const { meetingId, pinId } = message;
         if (!meetingId || !pinId) {
           console.error("BG: removePin - Missing parameters.");
           sendResponse({ success: false, error: "必須パラメータ(meetingId, pinId)が不足しています" });
           return;
         }
         if (!currentUser) {
           console.warn("BG: removePin - User not authenticated.");
           sendResponse({ success: false, error: "認証されていません" });
           return;
         }
         if (!database) {
           console.error("BG: removePin - Database not initialized.");
           sendResponse({ success: false, error: "データベースが初期化されていません" });
           return;
         }

         console.log(`BG: Attempting to remove pin ${pinId} from ${meetingId} by user ${currentUser.uid}`);

         const pinRef = ref(database, `meetings/${meetingId}/pins/${pinId}`);

         try {
           // TODO: 本当は削除権限チェック（ピン作成者か確認）を入れるべき
           await remove(pinRef);
           console.log(`BG: Pin removed successfully: ${pinId} from ${meetingId}`);
           sendResponse({ success: true });
         } catch (error) {
           console.error(`BG: ピン削除エラー (${meetingId}/${pinId}):`, error);
           if (error.code === 'PERMISSION_DENIED') {
               sendResponse({ success: false, error: "データベースからの削除権限がありません。" });
           } else {
               sendResponse({ success: false, error: `DB削除エラー: ${error.message}` });
           }
         }
         // 非同期処理完了後なので return は不要
      } else {
        console.warn("BG: Received unknown or invalid action:", message.action);
        sendResponse({ success: false, error: `不明なアクション: ${message.action}` });
      }
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