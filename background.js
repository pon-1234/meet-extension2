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
let activeListeners = {}; // { meetingId: listenerRef }
// persistencePromise は不要

// ★★★ initializeFirebase を async 関数に変更 ★★★
async function initializeFirebase() {
  console.log('BG: Firebaseを初期化中...');

  // 既に初期化済みの場合
  if (firebaseInitialized) {
    console.log("BG: Firebaseは既に初期化済みです");
    return { success: true };
  }

  // SDKまたは設定が読み込まれていない場合
  if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') {
    console.error("BG: Firebase SDKまたは設定が読み込まれていません");
    // 初期化失敗を示すオブジェクトを返す
    return { success: false, error: new Error("Firebase SDKまたは設定が読み込まれていません") };
  }

  try {
    // Firebase App の初期化
    if (!firebase.apps.length) {
       firebase.initializeApp(firebaseConfig);
       console.log('BG: Firebase Appが初期化されました');
    } else {
       firebase.app(); // 既存のインスタンスを取得
       console.log('BG: Firebase Appは既に初期化されています');
    }
    auth = firebase.auth();
    database = firebase.database();
    console.log('BG: Firebase Auth/Databaseインスタンスを取得しました');

    // ★★★ 永続性設定を NONE に変更し、await で待つ ★★★
    try {
      console.log('BG: 永続性設定 (NONE) を試みます...');
      // SESSION を試す場合は Persistence.SESSION に変更
      await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
      console.log('BG: 永続性を NONE に設定しました');
      // 永続性設定成功後に初期化完了とする
      firebaseInitialized = true;
      setupAuthListener(); // 認証リスナー設定
      console.log('BG: Firebase初期化完了 (永続性: NONE)');
      return { success: true };
    } catch (error) {
      // NONE でも永続性設定が失敗する可能性は低いですが、念のため警告
      console.warn('BG: 永続性設定 (NONE) エラー (無視して続行):', error);
      // エラーが発生しても初期化を続行する場合は、初期化完了とする
      firebaseInitialized = true;
      setupAuthListener();
      console.log('BG: Firebase初期化完了 (永続性設定エラーあり)');
      // エラーがあったことを示す情報を返すことも可能
      return { success: true, warning: 'Persistence setting failed but ignored' };
      // もし永続性設定の失敗が致命的なら、ここでエラーを投げるか false を返す
      // firebaseInitialized = false; // 初期化失敗扱いにする場合
      // return { success: false, error: error };
    }
    // ★★★ ここまで ★★★

  } catch (error) {
    console.error('BG: Firebase初期化中の致命的エラー:', error);
    firebaseInitialized = false; // 致命的エラーなら初期化失敗
    return { success: false, error: error };
  }
}


function setupAuthListener() {
  if (!auth) { console.error("BG: Auth listener setup failed - Auth not initialized"); return; }
  auth.onAuthStateChanged((user) => {
    console.log("BG: onAuthStateChanged triggered. user:", user); // ★ユーザーオブジェクト全体を確認
    const previousUser = currentUser;

    // ★★★ ドメインチェックの詳細ログ ★★★
    let isAllowedDomain = false;
    if (user && user.email) {
        // firebase-config.js に COMPANY_DOMAIN が定義されているか確認
        if (typeof COMPANY_DOMAIN !== 'undefined') {
            console.log(`BG: Checking email "${user.email}" against domain "@${COMPANY_DOMAIN}"`);
            isAllowedDomain = user.email.endsWith(`@${COMPANY_DOMAIN}`);
            console.log(`BG: Domain check result: ${isAllowedDomain}`);
        } else {
            console.warn("BG: COMPANY_DOMAIN is not defined in firebase-config.js. Domain check skipped.");
            // ドメインチェックをスキップするか、デフォルトで許可/不許可にするか決める
            isAllowedDomain = true; // または false
        }
    } else {
        console.log("BG: User or user.email is null/undefined.");
    }
    // ★★★ ここまで ★★★

    if (isAllowedDomain) { // ドメインチェック結果を使用
      currentUser = { uid: user.uid, email: user.email, displayName: user.displayName };
      console.log("BG: User authenticated:", currentUser.email);
      startListenersForActiveMeetTabs();
    } else {
      if (user) {
        console.warn("BG: User logged in but not from allowed domain:", user.email);
        // ドメイン不一致の場合はログアウトさせる (必要に応じて)
        auth.signOut().catch(err => console.error("BG: Sign out error:", err));
        // console.log("BG: Would sign out user due to domain mismatch, but commented out for debugging.");
      } else {
        console.log("BG: User logged out.");
      }
      currentUser = null; // 許可されないドメイン or ログアウトなら currentUser は null
      stopAllListeners();
    }

    if (JSON.stringify(previousUser) !== JSON.stringify(currentUser)) {
        notifyAuthStatusToAllContexts();
    }

  }, (error) => {
    console.error("BG: 認証状態変更エラー:", error);
    currentUser = null;
    stopAllListeners();
    notifyAuthStatusToAllContexts();
  });
}

// Popup と Content Script の両方に認証状態を通知
function notifyAuthStatusToAllContexts() {
    notifyAuthStatusToContentScripts();
    notifyAuthStatusToPopup();
}

// 認証状態をアクティブなMeetタブのContent Scriptに通知
function notifyAuthStatusToContentScripts() {
  chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'authStatusChanged', user: currentUser })
        .catch(error => {
            // 拡張機能がリロードされた直後など、受信側が存在しない場合のエラーは警告レベルに留める
            if (!error.message?.includes('Receiving end does not exist')) {
                 console.error(`BG: タブ ${tab.id} への認証状態通知エラー: ${error.message || error}`);
            } else {
                 console.log(`BG: タブ ${tab.id} への接続試行 (受信側なし): ${error.message}`);
            }
        });
    });
  });
}

// 認証状態をPopupに通知
function notifyAuthStatusToPopup() {
    chrome.runtime.sendMessage({ action: 'authStatusChanged', user: currentUser })
      .catch(error => {
          // ポップアップが開いていない場合のエラーは無視
          if (!error.message?.includes('Receiving end does not exist')) {
              console.warn(`BG: ポップアップへの認証状態通知エラー: ${error.message || error}`);
          }
      });
}

// --- データベースリスナー関連 ---

// 特定のMeeting IDのリスナーを開始
function startDbListener(meetingId) {
    if (!currentUser || !database || !meetingId) {
        console.log(`BG: ${meetingId} のリスナーを開始できません - ユーザー: ${!!currentUser}, DB: ${!!database}`);
        return;
    }
    // 既にリスナーが存在する場合は何もしない
    if (activeListeners[meetingId]) {
        console.log(`BG: ${meetingId} のリスナーは既に有効です`);
        return;
    }

    console.log(`BG: ${meetingId} のDBリスナーを開始します`);
    const pinsRef = database.ref(`meetings/${meetingId}/pins`);
    const listener = {}; // イベントごとのリスナー関数を保持

    // child_added
    listener.added = pinsRef.on('child_added', (snapshot) => {
        const pinId = snapshot.key;
        const pin = snapshot.val();
        console.log(`BG: child_added for ${meetingId}:`, pinId);
        // Content Script に通知
        notifyPinUpdateToContentScripts(meetingId, 'pinAdded', { pinId, pin });
    }, (error) => {
        console.error(`BG: DBリスナーエラー (child_added) for ${meetingId}:`, error);
        console.error('リスナーエラー詳細 - コード:', error.code, 'メッセージ:', error.message);
        // 権限エラーが出たら Content Script に通知
        if (error.code === 'PERMISSION_DENIED') {
           notifyPermissionErrorToContentScripts(meetingId);
        }
        // エラー発生時はリスナーを停止
        stopDbListener(meetingId);
    });

    // child_removed
    listener.removed = pinsRef.on('child_removed', (snapshot) => {
        const pinId = snapshot.key;
        console.log(`BG: child_removed for ${meetingId}:`, pinId);
        // Content Script に通知
        notifyPinUpdateToContentScripts(meetingId, 'pinRemoved', { pinId });
    }, (error) => {
        console.error(`BG: DBリスナーエラー (child_removed) for ${meetingId}:`, error);
        console.error('削除リスナーエラー詳細 - コード:', error.code, 'メッセージ:', error.message);
        if (error.code === 'PERMISSION_DENIED') {
            notifyPermissionErrorToContentScripts(meetingId);
        }
         // エラー発生時はリスナーを停止
        stopDbListener(meetingId);
    });

    // リスナーの参照と関数群を保存
    activeListeners[meetingId] = { ref: pinsRef, listeners: listener };
}

// 特定のMeeting IDのリスナーを停止
function stopDbListener(meetingId) {
    const listenerInfo = activeListeners[meetingId];
    if (listenerInfo) {
        console.log(`BG: ${meetingId} のDBリスナーを停止します`);
        // 登録されている全てのイベントリスナーを解除
        listenerInfo.ref.off('child_added', listenerInfo.listeners.added);
        listenerInfo.ref.off('child_removed', listenerInfo.listeners.removed);
        delete activeListeners[meetingId];
    }
}

// 全てのDBリスナーを停止
function stopAllListeners() {
    console.log("BG: 全てのDBリスナーを停止します");
    Object.keys(activeListeners).forEach(stopDbListener);
}

// アクティブなMeetタブ全てに対してリスナーを開始/確認する
function startListenersForActiveMeetTabs() {
    if (!currentUser) return; // ログインしていなければ何もしない
    chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
        tabs.forEach(tab => {
            const url = tab.url;
            const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
            const match = url.match(meetRegex);
            const meetingId = match ? match[1] : null;
            if (meetingId) {
                startDbListener(meetingId); // 既に存在すれば内部でスキップされる
            }
        });
    });
}

// --- Content Script への通知 ---

function notifyPinUpdateToContentScripts(targetMeetingId, action, data) {
    chrome.tabs.query({ url: `https://meet.google.com/${targetMeetingId}*` }, (tabs) => {
        tabs.forEach(tab => {
            console.log(`BG: ${action} をタブ ${tab.id} に送信します`);
            chrome.tabs.sendMessage(tab.id, { action: action, data: data })
             .catch(error => {
                 if (!error.message?.includes('Receiving end does not exist')) {
                     console.warn(`BG: ${action} をタブ ${tab.id} に送信できませんでした: ${error.message || error}`);
                 } else {
                     console.log(`BG: ${action} をタブ ${tab.id} に送信試行 (受信側なし)`);
                 }
             });
        });
    });
}

function notifyPermissionErrorToContentScripts(targetMeetingId) {
     chrome.tabs.query({ url: `https://meet.google.com/${targetMeetingId}*` }, (tabs) => {
        tabs.forEach(tab => {
            console.log(`BG: permission_error をタブ ${tab.id} に送信します`);
            chrome.tabs.sendMessage(tab.id, { action: 'permissionError' })
             .catch(error => {
                 if (!error.message?.includes('Receiving end does not exist')) {
                     console.warn(`BG: permission_error をタブ ${tab.id} に送信できませんでした: ${error.message || error}`);
                 } else {
                     console.log(`BG: permission_error をタブ ${tab.id} に送信試行 (受信側なし)`);
                 }
             });
        });
    });
}

// Googleログイン処理 (chrome.identity APIを使用) - async/await を使う
async function signInWithGoogle() {
  // initializeFirebase が完了している前提 (リスナー内で呼ばれる)
  if (!auth) {
    console.error("BG: Firebase Authが初期化されていません (signInWithGoogle)");
    throw new Error("Firebase Authが初期化されていません");
  }

  // chrome.identity.getAuthToken は Promise を返さないので Promise でラップ
  const token = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        const errorMsg = chrome.runtime.lastError?.message || "認証トークンの取得に失敗しました。";
        console.error("BG: chrome.identity.getAuthToken エラー:", errorMsg);
        reject(new Error(errorMsg));
      } else {
        resolve(token);
      }
    });
  });

  // FirebaseにGoogleのOAuth2アクセストークンでログイン
  const credential = firebase.auth.GoogleAuthProvider.credential(null, token);

  try {
    const userCredential = await auth.signInWithCredential(credential);
    console.log("BG: chrome.identityでのサインイン成功:", userCredential.user?.email);
    // 実際のユーザー情報の更新と通知は onAuthStateChanged で行われる
    return true; // ログインプロセス開始成功
  } catch (error) {
    console.error("BG: Firebase signInWithCredential エラー:", error);
    throw error; // エラーを再スロー
  }
}

// --- メッセージリスナー (Content Scriptからの要求処理) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ★★★ リスナー全体を async 関数でラップ ★★★
  (async () => {
    try {
      // ★★★ initializeFirebase を await で呼び出す ★★★
      const initResult = await initializeFirebase();

      // ★★★ 初期化失敗時の処理 ★★★
      if (!initResult.success || !firebaseInitialized) {
        const errorMsg = `Firebase初期化エラー: ${initResult.error?.message || '不明なエラー'}`;
        console.error("BG: メッセージ処理中止 -", errorMsg);
        sendResponse({ success: false, error: errorMsg });
        return; // ここで処理を中断
      }

      // ★★★ auth や database が利用可能か確認 (念のため) ★★★
      if (!auth || !database) {
          sendResponse({ success: false, error: "Firebase Auth/Databaseが利用できません" });
          return;
      }

      // 既存の switch 文の処理をここに入れる
      switch (message.action) {
          case 'getAuthStatus':
              sendResponse({ user: currentUser });
              // 同期応答なので return true は不要 (暗黙的にfalse)
              break;
          case 'requestLogin':
              try {
                  // signInWithGoogle は Promise を返すので await
                  const success = await signInWithGoogle();
                  sendResponse({ started: success });
              } catch (error) {
                  sendResponse({ started: false, error: error.message });
              }
              // 非同期処理を await で完了させたので return true は不要
              break;
          case 'requestLogout':
              if (auth) {
                  try {
                      await auth.signOut(); // await で待つ
                      sendResponse({ success: true });
                  } catch (error) {
                      sendResponse({ success: false, error: error.message });
                  }
              } else {
                  sendResponse({ success: false, error: "Authが初期化されていません" });
              }
              // 非同期処理を await で完了させたので return true は不要
              break;

          // ★★★ ピン作成リクエスト処理 (async/await を使用) ★★★
          case 'createPing':
              if (!currentUser) {
                  sendResponse({ success: false, error: "認証されていません" });
                  break;
              }
              if (!message.meetingId || !message.pingType) {
                  sendResponse({ success: false, error: "リクエストデータが無効です" });
                  break;
              }
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
                  await newPinRef.set(pinData); // ★★★ await で完了を待つ ★★★
                  console.log(`BG: ピン ${message.pingType} が ${message.meetingId} に作成されました`);
                  sendResponse({ success: true, pinId: newPinRef.key });
                   // 自動削除タイマー (非同期で実行されるので await は不要)
                   setTimeout(() => {
                      newPinRef.remove().catch(e => console.error("BG: ピンの自動削除エラー:", e));
                   }, 30000); // 30秒
              } catch (error) {
                  console.error(`BG: ${message.meetingId} のピン作成エラー:`, error);
                  console.error('ピン作成エラー詳細 - コード:', error.code, 'メッセージ:', error.message);
                  // console.error('ピン作成エラー完全詳細:', JSON.stringify(error, null, 2)); // 詳細すぎる場合はコメントアウト
                  sendResponse({ success: false, error: error.message, code: error.code });
              }
              // 非同期処理を await で完了させたので return true は不要
              break;

          // ★★★ ピン削除リクエスト処理 (async/await を使用) ★★★
          case 'removePing':
              if (!currentUser) {
                  sendResponse({ success: false, error: "認証されていません" });
                  break;
              }
              if (!message.meetingId || !message.pinId) {
                  sendResponse({ success: false, error: "リクエストデータが無効です" });
                  break;
              }
              try {
                  const pinToRemoveRef = database.ref(`meetings/${message.meetingId}/pins/${message.pinId}`);
                  const snapshot = await pinToRemoveRef.child('createdBy/uid').once('value'); // ★★★ await で待つ ★★★
                  if (snapshot.val() === currentUser.uid) {
                      await pinToRemoveRef.remove(); // ★★★ await で待つ ★★★
                      console.log(`BG: ピン ${message.pinId} が ${message.meetingId} から削除されました`);
                      sendResponse({ success: true });
                  } else {
                      // 権限がない場合もエラーとして処理
                      throw new Error("権限がありません");
                  }
              } catch (error) {
                  console.error(`BG: ${message.meetingId} のピン ${message.pinId} 削除エラー:`, error);
                  console.error('ピン削除エラー詳細 - コード:', error.code, 'メッセージ:', error.message);
                  // console.error('ピン削除エラー完全詳細:', JSON.stringify(error, null, 2)); // 詳細すぎる場合はコメントアウト
                  sendResponse({ success: false, error: error.message, code: error.code });
              }
              // 非同期処理を await で完了させたので return true は不要
              break;

          // ★★★ Meetページが開かれた/更新されたことを通知 ★★★
          case 'meetPageLoaded':
              console.log("BG: meetPageLoaded メッセージをタブ", sender.tab?.id, "から受信しました");
              const url = sender.tab?.url;
              const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
              const match = url?.match(meetRegex);
              const meetingId = match ? match[1] : null;
              if (meetingId && currentUser) {
                  startDbListener(meetingId); // DBリスナー開始 (これは非同期だが完了を待つ必要はない)
                  sendResponse({ status: 'listener_started_or_confirmed' });
              } else if (meetingId && !currentUser) {
                  sendResponse({ status: 'user_not_logged_in' });
              } else {
                  sendResponse({ status: 'no_meeting_id' });
              }
              // 同期応答なので return true は不要
              break;

          default:
              console.warn("BG: 不明なメッセージアクション:", message.action);
              sendResponse({ success: false, error: "不明なアクション" });
              // 同期応答なので return true は不要
              break;
      }
    } catch (error) {
      // initializeFirebase や switch 内で捕捉されなかった予期せぬエラー
      console.error("BG: メッセージ処理中の予期せぬエラー:", error);
      // ここで sendResponse を試みる (既に閉じている可能性もある)
      try {
        sendResponse({
          success: false,
          error: `予期せぬエラー: ${error.message || '不明なエラー'}`,
          code: error.code || 'UNEXPECTED_ERROR'
        });
      } catch (sendError) {
         console.error("BG: エラー応答の送信に失敗:", sendError);
      }
    }
  })(); // ★★★ 即時実行 async 関数を呼び出す ★★★

  // ★★★ 非同期処理を行うため、常に true を返す必要がある ★★★
  // (async ラップの内側で sendResponse を呼び出すため)
  return true;
});


// インストール/アップデート時
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`Meet Ping Extension がインストール/アップデートされました (${details.reason})`);
  await initializeFirebase(); // 完了を待つ必要はあまりないが、一応待つ
});

// Service Worker起動時
// ★★★ async/await を使用して初期化を試みる ★★★
(async () => {
  console.log("Background service worker started/restarted.");
  await initializeFirebase(); // 起動時に初期化を試みる (結果はここでは使わない)
})();