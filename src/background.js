// src/background.js (会議IDごとのリスナー管理、非同期初期化、エラーハンドリング改善)

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
  remove,
  serverTimestamp // serverTimestamp をインポート
} from 'firebase/database';
import { firebaseConfig, COMPANY_DOMAIN } from './firebase-config';

let firebaseInitialized = false;
let app = null; // Firebase App インスタンスを保持
let auth = null;
let database = null;
let currentUser = null;
let activeListeners = {}; // { meetingId: { ref, listeners: { added, removed } } }

// --- Firebase 初期化関数 (async) ---
async function initializeFirebase() {
  // console.log('BG: Firebase 初期化処理開始...'); // ログは必要に応じて調整
  if (firebaseInitialized) {
    // console.log("BG: Firebaseは既に初期化済みです");
    return { success: true };
  }

  try {
    app = initializeApp(firebaseConfig); // app インスタンスを保持
    // console.log('BG: Firebase Appが初期化されました');

    auth = getAuth(app);
    database = getDatabase(app);
    // console.log('BG: Firebase Auth/Databaseインスタンスを取得しました');

    firebaseInitialized = true;
    setupAuthListener();
    // console.log('BG: Firebase初期化完了');
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
    // console.log("BG: onAuthStateChanged triggered. user:", user ? user.email : 'null');
    const previousUser = currentUser;
    let isAllowedDomain = false;

    if (user && user.email) {
        if (COMPANY_DOMAIN) {
            // console.log(`BG: Checking email "${user.email}" against domain "@${COMPANY_DOMAIN}"`);
            isAllowedDomain = user.email.endsWith(`@${COMPANY_DOMAIN}`);
            // console.log(`BG: Domain check result: ${isAllowedDomain}`);
        } else {
            console.warn("BG: COMPANY_DOMAIN is not defined or empty. Domain check skipped, allowing user.");
            isAllowedDomain = true;
        }
    } else {
        // console.log("BG: User logged out or email is missing.");
        isAllowedDomain = false;
    }

    if (isAllowedDomain) {
      currentUser = { uid: user.uid, email: user.email, displayName: user.displayName || user.email.split('@')[0] };
      // console.log("BG: User authenticated:", currentUser.email);
      // 認証が変わった場合、アクティブなタブに対してリスナーを開始し直す
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
        // console.log("BG: Auth status changed, notifying contexts.");
        notifyAuthStatusToAllContexts();
    }
  }, (error) => {
    console.error("BG: 認証状態変更リスナーエラー:", error);
    currentUser = null;
    stopAllListeners();
    notifyAuthStatusToAllContexts();
  });
}

// --- 認証状態通知 ---
function notifyAuthStatusToAllContexts() {
    notifyAuthStatusToContentScripts();
    notifyAuthStatusToPopup();
}
function notifyAuthStatusToContentScripts() {
  chrome.tabs.query({ url: "https://meet.google.com/*" })
    .then(tabs => {
      tabs.forEach(tab => {
        if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'authStatusChanged', user: currentUser })
            .catch(error => handleMessageError(error, tab.id, 'authStatusChanged'));
        }
      });
    })
    .catch(error => console.warn("BG: Error querying tabs for content script notification:", error));
}
function notifyAuthStatusToPopup() {
    chrome.runtime.sendMessage({ action: 'authStatusChanged', user: currentUser })
        .catch(error => handleMessageError(error, 'popup', 'authStatusChanged'));
}

// --- データベースリスナー関連 ---
function startDbListener(meetingId) {
    if (!currentUser || !database || !meetingId) {
        // console.log(`BG: Cannot start listener for ${meetingId} - User:${!!currentUser}, DB:${!!database}`);
        return;
    }
    if (activeListeners[meetingId]) {
        // console.log(`BG: Listener for ${meetingId} already active.`);
        return;
    }
    console.log(`BG: Starting DB listener for ${meetingId}`);
    const pinsRef = ref(database, `meetings/${meetingId}/pins`); // 正しいパス
    const listeners = {};

    try {
        listeners.added = onChildAdded(pinsRef, (snapshot) => {
            // console.log(`BG: Pin added in ${meetingId}: ${snapshot.key}`);
            const pinId = snapshot.key;
            const pin = snapshot.val();
            notifyPinUpdateToContentScripts(meetingId, 'pinAdded', { pinId, pin });
        }, (error) => {
            console.error(`BG: DB listener error (child_added) for ${meetingId}:`, error);
            if (error.code === 'PERMISSION_DENIED') notifyPermissionErrorToContentScripts(meetingId);
            stopDbListener(meetingId); // エラー時もリスナー停止
        });

        listeners.removed = onChildRemoved(pinsRef, (snapshot) => {
            // console.log(`BG: Pin removed in ${meetingId}: ${snapshot.key}`);
            const pinId = snapshot.key;
            notifyPinUpdateToContentScripts(meetingId, 'pinRemoved', { pinId });
        }, (error) => {
            console.error(`BG: DB listener error (child_removed) for ${meetingId}:`, error);
            if (error.code === 'PERMISSION_DENIED') notifyPermissionErrorToContentScripts(meetingId);
            stopDbListener(meetingId); // エラー時もリスナー停止
        });

        activeListeners[meetingId] = { ref: pinsRef, listeners: listeners };
    } catch (error) {
        console.error(`BG: Failed to attach listeners for ${meetingId}:`, error);
    }
}

function stopDbListener(meetingId) {
    const listenerInfo = activeListeners[meetingId];
    if (listenerInfo) {
        console.log(`BG: Stopping DB listener for ${meetingId}`);
        try {
            // off() を呼ぶ前にリスナー関数が存在するか確認
            if (listenerInfo.listeners.added) {
                off(listenerInfo.ref, 'child_added', listenerInfo.listeners.added);
            }
            if (listenerInfo.listeners.removed) {
                off(listenerInfo.ref, 'child_removed', listenerInfo.listeners.removed);
            }
        } catch (offError) {
            handleMessageError(offError, `listener off for ${meetingId}`);
        }
        delete activeListeners[meetingId];
    }
}

function stopAllListeners() {
    console.log("BG: Stopping all DB listeners.");
    Object.keys(activeListeners).forEach(stopDbListener);
}

function startListenersForActiveMeetTabs() {
    if (!currentUser) return;
    chrome.tabs.query({ url: "https://meet.google.com/*" })
        .then(tabs => {
            const activeMeetingIds = new Set();
            tabs.forEach(tab => {
                if (tab.url) {
                    const meetingId = extractMeetingIdFromUrl(tab.url);
                    if (meetingId) {
                        activeMeetingIds.add(meetingId);
                        if (!activeListeners[meetingId]) { // まだリスナーがなければ開始
                           // console.log(`BG: Found active Meet tab: ${meetingId}, starting listener.`);
                            startDbListener(meetingId);
                        }
                    }
                }
            });
            // 不要になったリスナーを停止 (現在開いているタブにないリスナー)
            Object.keys(activeListeners).forEach(listeningId => {
                if (!activeMeetingIds.has(listeningId)) {
                    console.log(`BG: Stopping listener for inactive meeting: ${listeningId}`);
                    stopDbListener(listeningId);
                }
            });
        })
        .catch(error => console.warn("BG: Error querying tabs for listener sync:", error));
}

// --- Content Script への通知ヘルパー (会議IDでフィルタリング) ---
function notifyPinUpdateToContentScripts(targetMeetingId, action, data) {
    chrome.tabs.query({ url: `https://meet.google.com/${targetMeetingId}*` }) // URLで直接絞り込み
        .then(tabs => {
            tabs.forEach(tab => {
                if(tab.id) {
                    chrome.tabs.sendMessage(tab.id, { action, ...data })
                    .catch(error => handleMessageError(error, tab.id, action));
                }
            });
        })
        .catch(error => console.warn(`BG: Error querying tabs for ${action} notification:`, error));
}

function notifyPermissionErrorToContentScripts(targetMeetingId) {
     chrome.tabs.query({ url: `https://meet.google.com/${targetMeetingId}*` })
        .then(tabs => {
            tabs.forEach(tab => {
                if(tab.id) {
                    chrome.tabs.sendMessage(tab.id, { action: 'dbPermissionError' })
                    .catch(error => handleMessageError(error, tab.id, 'dbPermissionError'));
                }
            });
        })
        .catch(error => console.warn("BG: Error querying tabs for permission error notification:", error));
}

// --- Googleログイン処理 ---
async function signInWithGoogle() {
  // console.log("BG: Starting Google Sign-In process...");
  try {
    const initResult = await initializeFirebase(); // 先に初期化を試みる
    if (!initResult.success) {
      console.error("BG: Firebase initialization failed, aborting sign-in:", initResult.error);
      return { success: false, error: initResult.error };
    }
    if (!auth) {
        console.error("BG: Auth object not available after initialization.");
        return { success: false, error: "Authentication service not ready." };
    }
    const authToken = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });
    // console.log("BG: Got auth token from Chrome Identity API.");
    const credential = GoogleAuthProvider.credential(null, authToken);
    // console.log("BG: Signing in with Firebase credential...");
    await signInWithCredential(auth, credential);
    console.log("BG: Google Sign-In successful (Firebase).");
    return { success: true };
  } catch (error) {
    console.error("BG: Error during Google Sign-In process:", error);
    return { success: false, error: error };
  }
}

// --- URLからMeeting IDを抽出 ---
function extractMeetingIdFromUrl(url) {
  if (!url) return null;
  const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
  const match = url.match(meetRegex);
  return match ? match[1] : null;
}

// --- メッセージ送信エラーハンドリング ---
function handleMessageError(error, targetDesc, actionDesc = 'message') {
    if (!error) return; // エラーがなければ何もしない
    // 無視して良いエラーか判定
    const ignoreErrors = ['Receiving end does not exist', 'Extension context invalidated'];
    if (!ignoreErrors.some(msg => error.message?.includes(msg))) {
        console.warn(`BG: Error sending ${actionDesc} to ${targetDesc}: ${error.message || error}`);
    }
}


// --- タブ更新/削除リスナー ---
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // status 'loading' でもURLが変わる場合があるので注意（必要なら 'loading' も含める）
  if ((changeInfo.status === 'complete' || changeInfo.url) && tab.url && tab.url.includes("meet.google.com/")) {
    // console.log(`BG: Tab updated: ${tabId}, Status: ${changeInfo.status}, URL: ${tab.url}`);
    const meetingId = extractMeetingIdFromUrl(tab.url);
    // Content ScriptにURL更新を通知（これによりCS側でリスナー開始/停止依頼が行われる）
    chrome.tabs.sendMessage(tabId, { action: 'urlUpdated', url: tab.url })
        .catch(error => handleMessageError(error, tabId, 'urlUpdated'));

    // Background側でも状態変化に応じてリスナーを同期
    startListenersForActiveMeetTabs();
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    // console.log(`BG: Tab removed: ${tabId}. Checking for listener cleanup.`);
    // どのタブがどの会議IDだったかを正確に知るのは難しい
    // 代わりに、定期的にアクティブなタブをチェックして不要なリスナーを削除する
    // (startListenersForActiveMeetTabs が呼ばれるタイミングで実質的に行われる)
    // もしくは、ここで単純に startListenersForActiveMeetTabs を呼んでも良い
    startListenersForActiveMeetTabs();
});


// --- メッセージリスナー ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const initResult = await initializeFirebase();
      // console.log("BG: Message received:", message.action, "Firebase Initialized:", firebaseInitialized);

      if (!initResult.success || !firebaseInitialized) {
        console.error("BG: Firebase not initialized, cannot process message:", message.action);
        sendResponse({ success: false, error: "バックグラウンド処理の準備ができていません" });
        return;
      }

      const action = message.action;

      if (typeof action === 'string' && action.trim() === 'getAuthStatus') {
        // console.log("BG: Processing getAuthStatus...");
        sendResponse({ user: currentUser });
        return;
      } else if (typeof action === 'string' && action.trim() === 'requestLogin') { // Popupからのログイン要求アクション名変更
        console.log("BG: Processing requestLogin...");
        const result = await signInWithGoogle();
        sendResponse({ started: result.success, error: result.error?.message }); // 結果を返す
        return;
      } else if (typeof action === 'string' && action.trim() === 'requestLogout') { // Popupからのログアウトリクエスト
        console.log("BG: Processing requestLogout...");
        if (auth) {
            try {
                await signOut(auth);
                console.log("BG: User signed out successfully.");
                // currentUser = null; // onAuthStateChangedで処理される
                // stopAllListeners(); // onAuthStateChangedで処理される
                // notifyAuthStatusToAllContexts(); // onAuthStateChangedで処理される
                sendResponse({ success: true });
            } catch(error) {
                console.error("BG: Sign out error:", error);
                sendResponse({ success: false, error: error.message });
            }
        } else {
          console.warn("BG: SignOut requested but Auth is not initialized.");
          sendResponse({ success: false, error: "認証システムが初期化されていません" });
        }
        return;
      } else if (typeof action === 'string' && action.trim() === 'startListening') {
          const { meetingId } = message;
          // console.log(`BG: Processing startListening for ${meetingId}...`);
          if (meetingId) {
              startDbListener(meetingId);
              sendResponse({ success: true, message: `Listener started for ${meetingId}` });
          } else {
              sendResponse({ success: false, error: "Meeting ID is required" });
          }
          return;
      } else if (typeof action === 'string' && action.trim() === 'stopListening') {
          const { meetingId } = message;
          // console.log(`BG: Processing stopListening for ${meetingId}...`);
          if (meetingId) {
              stopDbListener(meetingId);
              sendResponse({ success: true, message: `Listener stopped for ${meetingId}` });
          } else {
              sendResponse({ success: false, error: "Meeting ID is required" });
          }
          return;
      } else if (typeof action === 'string' && action.trim() === 'createPin') {
        const { meetingId, pinData } = message;
        // console.log(`BG: Processing createPin for type: ${pinData?.type} in meeting: ${meetingId}`);

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

        // console.log(`BG: Attempting to create pin in ${meetingId} for user ${currentUser.uid}`);
        const pinsRef = ref(database, `meetings/${meetingId}/pins`);
        const newPinRef = push(pinsRef);

        const pinPayload = {
          ...pinData,
          createdBy: { // createdBy オブジェクトを追加
             uid: currentUser.uid,
             displayName: currentUser.displayName,
             email: currentUser.email // 必要であればemailも追加
          },
          timestamp: serverTimestamp() // Firebaseサーバータイムスタンプを使用
        };

        // console.log("BG: Setting pin payload:", pinPayload);

        try {
          await set(newPinRef, pinPayload);
          // console.log(`BG: Pin created successfully in ${meetingId}: ${newPinRef.key}`);
          sendResponse({ success: true, pinId: newPinRef.key });
        } catch (error) {
          console.error(`BG: ピン作成エラー (${meetingId}):`, error);
          if (error.code === 'PERMISSION_DENIED') {
               sendResponse({ success: false, error: "データベースへの書き込み権限がありません。" });
          } else {
               sendResponse({ success: false, error: `DB書き込みエラー: ${error.message}` });
          }
        }
      } else if (typeof action === 'string' && action.trim() === 'removePin') {
         // console.log("BG: Processing removePin...");
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

          // console.log(`BG: Attempting to remove pin ${pinId} from ${meetingId} by user ${currentUser.uid}`);
          const pinRef = ref(database, `meetings/${meetingId}/pins/${pinId}`);

          try {
            // サーバー側で削除権限をチェックするため、クライアント側での作成者チェックは必須ではない
            await remove(pinRef);
            // console.log(`BG: Pin removed successfully: ${pinId} from ${meetingId}`);
            sendResponse({ success: true });
          } catch (error) {
            console.error(`BG: ピン削除エラー (${meetingId}/${pinId}):`, error);
            if (error.code === 'PERMISSION_DENIED') {
                sendResponse({ success: false, error: "データベースからの削除権限がありません。" });
            } else {
                sendResponse({ success: false, error: `DB削除エラー: ${error.message}` });
            }
          }
      } else {
        console.warn("BG: Received unknown or invalid action:", message.action);
        sendResponse({ success: false, error: `不明なアクション: ${message.action}` });
      }
    } catch (error) {
      console.error("BG: Unexpected error in message listener:", error);
      sendResponse({ success: false, error: `予期しないエラー: ${error.message || error}` });
    }
  })();

  return true; // Indicate that the response is asynchronous
});

// --- 拡張機能インストール/起動時の処理 ---
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("BG: Extension installed/updated.", details.reason);
  await initializeFirebase(); // インストール/更新時にも初期化を試みる
});

// Service Worker起動時にFirebase初期化を試みる
initializeFirebase().then(result => {
  console.log("BG: Initial Firebase initialization result:", result.success ? 'Success' : 'Failure', result.error || '');
});