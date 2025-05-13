// src/content.js

// --- グローバル変数 ---
let currentUser = null;
let currentMeetingId = null; // 現在のページの会議ID
let userPins = {}; // { pinId: { element: ..., timeoutId: ... } } // timeoutId を追加
let currentUrl = location.href; // 現在のURLを保持

// ピンの種類定義 (8種類に更新)
const PING_DEFINITIONS = {
    question: { icon: chrome.runtime.getURL('icons/question.png'), label: '疑問' }, // 疑問
    onMyWay: { icon: chrome.runtime.getURL('icons/onMyWay.png'), label: '任せて' }, // 話します → 任せて
    danger: { icon: chrome.runtime.getURL('icons/danger.png'), label: '撤退' }, // 撤退
    assist: { icon: chrome.runtime.getURL('icons/assist.png'), label: '助けて' }, // 助けて
    goodJob: { icon: chrome.runtime.getURL('icons/goodJob.png'), label: 'いい感じ' }, // NEW: いい感じ
    finishHim: { icon: chrome.runtime.getURL('icons/finishHim.png'), label: 'トドメだ' }, // NEW: トドメだ
    needInfo: { icon: chrome.runtime.getURL('icons/needInfo.png'), label: '情報が必要' }, // NEW: 情報が必要
    changePlan: { icon: chrome.runtime.getURL('icons/changePlan.png'), label: '作戦変更' }, // NEW: 作戦変更
};

// メニューの配置計算用 (8種類用に角度を調整)
const PING_MENU_POSITIONS = {
    question:   { angle: 90,  distance: 70 }, // 下
    onMyWay:    { angle: 45,  distance: 70 }, // 右下
    danger:     { angle: 0,   distance: 70 }, // 右
    assist:     { angle: -45, distance: 70 }, // 右上
    goodJob:    { angle: -90, distance: 70 }, // 上
    finishHim:  { angle: -135, distance: 70 }, // 左上
    needInfo:   { angle: 180, distance: 70 }, // 左
    changePlan: { angle: 135, distance: 70 }, // 左下
};

const PIN_AUTO_REMOVE_DURATION = 5 * 60 * 1000; // 5分 (ミリ秒)

// --- 初期化関連 ---
function initializeContentScript() {
  console.log('Content script: Initializing for URL:', currentUrl);
  requestAuthStatusFromBackground();
  handleUrlUpdate(currentUrl); // 初回読み込み時のURLで処理を開始
}

function requestAuthStatusFromBackground() {
  chrome.runtime.sendMessage({ action: 'getAuthStatus' })
    .then(handleAuthResponse) // Promiseベースに
    .catch(error => {
        handleMessageError(error, 'background', 'getAuthStatus');
        handleAuthResponse(null); // エラー時は未認証として処理
    });
}

function handleAuthResponse(response) {
    const user = response?.user;
    // console.log('CS: Handling auth response. User:', user ? user.email : 'null');
    const previousUser = currentUser;
    currentUser = user;
    const uiExists = !!document.getElementById('ping-container');
    // 認証状態が変わったか、UIが存在しない場合にUI更新/リスナー調整
    if (JSON.stringify(previousUser) !== JSON.stringify(currentUser) || !uiExists) {
        handleUrlUpdate(currentUrl);
    }
}

// --- URL変更ハンドリングとリスナー管理 ---
function handleUrlUpdate(url) {
    // console.log('CS: Handling URL update:', url);
    const newMeetingId = extractMeetingIdFromUrl(url);
    // console.log(`CS: Current Meeting ID: ${currentMeetingId}, New Meeting ID: ${newMeetingId}`);

    if (newMeetingId !== currentMeetingId) {
        // console.log(`CS: Meeting ID changed from ${currentMeetingId} to ${newMeetingId}`);

        // 古いリスナー停止を依頼
        if (currentMeetingId) {
            chrome.runtime.sendMessage({ action: 'stopListening', meetingId: currentMeetingId })
                .catch(error => handleMessageError(error, 'background', 'stopListening'));
        }

        cleanupUI(); // UIクリア
        currentMeetingId = newMeetingId; // 新しいIDをセット

        // 新しいリスナー開始を依頼 (ユーザー認証済みの場合)
        if (currentMeetingId && currentUser) {
             chrome.runtime.sendMessage({ action: 'startListening', meetingId: currentMeetingId })
                .catch(error => handleMessageError(error, 'background', 'startListening'));
        }
    }

    // UIのセットアップ/ログインプロンプト表示
    if (currentMeetingId && currentUser) {
        startPingSystem();
        const loginPrompt = document.getElementById('ping-login-prompt');
        if (loginPrompt) loginPrompt.remove();
    } else if (currentMeetingId && !currentUser) {
        // console.log('CS: User not logged in for meeting:', currentMeetingId);
        cleanupUI();
        showLoginPrompt();
    } else { // 会議ページでない、または会議IDがない場合
        cleanupUI();
        currentMeetingId = null; // IDがない場合は null に
    }
}

function extractMeetingIdFromUrl(url) {
    if (!url) return null;
    const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
    const match = url.match(meetRegex);
    return match ? match[1] : null;
}

// --- Background Scriptからのメッセージ受信 ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (chrome.runtime.lastError) { return; }

  switch (message.action) {
    case 'authStatusChanged':
      handleAuthResponse(message);
      sendResponse({ received: true });
      break;
    case 'pinAdded':
      if (currentMeetingId && message.pinId && message.pin) {
          renderPin(message.pinId, message.pin);
      }
      sendResponse({ received: true });
      break;
    case 'pinRemoved':
      if (currentMeetingId && message.pinId) {
           removePinElement(message.pinId);
      }
      sendResponse({ received: true });
      break;
    case 'dbPermissionError':
       showMessage("エラー: DBアクセス権限がありません。", true);
       sendResponse({ received: true });
       break;
    case 'urlUpdated':
        if (message.url && message.url !== currentUrl) {
            currentUrl = message.url;
            handleUrlUpdate(currentUrl);
        } else if (message.url === currentUrl && !document.getElementById('ping-container')) {
            // URLが同じでもUIがない場合は再構築（ページ再読み込みなしでcontent scriptが再実行された場合など）
            handleUrlUpdate(currentUrl);
        }
       sendResponse({ received: true });
       break;
    default:
      // console.warn("CS: Received unknown action from background:", message.action);
      sendResponse({ received: false, message: "Unknown action" });
      break;
  }
   return true; // Keep channel open for async response
});

// --- UI関連 ---
function startPingSystem() {
  if (!currentUser) { /* console.log("CS: User not logged in, not starting ping system."); */ return; }
  if (!currentMeetingId) { /* console.log("CS: No current meeting ID, not starting ping system."); */ return; }
  if (!document.getElementById('ping-container')) {
    // console.log("CS: Ping system UI not found, setting up...");
     setupUI();
  } else {
    // console.log("CS: Ping system UI already exists.");
  }
}

function setupUI() {
  if (document.getElementById('ping-container')) { return; }
  // console.log("CS: setupUI: Creating UI elements...");

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
  centerIcon.src = chrome.runtime.getURL('icons/close-menu.svg');
  centerIcon.alt = 'メニューを閉じる';
  centerIcon.width = 24;
  centerIcon.height = 24;
  pingCenter.appendChild(centerIcon);
  pingCenter.addEventListener('click', (event) => {
    event.stopPropagation();
    if (pingMenu) {
      pingMenu.classList.add('hidden');
    }
  });
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
      const distance = posInfo.distance || 70;
      const x = Math.cos(angleRad) * distance;
      const y = Math.sin(angleRad) * distance;
      option.style.position = 'absolute';
      option.style.top = '50%';
      option.style.left = '50%';
      option.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    }

    option.addEventListener('click', (event) => {
      event.stopPropagation();
      pingMenu.classList.add('hidden');

      // console.log(`CS: Ping option clicked - Type: ${key}, Meeting ID: ${currentMeetingId}`);

      chrome.runtime.sendMessage({
          action: 'createPin',
          meetingId: currentMeetingId,
          pinData: { type: key }
      })
      .then(response => {
          if (response?.success) {
              showMessage(`ピン「${pingInfo.label}」を作成しました`);
          } else {
              console.error("CS: Failed to create pin:", response?.error, "Code:", response?.code);
              showMessage(`エラー: ピンを作成できませんでした (${response?.error || '不明なエラー'})`, true);
          }
      })
      .catch(error => {
          handleMessageError(error, 'background', 'createPin');
          showMessage("エラー: ピンの作成依頼に失敗しました。", true);
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

  // Cleanup all existing pins and their timeouts
  Object.keys(userPins).forEach(pinId => {
      if (userPins[pinId] && userPins[pinId].timeoutId) {
          clearTimeout(userPins[pinId].timeoutId);
      }
      const pinElement = userPins[pinId]?.element;
      if (pinElement && pinElement.parentNode) {
          pinElement.remove();
      }
  });
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
  if (!window.location.href.includes("meet.google.com/")) return; // Only show on Meet pages
  if (!document.body) { console.error("CS: document.body not available for login prompt."); return; }


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
          chrome.runtime.sendMessage({ action: 'requestLogin' })
            .then(response => {
                if (response?.started) {
                    showMessage('ログインプロセスを開始しました...');
                    if(document.getElementById('ping-login-prompt')) prompt.remove(); // Remove prompt after starting
                } else {
                    showMessage(`ログインを開始できませんでした (${response?.error || '不明なエラー'})`, true);
                     if (document.getElementById('ping-login-button')) { // Check if button still exists
                         loginButton.disabled = false;
                         loginButton.textContent = 'ログイン';
                     }
                }
            })
            .catch(error => {
                handleMessageError(error, 'background', 'requestLogin');
                showMessage('ログイン開始に失敗しました。', true);
                 if (document.getElementById('ping-login-button')) { // Check if button still exists
                     loginButton.disabled = false;
                     loginButton.textContent = 'ログイン';
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
  if (!pinsArea) { /* console.log("CS: pins-area not found, cannot render pin."); */ return; }

  // 既存のピンがあれば、まずタイマーをクリアしてから要素を削除
  if (userPins[pinId]) {
    if (userPins[pinId].timeoutId) {
      clearTimeout(userPins[pinId].timeoutId);
    }
    removePinElement(pinId, false); // アニメーションなしで即時削除
  }


  const pingInfo = PING_DEFINITIONS[pin.type] || { icon: chrome.runtime.getURL('icons/question.png'), label: '不明' };
  const pinElement = document.createElement('div');
  pinElement.id = `pin-${pinId}`;
  pinElement.className = 'pin';
  const isMyPin = currentUser && pin.createdBy?.uid === currentUser.uid;
  if (isMyPin) {
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
  userDiv.className = 'pin-user';
  userDiv.textContent = pin.createdBy?.displayName || pin.createdBy?.email?.split('@')[0] || '不明';
  detailsDiv.appendChild(userDiv);
  pinElement.appendChild(detailsDiv);

  if (isMyPin) {
    pinElement.title = 'クリックして削除';
    pinElement.addEventListener('click', () => {
      // 即座にUIからアニメーション付きで削除
      removePinElement(pinId, true);

      // バックグラウンドに削除をリクエスト
      chrome.runtime.sendMessage({
          action: 'removePin',
          meetingId: currentMeetingId,
          pinId: pinId
      })
      .then(response => {
          if (!response?.success) {
            // UIは既に消えているので、エラーメッセージのみ表示
            console.error("CS: Failed to remove pin from DB:", response?.error);
            showMessage(`エラー: ピンをDBから削除できませんでした (${response?.error || '不明なエラー'})。UIからは削除されました。`, true);
          }
      })
      .catch(error => {
          handleMessageError(error, 'background', 'removePin');
          showMessage('エラー: ピンのDB削除リクエストに失敗しました。UIからは削除されました。', true);
      });
    });
  }

  if (!isMyPin) {
    playSound();
  }

  // ★★★ 自動削除タイマーを設定 (5分後) ★★★
  const autoRemoveTimeoutId = setTimeout(() => {
    // console.log(`CS: Auto-removing pin ${pinId} after ${PIN_AUTO_REMOVE_DURATION / 1000 / 60} minutes.`);
    removePinElement(pinId, true); // アニメーション付きで削除
  }, PIN_AUTO_REMOVE_DURATION);

  pinsArea.appendChild(pinElement);
  requestAnimationFrame(() => {
    pinElement.classList.add('show');
  });
  userPins[pinId] = { element: pinElement, timeoutId: autoRemoveTimeoutId }; // timeoutId も保存
}

function playSound() {
    try {
        const soundUrl = chrome.runtime.getURL('sounds/pin_created.mp3');
        const audio = new Audio(soundUrl);
        audio.volume = 0.3; // 音量を30%に設定
        audio.play().catch(e => console.error('CS: 音声再生エラー:', e));
    } catch (error) {
        console.error('CS: playSound関数でエラー:', error);
    }
}

function removePinElement(pinId, animate = true) {
    const pinInfo = userPins[pinId];

    // ★★★ 自動削除タイマーがあればクリア ★★★
    if (pinInfo && pinInfo.timeoutId) {
        clearTimeout(pinInfo.timeoutId);
    }

    const pinElement = pinInfo?.element || document.getElementById(`pin-${pinId}`);

    if (pinElement) {
        const performRemove = () => {
            if (pinElement.parentNode) pinElement.remove();
            delete userPins[pinId]; // userPins から対応するエントリを削除
        };

        if (animate && pinElement.classList.contains('show')) {
            pinElement.classList.remove('show');
            pinElement.classList.add('hide');
            setTimeout(performRemove, 300); // アニメーション時間後にDOMから削除
        } else {
            performRemove(); // アニメーションなしなら即時削除
        }
    } else {
        // 要素が見つからない場合でも、userPinsからはエントリを削除しておく
        delete userPins[pinId];
    }
}

// --- メッセージ表示関連 ---
let messageTimeout;
function showMessage(text, isError = false) {
  let messageArea = document.getElementById('ping-message');
  if (!messageArea) messageArea = createMessageArea();
  if (!messageArea) return; // Still no message area (e.g., document.body not ready)

  if (messageTimeout) clearTimeout(messageTimeout);
  messageArea.textContent = text;
  messageArea.className = 'ping-message-area'; // Reset classes
  messageArea.classList.add(isError ? 'error' : 'success');
  messageArea.classList.add('show'); // Trigger animation

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

// --- メッセージ送信エラーハンドリング ---
function handleMessageError(error, targetDesc, actionDesc = 'message') {
    if (!error) return;
    const ignoreErrors = ['Receiving end does not exist', 'Extension context invalidated', 'The message port closed before a response was received.'];
    if (!ignoreErrors.some(msg => error.message?.includes(msg))) {
        console.warn(`CS: Error sending ${actionDesc} to ${targetDesc}: ${error.message || error}`);
    }
}

// --- スクリプトロード時の処理 ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
    initializeContentScript();
}

console.log('Meet Ping Extension content script loaded and initialized (with auto-remove pins).');