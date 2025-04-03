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
let persistencePromise = null; // 永続性設定の Promise を保持 ★追加

function initializeFirebase() {
  console.log('BG: Firebaseを初期化中...');
  
  // 常に有効なPromiseを返すための変数を定義
  let initPromise;
  
  if (!firebaseInitialized && typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined') {
    try {
      if (!firebase.apps.length) {
         firebase.initializeApp(firebaseConfig);
         console.log('BG: Firebase Appが初期化されました');
      } else {
         firebase.app();
         console.log('BG: Firebase Appは既に初期化されています');
      }
      auth = firebase.auth();
      database = firebase.database(); // Database インスタンス取得

      // ★★★ 永続性を 'local' に設定 ★★★
      try {
        console.log('BG: 永続性設定を開始します...');
        
        // 永続性設定のPromiseを作成
        initPromise = auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
          .then(() => {
            console.log('BG: 永続性を LOCAL (通常 IndexedDB) に設定しました');
            firebaseInitialized = true;
            console.log('BG: Firebase Auth/Databaseインスタンスを取得しました');
            setupAuthListener();
            return true; // Promiseの結果としてtrueを返す
          })
          .catch((error) => {
            console.error('BG: 永続性設定エラー:', error);
            console.error('BG: エラーコード:', error.code);
            console.error('BG: エラーメッセージ:', error.message);
            // エラーが発生した場合も初期化を進める
            firebaseInitialized = true;
            setupAuthListener();
            // エラーをプロパゲートしないように、完了した結果を返す
            return { success: false, error: error };
          });
        
        // persistencePromiseを更新
        persistencePromise = initPromise;
        
      } catch (error) {
        console.error('BG: 永続性設定の試行中に例外が発生しました:', error);
        firebaseInitialized = true;
        setupAuthListener();
        // 例外が発生した場合は、完了済みのPromiseを作成
        initPromise = Promise.resolve({ success: false, error: error });
      }
      // ★★★ ここまで ★★★

    } catch (error) { 
      console.error('BG: Firebase初期化エラー:', error);
      // Firebase初期化エラーの場合も、完了済みのPromiseを作成
      initPromise = Promise.resolve({ success: false, error: error });
    }
  } else if (firebaseInitialized) { 
    console.log("BG: Firebaseは既に初期化済みです"); 
    // 既に初期化済みの場合は、成功を返すPromiseを作成
    initPromise = Promise.resolve({ success: true });
  }
  else { 
    console.error("BG: Firebase SDKまたは設定が読み込まれていません"); 
    // SDKが読み込まれていない場合は、エラーを返すPromiseを作成
    initPromise = Promise.resolve({ success: false, error: new Error("Firebase SDKまたは設定が読み込まれていません") });
  }
  
  // 常に有効なPromiseを返す
  return initPromise || Promise.resolve({ success: false, error: new Error("不明な初期化エラー") });
}

function setupAuthListener() {
  if (!auth) { console.error("BG: Auth listener setup failed - Auth not initialized"); return; }
  auth.onAuthStateChanged((user) => {
    console.log("BG: onAuthStateChanged triggered. user:", user); // ★ユーザーオブジェクト全体を確認
    const previousUser = currentUser;

    // ★★★ ドメインチェックの詳細ログ ★★★
    let isAllowedDomain = false;
    if (user && user.email) {
        console.log(`BG: Checking email "${user.email}" against domain "@${COMPANY_DOMAIN}"`);
        isAllowedDomain = user.email.endsWith(`@${COMPANY_DOMAIN}`);
        console.log(`BG: Domain check result: ${isAllowedDomain}`);
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
        // ★★★ ログアウトは一時的にコメントアウトして、状態変化だけ確認 ★★★
        // auth.signOut().catch(err => console.error("BG: Sign out error:", err));
        console.log("BG: Would sign out user due to domain mismatch, but commented out for debugging.");
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
        .catch(error => console.warn(`BG: タブ ${tab.id} への認証状態通知エラー: ${error.message || error}`));
    });
  });
}

// 認証状態をPopupに通知
function notifyAuthStatusToPopup() {
    chrome.runtime.sendMessage({ action: 'authStatusChanged', user: currentUser })
      .catch(error => console.warn(`BG: ポップアップへの認証状態通知エラー: ${error.message || error}`));
}

// --- データベースリスナー関連 ---

// 特定のMeeting IDのリスナーを開始
function startDbListener(meetingId) {
    if (!currentUser || !database || !meetingId || activeListeners[meetingId]) {
        if (activeListeners[meetingId]) console.log(`BG: ${meetingId} のリスナーは既に有効です`);
        else console.log(`BG: ${meetingId} のリスナーを開始できません - ユーザー: ${!!currentUser}, DB: ${!!database}`);
        return;
    }
    console.log(`BG: ${meetingId} のDBリスナーを開始します`);
    const pinsRef = database.ref(`meetings/${meetingId}/pins`);
    activeListeners[meetingId] = pinsRef; // 参照を保持

    // child_added
    pinsRef.on('child_added', (snapshot) => {
        const pinId = snapshot.key;
        const pin = snapshot.val();
        console.log(`BG: child_added for ${meetingId}:`, pinId);
        // Content Script に通知
        notifyPinUpdateToContentScripts(meetingId, 'pinAdded', { pinId, pin });
    }, (error) => {
        console.error(`BG: DBリスナーエラー (child_added) for ${meetingId}:`, error);
        console.error('リスナーエラー詳細 - コード:', error.code, 'メッセージ:', error.message);
        console.error('リスナーエラー完全詳細:', JSON.stringify(error, null, 2));
        // 権限エラーが出たら Content Script に通知
        if (error.code === 'PERMISSION_DENIED') {
           notifyPermissionErrorToContentScripts(meetingId);
        }
    });

    // child_removed
    pinsRef.on('child_removed', (snapshot) => {
        const pinId = snapshot.key;
        console.log(`BG: child_removed for ${meetingId}:`, pinId);
        // Content Script に通知
        notifyPinUpdateToContentScripts(meetingId, 'pinRemoved', { pinId });
    }, (error) => {
        console.error(`BG: DBリスナーエラー (child_removed) for ${meetingId}:`, error);
        console.error('削除リスナーエラー詳細 - コード:', error.code, 'メッセージ:', error.message);
        console.error('削除リスナーエラー完全詳細:', JSON.stringify(error, null, 2));
        if (error.code === 'PERMISSION_DENIED') {
            notifyPermissionErrorToContentScripts(meetingId);
        }
    });
}

// 特定のMeeting IDのリスナーを停止
function stopDbListener(meetingId) {
    if (activeListeners[meetingId]) {
        console.log(`BG: ${meetingId} のDBリスナーを停止します`);
        activeListeners[meetingId].off(); // リスナー解除
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
                startDbListener(meetingId);
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
             .catch(error => console.warn(`BG: ${action} をタブ ${tab.id} に送信できませんでした: ${error.message || error}`));
        });
    });
}

function notifyPermissionErrorToContentScripts(targetMeetingId) {
     chrome.tabs.query({ url: `https://meet.google.com/${targetMeetingId}*` }, (tabs) => {
        tabs.forEach(tab => {
            console.log(`BG: permission_error をタブ ${tab.id} に送信します`);
            chrome.tabs.sendMessage(tab.id, { action: 'permissionError' })
             .catch(error => console.warn(`BG: permission_error をタブ ${tab.id} に送信できませんでした: ${error.message || error}`));
        });
    });
}

// Googleログイン処理 (chrome.identity APIを使用)
function signInWithGoogle() {
  return new Promise((resolve, reject) => {
    if (!auth) {
      console.error("BG: Firebase Authが初期化されていません");
      return reject(new Error("Firebase Authが初期化されていません"));
    }

    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        const errorMsg = chrome.runtime.lastError?.message || "認証トークンの取得に失敗しました。ユーザーがキャンセルした可能性があります";
        console.error("BG: chrome.identity.getAuthToken エラー:", errorMsg);
        reject(new Error(errorMsg));
        return;
      }

      // FirebaseにGoogleのOAuth2アクセストークンでログイン
      const credential = firebase.auth.GoogleAuthProvider.credential(null, token);

      auth.signInWithCredential(credential)
        .then((userCredential) => {
          console.log("BG: chrome.identityでのサインイン成功:", userCredential.user?.email);
          // 実際のユーザー情報の更新と通知は onAuthStateChanged で行われる
          resolve(true); // ログインプロセス開始成功
        })
        .catch((error) => {
          console.error("BG: Firebase signInWithCredential エラー:", error);
          reject(error); // Firebase側のエラーをreject
        });
    });
  });
}

// --- メッセージリスナー (Content Scriptからの要求処理) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // initializeFirebase を呼び出し、完了を待ってから処理を開始
  initializeFirebase()
    .then((result) => {
      // 初期化結果をチェック
      if (result && result.error) {
        console.error("BG: Firebase初期化結果にエラーがあります:", result.error);
      }
      
      // 永続性設定後 (成功またはエラー後) の処理
      if (!firebaseInitialized) {
          sendResponse({ success: false, error: "Firebaseの初期化に失敗しました" });
          return; // Promise 内なので return true は不要
      }

      // 既存の switch 文の処理をここに入れる
      switch (message.action) {
          case 'getAuthStatus':
              sendResponse({ user: currentUser });
              break; // 同期応答
          case 'requestLogin':
              signInWithGoogle()
                  .then(success => sendResponse({ started: success }))
                  .catch(error => sendResponse({ started: false, error: error.message }));
              return true; // 非同期応答を示す ★重要★
          case 'requestLogout':
              if (auth) {
                  auth.signOut()
                      .then(() => sendResponse({ success: true }))
                      .catch(error => sendResponse({ success: false, error: error.message }));
              } else { sendResponse({ success: false, error: "Authが初期化されていません" }); }
              return true; // 非同期応答を示す ★重要★

      // ★★★ ピン作成リクエスト処理 ★★★
      case 'createPing':
          if (!currentUser) {
              sendResponse({ success: false, error: "認証されていません" });
              break;
          }
          if (!database || !message.meetingId || !message.pingType) {
              sendResponse({ success: false, error: "リクエストデータが無効です" });
              break;
          }
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
          newPinRef.set(pinData)
              .then(() => {
                  console.log(`BG: ピン ${message.pingType} が ${message.meetingId} に作成されました`);
                  sendResponse({ success: true, pinId: newPinRef.key });
                   // 自動削除タイマー (Firebase Functions推奨だが、簡易的にここで設定)
                   setTimeout(() => {
                      newPinRef.remove().catch(e => console.error("BG: ピンの自動削除エラー:", e));
                   }, 30000); // 30秒
              })
              .catch(error => {
                  console.error(`BG: ${message.meetingId} のピン作成エラー:`, error);
                  console.error('ピン作成エラー詳細 - コード:', error.code, 'メッセージ:', error.message);
                  console.error('ピン作成エラー完全詳細:', JSON.stringify(error, null, 2));
                  sendResponse({ success: false, error: error.message, code: error.code });
              });
          return true; // 非同期応答を示す ★重要★

      // ★★★ ピン削除リクエスト処理 ★★★
      case 'removePing':
          if (!currentUser) {
              sendResponse({ success: false, error: "認証されていません" });
              break;
          }
          if (!database || !message.meetingId || !message.pinId) {
              sendResponse({ success: false, error: "リクエストデータが無効です" });
              break;
          }
          const pinToRemoveRef = database.ref(`meetings/${message.meetingId}/pins/${message.pinId}`);
          // 削除前に作成者を確認 (セキュリティルールでもチェックされるが念のため)
          pinToRemoveRef.child('createdBy/uid').once('value')
             .then(snapshot => {
                 if (snapshot.val() === currentUser.uid) {
                     return pinToRemoveRef.remove();
                 } else {
                     return Promise.reject(new Error("権限がありません"));
                 }
             })
             .then(() => {
                 console.log(`BG: ピン ${message.pinId} が ${message.meetingId} から削除されました`);
                 sendResponse({ success: true });
             })
             .catch(error => {
                  console.error(`BG: ${message.meetingId} のピン ${message.pinId} 削除エラー:`, error);
                  console.error('ピン削除エラー詳細 - コード:', error.code, 'メッセージ:', error.message);
                  console.error('ピン削除エラー完全詳細:', JSON.stringify(error, null, 2));
                  sendResponse({ success: false, error: error.message });
              });
          return true; // 非同期応答を示す ★重要★

        // ★★★ Meetページが開かれた/更新されたことを通知 ★★★
       case 'meetPageLoaded':
            console.log("BG: meetPageLoaded メッセージをタブ", sender.tab?.id, "から受信しました");
            const url = sender.tab?.url;
            const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
            const match = url?.match(meetRegex);
            const meetingId = match ? match[1] : null;
            if (meetingId && currentUser) {
                startDbListener(meetingId); // リスナーを開始/確認
                sendResponse({ status: 'listener_started_or_confirmed' });
            } else if (meetingId && !currentUser) {
                 sendResponse({ status: 'user_not_logged_in' });
            } else {
                 sendResponse({ status: 'no_meeting_id' });
            }
            break; // 同期応答

      default:
          console.warn("BG: 不明なメッセージアクション:", message.action);
          sendResponse({ success: false, error: "不明なアクション" });
          break; // 同期応答
      }
      // 非同期応答 (return true) しなかった場合のフォールバック
      // (同期応答の場合は暗黙的に false が返る)
    })
    .catch(error => {
      // initializeFirebase の .catch でハンドルされなかったエラーなど
      console.error("BG: メッセージ処理中の初期化/永続性エラー:", error);
      console.error("BG: エラーの詳細情報:", JSON.stringify({
        code: error.code,
        message: error.message,
        stack: error.stack
      }, null, 2));
      sendResponse({ 
        success: false, 
        error: `Firebase 初期化/永続性エラー: ${error.message || '不明なエラー'}`,
        code: error.code || 'UNKNOWN_ERROR'
      });
    });

  // ★★★ 非同期処理を行うため、常に true を返す必要がある ★★★
  return true;
});

// インストール/アップデート時
chrome.runtime.onInstalled.addListener(() => {
  console.log('Meet Ping Extension がインストール/アップデートされました');
  initializeFirebase(); // ここで呼ぶのは良いが、完了を待つ必要はない
});

// Service Worker起動時
initializeFirebase(); // Service Worker 起動時に初期化を開始
console.log("Background service worker started/restarted.");

// --- signInWithGoogle や DBリスナー関連の関数は変更なし ---
function signInWithGoogle() {
  // ... (既存のコード) ...
}
function startDbListener(meetingId) {
  // ... (既存のコード) ...
}
// ... 他の関数 ...
