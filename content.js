// content.js

// --- グローバル変数 --- (変更なし)
let currentUser = null;
let currentMeetingId = null;
let database = null;
let auth = null;
let pinsRef = null;
let userPins = {};

// ピンの種類定義
const PING_DEFINITIONS = {
    danger: { icon: '⚠️', label: '危険' },
    onMyWay: { icon: '➡️', label: '向かっている' },
    question: { icon: '❓', label: '質問' },
    assist: { icon: '🆘', label: '助けて' } // 日本語ラベル修正
};
// メニューの配置計算用
const PING_MENU_POSITIONS = {
    danger: { angle: -90, distance: 70 },  // 上
    onMyWay: { angle: 0, distance: 70 },   // 右
    question: { angle: 90, distance: 70 },  // 下
    assist: { angle: 180, distance: 70 }   // 左
};

// --- Firebase 初期化/認証関連 ---
function initializeFirebase() {
  try {
    // firebaseConfig は firebase-config.js でグローバルに定義されている前提
    if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') {
      console.error('Firebase SDK または設定が読み込まれていません。');
      showMessage('エラー: 初期化に失敗しました。');
      return;
    }

    // Background Script で初期化済みのはず
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

function requestAuthStatusFromBackground() {
  chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Error sending message to background:", chrome.runtime.lastError.message);
      return;
    }
    handleAuthResponse(response); // 応答を処理する関数を呼び出す
  });
}

function handleAuthResponse(response) {
    const user = response?.user;
    console.log('Received auth status from background:', user);
    // COMPANY_DOMAIN は firebase-config.js で定義されている想定
    if (user && typeof COMPANY_DOMAIN !== 'undefined' && user.email.endsWith(`@${COMPANY_DOMAIN}`)) {
        currentUser = user;
        // Meetページにいればシステムを開始/更新
        if (currentMeetingId) {
            startPingSystem();
        } else {
            // Meet ID がまだ検出されていない可能性があるので検出を試みる
            detectMeetingId();
        }
    } else {
        currentUser = null;
        if (user) {
            console.warn('User not from allowed domain.');
            showMessage('許可されたドメインのアカウントではありません。');
        } else {
            console.log('User not logged in.');
            // ログインプロンプト表示
            showLoginPrompt();
        }
        cleanupUI(); // UIを削除または非表示にする
    }
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'authStatusChanged') {
    console.log('Auth status changed notification received:', message.user);
    handleAuthResponse(message); // 認証状態変更を処理
    // 必要に応じてUIの再描画やリスナーの再設定を行う
    if (message.user && currentMeetingId && !document.getElementById('lol-ping-container')) {
        console.log("User logged in, meet active, UI missing. Setting up UI.");
        setupUI();
        setupPinsListener();
    } else if (!message.user) {
        cleanupUI();
    }
    sendResponse({ received: true });
    return true;
  }
  // ... 他のアクション
});

// --- Meet関連処理 ---
function detectMeetingId() {
  const url = window.location.href;
  const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
  const match = url.match(meetRegex);
  const newMeetingId = match ? match[1] : null;

  if (newMeetingId !== currentMeetingId) {
    console.log(`Meeting ID changed from ${currentMeetingId} to ${newMeetingId}`);
    cleanupUI(); // UIとリスナーをクリア
    currentMeetingId = newMeetingId;
    if (currentMeetingId && currentUser) {
      console.log("New meeting detected, user already logged in. Starting ping system.");
      startPingSystem();
    } else if (currentMeetingId && !currentUser){
        console.log("New meeting detected, user not logged in. Requesting auth status.");
        requestAuthStatusFromBackground(); // ログインしてなければ確認
    } else {
         console.log("Exited Meet or invalid URL.");
    }
  } else if (currentMeetingId && currentUser && !document.getElementById('lol-ping-container')) {
      // 同じMeetページだがUIがない場合
      console.log("Same meeting ID, UI missing. Setting up UI.");
      setupUI();
      setupPinsListener();
  } else {
      console.log("Meeting ID check: No significant change detected.");
  }
}

// --- ピンシステム初期化・開始 ---
function startPingSystem() {
  if (!currentUser) {
    console.error('startPingSystem: User not authenticated.');
    return;
  }
  if (!currentMeetingId) {
    console.error('startPingSystem: Meeting ID not found.');
     detectMeetingId(); // 再度検出を試みる
     if (!currentMeetingId) return; // それでもなければ中断
  }

  console.log("startPingSystem: Initializing for meeting:", currentMeetingId);
  setupUI(); // UI作成 (内部で存在チェック)
  setupPinsListener(); // リスナー設定 (内部で重複防止)
  showMessage(`ピンシステム起動 (${currentUser.displayName || currentUser.email.split('@')[0]})`);
}

// --- UI関連 ---

function setupUI() {
  if (document.getElementById('lol-ping-container')) {
    console.warn("setupUI: UI container already exists. Aborting setup.");
    return;
  }
  if (!currentUser || !currentMeetingId) {
    console.warn("setupUI: No logged in user or meeting ID. Aborting setup.");
    return;
  }
  console.log("setupUI: Creating UI elements...");

  const container = document.createElement('div');
  container.id = 'lol-ping-container';

  // ピンメニューボタン
  const pingButton = document.createElement('button');
  pingButton.id = 'ping-menu-button';
  pingButton.innerHTML = '<span>!</span>';
  pingButton.title = 'ピンメニューを開く'; // 日本語修正
  pingButton.addEventListener('click', togglePingMenu);
  container.appendChild(pingButton);

  // ピンメニュー
  const pingMenu = document.createElement('div');
  pingMenu.id = 'ping-menu';
  pingMenu.classList.add('hidden');

  const pingCenter = document.createElement('div');
  pingCenter.id = 'ping-center';
  pingCenter.textContent = 'PING';
  pingMenu.appendChild(pingCenter);

  // ピンオプション
  Object.keys(PING_DEFINITIONS).forEach(key => {
    const pingInfo = PING_DEFINITIONS[key];
    const posInfo = PING_MENU_POSITIONS[key];
    const option = document.createElement('div');
    option.className = 'ping-option';
    option.dataset.type = key;
    option.title = pingInfo.label; // 日本語ラベル

    const iconDiv = document.createElement('div');
    iconDiv.className = 'ping-icon';
    iconDiv.textContent = pingInfo.icon; // 絵文字アイコン
    option.appendChild(iconDiv);

    if (posInfo) {
      const angleRad = posInfo.angle * (Math.PI / 180);
      const x = Math.cos(angleRad) * posInfo.distance;
      const y = Math.sin(angleRad) * posInfo.distance;
      option.style.position = 'absolute';
      option.style.top = '50%';
      option.style.left = '50%';
      option.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    }
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      createPin(key);
      pingMenu.classList.add('hidden');
    });
    pingMenu.appendChild(option);
  });
  container.appendChild(pingMenu);

  // ピン表示エリア
  const pinsArea = document.createElement('div');
  pinsArea.id = 'pins-area';
  container.appendChild(pinsArea);

  // 説明表示
  const instructions = document.createElement('div');
  instructions.id = 'ping-instructions';
  instructions.innerHTML = `
    <div class="font-bold mb-1">使い方:</div>
    <div>1. 左下の[!]ボタンでメニュー開閉</div>
    <div>2. アイコンを選択してピン作成</div>
    <div>3. 表示されたピンをクリックして削除</div>
  `; // 日本語修正
  container.appendChild(instructions);

  document.body.appendChild(container);
  document.removeEventListener('click', handleDocumentClickForMenu);
  document.addEventListener('click', handleDocumentClickForMenu);
  console.log('ピンUIが body に追加されました'); // 日本語修正
}

function cleanupUI() {
  console.log("cleanupUI: Attempting to remove UI...");
  if (pinsRef) {
      pinsRef.off();
      pinsRef = null;
      console.log("Detached Firebase pins listener during cleanup.");
  }
  document.removeEventListener('click', handleDocumentClickForMenu);

  const container = document.getElementById('lol-ping-container');
  if (container) {
    container.remove();
    console.log('ピンUIコンテナが削除されました'); // 日本語修正
  } else {
    console.log("cleanupUI: UI container not found.");
  }
  const loginPrompt = document.getElementById('ping-login-prompt');
  if (loginPrompt) loginPrompt.remove();
  const messageArea = document.getElementById('lol-ping-message');
  if (messageArea) messageArea.remove();
}

function handleDocumentClickForMenu(event) {
    const menu = document.getElementById('ping-menu');
    const button = document.getElementById('ping-menu-button');
    if (menu && !menu.classList.contains('hidden')) {
        if (!menu.contains(event.target) && !button.contains(event.target)) {
             menu.classList.add('hidden');
        }
    }
}

function togglePingMenu(event) {
    event.stopPropagation();
    const pingMenu = document.getElementById('ping-menu');
    if (pingMenu) {
        pingMenu.classList.toggle('hidden');
    }
}

function showLoginPrompt() {
  const existingPrompt = document.getElementById('ping-login-prompt');
  if (existingPrompt) {
    existingPrompt.remove();
  }
  const prompt = document.createElement('div');
  prompt.id = 'ping-login-prompt';
  // スタイルはCSSで定義されている前提
  prompt.innerHTML = `ピン機能を使うにはログインが必要です。クリックしてログイン。`; // 日本語修正
  prompt.onclick = () => {
      chrome.runtime.sendMessage({ action: 'requestLogin' }, (response) => {
          if (chrome.runtime.lastError) {
              console.error("Login request error:", chrome.runtime.lastError.message);
              showMessage('ログイン開始に失敗しました。', true); // isError = true
          } else if (response && response.started) {
              showMessage('ログインプロセスを開始しました...');
              prompt.remove();
          } else {
              showMessage('ログインを開始できませんでした。', true); // isError = true
          }
      });
  };
  document.body.appendChild(prompt);
}


// --- Firebase Realtime Database 操作 ---

function createPin(pingType) {
  if (!currentUser || !currentMeetingId) {
    console.error('ピンを作成できません: ユーザーがログインしていないか、ミーティングIDが見つかりません。'); // 日本語修正
    showMessage('エラー: ピンを作成できません。ログイン状態を確認してください。', true); // 日本語修正
    return;
  }
  const db = firebase.database();
  if (!db) {
    console.error("データベースが利用できません。Firebaseが初期化されていません。"); // 日本語修正
    showMessage('エラー: データベース接続に問題があります。', true); // 日本語修正
    return;
  }
  const currentPinsRef = db.ref(`meetings/${currentMeetingId}/pins`);

  const pin = {
    type: pingType,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    createdBy: {
      uid: currentUser.uid,
      displayName: currentUser.displayName || currentUser.email.split('@')[0],
      email: currentUser.email
    },
    // expiresAt はDBルールかCloud Functionsで処理する方が堅牢
  };

  const newPinRef = currentPinsRef.push();
  newPinRef.set(pin)
    .then(() => {
      console.log('ピンが作成されました:', newPinRef.key); // 日本語修正
      showMessage(`ピン「${PING_DEFINITIONS[pingType]?.label || pingType}」を作成しました`); // 日本語ラベル使用
      // 自分のピン追跡は任意
      // userPins[newPinRef.key] = true;
    })
    .catch(error => {
      console.error('ピンの作成エラー:', error); // 日本語修正
      showMessage(`エラー: ピンを作成できませんでした: ${error.message}`, true); // 日本語修正
    });
}

function removePinFromDb(pinId) {
    if (!currentUser || !currentMeetingId) return;
    const db = firebase.database();
    if (!db) return;
    const pinRef = db.ref(`meetings/${currentMeetingId}/pins/${pinId}`);

    pinRef.once('value')
      .then(snapshot => {
        const pin = snapshot.val();
        // Firebaseのデータ構造に合わせて createdBy.uid で比較
        if (pin && pin.createdBy && pin.createdBy.uid === currentUser.uid) {
          return pinRef.remove();
        } else if (pin) {
          console.warn('他のユーザーのピンを削除しようとしました。'); // 日本語修正
          showMessage('他のユーザーのピンは削除できません。', true); // isError = true
          return Promise.reject('Permission denied');
        } else {
          console.warn('削除対象のピンが見つかりません:', pinId); // 日本語修正
          return Promise.reject('Pin not found');
        }
      })
      .then(() => {
        console.log('ピンをDBから削除しました:', pinId); // 日本語修正
        showMessage('ピンを削除しました'); // 日本語修正
      })
      .catch(error => {
        if (error !== 'Permission denied or Pin not found') {
          console.error('ピンのDB削除エラー:', error); // 日本語修正
          showMessage('エラー: ピンの削除に失敗しました。', true); // 日本語修正
        }
      });
}

function setupPinsListener() {
  if (!currentUser || !currentMeetingId) {
    console.log("setupPinsListener: Skipping, no user or meeting ID.");
    return;
  }
  const db = firebase.database();
  if (!db) {
    console.error("setupPinsListener: Database not available.");
    return;
  }
  const newPinsRef = db.ref(`meetings/${currentMeetingId}/pins`);

  if (pinsRef) {
    console.log("setupPinsListener: Detaching previous listener.");
    pinsRef.off();
  }
  pinsRef = newPinsRef;
  console.log("Setting up new pins listener for:", currentMeetingId);

  pinsRef.on('child_added', (snapshot) => {
    const pinId = snapshot.key;
    const pin = snapshot.val();
    if (!pin || !pin.createdBy) return; // createdBy がないデータは無視
    console.log('Pin added (child_added):', pinId, pin);
    renderPin(pinId, pin);
  }, (error) => {
    console.error('Error listening for child_added:', error);
    showMessage('エラー: ピンの受信に失敗しました。', true); // 日本語修正
  });

  pinsRef.on('child_removed', (snapshot) => {
    const pinId = snapshot.key;
    console.log('Pin removed (child_removed):', pinId);
    const pinElement = document.getElementById(`pin-${pinId}`);
    if (pinElement) {
       pinElement.classList.remove('show');
       pinElement.classList.add('hide');
       setTimeout(() => {
           pinElement.remove();
           console.log('DOMからピン要素を削除:', pinId); // 日本語修正
       }, 300);
      if (userPins[pinId]) {
        delete userPins[pinId];
      }
    }
  }, (error) => {
    console.error('Error listening for child_removed:', error);
  });
}

// --- 表示関連 ---

function renderPin(pinId, pin) {
  const pinsArea = document.getElementById('pins-area');
  if (!pinsArea) {
    console.error("renderPin: #pins-area not found.");
    return;
  }
  const existingPin = document.getElementById(`pin-${pinId}`);
  if (existingPin) {
    existingPin.remove();
  }

  const pingInfo = PING_DEFINITIONS[pin.type] || { icon: '❓', label: '不明' }; // 日本語修正
  const pinElement = document.createElement('div');
  pinElement.id = `pin-${pinId}`;
  pinElement.className = 'pin';
  if (currentUser && pin.createdBy.uid === currentUser.uid) {
      pinElement.classList.add('my-pin');
  }
  pinElement.dataset.createdBy = pin.createdBy.uid;

  const iconDiv = document.createElement('div');
  iconDiv.className = 'pin-icon';
  iconDiv.textContent = pingInfo.icon;
  pinElement.appendChild(iconDiv);

  const detailsDiv = document.createElement('div');
  detailsDiv.className = 'pin-details';

  const labelDiv = document.createElement('div');
  labelDiv.className = 'pin-label';
  labelDiv.textContent = pingInfo.label; // 日本語ラベル
  detailsDiv.appendChild(labelDiv);

  const userDiv = document.createElement('div');
  userDiv.className = 'pin-user';
  userDiv.textContent = pin.createdBy.displayName || '不明なユーザー'; // 日本語修正
  detailsDiv.appendChild(userDiv);

  pinElement.appendChild(detailsDiv);

  if (currentUser && pin.createdBy.uid === currentUser.uid) {
    pinElement.title = 'クリックして削除'; // 日本語修正
    pinElement.addEventListener('click', () => removePinFromDb(pinId));
  }

  pinsArea.appendChild(pinElement);
  setTimeout(() => {
    pinElement.classList.add('show');
  }, 10);

  // 自動削除タイマー (expiresAt があればそれを使う)
  const expiresAt = pin.expiresAt || (pin.createdAt + 30000); // createdAtを使用
  const timeoutDuration = Math.max(0, expiresAt - Date.now());
  setTimeout(() => {
      if (pinElement.parentNode) {
          pinElement.classList.remove('show');
          pinElement.classList.add('hide');
          setTimeout(() => pinElement.remove(), 300);
      }
  }, timeoutDuration);
}

let messageTimeout;
function showMessage(text, isError = false) {
  const messageArea = document.getElementById('lol-ping-message') || createMessageArea();
  clearTimeout(messageTimeout);
  messageArea.textContent = text;
  messageArea.style.backgroundColor = isError ? 'rgba(244, 67, 54, 0.9)' : 'rgba(76, 175, 80, 0.9)';
  messageArea.classList.add('show');
  messageTimeout = setTimeout(() => {
    messageArea.classList.remove('show');
  }, 3000);
}

function createMessageArea() {
    let area = document.getElementById('lol-ping-message');
    if (!area) {
        area = document.createElement('div');
        area.id = 'lol-ping-message';
        document.body.appendChild(area);
    }
    return area;
}

// --- 初期化トリガー ---
let lastUrl = location.href;
const observer = new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    console.log(`URL changed from ${lastUrl} to ${url}`);
    lastUrl = url;
    detectMeetingId(); // URL変更時に再検出
  }
});

function startObserver() {
    observer.disconnect();
    const bodyReady = document.body ? Promise.resolve() : new Promise(resolve => {
        const obs = new MutationObserver(() => {
            if (document.body) {
                obs.disconnect();
                resolve();
            }
        });
        obs.observe(document.documentElement, { childList: true });
    });

    bodyReady.then(() => {
        observer.observe(document.body, { subtree: true, childList: true });
        console.log("DOM observer started.");
        detectMeetingId(); // 初回検出
    });
}

initializeFirebase();
startObserver();

console.log('Meet LoL-Style Ping content script loaded.'); // 日本語修正