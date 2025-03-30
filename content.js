// content.js - Google Meetの画面にピン機能を追加するコンテンツスクリプト

// グローバル変数
let currentUser = null;
let currentMeetingId = null;
let database = null; // 必要になったら取得
let auth = null; // 必要になったら取得
let pinsRef = null;
let userPins = {}; // ユーザーが作成したピンを追跡

// Firebase初期化（設定読み込みとインスタンス取得準備）
function initializeFirebase() {
  try {
    // firebaseConfig は firebase-config.js でグローバルに定義されている前提
    if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') {
      console.error('Firebase SDK または設定が読み込まれていません。');
      showMessage('エラー: 初期化に失敗しました。');
      return;
    }

    // Background Script で初期化済みのはずなので、ここではインスタンス取得のみ試みる
    console.log('Content script: Firebase SDK/Config loaded.');

    // 認証状態をBackground Scriptに問い合わせる
    requestAuthStatusFromBackground();

    // Meeting IDを検出
    detectMeetingId();

  } catch (error) {
    console.error('Content script Firebase 初期化処理エラー:', error);
    showMessage('エラー: 初期化中に問題が発生しました。');
  }
}

// Meeting IDをURLから取得
function detectMeetingId() {
  // ... (変更なし) ...
  const url = window.location.href;
  const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
  const match = url.match(meetRegex);
  
  if (match && match[1]) {
      currentMeetingId = match[1];
      console.log('検出されたMeeting ID:', currentMeetingId);
      // ユーザーが認証済みならリスナー設定などを行う
      if (currentUser) {
          setupPinsListener(); // リスナー設定
          setupUI(); // UI設定
      }
  } else {
      console.log('Meeting IDが見つかりません');
      currentMeetingId = null;
      cleanupUI(); // UIがあれば削除
  }
}

 // Background Scriptに認証状態を問い合わせる
function requestAuthStatusFromBackground() {
  chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (response) => {
    // ... (既存のコードを流用 - currentUser設定、startPingSystem呼び出しなど) ...
     if (chrome.runtime.lastError) {
        console.error("Error sending message to background:", chrome.runtime.lastError.message);
        // リトライやエラー表示など
        return;
    }
    handleAuthResponse(response); // 応答を処理する関数を呼び出す
  });
}

// Backgroundからの認証応答を処理
function handleAuthResponse(response) {
    const user = response?.user;
    console.log('Received auth status from background:', user);
    if (user && user.email.endsWith(`@${COMPANY_DOMAIN}`)) {
        currentUser = user;
        startPingSystem(); // UI作成やリスナー設定を含む関数
    } else {
        currentUser = null;
        if (user) {
             console.warn('User not from allowed domain.');
             showMessage('許可されたドメインのアカウントではありません。');
        } else {
             console.log('User not logged in.');
             // ログインプロンプト表示など (showLoginPrompt())
             showLoginPrompt();
        }
        cleanupUI(); // UIを削除または非表示にする
    }
}

// ピンシステムの初期化・開始 (UI作成、リスナー設定など)
function startPingSystem() {
  if (!currentUser) {
      console.error('User not authenticated.');
      requestAuthStatusFromBackground(); // 再確認
      return;
  }
   if (!currentMeetingId) {
      detectMeetingId(); // Meeting IDがなければ再検出
      if(!currentMeetingId) {
         console.error('Meeting ID not found.');
         return;
      }
   }

  // UIがなければ作成
  if (!document.getElementById('lol-ping-container')) {
    setupUI(); // UIセットアップ関数を呼び出す
  } else {
     console.log("Ping UI already exists.");
  }

  // Firebaseリスナーの設定
  setupPinsListener();

  console.log('Ping system initialized/updated for meeting:', currentMeetingId);
  showMessage(`ピンシステム起動 (${currentUser.displayName || currentUser.email.split('@')[0]})`);
}

// ピンのリアルタイムリスナーを設定
function setupPinsListener() {
  if (!currentUser || !currentMeetingId) return;
  
  // 既存のリスナーをクリーンアップ
  if (pinsRef) {
    pinsRef.off();
    console.log("Detached old pins listener.");
  }

  // データベースインスタンスを取得
  const db = getDatabase();
  if (!db) return;
  
  // 新しいリスナーを設定
  pinsRef = db.ref(`meetings/${currentMeetingId}/pins`);
  console.log("Setting up new pins listener for:", currentMeetingId);
  
  // 新しいピンが追加されたとき
  pinsRef.on('child_added', (snapshot) => {
    const pinId = snapshot.key;
    const pin = snapshot.val();
    console.log('新しいピン:', pinId, pin);
    renderPin(pinId, pin);
  });
  
  // ピンが削除されたとき
  pinsRef.on('child_removed', (snapshot) => {
    const pinId = snapshot.key;
    console.log('ピンが削除されました:', pinId);
    removePin(pinId);
  });
}

// UIu8981u7d20u3092u8ffdu52a0
function setupUI() {
  if (!currentUser) return;
  
  // u65e2u5b58u306eUIu3092u30afu30eau30fcu30f3u30a2u30c3u30d7
  cleanupUI();
  
  // u30d4u30f3u30e1u30cbu30e5u30fcu30dcu30bfu30f3u3092u8ffdu52a0
  const controlsContainer = document.querySelector('[data-is-persistent="true"][data-allocation-index="0"]');
  if (!controlsContainer) {
    console.log('Google Meetu306eu30b3u30f3u30c8u30edu30fcu30ebu30b3u30f3u30c6u30cau304cu898bu3064u304bu308au307eu305bu3093');
    setTimeout(setupUI, 2000); // 2u79d2u5f8cu306bu518du8a66u884c
    return;
  }
  
  // u30d4u30f3u30dcu30bfu30f3u3068u30e1u30cbu30e5u30fcu306eu30b3u30f3u30c6u30cau3092u4f5cu6210
  const container = document.createElement('div');
  container.id = 'lol-ping-container';
  
  // u30d4u30f3u30dcu30bfu30f3
  const pingButton = document.createElement('button');
  pingButton.id = 'ping-button';
  pingButton.textContent = '!';
  pingButton.title = 'u30d4u30f3u30e1u30cbu30e5u30fcu3092u958bu304f';
  
  // u30d4u30f3u30e1u30cbu30e5u30fc
  const pingMenu = document.createElement('div');
  pingMenu.id = 'ping-menu';
  pingMenu.style.display = 'none';
  
  // u30d4u30f3u306eu7a2eu985e
  const pingTypes = [
    { type: 'warning', emoji: 'u26a0ufe0f', label: 'u8b66u544a' },
    { type: 'direction', emoji: 'u27a1ufe0f', label: 'u65b9u5411' },
    { type: 'question', emoji: 'u2753', label: 'u8ceau554f' },
    { type: 'help', emoji: 'ud83cudd98', label: 'u52a9u3051u3066' }
  ];
  
  // u30d4u30f3u30e1u30cbu30e5u30fcu306eu30dcu30bfu30f3u3092u4f5cu6210
  pingTypes.forEach(pingType => {
    const button = document.createElement('button');
    button.className = 'ping-option';
    button.dataset.type = pingType.type;
    button.innerHTML = `${pingType.emoji}<span>${pingType.label}</span>`;
    button.addEventListener('click', () => {
      createPin(pingType.type);
      pingMenu.style.display = 'none';
    });
    pingMenu.appendChild(button);
  });
  
  // u30d4u30f3u8868u793au30a8u30eau30a2
  const pinsArea = document.createElement('div');
  pinsArea.id = 'pins-area';
  
  // u30afu30eau30c3u30afu30a4u30d9u30f3u30c8
  pingButton.addEventListener('click', () => {
    pingMenu.style.display = pingMenu.style.display === 'none' ? 'flex' : 'none';
  });
  
  // u30afu30eau30c3u30afu4ee5u5916u3067u30e1u30cbu30e5u30fcu3092u9589u3058u308b
  document.addEventListener('click', (event) => {
    if (!pingMenu.contains(event.target) && event.target !== pingButton) {
      pingMenu.style.display = 'none';
    }
  });
  
  // u8981u7d20u3092u8ffdu52a0
  container.appendChild(pingButton);
  container.appendChild(pingMenu);
  container.appendChild(pinsArea);
  controlsContainer.appendChild(container);
  
  console.log('u30d4u30f3UIu304cu8ffdu52a0u3055u308cu307eu3057u305f');
}

// UIを削除
function cleanupUI() {
  const container = document.getElementById('lol-ping-container');
  if (container) {
    container.remove();
    console.log('ピンUIが削除されました');
  }
}

// データベースインスタンスを取得するヘルパー関数
function getDatabase() {
  if (!database) {
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
      database = firebase.database();
      console.log('データベースインスタンスを取得しました');
    } else {
      console.error('データベースを取得できません: Firebase が初期化されていません。');
      return null;
    }
  }
  return database;
}

// ピンを作成
function createPin(pingType) {
  if (!currentUser || !currentMeetingId) {
    console.error('ピンを作成できません: ユーザーがログインしていないか、ミーティングIDが見つかりません。');
    showMessage('エラー: ピンを作成できません。ログイン状態を確認してください。');
    return;
  }
  
  // データベースインスタンスを取得
  const db = getDatabase();
  if (!db) {
    console.error('データベースが利用できないためピンを作成できません');
    showMessage('エラー: データベース接続に問題があります。');
    return;
  }
  
  // pinsRefが未設定の場合は設定
  if (!pinsRef) {
    pinsRef = db.ref(`meetings/${currentMeetingId}/pins`);
  }
  
  // ピンデータの作成
  const pin = {
    type: pingType,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    createdBy: {
      uid: currentUser.uid,
      displayName: currentUser.displayName || currentUser.email.split('@')[0],
      email: currentUser.email
    },
    expiresAt: Date.now() + 30000 // 30秒後に消える
  };
  
  // データベースにピンを追加
  const newPinRef = pinsRef.push();
  newPinRef.set(pin)
    .then(() => {
      console.log('ピンが作成されました:', newPinRef.key);
      
      // 自分のピンを追跡
      userPins[newPinRef.key] = true;
      
      // 期限切れで自動削除
      setTimeout(() => {
        newPinRef.remove()
          .then(() => console.log('ピンの期限が切れました:', newPinRef.key))
          .catch(error => console.error('ピンの自動削除エラー:', error));
      }, 30000);
    })
    .catch(error => {
      console.error('ピンの作成エラー:', error);
      showMessage(`エラー: ピンを作成できませんでした: ${error.message}`);
    });
}

// u30d4u30f3u3092u8868u793a
function renderPin(pinId, pin) {
  const pinsArea = document.getElementById('pins-area');
  if (!pinsArea) return; // UIu672au4f5cu6210u306eu5834u5408u306fu4f55u3082u3057u306au3044

  // u53e4u3044u30d4u30f3u304cu3042u308cu3070u524au9664 (u518du63cfu753bu306eu5834u5408)
  const existingPin = document.getElementById(`pin-${pinId}`);
  if (existingPin) {
    existingPin.remove();
  }
  
  // u30d4u30f3u306eu7a2eu985eu306bu5fdcu3058u305fu7d75u6587u5b57
  let emoji = 'u26a0ufe0f'; // u30c7u30d5u30a9u30ebu30c8u306fu8b66u544a
  switch (pin.type) {
    case 'warning': emoji = 'u26a0ufe0f'; break;
    case 'direction': emoji = 'u27a1ufe0f'; break;
    case 'question': emoji = 'u2753'; break;
    case 'help': emoji = 'ud83cudd98'; break;
  }
  
  // u30d4u30f3u8981u7d20u306eu4f5cu6210
  const pinElement = document.createElement('div');
  pinElement.id = `pin-${pinId}`;
  pinElement.className = `pin ${pin.type}`;
  pinElement.innerHTML = `
    <div class="pin-emoji">${emoji}</div>
    <div class="pin-info">
      <div class="pin-user">${pin.createdBy.displayName}</div>
    </div>
  `;
  
  // u81eau5206u306eu30d4u30f3u306au3089u30afu30eau30c3u30afu3067u524au9664u53efu80fdu306b
  if (currentUser && pin.createdBy.uid === currentUser.uid) {
    pinElement.classList.add('own-pin');
    pinElement.title = 'u30afu30eau30c3u30afu3057u3066u524au9664';
    pinElement.addEventListener('click', () => {
      if (pinsRef) {
        pinsRef.child(pinId).remove()
          .then(() => console.log('u30d4u30f3u304cu624bu52d5u3067u524au9664u3055u308cu307eu3057u305f:', pinId))
          .catch(error => console.error('u30d4u30f3u306eu524au9664u30a8u30e9u30fc:', error));
      }
    });
  }
  
  // u8868u793a
  pinsArea.appendChild(pinElement);
  
  // u30a2u30cbu30e1u30fcu30b7u30e7u30f3u7528u306bu30bfu30a4u30e0u30a2u30a6u30c8u3092u8a2du5b9a
  setTimeout(() => {
    pinElement.classList.add('show');
  }, 10);
}

// u30d4u30f3u3092u524au9664
function removePin(pinId) {
  const pinElement = document.getElementById(`pin-${pinId}`);
  if (pinElement) {
    // u30d5u30a7u30fcu30c9u30a2u30a6u30c8u30a2u30cbu30e1u30fcu30b7u30e7u30f3
    pinElement.classList.remove('show');
    pinElement.classList.add('hide');
    
    // u30a2u30cbu30e1u30fcu30b7u30e7u30f3u5b8cu4e86u5f8cu306bu8981u7d20u3092u524au9664
    setTimeout(() => {
      pinElement.remove();
    }, 300);
    
    // u81eau5206u306eu30d4u30f3u306eu8ffdu8de1u304bu3089u524au9664
    if (userPins[pinId]) {
      delete userPins[pinId];
    }
  }
}

// u30e1u30c3u30bbu30fcu30b8u3092u8868u793a
function showMessage(message, duration = 3000) {
  let messageContainer = document.getElementById('lol-ping-message');
  
  if (!messageContainer) {
    messageContainer = document.createElement('div');
    messageContainer.id = 'lol-ping-message';
    document.body.appendChild(messageContainer);
  }
  
  messageContainer.textContent = message;
  messageContainer.classList.add('show');
  
  setTimeout(() => {
    messageContainer.classList.remove('show');
  }, duration);
}

// u30ddu30c3u30d7u30a2u30c3u30d7u304bu3089u306eu30e1u30c3u30bbu30fcu30b8u3092u53d7u4fe1
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'userLoggedIn') {
    currentUser = message.user;
    console.log('u30ddu30c3u30d7u30a2u30c3u30d7u304bu3089u306eu30edu30b0u30a4u30f3u901au77e5:', currentUser);
    
    // Firebaseu304cu521du671fu5316u3055u308cu3066u3044u308bu304bu78bau8a8d
    if (!database) {
      initializeFirebase();
    } else if (currentMeetingId) {
      setupPinsListener();
      setupUI();
    }
    
    sendResponse({status: 'success'});
    return true;
  }
  
  if (message.action === 'userLoggedOut') {
    console.log('u30ddu30c3u30d7u30a2u30c3u30d7u304bu3089u306eu30edu30b0u30a2u30a6u30c8u901au77e5');
    currentUser = null;
    cleanupUI();
    sendResponse({status: 'success'});
    return true;
  }
});

// u30dau30fcu30b8u8aadu307fu8fbcu307fu5b8cu4e86u6642u306bu521du671fu5316
window.addEventListener('load', () => {
  console.log('Meet LoL-Style Pingu62e1u5f35u6a5fu80fdu304cu8aadu307fu8fbcu307eu308cu307eu3057u305f');
  
  // URLu5909u66f4u3092u76e3u8996u3057u3066Meeting IDu306eu5909u66f4u3092u691cu51fa
  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      console.log('URLu304cu5909u66f4u3055u308cu307eu3057u305f:', lastUrl);
      detectMeetingId();
    }
  });
  
  urlObserver.observe(document, {subtree: true, childList: true});
  
  // Firebaseu521du671fu5316
  initializeFirebase();
  
  // Meeting IDu3092u53d6u5f97
  detectMeetingId();
});
