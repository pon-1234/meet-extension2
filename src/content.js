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
  requestAuthStatusFromBackground();
  handleUrlUpdate(currentUrl);
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

function handleAuthResponse(response) {
    const user = response?.user;
    console.log('CS: Handling auth response. User:', user ? user.email : 'null');
    const previousUser = currentUser;
    currentUser = user;
    const uiExists = !!document.getElementById('ping-container');
    if (JSON.stringify(previousUser) !== JSON.stringify(currentUser) || !uiExists) {
        handleUrlUpdate(currentUrl);
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (chrome.runtime.lastError) {
      return;
  }

  switch (message.action) {
    case 'authStatusChanged':
      handleAuthResponse(message);
      sendResponse({ received: true });
      break;
    case 'pinAdded':
      if (message.pinId && message.pin) {
        renderPin(message.pinId, message.pin); // pinAdded時にrenderPinを呼ぶ
      } else { console.warn("CS: Invalid pinAdded data:", message); }
      sendResponse({ received: true });
      break;
    case 'pinRemoved':
      if (message.pinId) {
        removePinElement(message.pinId);
      } else { console.warn("CS: Invalid pinRemoved data:", message); }
      sendResponse({ received: true });
      break;
    case 'permissionError':
       showMessage("エラー: DBアクセス権限がありません。", true);
       sendResponse({ received: true });
       break;
    case 'urlUpdated':
       if (message.url && message.url !== currentUrl) {
           currentUrl = message.url;
           handleUrlUpdate(currentUrl);
       } else if (message.url === currentUrl && !document.getElementById('ping-container')) {
           handleUrlUpdate(currentUrl);
       }
       sendResponse({ received: true });
       break;
    default:
      sendResponse({ received: false, message: "Unknown action" });
      break;
  }
   return true;
});

function handleUrlUpdate(url) {
    console.log('CS: Handling URL update:', url);
    const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
    const match = url ? url.match(meetRegex) : null;
    const newMeetingId = match ? match[1] : null;

    console.log(`CS: Current Meeting ID: ${currentMeetingId}, New Meeting ID: ${newMeetingId}`);

    if (newMeetingId !== currentMeetingId) {
        console.log(`CS: Meeting ID changed from ${currentMeetingId} to ${newMeetingId}`);
        cleanupUI();
        currentMeetingId = newMeetingId;
    }

    if (currentMeetingId && currentUser) {
        startPingSystem();
        const loginPrompt = document.getElementById('ping-login-prompt');
        if (loginPrompt) loginPrompt.remove();
    } else if (currentMeetingId && !currentUser) {
        console.log('CS: User not logged in for meeting:', currentMeetingId);
        cleanupUI();
        showLoginPrompt();
    } else {
        cleanupUI();
        currentMeetingId = null;
    }
}

function startPingSystem() {
  if (!currentUser) { console.error('CS: startPingSystem: User not authenticated.'); return; }
  if (!currentMeetingId) { console.error('CS: startPingSystem: Meeting ID not found.'); return; }

  if (!document.getElementById('ping-container')) {
     setupUI();
  }
  showMessage(`ピンシステム起動 (${currentUser.displayName || currentUser.email.split('@')[0]})`);
}

function setupUI() {
  if (document.getElementById('ping-container')) { return; }
  console.log("CS: setupUI: Creating UI elements...");

  const container = document.createElement('div');
  container.id = 'ping-container';

  const pingButton = document.createElement('button');
  pingButton.id = 'ping-menu-button';
  pingButton.innerHTML = '<span>!</span>';
  pingButton.title = 'ピンメニューを開く';
  pingButton.addEventListener('click', togglePingMenu);
  container.appendChild(pingButton);

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
      pingMenu.classList.add('hidden');

      // ★デバッグログ追加: どのピンがクリックされたか
      console.log(`CS: Ping option clicked - Type: ${key}, Meeting ID: ${currentMeetingId}`);

      chrome.runtime.sendMessage({
          action: 'createPin',
          meetingId: currentMeetingId,
          pinData: { type: key }
      }, (response) => {
          if (chrome.runtime.lastError) {
              if (chrome.runtime.lastError.message?.includes('Extension context invalidated')) {
                  console.warn("CS: Context invalidated before receiving response for createPin.");
              } else {
                  console.error("CS: Error sending createPin message:", chrome.runtime.lastError.message);
                  showMessage("エラー: ピンの作成依頼に失敗しました。", true);
              }
              return;
          }
          if (response?.success) {
              showMessage(`ピン「${pingInfo.label}」を作成しました`);
              // 自分のピン作成成功時にも音を鳴らす場合はここに playSound() を追加
              // playSound();
          } else {
              console.error("CS: Failed to create pin:", response?.error, "Code:", response?.code);
              showMessage(`エラー: ピンを作成できませんでした (${response?.error || '不明なエラー'})`, true);
          }
      });
    });
    pingMenu.appendChild(option);
  });
  container.appendChild(pingMenu);

  const pinsArea = document.createElement('div');
  pinsArea.id = 'pins-area';
  container.appendChild(pinsArea);

  if (document.body) {
    document.body.appendChild(container);
    document.removeEventListener('click', handleDocumentClickForMenu);
    document.addEventListener('click', handleDocumentClickForMenu);
    console.log('CS: ピンUIが body に追加されました');
  } else {
    console.error("CS: setupUI: document.body not found.");
  }
}

function cleanupUI() {
  document.removeEventListener('click', handleDocumentClickForMenu);
  const container = document.getElementById('ping-container');
  if (container) container.remove();
  const loginPrompt = document.getElementById('ping-login-prompt');
  if (loginPrompt) loginPrompt.remove();
  const messageArea = document.getElementById('ping-message');
  if (messageArea) messageArea.remove();
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
  if (document.getElementById('ping-login-prompt')) return;
  if (!window.location.href.includes("meet.google.com/")) return;
  if (!document.body) return;

  console.log("CS: Showing login prompt.");
  const prompt = document.createElement('div');
  prompt.id = 'ping-login-prompt';
  prompt.innerHTML = `ピン機能を使うにはログインが必要です。<button id="ping-login-button">ログイン</button>`;
  document.body.appendChild(prompt);

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
                  if (document.getElementById('ping-login-button')) {
                     loginButton.disabled = false;
                     loginButton.textContent = 'ログイン';
                  }
                  return;
              }
              if (response?.started) {
                  showMessage('ログインプロセスを開始しました...');
                  if(document.getElementById('ping-login-prompt')) prompt.remove();
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
  removePinElement(pinId, false);

  const pingInfo = PING_DEFINITIONS[pin.type] || { icon: '❓', label: '不明' };
  const pinElement = document.createElement('div');
  pinElement.id = `pin-${pinId}`;
  pinElement.className = 'pin';
  if (currentUser && pin.createdBy?.uid === currentUser.uid) {
      pinElement.classList.add('my-pin');
  }
  pinElement.dataset.createdBy = pin.createdBy?.uid || 'unknown';

  const iconDiv = document.createElement('div');
  iconDiv.className = 'pin-icon';
  const iconImg = document.createElement('img');
  iconImg.src = pingInfo.icon; iconImg.alt = pingInfo.label; iconImg.width = 24; iconImg.height = 24;
  iconDiv.appendChild(iconImg);
  pinElement.appendChild(iconDiv);

  const detailsDiv = document.createElement('div');
  detailsDiv.className = 'pin-details';
  const labelDiv = document.createElement('div');
  labelDiv.className = 'pin-label'; labelDiv.textContent = pingInfo.label;
  detailsDiv.appendChild(labelDiv);
  const userDiv = document.createElement('div');
  userDiv.className = 'pin-user'; userDiv.textContent = pin.createdBy?.displayName || pin.createdBy?.email?.split('@')[0] || '不明';
  detailsDiv.appendChild(userDiv);
  pinElement.appendChild(detailsDiv);

  if (currentUser && pin.createdBy?.uid === currentUser.uid) {
    pinElement.title = 'クリックして削除';
    pinElement.addEventListener('click', () => {
      console.log(`CS: Requesting removal of my pin ${pinId}`);
      pinElement.classList.remove('show');
      pinElement.classList.add('hide');

      chrome.runtime.sendMessage({ action: 'removePin', meetingId: currentMeetingId, pinId: pinId }, (response) => {
          if (chrome.runtime.lastError) {
             if (chrome.runtime.lastError.message?.includes('Extension context invalidated')) {
                 console.warn("CS: Context invalidated before receiving response for removePin.");
                 removePinElement(pinId, false);
             } else {
                 console.error("CS: removePin message error:", chrome.runtime.lastError.message);
                 showMessage('エラー: ピンの削除に失敗しました。', true);
                 if(document.getElementById(`pin-${pinId}`)) {
                     pinElement.classList.remove('hide'); pinElement.classList.add('show');
                 }
             }
             return;
          }
          if (response?.success) {
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

  // --- ★★★ 音声再生処理を追加 ★★★ ---
  if (currentUser && pin.createdBy?.uid !== currentUser.uid) { // 自分のピンでない場合のみ再生
    playSound();
  }
  // --- ★★★ ここまで ★★★ ---

  pinsArea.appendChild(pinElement);
  requestAnimationFrame(() => {
    pinElement.classList.add('show');
  });

  userPins[pinId] = { element: pinElement };
}

// --- ★★★ 音声再生関数を追加 ★★★ ---
function playSound() {
    try {
        // 再生する音声ファイルのURLを取得
        const soundUrl = chrome.runtime.getURL('sounds/pin_created.mp3');
        // Audioオブジェクトを作成
        const audio = new Audio(soundUrl);
        // ★★★ 音量を調整（例: 0.3 = 30%） ★★★
        audio.volume = 0.3;
        // 音声を再生
        audio.play().catch(e => console.error('CS: 音声再生エラー:', e));
    } catch (error) {
        console.error('CS: playSound関数でエラー:', error);
    }
}
// --- ★★★ ここまで ★★★ ---

// ピン要素削除ヘルパー
function removePinElement(pinId, animate = true) {
    const pinInfo = userPins[pinId];
    const pinElement = pinInfo?.element || document.getElementById(`pin-${pinId}`);

    if (pinElement) {
        const performRemove = () => {
            if (pinElement.parentNode) pinElement.remove();
            delete userPins[pinId];
        };

        if (animate && pinElement.classList.contains('show')) {
            pinElement.classList.remove('show');
            pinElement.classList.add('hide');
            setTimeout(performRemove, 300);
        } else {
            performRemove();
        }
    } else {
        delete userPins[pinId];
    }
}

// --- メッセージ表示関連 ---
let messageTimeout;
function showMessage(text, isError = false) {
  let messageArea = document.getElementById('ping-message');
  if (!messageArea) messageArea = createMessageArea();
  if (!messageArea) return;

  if (messageTimeout) clearTimeout(messageTimeout);
  messageArea.textContent = text;
  messageArea.className = 'ping-message-area';
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
        area.className = 'ping-message-area';
        document.body.appendChild(area);
    }
    return area;
}

// --- スクリプトロード時の処理 ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
    initializeContentScript();
}

console.log('Meet Ping Extension content script loaded.');