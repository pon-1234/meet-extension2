// background.js - Firebase SDK v9モジュラー形式に変換

// Firebase SDKをインポート
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithCredential, 
  GoogleAuthProvider,
  signOut,
  setPersistence,
  browserSessionPersistence
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

  try {
    // Firebase アプリの初期化
    const app = initializeApp(firebaseConfig);
    console.log('BG: Firebase Appが初期化されました');
    
    auth = getAuth(app);
    database = getDatabase(app);
    console.log('BG: Firebase Auth/Databaseインスタンスを取得しました');

    // 永続性を SESSION に設定（v9ではNONEがなくなり、browserSessionPersistenceが最も近い）
    try {
      console.log('BG: 永続性設定 (SESSION) を試みます...');
      await setPersistence(auth, browserSessionPersistence);
      console.log('BG: 永続性を SESSION に設定しました');
      firebaseInitialized = true;
      setupAuthListener(); // 認証リスナー設定
      console.log('BG: Firebase初期化完了 (永続性: SESSION)');
      return { success: true };
    } catch (error) {
      console.warn('BG: 永続性設定 (SESSION) エラー (無視して続行):', error);
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
  
  onAuthStateChanged(auth, (user) => {
    console.log("BG: onAuthStateChanged triggered. user:", user ? user.email : 'null');
    const previousUser = currentUser;
    let isAllowedDomain = false;

    if (user && user.email) {
        if (COMPANY_DOMAIN) { // COMPANY_DOMAIN が定義され、空でないか
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
        signOut(auth).catch(err => console.error("BG: Sign out error due to domain mismatch:", err));
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
    const pinsRef = ref(database, `meetings/${meetingId}/pins`);
    const listenerCallbacks = {}; // リスナー関数の参照を保持

    listenerCallbacks.added = onChildAdded(pinsRef, (snapshot) => {
        const pinId = snapshot.key;
        const pin = snapshot.val();
        // console.log(`BG: child_added for ${meetingId}:`, pinId);
        notifyPinUpdateToContentScripts(meetingId, 'pinAdded', { pinId, pin });
    }, (error) => {
        console.error(`BG: DBリスナーエラー (child_added) for ${meetingId}:`, error);
        if (error.code === 'PERMISSION_DENIED') notifyPermissionErrorToContentScripts(meetingId);
        stopDbListener(meetingId); // エラー時は停止
    });

    listenerCallbacks.removed = onChildRemoved(pinsRef, (snapshot) => {
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

// --- Content Script への通知ヘルパー ---
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
// Googleu30edu30b0u30a4u30f3u51e6u7406 (async)
async function signInWithGoogle() {
  console.log("BG: Googleu30edu30b0u30a4u30f3u3092u958bu59cbu3057u307eu3059");
  try {
    // Firebaseu521du671fu5316u78bau8a8d
    const initResult = await initializeFirebase();
    if (!initResult.success) {
      console.error("BG: Firebaseu521du671fu5316u30a8u30e9u30fc:", initResult.error);
      return { success: false, error: initResult.error };
    }

    // Chrome Identity APIu3092u4f7fu7528u3057u3066Googleu30c8u30fcu30afu30f3u3092u53d6u5f97
    const authToken = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(token);
      });
    });

    // Chrome Identity APIu304bu3089u53d6u5f97u3057u305fu30c8u30fcu30afu30f3u3067Firebaseu306bu30b5u30a4u30f3u30a4u30f3
    // RecaptchaVerifieru3092u4f7fu7528u305bu305au306bu76f4u63a5u8a8du8a3c
    const credential = GoogleAuthProvider.credential(null, authToken);
    await signInWithCredential(auth, credential);
    console.log("BG: Googleu30edu30b0u30a4u30f3u6210u529f");
    return { success: true };
  } catch (error) {
    console.error("BG: Googleu30edu30b0u30a4u30f3u30a8u30e9u30fc:", error);
    return { success: false, error: error };
  }
}

// URLu304bu3089u30dfu30fcu30c6u30a3u30f3u30b0IDu3092u62bdu51fau3059u308bu30d8u30ebu30d1u30fcu95a2u6570
function extractMeetingIdFromUrl(url) {
  // meet.google.com/abc-defg-hij u5f62u5f0fu306eURLu304bu3089IDu3092u62bdu51fa
  const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
  const match = url.match(meetRegex);
  return match ? match[1] : null;
}

// u2605u2605u2605 u30bfu30d6u66f4u65b0u30a4u30d9u30f3u30c8u30eau30b9u30cau30fc u2605u2605u2605
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // URLu304cu5909u66f4u3055u308cu3001u304bu3064u30bfu30d6u306eu8aadu307fu8fbcu307fu304cu5b8cu4e86u3057u305fMeetu30dau30fcu30b8u306bu5bfeu3057u3066u51e6u7406
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes("meet.google.com/")) {
    const meetingId = extractMeetingIdFromUrl(tab.url);
    if (meetingId) {
      console.log(`BG: Meetu30bfu30d6u304cu66f4u65b0u3055u308cu307eu3057u305f: ${meetingId}`);
      
      // u73feu5728u306eu8a8du8a3cu72b6u614bu3092u901au77e5
      chrome.tabs.sendMessage(tabId, { action: 'authStatusChanged', user: currentUser })
        .catch(error => {
          // Content Scriptu304cu307eu3060u6e96u5099u3067u304du3066u3044u306au3044u53efu80fdu6027u304cu3042u308bu306eu3067u30a8u30e9u30fcu306fu7121u8996
          if (!error.message?.includes('Receiving end does not exist')) {
            console.warn(`BG: u30bfu30d6u66f4u65b0u6642u306eu8a8du8a3cu72b6u614bu901au77e5u30a8u30e9u30fc: ${error.message || error}`);
          }
        });
      
      // u30edu30b0u30a4u30f3u6e08u307fu306au3089DBu30eau30b9u30cau30fcu3092u958bu59cb
      if (currentUser) {
        startDbListener(meetingId);
      }
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => { // u975eu540cu671fu51e6u7406u306eu305fu3081u306bu30e9u30c3u30d7
    try {
      const initResult = await initializeFirebase(); // u521du671fu5316u5b8cu4e86u3092u5f85u3064
      if (!initResult.success || !firebaseInitialized) {
        sendResponse({ success: false, error: `Firebaseu521du671fu5316u30a8u30e9u30fc: ${initResult.error?.message || 'u4e0du660e'}` });
        return;
      }

      // --- u8a8du8a3cu95a2u9023u306eu30e1u30c3u30bbu30fcu30b8u51e6u7406 ---
      if (message.action === 'getAuthStatus') {
        console.log("BG: u8a8du8a3cu72b6u614bu30eau30afu30a8u30b9u30c8u3092u53d7u4fe1", sender.tab ? `from tab ${sender.tab.id}` : 'from popup');
        sendResponse({ user: currentUser });
        return;
      }

      if (message.action === 'requestLogin') {
        console.log("BG: u30edu30b0u30a4u30f3u30eau30afu30a8u30b9u30c8u3092u53d7u4fe1");
        // u30edu30b0u30a4u30f3u51e6u7406u3092u958bu59cbu3057u305fu3053u3068u3092u901au77e5
        sendResponse({ started: true });
        
        // u5b9fu969bu306eu30edu30b0u30a4u30f3u51e6u7406u3092u5b9fu884c
        const loginResult = await signInWithGoogle();
        if (!loginResult.success) {
          // u30a8u30e9u30fcu304cu767au751fu3057u305fu5834u5408u3001u30ddu30c3u30d7u30a2u30c3u30d7u306bu901au77e5
          chrome.runtime.sendMessage({ 
            action: 'loginFailed', 
            error: loginResult.error?.message || 'u4e0du660eu306au30a8u30e9u30fc' 
          }).catch(() => {}); // u30ddu30c3u30d7u30a2u30c3u30d7u304cu9589u3058u3089u308cu3066u3044u308bu53efu80fdu6027u304cu3042u308bu306eu3067u30a8u30e9u30fcu306fu7121u8996
        }
        return;
      }

      if (message.action === 'requestLogout') {
        console.log("BG: u30edu30b0u30a2u30a6u30c8u30eau30afu30a8u30b9u30c8u3092u53d7u4fe1");
        try {
          await signOut(auth);
          console.log("BG: u30edu30b0u30a2u30a6u30c8u6210u529f");
          sendResponse({ success: true });
        } catch (error) {
          console.error("BG: u30edu30b0u30a2u30a6u30c8u30a8u30e9u30fc:", error);
          sendResponse({ success: false, error: error.message || 'u30edu30b0u30a2u30a6u30c8u4e2du306bu30a8u30e9u30fcu304cu767au751fu3057u307eu3057u305f' });
        }
        return;
      }

      // --- u30d4u30f3u64cdu4f5cu95a2u9023u306eu30e1u30c3u30bbu30fcu30b8u51e6u7406 ---
      if (!currentUser) {
        console.warn("BG: u30e6u30fcu30b6u30fcu304cu30edu30b0u30a4u30f3u3057u3066u3044u306au3044u305fu3081u3001u64cdu4f5cu3092u5b9fu884cu3067u304du307eu305bu3093", message.action);
        sendResponse({ success: false, error: 'u30edu30b0u30a4u30f3u304cu5fc5u8981u3067u3059' });
        return;
      }

      if (message.action === 'createPin') {
        const { meetingId, pinData } = message;
        if (!meetingId || !pinData) {
          sendResponse({ success: false, error: 'u5fc5u8981u306au30d1u30e9u30e1u30fcu30bfu304cu4e0du8db3u3057u3066u3044u307eu3059' });
          return;
        }

        try {
          // u30e6u30fcu30b6u30fcu60c5u5831u3092u8ffdu52a0
          const pinWithUser = {
            ...pinData,
            createdBy: {
              uid: currentUser.uid,
              displayName: currentUser.displayName,
              email: currentUser.email
            },
            createdAt: Date.now()
          };

          // u30d4u30f3u3092u4f5cu6210
          const pinsRef = ref(database, `meetings/${meetingId}/pins`);
          const newPinRef = push(pinsRef);
          await set(newPinRef, pinWithUser);
          
          console.log(`BG: u30d4u30f3u3092u4f5cu6210u3057u307eu3057u305f: ${meetingId}/${newPinRef.key}`);
          sendResponse({ success: true, pinId: newPinRef.key });
        } catch (error) {
          console.error("BG: u30d4u30f3u4f5cu6210u30a8u30e9u30fc:", error);
          sendResponse({ success: false, error: error.message || 'u30d4u30f3u306eu4f5cu6210u4e2du306bu30a8u30e9u30fcu304cu767au751fu3057u307eu3057u305f' });
        }
        return;
      }

      if (message.action === 'removePin') {
        const { meetingId, pinId } = message;
        if (!meetingId || !pinId) {
          sendResponse({ success: false, error: 'u5fc5u8981u306au30d1u30e9u30e1u30fcu30bfu304cu4e0du8db3u3057u3066u3044u307eu3059' });
          return;
        }

        try {
          const pinRef = ref(database, `meetings/${meetingId}/pins/${pinId}`);
          await remove(pinRef);
          console.log(`BG: u30d4u30f3u3092u524au9664u3057u307eu3057u305f: ${meetingId}/${pinId}`);
          sendResponse({ success: true });
        } catch (error) {
          console.error("BG: u30d4u30f3u524au9664u30a8u30e9u30fc:", error);
          sendResponse({ success: false, error: error.message || 'u30d4u30f3u306eu524au9664u4e2du306bu30a8u30e9u30fcu304cu767au751fu3057u307eu3057u305f' });
        }
        return;
      }

      // u4e0du660eu306au30e1u30c3u30bbu30fcu30b8
      console.warn("BG: u4e0du660eu306au30e1u30c3u30bbu30fcu30b8u3092u53d7u4fe1:", message);
      sendResponse({ success: false, error: 'u4e0du660eu306au30e1u30c3u30bbu30fcu30b8u30bfu30a4u30d7' });

    } catch (error) {
      console.error("BG: u30e1u30c3u30bbu30fcu30b8u51e6u7406u4e2du306eu4e88u671fu3057u306au3044u30a8u30e9u30fc:", error);
      sendResponse({ success: false, error: `u4e88u671fu3057u306au3044u30a8u30e9u30fc: ${error.message || error}` });
    }
  })(); // u5373u6642u5b9fu884c async u95a2u6570u3092u547cu3073u51fau3059

  // u975eu540cu671fu51e6u7406u3092u884cu3046u305fu3081u3001u5e38u306b true u3092u8fd4u3059u5fc5u8981u304cu3042u308b
  return true;
});


// --- u62e1u5f35u6a5fu80fdu306eu30a4u30f3u30b9u30c8u30fcu30eb/u30a2u30c3u30d7u30c7u30fcu30c8/u8d77u52d5u6642u306eu51e6u7406 ---
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("BG: u62e1u5f35u6a5fu80fdu304cu30a4u30f3u30b9u30c8u30fcu30eb/u66f4u65b0u3055u308cu307eu3057u305f", details.reason);
  
  // Firebaseu521du671fu5316
  await initializeFirebase();
  
  // u5fc5u8981u306bu5fdcu3058u3066u8ffdu52a0u306eu521du671fu5316u51e6u7406u3092u3053u3053u306bu8a18u8ff0
});

// u62e1u5f35u6a5fu80fdu8d77u52d5u6642u306eu521du671fu5316
initializeFirebase().then(result => {
  console.log("BG: u8d77u52d5u6642u306eFirebaseu521du671fu5316u7d50u679c:", result.success ? 'u6210u529f' : 'u5931u6557', result.error || '');
});
