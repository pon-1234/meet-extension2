// background.js

// Firebase SDKと設定ファイルをインポート
try {
  importScripts(
    './firebase/firebase-app-compat.js',
    './firebase/firebase-auth-compat.js',
    './firebase/firebase-database-compat.js',
    './firebase-config.js' // 設定ファイルを追加
  );
  console.log('BG: Firebase SDKとConfigのインポートに成功しました');
} catch (e) { console.error('Firebase SDK/Config Import Error:', e); }

let firebaseInitialized = false;
let auth = null;
let database = null; // Database インスタンスを保持
let currentUser = null;
let activeListeners = {}; // { meetingId: { ref: ..., listeners: { added: ..., removed: ... } } }

// Firebase 初期化関数 (async)
async function initializeFirebase() {
  console.log('BG: Firebaseを初期化中...');
  if (firebaseInitialized) {
    console.log("BG: Firebaseは既に初期化済みです");
    return { success: true };
  }
  if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') {
    console.error("BG: Firebase SDKまたは設定が読み込まれていません");
    return { success: false, error: new Error("Firebase SDKまたは設定が読み込まれていません") };
  }

  try {
    if (!firebase.apps.length) {
       firebase.initializeApp(firebaseConfig);
       console.log('BG: Firebase Appが初期化されました');
    } else {
       firebase.app();
       console.log('BG: Firebase Appは既に初期化されています');
    }
    auth = firebase.auth();
    database = firebase.database();
    console.log('BG: Firebase Auth/Databaseインスタンスを取得しました');

    // 永続性を NONE に設定
    try {
      console.log('BG: 永続性設定 (NONE) を試みます...');
      await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
      console.log('BG: 永続性を NONE に設定しました');
      firebaseInitialized = true;
      setupAuthListener(); // 認証リスナー設定
      console.log('BG: Firebase初期化完了 (永続性: NONE)');
      return { success: true };
    } catch (error) {
      console.warn('BG: 永続性設定 (NONE) エラー (無視して続行):', error);
      firebaseInitialized = true; // エラーでも初期化は完了扱いにする
      setupAuthListener();
      console.log('BG: Firebase初期化完了 (永続性設定エラーあり)');
      return { success: true, warning: 'Persistence setting failed but ignored' };
    }
  } catch (error) {
    console.error('BG: Firebase初期化中の致命的エラー:', error);
    firebaseInitialized = false;
    return { success: false, error: error };
  }
}

// 認証状態リスナー設定
function setupAuthListener() {
  if (!auth) { console.error("BG: Auth listener setup failed - Auth not initialized"); return; }
  auth.onAuthStateChanged((user) => {
    console.log("BG: onAuthStateChanged triggered. user:", user ? user.email : 'null');
    const previousUser = currentUser;
    let isAllowedDomain = false;

    if (user && user.email) {
        if (typeof COMPANY_DOMAIN !== 'undefined' && COMPANY_DOMAIN) { // COMPANY_DOMAIN が定義され、空でないか
            console.log(`BG: Checking email "${user.email}" against domain "@${COMPANY_DOMAIN}"`);
            isAllowedDomain = user.email.endsWith(`@${COMPANY_DOMAIN}`);
            console.log(`BG: Domain check result: ${isAllowedDomain}`);
        } else {
            console.warn("BG: COMPANY_DOMAIN is not defined or empty. Domain check skipped, allowing user.");
            isAllowedDomain = true; // ドメイン未指定なら許可
        }
    } else {
        console.log("BG: User logged out or email is missing.");
        isAllowedDomain = false; // ユーザーがいない場合は不許可
    }

    if (isAllowedDomain) {
      currentUser = { uid: user.uid, email: user.email, displayName: user.displayName || user.email.split('@')[0] };
      console.log("BG: User authenticated:", currentUser.email);
      startListenersForActiveMeetTabs();
    } else {
      if (user) { // ログインはしたがドメイン不一致
        console.warn("BG: User logged in but not from allowed domain:", user.email);
        auth.signOut().catch(err => console.error("BG: Sign out error due to domain mismatch:", err));
      }
      currentUser = null;
      stopAllListeners(); // ドメイン不一致またはログアウトならリスナー停止
    }

    // ユーザー状態が変わった場合のみ通知
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

// 全コンテキストへの認証状態通知
function notifyAuthStatusToAllContexts() {
    notifyAuthStatusToContentScripts();
    notifyAuthStatusToPopup();
}

// Content Script への通知
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

// Popup への通知
function notifyAuthStatusToPopup() {
    chrome.runtime.sendMessage({ action: 'authStatusChanged', user: currentUser })
      .catch(error => {
          if (!error.message?.includes('Receiving end does not exist')) {
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
        // console.log(`BG: ${meetingId} のリスナーは既に有効です`);
        return;
    }

    console.log(`BG: ${meetingId} のDBリスナーを開始します`);
    const pinsRef = database.ref(`meetings/${meetingId}/pins`);
    const listenerCallbacks = {}; // リスナー関数の参照を保持

    listenerCallbacks.added = pinsRef.on('child_added', (snapshot) => {
        const pinId = snapshot.key;
        const pin = snapshot.val();
        // console.log(`BG: child_added for ${meetingId}:`, pinId);
        notifyPinUpdateToContentScripts(meetingId, 'pinAdded', { pinId, pin });
    }, (error) => {
        console.error(`BG: DBリスナーエラー (child_added) for ${meetingId}:`, error);
        if (error.code === 'PERMISSION_DENIED') notifyPermissionErrorToContentScripts(meetingId);
        stopDbListener(meetingId); // エラー時は停止
    });

    listenerCallbacks.removed = pinsRef.on('child_removed', (snapshot) => {
        const pinId = snapshot.key;
        // console.log(`BG: child_removed for ${meetingId}:`, pinId);
        notifyPinUpdateToContentScripts(meetingId, 'pinRemoved', { pinId });
    }, (error) => {
        console.error(`BG: DBリスナーエラー (child_removed) for ${meetingId}:`, error);
        if (error.code === 'PERMISSION_DENIED') notifyPermissionErrorToContentScripts(meetingId);
        stopDbListener(meetingId); // エラー時は停止
    });

    activeListeners[meetingId] = { ref: pinsRef, listeners: listenerCallbacks };
}

function stopDbListener(meetingId) {
    const listenerInfo = activeListeners[meetingId];
    if (listenerInfo) {
        console.log(`BG: ${meetingId} のDBリスナーを停止します`);
        try {
            listenerInfo.ref.off('child_added', listenerInfo.listeners.added);
            listenerInfo.ref.off('child_removed', listenerInfo.listeners.removed);
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
        const currentMeetingIds = new Set();
        tabs.forEach(tab => {
            const url = tab.url;
            const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
            const match = url.match(meetRegex);
            const meetingId = match ? match[1] : null;
            if (meetingId) {
                currentMeetingIds.add(meetingId);
                startDbListener(meetingId); // 既に存在すればスキップされる
            }
        });
        // 閉じたタブのリスナーを停止 (オプション)
        Object.keys(activeListeners).forEach(listeningId => {
            if (!currentMeetingIds.has(listeningId)) {
                stopDbListener(listeningId);
            }
        });
    });
}

// --- Content Script への通知ヘルパー ---
function notifyPinUpdateToContentScripts(targetMeetingId, action, data) {
    chrome.tabs.query({ url: `https://meet.google.com/${targetMeetingId}*` }, (tabs) => {
        tabs.forEach(tab => {
            // console.log(`BG: ${action} をタブ ${tab.id} に送信`);
            chrome.tabs.sendMessage(tab.id, { action: action, data: data })
             .catch(error => {
                 if (!error.message?.includes('Receiving end does not exist')) {
                     console.warn(`BG: ${action} 送信エラー (Tab ${tab.id}): ${error.message || error}`);
                 }
             });
        });
    });
}

function notifyPermissionErrorToContentScripts(targetMeetingId) {
     chrome.tabs.query({ url: `https://meet.google.com/${targetMeetingId}*` }, (tabs) => {
        tabs.forEach(tab => {
            console.log(`BG: permission_error をタブ ${tab.id} に送信`);
            chrome.tabs.sendMessage(tab.id, { action: 'permissionError' })
             .catch(error => {
                 if (!error.message?.includes('Receiving end does not exist')) {
                     console.warn(`BG: permission_error 送信エラー (Tab ${tab.id}): ${error.message || error}`);
                 }
             });
        });
    });
}

// Googleログイン処理 (async)
async function signInWithGoogle() {
  if (!auth) {
    console.error("BG: Firebase Auth not initialized (signInWithGoogle)");
    throw new Error("Firebase Authが初期化されていません");
  }
  const token = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "認証トークン取得失敗"));
      } else {
        resolve(token);
      }
    });
  });
  const credential = firebase.auth.GoogleAuthProvider.credential(null, token);
  try {
    const userCredential = await auth.signInWithCredential(credential);
    console.log("BG: Google Sign-In successful:", userCredential.user?.email);
    return true;
  } catch (error) {
    console.error("BG: Firebase signInWithCredential error:", error);
    throw error;
  }
}

// ★★★ タブ更新イベントリスナー ★★★
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // URLが変更され、かつタブの読み込みが完了したMeetページに対して処理
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes("meet.google.com/")) {
    const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
    const match = tab.url.match(meetRegex);
    const meetingId = match ? match[1] : null;

    console.log(`BG: Tab ${tabId} updated. URL: ${tab.url}, Meeting ID: ${meetingId}`);

    // Content Script に URL 更新と Meeting ID を通知
    chrome.tabs.sendMessage(tabId, {
      action: 'urlUpdated',
      url: tab.url,
      meetingId: meetingId
    }).catch(error => {
      if (!error.message?.includes('Receiving end does not exist')) {
        console.warn(`BG: urlUpdated メッセージ送信エラー (Tab ${tabId}): ${error.message || error}`);
      }
    });

    // ログイン済み & Meeting ID があれば DB リスナーを開始/確認
    if (meetingId && currentUser) {
      startDbListener(meetingId);
    }
    // 他のMeetタブから離れた場合のリスナー停止ロジック（必要なら）
    // 例：現在アクティブなMeetタブのIDリストと比較して不要なものを停止
    startListenersForActiveMeetTabs(); // アクティブタブに基づいてリスナーを整理
  }
});


// --- メッセージリスナー ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => { // 非同期処理のためにラップ
    try {
      const initResult = await initializeFirebase(); // 初期化完了を待つ
      if (!initResult.success || !firebaseInitialized) {
        sendResponse({ success: false, error: `Firebase初期化エラー: ${initResult.error?.message || '不明'}` });
        return;
      }
      if (!auth || !database) {
        sendResponse({ success: false, error: "Firebase Auth/Database 利用不可" });
        return;
      }

      switch (message.action) {
        case 'getAuthStatus':
          sendResponse({ user: currentUser });
          break;
        case 'requestLogin':
          try {
            await signInWithGoogle();
            // 成功応答は onAuthStateChanged が currentUser を設定した後に
            // getAuthStatus を再度呼んでもらうか、BGから通知するのでここでは不要かも
            sendResponse({ started: true });
          } catch (error) {
            sendResponse({ started: false, error: error.message });
          }
          break; // async内で完結するので return true 不要
        case 'requestLogout':
          if (auth) {
            try {
              await auth.signOut();
              sendResponse({ success: true });
            } catch (error) {
              sendResponse({ success: false, error: error.message });
            }
          } else { sendResponse({ success: false, error: "Auth未初期化" }); }
          break; // async内で完結するので return true 不要

        case 'createPing':
          if (!currentUser) { sendResponse({ success: false, error: "未認証" }); break; }
          if (!message.meetingId || !message.pingType) { sendResponse({ success: false, error: "データ無効" }); break; }
          try {
            const pinsRefWrite = database.ref(`meetings/${message.meetingId}/pins`);
            const newPinRef = pinsRefWrite.push();
            const pinData = {
              type: message.pingType,
              createdAt: firebase.database.ServerValue.TIMESTAMP,
              createdBy: {
                uid: currentUser.uid,
                displayName: currentUser.displayName || currentUser.email.split('@')[0],
                email: currentUser.email
              }
            };
            await newPinRef.set(pinData);
            console.log(`BG: Pin ${message.pingType} created in ${message.meetingId}`);
            sendResponse({ success: true, pinId: newPinRef.key });
            // 自動削除タイマー
            setTimeout(() => {
              newPinRef.remove().catch(e => console.warn("BG: ピン自動削除エラー:", e));
            }, 30000); // 30秒
          } catch (error) {
            console.error(`BG: Pin creation error (${message.meetingId}):`, error);
            sendResponse({ success: false, error: error.message, code: error.code });
          }
          break; // async内で完結するので return true 不要

        case 'removePing':
          if (!currentUser) { sendResponse({ success: false, error: "未認証" }); break; }
          if (!message.meetingId || !message.pinId) { sendResponse({ success: false, error: "データ無効" }); break; }
          try {
            const pinToRemoveRef = database.ref(`meetings/${message.meetingId}/pins/${message.pinId}`);
            const snapshot = await pinToRemoveRef.child('createdBy/uid').once('value');
            if (snapshot.val() === currentUser.uid) {
              await pinToRemoveRef.remove();
              console.log(`BG: Pin ${message.pinId} removed from ${message.meetingId}`);
              sendResponse({ success: true });
            } else {
              throw new Error("権限がありません");
            }
          } catch (error) {
            console.error(`BG: Pin removal error (${message.meetingId}/${message.pinId}):`, error);
            sendResponse({ success: false, error: error.message, code: error.code });
          }
          break; // async内で完結するので return true 不要

        // ▼▼▼ meetPageLoaded は削除またはコメントアウト ▼▼▼
        /*
        case 'meetPageLoaded':
             // tabs.onUpdated で処理するため、基本的には不要
             console.log("BG: meetPageLoaded (deprecated) message received.");
             sendResponse({ status: 'received_deprecated' });
             break;
        */

        default:
          console.warn("BG: Unknown message action:", message.action);
          sendResponse({ success: false, error: "不明なアクション" });
          break;
      }
    } catch (error) {
      console.error("BG: メッセージ処理中の予期せぬエラー:", error);
      try {
        sendResponse({ success: false, error: `予期せぬエラー: ${error.message || '不明'}` });
      } catch (sendError) { console.error("BG: エラー応答送信失敗:", sendError); }
    }
  })(); // 即時実行 async 関数を呼び出す

  // 非同期処理を行うため、常に true を返す必要がある
  return true;
});


// --- 拡張機能のインストール/アップデート/起動時の処理 ---
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`Meet Ping Extension インストール/アップデート (${details.reason})`);
  await initializeFirebase();
});

// Service Worker 起動時に初期化
(async () => {
  console.log("Background service worker started/restarted.");
  await initializeFirebase();
})();