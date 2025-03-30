// content.js

// --- グローバル変数 --- (変更なし)
let currentUser = null;
let currentMeetingId = null;
let database = null;
let auth = null;
let pinsRef = null; // Firebaseリスナーの参照を保持
let userPins = {};

// --- Firebase 初期化/認証関連 --- (変更なし)
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

function requestAuthStatusFromBackground() {
  chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Error sending message to background:", chrome.runtime.lastError.message);
      // リトライやエラー表示など
      return;
    }
    handleAuthResponse(response); // 応答を処理する関数を呼び出す
  });
}

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'authStatusChanged') {
    console.log('Auth status changed notification received:', message.user);
    // UIの状態も認証状態に合わせて更新
    handleAuthResponse(message);
    // もしUIがない状態でログインした場合、UIを作るトリガーに
    if (message.user && !document.getElementById('lol-ping-container') && currentMeetingId) {
      console.log('User logged in and UI not found, setting up UI.');
      setupUI();
      setupPinsListener(); // UIとリスナーはセットで
    } else if (!message.user) {
      cleanupUI(); // ログアウトしたらUI削除
    }
    sendResponse({ received: true });
    return true;
  }
  // ... 他のアクション ...
});

// --- Meet関連処理 ---
function detectMeetingId() {
  const url = window.location.href;
  const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
  const match = url.match(meetRegex);

  const newMeetingId = match ? match[1] : null;

  // Meeting IDが変更されたか、Meetページでなくなったか
  if (newMeetingId !== currentMeetingId) {
    console.log(`Meeting ID changed from ${currentMeetingId} to ${newMeetingId}`);

    // 以前のUIとリスナーをクリーンアップ
    cleanupUI();

    currentMeetingId = newMeetingId;

    if (currentMeetingId) {
      // 新しいMeetページの場合、認証済みならシステム開始
      if (currentUser) {
        console.log("New meeting detected, user is logged in. Starting ping system.");
        startPingSystem();
      } else {
        console.log("New meeting detected, user is not logged in. Requesting auth status.");
        requestAuthStatusFromBackground(); // 認証状態を確認
      }
    } else {
      console.log("Not on a Meet page or ID not found.");
      // Meetページでなくなったので何もしない (cleanupUIは既に呼ばれた)
    }
  } else if (currentMeetingId && currentUser && !document.getElementById('lol-ping-container')) {
    // 同じMeetページだがUIがない場合 (リロード後など)
    console.log("Same meeting ID, but UI not found. Setting up UI.");
    setupUI();
    setupPinsListener();
  } else {
    console.log("Meeting ID has not changed.");
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
    return;
  }

  console.log("startPingSystem: Initializing for meeting:", currentMeetingId);

  // UI作成とリスナー設定を呼び出す
  setupUI(); // setupUI内で存在チェックを行う
  setupPinsListener(); // setupPinsListener内でリスナーの重複設定を防ぐ

  showMessage(`ピンシステム起動 (${currentUser.displayName || currentUser.email.split('@')[0]})`);
}

// --- UI関連 ---

// UI要素を追加
function setupUI() {
  // ★★★ 超重要: 既に存在する場合は何もしない ★★★
  if (document.getElementById('lol-ping-container')) {
    console.warn("setupUI: UI container already exists. Aborting setup.");
    return;
  }
  if (!currentUser) {
    console.warn("setupUI: No logged in user. Aborting setup.");
    return;
  }
  if (!currentMeetingId) {
    console.warn("setupUI: No meeting ID. Aborting setup.");
    return;
  }

  console.log("setupUI: Creating UI elements...");

  // コンテナの作成
  const container = document.createElement('div');
  container.id = 'lol-ping-container';

  // --- ボタンやメニュー要素の作成 (ここは変更なし) ---
  const pingButton = document.createElement('button');
  pingButton.id = 'ping-menu-button'; // IDを styles.css に合わせる
  pingButton.innerHTML = '<span>!</span>';
  pingButton.title = 'ピンメニューを開く';
  pingButton.addEventListener('click', togglePingMenu);

  const pingMenu = document.createElement('div');
  pingMenu.id = 'ping-menu';
  pingMenu.classList.add('hidden');

  const pingCenter = document.createElement('div');
  pingCenter.id = 'ping-center';
  pingCenter.textContent = 'PING';
  pingMenu.appendChild(pingCenter);

  // ピンの種類定義 (例) - グローバルスコープに移動しても良い
  const PING_DEFINITIONS = {
    danger: { icon: '⚠️', label: '危険' },
    onMyWay: { icon: '➡️', label: '向かっている' },
    question: { icon: '❓', label: '質問' },
    assist: { icon: '🆘', label: '助けて' }
  };
  const pingTypes = Object.keys(PING_DEFINITIONS).map(key => ({
    id: key,
    icon: PING_DEFINITIONS[key].icon,
    label: PING_DEFINITIONS[key].label,
  }));
  const positions = {
    danger: { top: '-70px', left: '0' },
    onMyWay: { top: '0', left: '70px' },
    question: { top: '70px', left: '0' },
    assist: { top: '0', left: '-70px' },
  };

  pingTypes.forEach(pingType => {
    const pingOption = document.createElement('div');
    pingOption.className = 'ping-option';
    pingOption.dataset.type = pingType.id;
    pingOption.innerHTML = `
      <div class="ping-icon">${pingType.icon}</div>
      <div class="ping-label">${pingType.label}</div>
    `;
    const pos = positions[pingType.id];
    if (pos) {
      pingOption.style.top = `calc(50% + ${pos.top} - 24px)`;
      pingOption.style.left = `calc(50% + ${pos.left} - 24px)`;
    }
    pingOption.addEventListener('click', (event) => {
      event.stopPropagation();
      createPin(pingType.id);
      pingMenu.classList.add('hidden'); // メニューを閉じる
    });
    pingMenu.appendChild(pingOption);
  });

  const pinsArea = document.createElement('div');
  pinsArea.id = 'pins-area';

  // 要素の追加
  container.appendChild(pingButton);
  container.appendChild(pingMenu);
  container.appendChild(pinsArea);

  // body に追加
  document.body.appendChild(container);

  // メニュー外クリックで閉じるイベントリスナー
  document.removeEventListener('click', handleDocumentClickForMenu); // 念のため削除
  document.addEventListener('click', handleDocumentClickForMenu);

  console.log('ピンUIが body に追加されました');
}

// UI要素を削除
function cleanupUI() {
  console.log("cleanupUI: Attempting to remove UI...");

  // ★★★ Firebaseリスナーをデタッチ ★★★
  if (pinsRef) {
    pinsRef.off(); // リスナーを解除
    pinsRef = null; // 参照をクリア
    console.log("Detached Firebase pins listener during cleanup.");
  }

  // ★★★ イベントリスナー削除 ★★★
  document.removeEventListener('click', handleDocumentClickForMenu);

  // UI要素の削除
  const container = document.getElementById('lol-ping-container');
  if (container) {
    container.remove();
    console.log('ピンUIコンテナが削除されました');
  } else {
    console.log("cleanupUI: UI container not found.");
  }

  // ログインプロンプトも削除
  const loginPrompt = document.getElementById('ping-login-prompt');
  if (loginPrompt) {
    loginPrompt.remove();
    console.log('Login prompt removed.');
  }
}

// メニュー外クリックで閉じるハンドラ
function handleDocumentClickForMenu(event) {
  const pingMenu = document.getElementById('ping-menu');
  const pingButton = document.getElementById('ping-menu-button');
  if (pingMenu && !pingMenu.contains(event.target) && event.target !== pingButton) {
    pingMenu.classList.add('hidden');
  }
}

// ピンメニューの表示切替関数
function togglePingMenu(event) {
  event.stopPropagation();
  const pingMenu = document.getElementById('ping-menu');
  if (pingMenu) {
    pingMenu.classList.toggle('hidden');
  }
}

// ログインプロンプト表示
function showLoginPrompt() {
  // 既存のプロンプトがあれば削除
  const existingPrompt = document.getElementById('ping-login-prompt');
  if (existingPrompt) {
    existingPrompt.remove();
  }

  const prompt = document.createElement('div');
  prompt.id = 'ping-login-prompt';
  prompt.innerHTML = `
    <div class="ping-login-content">
      <h3>ピン機能へのログイン</h3>
      <p>ピン機能を使用するには、ログインが必要です。</p>
      <button id="ping-login-button">ログイン</button>
    </div>
  `;

  document.body.appendChild(prompt);

  // ログインボタンのイベントリスナー
  document.getElementById('ping-login-button').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'requestLogin' }, (response) => {
      if (response && response.started) {
        prompt.remove();
      }
    });
  });
}


// --- Firebase Realtime Database 操作 ---
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

// ピンの変更をリッスン
function setupPinsListener() {
  if (!currentUser || !currentMeetingId) {
    console.log("setupPinsListener: Skipping, no user or meeting ID.");
    return;
  }

  // データベースインスタンスを取得
  const db = getDatabase();
  if (!db) {
    console.error("setupPinsListener: Database not available.");
    return;
  }

  const newPinsRef = db.ref(`meetings/${currentMeetingId}/pins`);

  // 既に同じRefでリスナーが設定されているかチェック (厳密には難しいが、試みる)
  // 簡単な方法は、古い参照があればoffにして新しい参照でonにすること
  if (pinsRef) {
    console.log("setupPinsListener: Detaching previous listener.");
    pinsRef.off();
  }

  pinsRef = newPinsRef; // 現在の参照を保持
  console.log("Setting up new pins listener for:", currentMeetingId);

  // child_added リスナー
  pinsRef.on('child_added', (snapshot) => {
    const pinId = snapshot.key;
    const pin = snapshot.val();
    if (!pin) return; // データがない場合は無視
    console.log('Pin added (child_added):', pinId, pin);
    renderPin(pinId, pin);
  }, (error) => {
    console.error('Error listening for child_added:', error);
    showMessage('エラー: ピンの受信に失敗しました。');
  });

  // child_removed リスナー
  pinsRef.on('child_removed', (snapshot) => {
    const pinId = snapshot.key;
    console.log('Pin removed (child_removed):', pinId);
    const pinElement = document.getElementById(`pin-${pinId}`);
    if (pinElement) {
      // アニメーション付きで削除する場合
      pinElement.classList.remove('show');
      pinElement.classList.add('hide');
      setTimeout(() => {
        pinElement.remove();
        console.log('DOMからピン要素を削除:', pinId);
      }, 300); // アニメーション時間

      if (userPins[pinId]) {
        delete userPins[pinId];
      }
    }
  }, (error) => {
    console.error('Error listening for child_removed:', error);
  });
}

// ピンを表示
function renderPin(pinId, pin) {
  const pinsArea = document.getElementById('pins-area');
  if (!pinsArea) return; // UI未作成の場合は何もしない

  // 古いピンがあれば削除 (再描画の場合)
  const existingPin = document.getElementById(`pin-${pinId}`);
  if (existingPin) {
    existingPin.remove();
  }

  // ピンの種類に応じた絵文字
  let emoji = '⚠️'; // デフォルトは警告
  switch (pin.type) {
    case 'danger': emoji = '⚠️'; break;
    case 'onMyWay': emoji = '➡️'; break;
    case 'question': emoji = '❓'; break;
    case 'assist': emoji = '🆘'; break;
  }

  // ピン要素の作成
  const pinElement = document.createElement('div');
  pinElement.id = `pin-${pinId}`;
  pinElement.className = `pin ${pin.type}`;
  pinElement.innerHTML = `
    <div class="pin-emoji">${emoji}</div>
    <div class="pin-info">
      <div class="pin-user">${pin.createdBy.displayName || pin.createdBy.email.split('@')[0]}</div>
    </div>
  `;

  // 自分のピンならクリックで削除可能に
  if (currentUser && pin.createdBy.uid === currentUser.uid) {
    pinElement.classList.add('own-pin');
    pinElement.title = 'クリックして削除';
    pinElement.addEventListener('click', () => {
      if (pinsRef) {
        pinsRef.child(pinId).remove()
          .then(() => console.log('ピンが手動で削除されました:', pinId))
          .catch(error => console.error('ピンの削除エラー:', error));
      }
    });
  }

  // 表示
  pinsArea.appendChild(pinElement);

  // アニメーション用にタイムアウトを設定
  setTimeout(() => {
    pinElement.classList.add('show');
  }, 10);
}

// メッセージを表示
function showMessage(text, duration = 3000) {
  let messageArea = document.getElementById('ping-message-area');
  if (!messageArea) {
    messageArea = createMessageArea();
  }

  const message = document.createElement('div');
  message.className = 'ping-message';
  message.textContent = text;
  messageArea.appendChild(message);

  // アニメーション表示
  setTimeout(() => message.classList.add('show'), 10);

  // 一定時間後に削除
  setTimeout(() => {
    message.classList.remove('show');
    setTimeout(() => message.remove(), 300); // フェードアウト後に削除
  }, duration);
}

// メッセージエリアを作成
function createMessageArea() {
  const area = document.createElement('div');
  area.id = 'ping-message-area';
  document.body.appendChild(area);
  return area;
}

// --- 初期化トリガー ---
let lastUrl = location.href;
const observer = new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    console.log(`URL changed from ${lastUrl} to ${url}`);
    lastUrl = url;
    // URLが変わったらMeeting IDを再検出 → UI/リスナーのリセットもここで行う
    detectMeetingId();
  }
});

// DOMの変更監視を開始する関数
function startObserver() {
  // 既に監視中かもしれないので、念のため停止
  observer.disconnect();
  // body要素の準備を待つ (Meetのロードが遅い場合があるため)
  const bodyReady = document.body ? Promise.resolve() : new Promise(resolve => {
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.documentElement, { childList: true });
  });

  bodyReady.then(() => {
    observer.observe(document.body, { subtree: true, childList: true });
    console.log("DOM observer started.");
    // 初回のMeeting ID検出
    detectMeetingId();
  });
}

// 初期化処理
initializeFirebase(); // Firebase設定読み込みと認証状態確認開始
startObserver();    // DOM監視開始

console.log('Meet LoL-Style Ping content script loaded.');
