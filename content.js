// content.js

// --- グローバル変数 ---
let currentUser = null;
let currentMeetingId = null;
let userPins = {}; // { pinId: { element: ... } } ピン要素の管理用
let currentUrl = location.href; // 現在のURLを保持

// ピンの種類定義
const PING_DEFINITIONS = {
    danger: { icon: chrome.runtime.getURL('icons/danger.png'), label: '撤退' },
    onMyWay: { icon: chrome.runtime.getURL('icons/onMyWay.png'), label: '話します' },
    question: { icon: chrome.runtime.getURL('icons/question.png'), label: '疑問' },
    assist: { icon: chrome.runtime.getURL('icons/assist.png'), label: '助けて' }
};

// メニューの配置計算用
const PING_MENU_POSITIONS = {
    danger: { angle: -90, distance: 70 },  // 上
    onMyWay: { angle: 0, distance: 70 },   // 右
    question: { angle: 90, distance: 70 },  // 下
    assist: { angle: 180, distance: 70 }   // 左
};

// --- 初期化関連 ---
function initializeContentScript() {
  console.log('Content script: 初期化中 for URL:', currentUrl);
  // Backgroundに認証状態を問い合わせる
  requestAuthStatusFromBackground();
  // 初回ロード時のMeeting ID検出とUI初期化
  handleUrlUpdate(currentUrl); // URL更新ハンドラを初回も呼ぶ
}

function requestAuthStatusFromBackground() {
  chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (response) => {
    if (chrome.runtime.lastError) {
      if (chrome.runtime.lastError.message?.includes('Extension context invalidated')) {
         console.warn("CS: Context invalidated before receiving initial auth status.");
      } else {
         console.error("CS: Error sending getAuthStatus message:", chrome.runtime.lastError.message);
      }
      handleAuthResponse(null);
      return;
    }
    handleAuthResponse(response);
  });
}

// 認証状態の応答を処理
function handleAuthResponse(response) {
    const user = response?.user;
    console.log('CS: Handling auth response. User:', user ? user.email : 'null');
    const previousUser = currentUser;
    currentUser = user;

    // ユーザー状態が変わったか、UIが存在しない場合にUI等を更新
    const uiExists = !!document.getElementById('ping-container');
    if (JSON.stringify(previousUser) !== JSON.stringify(currentUser) || !uiExists) {
        handleUrlUpdate(currentUrl); // URLに基づいてUIを再評価・更新
    }
}

// Background Scriptからのメッセージ受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (chrome.runtime.lastError) {
      // console.warn("CS: onMessage listener invoked after context invalidated:", chrome.runtime.lastError.message);
      return; // コンテキスト無効時は何もしない
  }
  // console.log("CS: Received message:", message.action);

  switch (message.action) {
    case 'authStatusChanged':
      handleAuthResponse(message);
      sendResponse({ received: true });
      break;
    case 'pinAdded':
      if (message.data?.pinId && message.data?.pin) {
        renderPin(message.data.pinId, message.data.pin);
      } else { console.warn("CS: Invalid pinAdded data:", message.data); }
      sendResponse({ received: true });
      break;
    case 'pinRemoved':
      if (message.data?.pinId) {
        removePinElement(message.data.pinId);
      } else { console.warn("CS: Invalid pinRemoved data:", message.data); }
      sendResponse({ received: true });
      break;
    case 'permissionError':
       showMessage("エラー: DBアクセス権限がありません。", true);
       sendResponse({ received: true });
       break;
    case 'urlUpdated': // ★★★ URL更新メッセージの処理 ★★★
       // console.log('CS: Received urlUpdated message:', message.url);
       if (message.url && message.url !== currentUrl) {
           currentUrl = message.url; // Content Script内のURLも更新
           handleUrlUpdate(currentUrl);
       } else if (message.url === currentUrl && !document.getElementById('ping-container')) {
           // 同じURLだがUIがない場合（リロードなど）もUI更新を試みる
           handleUrlUpdate(currentUrl);
       }
       sendResponse({ received: true });
       break;
    default:
      // console.warn("CS: Received unknown action:", message.action);
      sendResponse({ received: false, message: "Unknown action" });
      break;
  }
   return true; // 非同期応答の可能性のため true を返す
});

// URL更新時の処理
function handleUrlUpdate(url) {
    console.log('CS: Handling URL update:', url);
    const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
    const match = url ? url.match(meetRegex) : null;
    const newMeetingId = match ? match[1] : null;

    console.log(`CS: Current Meeting ID: ${currentMeetingId}, New Meeting ID: ${newMeetingId}`);

    // Meeting ID が変更された場合
    if (newMeetingId !== currentMeetingId) {
        console.log(`CS: Meeting ID changed from ${currentMeetingId} to ${newMeetingId}`);
        cleanupUI(); // 古いUIを削除
        currentMeetingId = newMeetingId;
    }

    // UI表示/非表示のロジック
    if (currentMeetingId && currentUser) {
        // Meetページ内でログイン済み -> UI表示/更新
        // console.log('CS: Starting ping system for meeting:', currentMeetingId);
        startPingSystem(); // UI表示、メッセージ表示
        const loginPrompt = document.getElementById('ping-login-prompt');
        if (loginPrompt) loginPrompt.remove(); // ログインプロンプト削除
    } else if (currentMeetingId && !currentUser) {
        // Meetページ内だが未ログイン -> UI削除、ログインプロンプト表示
        console.log('CS: User not logged in for meeting:', currentMeetingId);
        cleanupUI();
        showLoginPrompt();
    } else {
        // Meetページ以外 -> UI削除
        // console.log('CS: Not on a valid Meet page or no meeting ID.');
        cleanupUI();
        currentMeetingId = null; // Meeting IDもクリア
    }
}

// --- ピンシステム初期化・開始 ---
function startPingSystem() {
  if (!currentUser) { console.error('CS: startPingSystem: User not authenticated.'); return; }
  if (!currentMeetingId) { console.error('CS: startPingSystem: Meeting ID not found.'); return; }

  // UIがなければセットアップ
  if (!document.getElementById('ping-container')) {
     setupUI();
  }

  showMessage(`ピンシステム起動 (${currentUser.displayName || currentUser.email.split('@')[0]})`);
}

// --- UI関連 ---
function setupUI() {
  if (document.getElementById('ping-container')) { return; } // 既に存在すれば何もしない
  console.log("CS: setupUI: Creating UI elements...");

  const container = document.createElement('div');
  container.id = 'ping-container';

  // --- ピンメニューボタン ---
  const pingButton = document.createElement('button');
  pingButton.id = 'ping-menu-button';
  pingButton.innerHTML = '<span>!</span>';
  pingButton.title = 'ピンメニューを開く';
  pingButton.addEventListener('click', togglePingMenu);
  container.appendChild(pingButton);

  // --- ピンメニュー ---
  const pingMenu = document.createElement('div');
  pingMenu.id = 'ping-menu';
  pingMenu.classList.add('hidden');

  const pingCenter = document.createElement('div');
  pingCenter.id = 'ping-center';
  const centerIcon = document.createElement('img');
  centerIcon.src = chrome.runtime.getURL('icons/center-pin.png');
  centerIcon.alt = 'PING';
  centerIcon.width = 32; centerIcon.height = 32;
  pingCenter.appendChild(centerIcon);
  pingMenu.appendChild(pingCenter);

  Object.keys(PING_DEFINITIONS).forEach(key => {
    const pingInfo = PING_DEFINITIONS[key];
    const posInfo = PING_MENU_POSITIONS[key];
    const option = document.createElement('div');
    option.className = 'ping-option';
    option.dataset.type = key;
    option.title = pingInfo.label;

    const iconDiv = document.createElement('div');
    iconDiv.className = 'ping-icon';
    const iconImg = document.createElement('img');
    iconImg.src = pingInfo.icon;
    iconImg.alt = pingInfo.label;
    iconImg.width = 24; iconImg.height = 24;
    iconDiv.appendChild(iconImg);
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
      // console.log(`CS: Ping option ${key} clicked.`);
      pingMenu.classList.add('hidden'); // 先に隠す

      chrome.runtime.sendMessage({
          action: 'createPing',
          meetingId: currentMeetingId,
          pingType: key
      }, (response) => {
          if (chrome.runtime.lastError) {
              if (chrome.runtime.lastError.message?.includes('Extension context invalidated')) {
                  console.warn("CS: Context invalidated before receiving response for createPing.");
              } else {
                  console.error("CS: Error sending createPing message:", chrome.runtime.lastError.message);
                  showMessage("エラー: ピンの作成依頼に失敗しました。", true);
              }
              return;
          }
          if (response?.success) {
              // console.log("CS: Ping creation requested successfully, pinId:", response.pinId);
              showMessage(`ピン「${pingInfo.label}」を作成しました`);
          } else {
              console.error("CS: Failed to create pin:", response?.error, "Code:", response?.code);
              showMessage(`エラー: ピンを作成できませんでした (${response?.error || '不明なエラー'})`, true);
          }
      });
    });
    pingMenu.appendChild(option);
  });
  container.appendChild(pingMenu);

  // --- ピン表示エリア ---
  const pinsArea = document.createElement('div');
  pinsArea.id = 'pins-area';
  container.appendChild(pinsArea);

  // body が存在することを確認してから追加
  if (document.body) {
    document.body.appendChild(container);
    document.removeEventListener('click', handleDocumentClickForMenu); // 重複登録防止
    document.addEventListener('click', handleDocumentClickForMenu);
    console.log('CS: ピンUIが body に追加されました');
  } else {
    console.error("CS: setupUI: document.body not found.");
  }
}

function cleanupUI() {
  // console.log("CS: cleanupUI: Removing UI elements...");
  document.removeEventListener('click', handleDocumentClickForMenu);
  const container = document.getElementById('ping-container');
  if (container) container.remove();
  const loginPrompt = document.getElementById('ping-login-prompt');
  if (loginPrompt) loginPrompt.remove();
  const messageArea = document.getElementById('ping-message');
  if (messageArea) messageArea.remove();
  // ピン管理情報をクリア (タイマーはなくなった)
  userPins = {};
}

function handleDocumentClickForMenu(event) {
    const menu = document.getElementById('ping-menu');
    const button = document.getElementById('ping-menu-button');
    if (menu && !menu.classList.contains('hidden')) {
        if (!menu.contains(event.target) && (!button || !button.contains(event.target))) {
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
  if (document.getElementById('ping-login-prompt')) return; // 既に表示済み
  if (!window.location.href.includes("meet.google.com/")) return; // Meetページ以外は表示しない
  if (!document.body) return; // body がなければ表示できない

  console.log("CS: Showing login prompt.");
  const prompt = document.createElement('div');
  prompt.id = 'ping-login-prompt';
  prompt.innerHTML = `ピン機能を使うにはログインが必要です。<button id="ping-login-button">ログイン</button>`;
  document.body.appendChild(prompt); // 先に追加しないとボタンが取得できない

  const loginButton = document.getElementById('ping-login-button');
  if (loginButton) {
      loginButton.onclick = (e) => {
          e.stopPropagation();
          loginButton.disabled = true;
          loginButton.textContent = '処理中...';
          chrome.runtime.sendMessage({ action: 'requestLogin' }, (response) => {
              if (chrome.runtime.lastError) {
                  if (chrome.runtime.lastError.message?.includes('Extension context invalidated')) {
                       console.warn("CS: Context invalidated before receiving response for requestLogin.");
                  } else {
                      console.error("CS: Login request error:", chrome.runtime.lastError.message);
                      showMessage('ログイン開始に失敗しました。', true);
                  }
                  // ボタンの状態を元に戻す
                  if (document.getElementById('ping-login-button')) { // まだ要素があれば
                     loginButton.disabled = false;
                     loginButton.textContent = 'ログイン';
                  }
                  return;
              }
              if (response?.started) {
                  showMessage('ログインプロセスを開始しました...');
                  if(document.getElementById('ping-login-prompt')) prompt.remove(); // プロンプト削除
              } else {
                  showMessage(`ログインを開始できませんでした (${response?.error || '不明なエラー'})`, true);
                   if (document.getElementById('ping-login-button')) {
                       loginButton.disabled = false;
                       loginButton.textContent = 'ログイン';
                   }
              }
          });
      };
  } else {
       console.error("CS: Could not find #ping-login-button in prompt.");
  }
}

// --- ピン表示関連 ---
function renderPin(pinId, pin) {
  const pinsArea = document.getElementById('pins-area');
  if (!pinsArea) { console.warn("CS: #pins-area not found."); return; }
  removePinElement(pinId, false); // 更新の場合に備え、アニメーションなしで既存を削除

  const pingInfo = PING_DEFINITIONS[pin.type] || { icon: '❓', label: '不明' };
  const pinElement = document.createElement('div');
  pinElement.id = `pin-${pinId}`;
  pinElement.className = 'pin';
  if (currentUser && pin.createdBy?.uid === currentUser.uid) {
      pinElement.classList.add('my-pin');
  }
  pinElement.dataset.createdBy = pin.createdBy?.uid || 'unknown';

  // --- アイコン ---
  const iconDiv = document.createElement('div');
  iconDiv.className = 'pin-icon';
  const iconImg = document.createElement('img');
  iconImg.src = pingInfo.icon; iconImg.alt = pingInfo.label; iconImg.width = 24; iconImg.height = 24;
  iconDiv.appendChild(iconImg);
  pinElement.appendChild(iconDiv);

  // --- 詳細 (ラベルとユーザー名) ---
  const detailsDiv = document.createElement('div');
  detailsDiv.className = 'pin-details';
  const labelDiv = document.createElement('div');
  labelDiv.className = 'pin-label'; labelDiv.textContent = pingInfo.label;
  detailsDiv.appendChild(labelDiv);
  const userDiv = document.createElement('div');
  userDiv.className = 'pin-user'; userDiv.textContent = pin.createdBy?.displayName || pin.createdBy?.email?.split('@')[0] || '不明';
  detailsDiv.appendChild(userDiv);
  pinElement.appendChild(detailsDiv);

  // --- 自分のピンのクリック処理 ---
  if (currentUser && pin.createdBy?.uid === currentUser.uid) {
    pinElement.title = 'クリックして削除';
    pinElement.addEventListener('click', () => {
      console.log(`CS: Requesting removal of my pin ${pinId}`);
      pinElement.classList.remove('show');
      pinElement.classList.add('hide'); // 先に隠すアニメーション

      chrome.runtime.sendMessage({ action: 'removePing', meetingId: currentMeetingId, pinId: pinId }, (response) => {
          if (chrome.runtime.lastError) {
             if (chrome.runtime.lastError.message?.includes('Extension context invalidated')) {
                 console.warn("CS: Context invalidated before receiving response for removePing.");
                 removePinElement(pinId, false); // 念のため即時削除
             } else {
                 console.error("CS: removePing message error:", chrome.runtime.lastError.message);
                 showMessage('エラー: ピンの削除に失敗しました。', true);
                 if(document.getElementById(`pin-${pinId}`)) { // 要素がまだあれば表示状態に戻す
                     pinElement.classList.remove('hide'); pinElement.classList.add('show');
                 }
             }
             return;
          }
          if (response?.success) {
            // console.log("CS: Remove request successful for pin", pinId);
            // 削除成功時は BG からの pinRemoved を待つのでここでは何もしないか、
            // アニメーション完了後に消すだけにする
             setTimeout(() => removePinElement(pinId, false), 300);
          } else {
            console.error("CS: Failed to remove pin:", response?.error);
            showMessage(`エラー: ピンを削除できませんでした (${response?.error || '不明なエラー'})`, true);
             if(document.getElementById(`pin-${pinId}`)) {
                 pinElement.classList.remove('hide'); pinElement.classList.add('show');
             }
          }
        });
    });
  }

  pinsArea.appendChild(pinElement);
  requestAnimationFrame(() => { // 表示アニメーション
    pinElement.classList.add('show');
  });

  // ピン要素を管理
  userPins[pinId] = { element: pinElement };
}

// ピン要素削除ヘルパー
function removePinElement(pinId, animate = true) {
    const pinInfo = userPins[pinId];
    const pinElement = pinInfo?.element || document.getElementById(`pin-${pinId}`);

    if (pinElement) {
        const performRemove = () => {
            if (pinElement.parentNode) pinElement.remove();
            // console.log(`CS: Pin element ${pinId} removed.`);
            delete userPins[pinId]; // 管理情報から削除
        };

        if (animate && pinElement.classList.contains('show')) {
            pinElement.classList.remove('show');
            pinElement.classList.add('hide');
            setTimeout(performRemove, 300); // アニメーション時間後に削除
        } else {
            performRemove(); // 即時削除
        }
    } else {
        delete userPins[pinId]; // 要素がなくても管理情報からは削除
    }
}

// --- メッセージ表示関連 ---
let messageTimeout;
function showMessage(text, isError = false) {
  let messageArea = document.getElementById('ping-message');
  if (!messageArea) messageArea = createMessageArea();
  if (!messageArea) return; // body がなければ表示できない

  if (messageTimeout) clearTimeout(messageTimeout);
  messageArea.textContent = text;
  messageArea.className = 'ping-message-area'; // クラスでスタイル管理
  messageArea.classList.add(isError ? 'error' : 'success');
  messageArea.classList.add('show');

  messageTimeout = setTimeout(() => {
    messageArea.classList.remove('show');
  }, isError ? 5000 : 3000);
}

function createMessageArea() {
    let area = document.getElementById('ping-message');
    if (!area && document.body) {
        area = document.createElement('div');
        area.id = 'ping-message';
        area.className = 'ping-message-area'; // 初期クラス
        document.body.appendChild(area);
    }
    return area;
}

// --- スクリプトロード時の処理 ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
    initializeContentScript(); // 既に読み込み済みなら即時実行
}

console.log('Meet Ping Extension content script loaded.');