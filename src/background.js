// src/background.js (会議IDごとのリスナー管理、非同期初期化、エラーハンドリング改善, デスクトップ通知追加)

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
  serverTimestamp
} from 'firebase/database';
import { firebaseConfig, COMPANY_DOMAIN } from './firebase-config';

let firebaseInitialized = false;
let app = null;
let auth = null;
let database = null;
let currentUser = null;
let activeListeners = {}; // { meetingId: { ref, listeners: { added, removed } } }
let loggedInUsers = {}; // { uid: { email, displayName } } - Firebase認証されたユーザーのリスト

// Language Manager for background script
let BackgroundLanguageManager = {
    currentLanguage: 'ja',
    
    async init() {
        try {
            const result = await chrome.storage.sync.get(['language']);
            this.currentLanguage = result.language || 'ja';
        } catch (error) {
            console.log('Language initialization failed, using default:', error);
            this.currentLanguage = 'ja';
        }
    },
    
    getPingLabel(pingType) {
        const labels = {
            ja: {
                question: '疑問',
                onMyWay: '任せて',
                danger: '撤退',
                assist: '助けて',
                goodJob: 'いい感じ',
                finishHim: 'トドメだ',
                needInfo: '情報が必要',
                changePlan: '作戦変更'
            },
            en: {
                question: 'Question',
                onMyWay: 'On it',
                danger: 'Retreat',
                assist: 'Help',
                goodJob: 'Good job',
                finishHim: 'Finish it',
                needInfo: 'Need info',
                changePlan: 'Change plan'
            }
        };
        
        const langDef = labels[this.currentLanguage];
        if (!langDef || !langDef[pingType]) {
            return labels.ja[pingType] || pingType;
        }
        return langDef[pingType];
    }
};

// content.js と同様のピン定義 (通知アイコンに使用) - dynamically generate labels
function getPingDefinitions() {
    return {
        question: { icon: 'icons/question.png', label: BackgroundLanguageManager.getPingLabel('question') },
        onMyWay: { icon: 'icons/onMyWay.png', label: BackgroundLanguageManager.getPingLabel('onMyWay') },
        danger: { icon: 'icons/danger.png', label: BackgroundLanguageManager.getPingLabel('danger') },
        assist: { icon: 'icons/assist.png', label: BackgroundLanguageManager.getPingLabel('assist') },
        goodJob: { icon: 'icons/goodJob.png', label: BackgroundLanguageManager.getPingLabel('goodJob') },
        finishHim: { icon: 'icons/finishHim.png', label: BackgroundLanguageManager.getPingLabel('finishHim') },
        needInfo: { icon: 'icons/needInfo.png', label: BackgroundLanguageManager.getPingLabel('needInfo') },
        changePlan: { icon: 'icons/changePlan.png', label: BackgroundLanguageManager.getPingLabel('changePlan') },
    };
}


// --- Firebase 初期化関数 (async) ---
async function initializeFirebase() {
  if (firebaseInitialized) {
    return { success: true };
  }
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    database = getDatabase(app);
    firebaseInitialized = true;
    setupAuthListener();
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
    const previousUser = currentUser;
    let isAllowedDomain = false;

    if (user && user.email) {
        if (COMPANY_DOMAIN) {
            isAllowedDomain = user.email.endsWith(`@${COMPANY_DOMAIN}`);
        } else {
            console.warn("BG: COMPANY_DOMAIN is not defined or empty. Domain check skipped, allowing user.");
            isAllowedDomain = true;
        }
    } else {
        isAllowedDomain = false;
    }

    if (isAllowedDomain) {
      currentUser = { uid: user.uid, email: user.email, displayName: user.displayName || user.email.split('@')[0] };
      // ログインユーザーリストに追加
      loggedInUsers[user.uid] = {
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0]
      };
      startListenersForActiveMeetTabs();
    } else {
      if (user) {
        console.warn("BG: User logged in but not from allowed domain:", user.email);
        signOut(auth).catch(err => console.error("BG: Sign out error due to domain mismatch:", err));
      }
      if (currentUser) {
        // ログインユーザーリストから削除
        delete loggedInUsers[currentUser.uid];
      }
      currentUser = null;
      stopAllListeners();
    }

    if (JSON.stringify(previousUser) !== JSON.stringify(currentUser)) {
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
        return;
    }
    if (activeListeners[meetingId]) {
        return;
    }
    console.log(`BG: Starting DB listener for ${meetingId}`);
    
    // 全体向けピン
    const pinsRef = ref(database, `meetings/${meetingId}/pins`);
    // 自分宛ての個別ピン
    const directPinsRef = ref(database, `meetings/${meetingId}/directPins/${currentUser.uid}`);
    
    const listeners = {};

    try {
        // 全体向けピンのリスナー
        listeners.pinsAdded = onChildAdded(pinsRef, (snapshot) => {
            const pinId = snapshot.key;
            const pin = snapshot.val();
            notifyPinUpdateToContentScripts(meetingId, 'pinAdded', { pinId, pin });

            // --- デスクトップ通知作成処理 ---
            if (pin && pin.createdBy && currentUser && pin.createdBy.uid !== currentUser.uid) {
                const pinDef = getPingDefinitions()[pin.type] || { label: pin.type, icon: 'icons/icon48.png' };
                let iconUrl = chrome.runtime.getURL(pinDef.icon);

                chrome.notifications.create(
                    `pin-${meetingId}-${pinId}`,
                    {
                        type: 'basic',
                        iconUrl: iconUrl,
                        title: `新しいピン: ${pinDef.label}`,
                        message: `${pin.createdBy.displayName || pin.createdBy.email.split('@')[0]}さんがピンを送信しました。\n会議: ${meetingId}`,
                        priority: 1,
                    },
                    (notificationId) => {
                        if (chrome.runtime.lastError) {
                            console.error('BG: 通知作成エラー:', chrome.runtime.lastError.message);
                        }
                    }
                );
            }
            // --- 通知作成処理ここまで ---

        }, (error) => {
            console.error(`BG: DB listener error (pins child_added) for ${meetingId}:`, error);
            if (error.code === 'PERMISSION_DENIED') notifyPermissionErrorToContentScripts(meetingId);
            stopDbListener(meetingId);
        });

        listeners.pinsRemoved = onChildRemoved(pinsRef, (snapshot) => {
            const pinId = snapshot.key;
            notifyPinUpdateToContentScripts(meetingId, 'pinRemoved', { pinId });
            chrome.notifications.clear(`pin-${meetingId}-${pinId}`, (wasCleared) => {
                if (chrome.runtime.lastError) { /* console.warn('Error clearing notification:', chrome.runtime.lastError.message); */ }
            });
        }, (error) => {
            console.error(`BG: DB listener error (pins child_removed) for ${meetingId}:`, error);
            if (error.code === 'PERMISSION_DENIED') notifyPermissionErrorToContentScripts(meetingId);
            stopDbListener(meetingId);
        });

        // 個別ピンのリスナー
        listeners.directPinsAdded = onChildAdded(directPinsRef, (snapshot) => {
            const pinId = snapshot.key;
            const pin = snapshot.val();
            // 個別ピンとしてマーク
            pin.isDirect = true;
            notifyPinUpdateToContentScripts(meetingId, 'pinAdded', { pinId, pin });

            // --- 個別ピンのデスクトップ通知 ---
            if (pin && pin.createdBy) {
                const pinDef = getPingDefinitions()[pin.type] || { label: pin.type, icon: 'icons/icon48.png' };
                let iconUrl = chrome.runtime.getURL(pinDef.icon);

                chrome.notifications.create(
                    `directpin-${meetingId}-${pinId}`,
                    {
                        type: 'basic',
                        iconUrl: iconUrl,
                        title: `個別ピン: ${pinDef.label}`,
                        message: `${pin.createdBy.displayName || pin.createdBy.email.split('@')[0]}さんからの個別ピンです。\n会議: ${meetingId}`,
                        priority: 2, // 個別ピンは高優先度
                    },
                    (notificationId) => {
                        if (chrome.runtime.lastError) {
                            console.error('BG: 個別ピン通知作成エラー:', chrome.runtime.lastError.message);
                        }
                    }
                );
            }
        }, (error) => {
            console.error(`BG: DB listener error (directPins child_added) for ${meetingId}:`, error);
            if (error.code === 'PERMISSION_DENIED') notifyPermissionErrorToContentScripts(meetingId);
            stopDbListener(meetingId);
        });

        listeners.directPinsRemoved = onChildRemoved(directPinsRef, (snapshot) => {
            const pinId = snapshot.key;
            notifyPinUpdateToContentScripts(meetingId, 'pinRemoved', { pinId });
            chrome.notifications.clear(`directpin-${meetingId}-${pinId}`, (wasCleared) => {
                if (chrome.runtime.lastError) { /* console.warn('Error clearing direct pin notification:', chrome.runtime.lastError.message); */ }
            });
        }, (error) => {
            console.error(`BG: DB listener error (directPins child_removed) for ${meetingId}:`, error);
            if (error.code === 'PERMISSION_DENIED') notifyPermissionErrorToContentScripts(meetingId);
            stopDbListener(meetingId);
        });

        activeListeners[meetingId] = { 
            pinsRef: pinsRef,
            directPinsRef: directPinsRef,
            listeners: listeners 
        };
    } catch (error) {
        console.error(`BG: Failed to attach listeners for ${meetingId}:`, error);
    }
}

function stopDbListener(meetingId) {
    const listenerInfo = activeListeners[meetingId];
    if (listenerInfo) {
        console.log(`BG: Stopping DB listener for ${meetingId}`);
        try {
            if (listenerInfo.listeners.pinsAdded) {
                off(listenerInfo.pinsRef, 'child_added', listenerInfo.listeners.pinsAdded);
            }
            if (listenerInfo.listeners.pinsRemoved) {
                off(listenerInfo.pinsRef, 'child_removed', listenerInfo.listeners.pinsRemoved);
            }
            if (listenerInfo.listeners.directPinsAdded) {
                off(listenerInfo.directPinsRef, 'child_added', listenerInfo.listeners.directPinsAdded);
            }
            if (listenerInfo.listeners.directPinsRemoved) {
                off(listenerInfo.directPinsRef, 'child_removed', listenerInfo.listeners.directPinsRemoved);
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
                        if (!activeListeners[meetingId]) {
                            startDbListener(meetingId);
                        }
                    }
                }
            });
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
    chrome.tabs.query({ url: `https://meet.google.com/${targetMeetingId}*` })
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
  try {
    const initResult = await initializeFirebase();
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
    const credential = GoogleAuthProvider.credential(null, authToken);
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
    if (!error) return;
    const ignoreErrors = ['Receiving end does not exist', 'Extension context invalidated'];
    if (!ignoreErrors.some(msg => error.message?.includes(msg))) {
        console.warn(`BG: Error sending ${actionDesc} to ${targetDesc}: ${error.message || error}`);
    }
}

// --- タブ更新/削除リスナー ---
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if ((changeInfo.status === 'complete' || changeInfo.url) && tab.url && tab.url.includes("meet.google.com/")) {
    chrome.tabs.sendMessage(tabId, { action: 'urlUpdated', url: tab.url })
        .catch(error => handleMessageError(error, tabId, 'urlUpdated'));
    startListenersForActiveMeetTabs();
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    startListenersForActiveMeetTabs();
});

// --- メッセージリスナー ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const initResult = await initializeFirebase();
      if (!initResult.success || !firebaseInitialized) {
        console.error("BG: Firebase not initialized, cannot process message:", message.action);
        sendResponse({ success: false, error: "バックグラウンド処理の準備ができていません" });
        return;
      }

      const action = message.action;

      if (typeof action === 'string' && action.trim() === 'getAuthStatus') {
        sendResponse({ user: currentUser });
        return;
      } else if (typeof action === 'string' && action.trim() === 'getLoggedInUsers') {
        sendResponse({ loggedInUsers: loggedInUsers });
        return;
      } else if (typeof action === 'string' && action.trim() === 'requestLogin') {
        const result = await signInWithGoogle();
        sendResponse({ started: result.success, error: result.error?.message });
        return;
      } else if (typeof action === 'string' && action.trim() === 'requestLogout') {
        if (auth) {
            try {
                await signOut(auth);
                console.log("BG: User signed out successfully.");
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
          if (meetingId) {
              startDbListener(meetingId);
              sendResponse({ success: true, message: `Listener started for ${meetingId}` });
          } else {
              sendResponse({ success: false, error: "Meeting ID is required" });
          }
          return;
      } else if (typeof action === 'string' && action.trim() === 'stopListening') {
          const { meetingId } = message;
          if (meetingId) {
              stopDbListener(meetingId);
              sendResponse({ success: true, message: `Listener stopped for ${meetingId}` });
          } else {
              sendResponse({ success: false, error: "Meeting ID is required" });
          }
          return;
      } else if (typeof action === 'string' && action.trim() === 'createPin') {
        const { meetingId, pinData } = message;
        if (!meetingId || !pinData || !pinData.type) {
          sendResponse({ success: false, error: "必須パラメータ(meetingId, pinData.type)が不足しています" });
          return;
        }
        if (!currentUser) {
          sendResponse({ success: false, error: "認証されていません" });
          return;
        }
        if (!database) {
          sendResponse({ success: false, error: "データベースが初期化されていません" });
          return;
        }
        try {
          const pinsRef = ref(database, `meetings/${meetingId}/pins`);
          const newPinRef = push(pinsRef);
          const pinPayload = {
            ...pinData,
            createdBy: {
               uid: currentUser.uid,
               displayName: currentUser.displayName,
               email: currentUser.email
            },
            timestamp: serverTimestamp()
          };
          await set(newPinRef, pinPayload);
          sendResponse({ success: true, pinId: newPinRef.key });
        } catch (error) {
          console.error(`BG: ピン作成エラー (${meetingId}):`, error);
          if (error.code === 'PERMISSION_DENIED') {
            notifyPermissionErrorToContentScripts(meetingId);
          }
          sendResponse({ success: false, error: error.message });
        }
        return;
      } else if (typeof action === 'string' && action.trim() === 'createDirectPin') {
        const { meetingId, targetUserId, pinData } = message;
        if (!meetingId || !targetUserId || !pinData || !pinData.type) {
          sendResponse({ success: false, error: "必須パラメータ(meetingId, targetUserId, pinData.type)が不足しています" });
          return;
        }
        if (!currentUser) {
          sendResponse({ success: false, error: "認証されていません" });
          return;
        }
        if (!database) {
          sendResponse({ success: false, error: "データベースが初期化されていません" });
          return;
        }
        try {
          // 受信者宛てのピン
          const directPinsRef = ref(database, `meetings/${meetingId}/directPins/${targetUserId}`);
          const newPinRef = push(directPinsRef);
          const pinPayload = {
            ...pinData,
            createdBy: {
               uid: currentUser.uid,
               displayName: currentUser.displayName,
               email: currentUser.email
            },
            targetUserId: targetUserId,
            timestamp: serverTimestamp()
          };
          await set(newPinRef, pinPayload);

          // 送信者宛てのピンのコピー（送信確認用）
          const senderPinsRef = ref(database, `meetings/${meetingId}/directPins/${currentUser.uid}`);
          const senderPinRef = push(senderPinsRef);
          const senderPinPayload = {
            ...pinPayload,
            isSent: true, // 送信したピンであることを示すフラグ
            originalPinId: newPinRef.key, // 元のピンIDを保存
            displayTargetName: message.targetDisplayName || 'Unknown User' // 送信先の表示名
          };
          await set(senderPinRef, senderPinPayload);

          sendResponse({ success: true, pinId: newPinRef.key, senderPinId: senderPinRef.key });
        } catch (error) {
          console.error(`BG: 個別ピン作成エラー (${meetingId} -> ${targetUserId}):`, error);
          if (error.code === 'PERMISSION_DENIED') {
            notifyPermissionErrorToContentScripts(meetingId);
          }
          sendResponse({ success: false, error: error.message });
        }
        return;
      } else if (typeof action === 'string' && action.trim() === 'removePin') {
         const { meetingId, pinId } = message;
          if (!meetingId || !pinId) {
            sendResponse({ success: false, error: "必須パラメータ(meetingId, pinId)が不足しています" });
            return;
          }
          if (!currentUser) {
            sendResponse({ success: false, error: "認証されていません" });
            return;
          }
          if (!database) {
            sendResponse({ success: false, error: "データベースが初期化されていません" });
            return;
          }
          const pinRef = ref(database, `meetings/${meetingId}/pins/${pinId}`);
          try {
            await remove(pinRef);
            sendResponse({ success: true });
          } catch (error) {
            console.error(`BG: ピン削除エラー (${meetingId}/${pinId}):`, error);
            if (error.code === 'PERMISSION_DENIED') {
                sendResponse({ success: false, error: "データベースからの削除権限がありません。" });
            } else {
                sendResponse({ success: false, error: `DB削除エラー: ${error.message}` });
            }
          }
      } else if (typeof action === 'string' && action.trim() === 'removeDirectPin') {
         const { meetingId, pinId, targetUserId } = message;
          if (!meetingId || !pinId || !targetUserId) {
            sendResponse({ success: false, error: "必須パラメータ(meetingId, pinId, targetUserId)が不足しています" });
            return;
          }
          if (!currentUser) {
            sendResponse({ success: false, error: "認証されていません" });
            return;
          }
          if (!database) {
            sendResponse({ success: false, error: "データベースが初期化されていません" });
            return;
          }
          const directPinRef = ref(database, `meetings/${meetingId}/directPins/${targetUserId}/${pinId}`);
          try {
            await remove(directPinRef);
            sendResponse({ success: true });
          } catch (error) {
            console.error(`BG: 個別ピン削除エラー (${meetingId}/${targetUserId}/${pinId}):`, error);
            if (error.code === 'PERMISSION_DENIED') {
                sendResponse({ success: false, error: "データベースからの削除権限がありません。" });
            } else {
                sendResponse({ success: false, error: `個別ピンDB削除エラー: ${error.message}` });
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

// --- 通知クリック時のリスナー ---
chrome.notifications.onClicked.addListener(async (notificationId) => {
    console.log(`BG: 通知 ${notificationId} がクリックされました`);
    if (notificationId.startsWith('pin-')) {
        const parts = notificationId.split('-');
        if (parts.length >= 3) { // pin-meetingId-pinId を想定
            const meetingId = parts[1];
            const meetUrlPattern = `*://meet.google.com/${meetingId}*`;

            try {
                const tabs = await chrome.tabs.query({ url: meetUrlPattern });
                if (tabs.length > 0) {
                    const targetTab = tabs[0];
                    await chrome.tabs.update(targetTab.id, { active: true });
                    if (targetTab.windowId) {
                        await chrome.windows.update(targetTab.windowId, { focused: true });
                    }
                } else {
                    // Meetタブが見つからない場合、新しいタブで開く (オプション)
                    // chrome.tabs.create({ url: `https://meet.google.com/${meetingId}` });
                    console.warn(`BG: 通知に対応するMeetタブ (${meetUrlPattern}) が見つかりません`);
                }
            } catch (error) {
                console.error("BG: 通知クリック時のタブ操作エラー:", error);
            }
        }
    }
    chrome.notifications.clear(notificationId);
});


// --- 拡張機能インストール/起動時の処理 ---
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("BG: Extension installed/updated.", details.reason);
  await BackgroundLanguageManager.init();
  await initializeFirebase();
});

// Initialize on startup
(async () => {
  await BackgroundLanguageManager.init();
  const result = await initializeFirebase();
  console.log("BG: Initial Firebase initialization result:", result.success ? 'Success' : 'Failure', result.error || '');
})();

// Listen for language changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.language) {
    BackgroundLanguageManager.currentLanguage = changes.language.newValue;
  }
});