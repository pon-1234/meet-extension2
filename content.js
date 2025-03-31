// content.js

// --- グローバル変数 ---
let currentUser = null;
let currentMeetingId = null;
// database, auth, pinsRef は content.js では不要になる
let userPins = {};

// ピンの種類定義
const PING_DEFINITIONS = {
    danger: { icon: '⚠️', label: '危険' },
    onMyWay: { icon: '➡️', label: '向かっている' },
    question: { icon: '❓', label: '質問' },
    assist: { icon: '🆘', label: '助けて' }
};

// メニューの配置計算用
const PING_MENU_POSITIONS = {
    danger: { angle: -90, distance: 70 },  // 上
    onMyWay: { angle: 0, distance: 70 },   // 右
    question: { angle: 90, distance: 70 },  // 下
    assist: { angle: 180, distance: 70 }   // 左
};

// --- 初期化/認証関連 ---
function initializeContentScript() {
  try {
    console.log('Content script: 初期化中...');
    // Backgroundに認証状態を問い合わせる
    requestAuthStatusFromBackground();
    // Meeting IDを検出 (URL監視も含む)
    startObserver(); // DOM監視と初回検出を開始
  } catch (error) {
    console.error('Content script 初期化処理エラー:', error);
    showMessage('エラー: 初期化中に問題が発生しました。', true);
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
            // ★★★ startPingSystem を呼び出す ★★★
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


// Background Scriptからのメッセージ受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Content script: Received message:", message);
  switch (message.action) {
    case 'authStatusChanged':
      handleAuthResponse(message); // 認証状態の変更を処理
      sendResponse({ received: true });
      break;
    // ★★★ Backgroundからピン追加通知 ★★★
    case 'pinAdded':
      if (message.data && message.data.pinId && message.data.pin) {
        console.log("BackgroundからpinAddedを受信:", message.data.pinId);
        renderPin(message.data.pinId, message.data.pin); // DOMに描画
      } else {
        console.warn("無効なpinAddedデータを受信:", message.data);
      }
      sendResponse({ received: true });
      break;
    // ★★★ Backgroundからピン削除通知 ★★★
    case 'pinRemoved':
      if (message.data && message.data.pinId) {
        console.log("BackgroundからpinRemovedを受信:", message.data.pinId);
        const pinElement = document.getElementById(`pin-${message.data.pinId}`);
        if (pinElement) {
           // アニメーション付きで削除
           pinElement.classList.remove('show');
           pinElement.classList.add('hide');
           setTimeout(() => {
               pinElement.remove();
               console.log('DOMからピン要素を削除:', message.data.pinId);
           }, 300);
        }
      } else {
           console.warn("無効なpinRemovedデータを受信:", message.data);
      }
      sendResponse({ received: true });
      break;
     // ★★★ Backgroundから権限エラー通知 ★★★
     case 'permissionError':
        showMessage("エラー: データベースへのアクセス権限がありません。管理者に確認してください。", true);
        sendResponse({ received: true });
        break;
    default:
      // 知らないアクションは無視
      sendResponse({ received: false, message: "Unknown action" });
      break;
  }
  // 非同期応答を示すために true を返す
   return true;
});

// --- Meet関連処理 ---
function detectMeetingId() {
  const url = window.location.href;
  const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
  const match = url.match(meetRegex);
  const newMeetingId = match ? match[1] : null;

  if (newMeetingId !== currentMeetingId) {
    console.log(`Meeting IDが ${currentMeetingId} から ${newMeetingId} に変更されました`);
    cleanupUI(); // UIをクリア
    currentMeetingId = newMeetingId;
    if (currentMeetingId) {
        // BackgroundにMeetページがロードされたことを通知
        chrome.runtime.sendMessage({ action: 'meetPageLoaded' })
            .catch(e => console.error("meetPageLoadedメッセージ送信エラー:", e));
        // ユーザーが既にログイン済みならUI表示
        if (currentUser) {
            console.log("New meeting detected, user already logged in. Starting ping system.");
            // ★★★ startPingSystem を呼び出す ★★★
            startPingSystem();
        } else {
             console.log("新しいミーティングを検出、ユーザーはログインしていません。認証状態を確認中。");
        }
    } else {
         console.log("Meetを退出したか、無効なURLです。");
    }
  } else {
       console.log("Meeting IDチェック: 重要な変更は検出されません。");
       // 同じページでリロードされた場合など、UIが存在しないか確認
       if (currentMeetingId && currentUser && !document.getElementById('lol-ping-container')) {
           console.log("Same meeting ID, UI missing. Setting up UI.");
           // ★★★ startPingSystem を呼び出す ★★★
           startPingSystem(); // UI がない場合もここで再生成を試みる
           chrome.runtime.sendMessage({ action: 'meetPageLoaded' })
               .catch(e => console.error("meetPageLoadedメッセージ送信エラー:", e));
       }
  }
}

// --- ピンシステム初期化・開始 (★この関数を元に戻す★) ---
function startPingSystem() {
  if (!currentUser) {
    console.error('startPingSystem: ユーザーが認証されていません。');
    return;
  }
  if (!currentMeetingId) {
    console.error('startPingSystem: ミーティングIDが見つかりません。');
    return;
  }
  console.log("startPingSystem: UIとリスナーを設定します for meeting:", currentMeetingId);

  setupUI(); // UI作成/確認

  // ★★★ setupPinsListener の呼び出しは削除 ★★★
  // setupPinsListener(); // リスナー設定は Background が担当

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
    // ★★★ クリック時に Background にメッセージ送信 ★★★
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      // createPin(key); // ← この行は削除！
      console.log(`Ping option ${key} clicked. Sending message to background...`); // ★ログ変更
      chrome.runtime.sendMessage({
          action: 'createPing',
          meetingId: currentMeetingId,
          pingType: key
      }, (response) => {
          if (chrome.runtime.lastError) {
              console.error("Error sending createPing message:", chrome.runtime.lastError.message);
              showMessage("エラー: ピンの作成依頼に失敗しました。", true); // メッセージ修正
          } else if (response && response.success) {
              console.log("Ping creation requested successfully, pinId:", response.pinId);
              showMessage(`ピン「${pingInfo.label}」を作成しました`);
          } else {
              console.error("Failed to create pin (response from background):", response?.error, "Code:", response?.code);
              showMessage(`エラー: ピンを作成できませんでした (${response?.error || '不明なエラー'})`, true);
          }
      });
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
  console.log("cleanupUI: UIを削除しようとしています...");
  // ★★★ Firebaseリスナーは Background で管理するのでここでは解除不要 ★★★
  // Backgroundにクリーンアップを通知
  if (currentMeetingId) {
      chrome.runtime.sendMessage({ action: 'cleanupPins', meetingId: currentMeetingId })
          .catch(e => console.error("cleanupPinsメッセージ送信エラー:", e));
  }
  
  document.removeEventListener('click', handleDocumentClickForMenu);

  const container = document.getElementById('lol-ping-container');
  if (container) {
    container.remove();
    console.log('ピンUIコンテナが削除されました');
  } else {
    console.log("cleanupUI: UIコンテナが見つかりません。");
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


// --- ピン表示関連の関数 ---

// --- 表示関連 ---

function renderPin(pinId, pin) {
  console.log(`ピンをレンダリング: ${pinId}`, pin);
  const pinsArea = document.getElementById('pins-area');
  if (!pinsArea) {
    console.error("renderPin: #pins-areaが見つかりません");
    return;
  }
  const existingPin = document.getElementById(`pin-${pinId}`);
  if (existingPin) {
    existingPin.remove();
  }

  const pingInfo = PING_DEFINITIONS[pin.type] || { icon: '❓', label: '不明' };
  const pinElement = document.createElement('div');
  pinElement.id = `pin-${pinId}`;
  pinElement.className = 'pin';
  if (currentUser && pin.createdBy && pin.createdBy.uid === currentUser.uid) {
      pinElement.classList.add('my-pin');
  }
  
  if (pin.createdBy) {
    pinElement.dataset.createdBy = pin.createdBy.uid;
  }

  const iconDiv = document.createElement('div');
  iconDiv.className = 'pin-icon';
  iconDiv.textContent = pingInfo.icon;
  pinElement.appendChild(iconDiv);

  const detailsDiv = document.createElement('div');
  detailsDiv.className = 'pin-details';

  const labelDiv = document.createElement('div');
  labelDiv.className = 'pin-label';
  labelDiv.textContent = pingInfo.label;
  detailsDiv.appendChild(labelDiv);

  const userDiv = document.createElement('div');
  userDiv.className = 'pin-user';
  userDiv.textContent = pin.createdBy?.displayName || '不明なユーザー';
  detailsDiv.appendChild(userDiv);

  pinElement.appendChild(detailsDiv);

  if (currentUser && pin.createdBy && pin.createdBy.uid === currentUser.uid) {
    pinElement.title = 'クリックして削除';
    // Backgroundにピン削除リクエストを送信
    pinElement.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        action: 'removePing',
        meetingId: currentMeetingId,
        pinId: pinId
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("removePingメッセージ送信エラー:", chrome.runtime.lastError.message);
          showMessage('エラー: ピンの削除に失敗しました。', true);
        } else if (response && response.success) {
          console.log("ピン削除リクエストが成功しました");
          // バックグラウンドからの通知を待たずにアニメーションを開始
          pinElement.classList.remove('show');
          pinElement.classList.add('hide');
          setTimeout(() => {
            pinElement.remove();
          }, 300);
        } else {
          console.error("ピンの削除に失敗しました:", response?.error);
          showMessage(`エラー: ピンを削除できませんでした (${response?.error || '不明なエラー'})`, true);
        }
      });
    });
  }

  console.log("Pin element created, attempting to append:", pinElement); // ★ログ追加8
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

// Firebaseの初期化は Background Script で行うため、ここでは呼び出さない
startObserver();

console.log('Meet LoL-Style Ping content script loaded.'); // 日本語修正