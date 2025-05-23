// src/content.js

// --- グローバル変数 ---
let currentUser = null;
let currentMeetingId = null; // 現在のページの会議ID
let userPins = {}; // { pinId: { element: ..., timeoutId: ... } } // timeoutId を追加
let currentUrl = location.href; // 現在のURLを保持
let currentPingMode = 'everyone'; // 'everyone' または 'individual'
let meetParticipants = {}; // 参加者のリスト { uid: { displayName, email } }
let participantsObserver = null; // 参加者変更監視用
let participantsUpdateInterval = null; // 参加者更新インターバル

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
  
  // 参加者監視を開始
  startParticipantsMonitoring();
}

function setupUI() {
  if (document.getElementById('ping-container')) { return; }
  // console.log("CS: setupUI: Creating UI elements...");

  const container = document.createElement('div');
  container.id = 'ping-container';

  const pingButton = document.createElement('button');
  pingButton.id = 'ping-menu-button';
  const menuButtonIcon = document.createElement('img');
  menuButtonIcon.src = chrome.runtime.getURL('icons/pin-menu.png'); // 新しいアイコン画像
  menuButtonIcon.alt = 'ピンメニューを開く';
  pingButton.appendChild(menuButtonIcon);
  pingButton.title = 'ピンメニューを開く';
  pingButton.addEventListener('click', togglePingMenu);
  container.appendChild(pingButton);

  // メインメニュー（全体/個別選択）
  const pingMenu = document.createElement('div');
  pingMenu.id = 'ping-menu';
  pingMenu.classList.add('hidden');

  // 中央の閉じるボタン
  const pingCenter = document.createElement('div');
  pingCenter.id = 'ping-center';
  const centerIcon = document.createElement('img');
  centerIcon.src = chrome.runtime.getURL('icons/close-menu.svg');
  pingCenter.title = 'メニューを閉じる';
  centerIcon.alt = 'メニューを閉じる';
  centerIcon.width = 24;
  centerIcon.height = 24;
  pingCenter.appendChild(centerIcon);
  pingCenter.addEventListener('click', (event) => {
    event.stopPropagation();
    closePingMenu();
  });
  pingMenu.appendChild(pingCenter);

  // 全体向けオプション
  const everyoneOption = document.createElement('div');
  everyoneOption.className = 'ping-mode-option';
  everyoneOption.dataset.mode = 'everyone';
  everyoneOption.style.position = 'absolute';
  everyoneOption.style.top = '50%';
  everyoneOption.style.left = '50%';
  everyoneOption.style.transform = 'translate(calc(-50% + 0px), calc(-50% + -70px))'; // 上
  
  const everyoneIcon = document.createElement('div');
  everyoneIcon.className = 'ping-text-icon';
  everyoneIcon.textContent = '全';
  everyoneOption.appendChild(everyoneIcon);

  const everyoneTooltip = document.createElement('span');
  everyoneTooltip.className = 'ping-option-tooltip';
  everyoneTooltip.textContent = '全体';
  everyoneOption.appendChild(everyoneTooltip);

  everyoneOption.addEventListener('click', (event) => {
    event.stopPropagation();
    currentPingMode = 'everyone';
    showPingOptions();
  });
  pingMenu.appendChild(everyoneOption);

  // 個別向けオプション
  const individualOption = document.createElement('div');
  individualOption.className = 'ping-mode-option';
  individualOption.dataset.mode = 'individual';
  individualOption.style.position = 'absolute';
  individualOption.style.top = '50%';
  individualOption.style.left = '50%';
  individualOption.style.transform = 'translate(calc(-50% + 0px), calc(-50% + 70px))'; // 下

  const individualIcon = document.createElement('div');
  individualIcon.className = 'ping-text-icon';
  individualIcon.textContent = '個';
  individualOption.appendChild(individualIcon);

  const individualTooltip = document.createElement('span');
  individualTooltip.className = 'ping-option-tooltip';
  individualTooltip.textContent = '個別';
  individualOption.appendChild(individualTooltip);

  individualOption.addEventListener('click', (event) => {
    event.stopPropagation();
    currentPingMode = 'individual';
    showParticipantsList();
  });
  pingMenu.appendChild(individualOption);

  container.appendChild(pingMenu);

  // ピンオプションメニュー（サブメニュー）
  const pingOptionsMenu = document.createElement('div');
  pingOptionsMenu.id = 'ping-options-menu';
  pingOptionsMenu.classList.add('hidden');
  
  // 戻るボタン
  const backButton = document.createElement('div');
  backButton.id = 'ping-back-button';
  backButton.style.position = 'absolute';
  backButton.style.top = '50%';
  backButton.style.left = '50%';
  backButton.style.transform = 'translate(-50%, -50%)';
  const backIcon = document.createElement('div');
  backIcon.className = 'ping-text-icon';
  backIcon.textContent = '←';
  backButton.appendChild(backIcon);
  backButton.title = '戻る';
  backButton.addEventListener('click', (event) => {
    event.stopPropagation();
    showMainMenu();
  });
  pingOptionsMenu.appendChild(backButton);

  // ピンオプションを追加
  Object.keys(PING_DEFINITIONS).forEach(key => {
    const pingInfo = PING_DEFINITIONS[key];
    const posInfo = PING_MENU_POSITIONS[key];
    const option = document.createElement('div');
    option.className = 'ping-option';
    option.dataset.type = key;

    const iconDiv = document.createElement('div');
    iconDiv.className = 'ping-icon';
    const iconImg = document.createElement('img');
    iconImg.src = pingInfo.icon;
    iconImg.alt = pingInfo.label;
    iconImg.width = 24; iconImg.height = 24;
    iconDiv.appendChild(iconImg);
    option.appendChild(iconDiv);

    const tooltipSpan = document.createElement('span');
    tooltipSpan.className = 'ping-option-tooltip';
    tooltipSpan.textContent = pingInfo.label;
    option.appendChild(tooltipSpan);

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
      handlePingSelection(key, pingInfo);
    });
    pingOptionsMenu.appendChild(option);
  });
  container.appendChild(pingOptionsMenu);

  // 参加者リストメニュー
  const participantsMenu = document.createElement('div');
  participantsMenu.id = 'ping-participants-menu';
  participantsMenu.classList.add('hidden');
  
  const participantsBackButton = document.createElement('div');
  participantsBackButton.id = 'participants-back-button';
  participantsBackButton.style.position = 'absolute';
  participantsBackButton.style.top = '50%';
  participantsBackButton.style.left = '50%';
  participantsBackButton.style.transform = 'translate(-50%, -50%)';
  const participantsBackIcon = document.createElement('div');
  participantsBackIcon.className = 'ping-text-icon';
  participantsBackIcon.textContent = '←';
  participantsBackButton.appendChild(participantsBackIcon);
  participantsBackButton.title = '戻る';
  participantsBackButton.addEventListener('click', (event) => {
    event.stopPropagation();
    showMainMenu();
    });
  participantsMenu.appendChild(participantsBackButton);

  container.appendChild(participantsMenu);

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
  // 参加者監視を停止
  stopParticipantsMonitoring();
  
  document.removeEventListener('click', handleDocumentClickForMenu);
  const container = document.getElementById('ping-container');
  if (container) container.remove();
  const loginPrompt = document.getElementById('ping-login-prompt');
  if (loginPrompt) loginPrompt.remove();
  const messageArea = document.getElementById('ping-message');
  if (messageArea) messageArea.remove();
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
  meetParticipants = {};
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
        if (pingMenu.classList.contains('hidden')) {
            showMainMenu();
        } else {
            closePingMenu();
        }
    }
}

function closePingMenu() {
    const pingMenu = document.getElementById('ping-menu');
    const pingOptionsMenu = document.getElementById('ping-options-menu');
    const participantsMenu = document.getElementById('ping-participants-menu');
    
    if (pingMenu) pingMenu.classList.add('hidden');
    if (pingOptionsMenu) pingOptionsMenu.classList.add('hidden');
    if (participantsMenu) participantsMenu.classList.add('hidden');
    }

function showMainMenu() {
    const pingMenu = document.getElementById('ping-menu');
    const pingOptionsMenu = document.getElementById('ping-options-menu');
    const participantsMenu = document.getElementById('ping-participants-menu');
    
    if (pingMenu) pingMenu.classList.remove('hidden');
    if (pingOptionsMenu) pingOptionsMenu.classList.add('hidden');
    if (participantsMenu) participantsMenu.classList.add('hidden');
}

function showPingOptions() {
    const pingMenu = document.getElementById('ping-menu');
    const pingOptionsMenu = document.getElementById('ping-options-menu');
    const participantsMenu = document.getElementById('ping-participants-menu');
    
    if (pingMenu) pingMenu.classList.add('hidden');
    if (pingOptionsMenu) pingOptionsMenu.classList.remove('hidden');
    if (participantsMenu) participantsMenu.classList.add('hidden');
}

function showParticipantsList() {
    // 参加者リストを更新
    updateParticipantsList();
    
    const pingMenu = document.getElementById('ping-menu');
    const pingOptionsMenu = document.getElementById('ping-options-menu');
    const participantsMenu = document.getElementById('ping-participants-menu');
    
    if (pingMenu) pingMenu.classList.add('hidden');
    if (pingOptionsMenu) pingOptionsMenu.classList.add('hidden');
    if (participantsMenu) participantsMenu.classList.remove('hidden');
}

function handlePingSelection(pingType, pingInfo) {
    closePingMenu();
    
    if (currentPingMode === 'everyone') {
        // 全体向けピン
        chrome.runtime.sendMessage({
            action: 'createPin',
            meetingId: currentMeetingId,
            pinData: { type: pingType }
        })
        .then(response => {
            if (response?.success) {
                showMessage(`ピン「${pingInfo.label}」を全体に送信しました`);
            } else {
                console.error("CS: Failed to create pin:", response?.error, "Code:", response?.code);
                showMessage(`エラー: ピンを作成できませんでした (${response?.error || '不明なエラー'})`, true);
            }
        })
        .catch(error => {
            handleMessageError(error, 'background', 'createPin');
            showMessage("エラー: ピンの作成依頼に失敗しました。", true);
        });
    } else if (currentPingMode === 'individual') {
        // 個別向けピン - 対象ユーザーが選択されている場合
        if (window.selectedParticipant) {
            chrome.runtime.sendMessage({
                action: 'createDirectPin',
                meetingId: currentMeetingId,
                targetUserId: window.selectedParticipant.uid,
                targetDisplayName: window.selectedParticipant.displayName,
                pinData: { type: pingType }
            })
            .then(response => {
                if (response?.success) {
                    showMessage(`ピン「${pingInfo.label}」を${window.selectedParticipant.displayName}に送信しました`);
                } else {
                    console.error("CS: Failed to create direct pin:", response?.error);
                    showMessage(`エラー: 個別ピンを作成できませんでした (${response?.error || '不明なエラー'})`, true);
                }
            })
            .catch(error => {
                handleMessageError(error, 'background', 'createDirectPin');
                showMessage("エラー: 個別ピンの作成依頼に失敗しました。", true);
            });
        } else {
            showMessage("エラー: 送信先が選択されていません。", true);
        }
    }
}

function updateParticipantsList() {
    const participantsMenu = document.getElementById('ping-participants-menu');
    if (!participantsMenu) return;

    // 既存の参加者オプションを削除（戻るボタンは残す）
    const existingOptions = participantsMenu.querySelectorAll('.participant-option');
    existingOptions.forEach(option => option.remove());

    // 実際の参加者データを使用
    const participants = Object.values(meetParticipants).filter(participant => 
        participant.uid !== currentUser?.uid // 自分は除外
    );
    
    if (participants.length === 0) {
        console.log('CS: 利用可能な参加者がいません。ダミーデータを使用します。');
        // 参加者がいない場合はダミーデータを表示
        const dummyParticipants = [
            {
                uid: 'demo-user-1',
                displayName: 'デモユーザー1',
                email: 'demo1@example.com'
            },
            {
                uid: 'demo-user-2',
                displayName: 'デモユーザー2',
                email: 'demo2@example.com'
            }
        ];
        dummyParticipants.forEach((participant, index) => addParticipantOption(participant, index, participantsMenu));
    } else {
        // 実際の参加者を追加
        participants.forEach((participant, index) => addParticipantOption(participant, index, participantsMenu));
    }
}

function addParticipantOption(participant, index, participantsMenu) {
    const option = document.createElement('div');
    option.className = 'participant-option';
    option.dataset.uid = participant.uid;
    
    // 円周上に配置（最大8人まで）
    const angle = (index * 45) - 90; // -90度から開始して45度ずつ
    const distance = 70;
    const angleRad = angle * (Math.PI / 180);
    const x = Math.cos(angleRad) * distance;
    const y = Math.sin(angleRad) * distance;
    
    option.style.position = 'absolute';
    option.style.top = '50%';
    option.style.left = '50%';
    option.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;

    const iconDiv = document.createElement('div');
    iconDiv.className = 'ping-text-icon';
    // 名前の頭文字を取得（日本語の場合は最初の1文字、英語の場合は最初の1文字）
    const firstChar = participant.displayName.charAt(0).toUpperCase();
    iconDiv.textContent = firstChar;
    option.appendChild(iconDiv);

    const tooltipSpan = document.createElement('span');
    tooltipSpan.className = 'ping-option-tooltip';
    tooltipSpan.textContent = participant.displayName;
    option.appendChild(tooltipSpan);

    option.addEventListener('click', (event) => {
        event.stopPropagation();
        window.selectedParticipant = participant;
        showPingOptions();
    });

    participantsMenu.appendChild(option);
}

function extractParticipantsFromDOM() {
    const participants = [];
    
    try {
        // Google Meetの参加者情報を取得する複数の方法を試行
        
        // 方法1: 参加者パネルが開いている場合
        const participantItems = document.querySelectorAll('[data-participant-id]');
        if (participantItems.length > 0) {
            participantItems.forEach(item => {
                const nameElement = item.querySelector('[data-self-name], [jsname="YbZvtf"], .z5xWsc');
                if (nameElement) {
                    const displayName = nameElement.textContent.trim();
                    if (displayName && displayName !== '') {
                        participants.push({
                            uid: generateParticipantId(displayName),
                            displayName: displayName,
                            email: `${displayName.replace(/\s+/g, '').toLowerCase()}@unknown.com`
                        });
                    }
                }
            });
        }
        
        // 方法2: ビデオタイルから名前を抽出
        if (participants.length === 0) {
            const videoTiles = document.querySelectorAll('[data-ssrc], [jsname="A5il2e"], .ZWQeQ, .MuzmKe');
            videoTiles.forEach(tile => {
                const nameElements = tile.querySelectorAll('.zWGUib, .EuSOXe, .NpwXQ, [data-self-name]');
                nameElements.forEach(nameEl => {
                    const displayName = nameEl.textContent.trim();
                    if (displayName && displayName !== '' && displayName !== '自分' && !displayName.includes('ミュート')) {
                        const existingParticipant = participants.find(p => p.displayName === displayName);
                        if (!existingParticipant) {
                            participants.push({
                                uid: generateParticipantId(displayName),
                                displayName: displayName,
                                email: `${displayName.replace(/\s+/g, '').toLowerCase()}@unknown.com`
                            });
                        }
                    }
                });
            });
        }
        
        // 方法3: より広範囲な名前要素の検索
        if (participants.length === 0) {
            const allNameElements = document.querySelectorAll(
                '.z5xWsc, .ZWQeQ, .zWGUib, .EuSOXe, .NpwXQ, [data-self-name], ' +
                '[aria-label*="ユーザー"], [title*="ユーザー"], ' +
                '.uGOf1d, .NpwXQ, .JvZxJe'
            );
            
            allNameElements.forEach(nameEl => {
                const displayName = nameEl.textContent.trim();
                if (displayName && 
                    displayName !== '' && 
                    displayName !== '自分' && 
                    !displayName.includes('ミュート') &&
                    !displayName.includes('カメラ') &&
                    !displayName.includes('マイク') &&
                    displayName.length > 1) {
                    
                    const existingParticipant = participants.find(p => p.displayName === displayName);
                    if (!existingParticipant) {
                        participants.push({
                            uid: generateParticipantId(displayName),
                            displayName: displayName,
                            email: `${displayName.replace(/\s+/g, '').toLowerCase()}@unknown.com`
                        });
                    }
                }
            });
        }
        
        console.log('CS: 検出された参加者:', participants);
        
    } catch (error) {
        console.error('CS: 参加者検出エラー:', error);
    }
    
    // 少なくとも現在のユーザー以外の参加者がいない場合はダミーデータを返す
    if (participants.length === 0) {
        console.log('CS: 参加者を検出できませんでした。ダミーデータを使用します。');
        participants.push({
            uid: 'demo-user-1',
            displayName: 'デモユーザー1',
            email: 'demo1@example.com'
        });
        participants.push({
            uid: 'demo-user-2',
            displayName: 'デモユーザー2', 
            email: 'demo2@example.com'
        });
    }
    
    return participants;
}

function generateParticipantId(displayName) {
    // 表示名からユニークなIDを生成
    return 'participant-' + btoa(encodeURIComponent(displayName)).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
}

function showLoginPrompt() {
  if (document.getElementById('ping-login-prompt')) return;
  if (!window.location.href.includes("meet.google.com/")) return;
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
                    if(document.getElementById('ping-login-prompt')) prompt.remove();
                } else {
                    showMessage(`ログインを開始できませんでした (${response?.error || '不明なエラー'})`, true);
                     if (document.getElementById('ping-login-button')) {
                         loginButton.disabled = false;
                         loginButton.textContent = 'ログイン';
                     }
                }
            })
            .catch(error => {
                handleMessageError(error, 'background', 'requestLogin');
                showMessage('ログイン開始に失敗しました。', true);
                 if (document.getElementById('ping-login-button')) {
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
  if (!pinsArea) return;

  if (userPins[pinId]) {
    if (userPins[pinId].timeoutId) {
      clearTimeout(userPins[pinId].timeoutId);
    }
    removePinElement(pinId, false);
  }

  const pingInfo = PING_DEFINITIONS[pin.type] || { icon: chrome.runtime.getURL('icons/question.png'), label: '不明' };
  const pinElement = document.createElement('div');
  pinElement.id = `pin-${pinId}`;
  pinElement.className = 'pin';
  const isMyPin = currentUser && pin.createdBy?.uid === currentUser.uid;
  const isDirect = pin.isDirect || false; // 個別ピンかどうか
  const isSent = pin.isSent || false; // 送信したピンかどうか
  
  if (isMyPin) {
      pinElement.classList.add('my-pin');
  }
  if (isDirect) {
      pinElement.classList.add('direct-pin');
  }
  if (isSent) {
      pinElement.classList.add('sent-pin');
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
  labelDiv.className = 'pin-label'; 
  
  // ピンの種類に応じてラベルを設定
  if (isSent) {
      labelDiv.textContent = `📤${pingInfo.label}`; // 送信したピンは📤アイコン
  } else if (isDirect) {
      labelDiv.textContent = `🔒${pingInfo.label}`; // 受信した個別ピンは🔒アイコン
  } else {
      labelDiv.textContent = pingInfo.label; // 全体ピンは通常表示
  }
  
  detailsDiv.appendChild(labelDiv);
  const userDiv = document.createElement('div');
  userDiv.className = 'pin-user';
  
  // ユーザー表示名を設定
  if (isSent) {
      // 送信したピンの場合は送信先を表示
      userDiv.textContent = `→ ${pin.displayTargetName || '不明なユーザー'}`;
  } else {
      // 受信したピンの場合は送信者を表示
  userDiv.textContent = pin.createdBy?.displayName || pin.createdBy?.email?.split('@')[0] || '不明';
  }
  
  detailsDiv.appendChild(userDiv);

  const senderName = pin.createdBy?.displayName || pin.createdBy?.email?.split('@')[0] || '不明';
  pinElement.appendChild(detailsDiv);

  if (isMyPin) {
    let pinTypeText = '';
    if (isSent) {
        pinTypeText = '送信した個別ピン';
    } else if (isDirect) {
        pinTypeText = '個別ピン';
    } else {
        pinTypeText = 'ピン';
    }
    
    pinElement.title = `クリックして削除 (${pingInfo.label} - ${pinTypeText})`;
    pinElement.addEventListener('click', () => {
      removePinElement(pinId, true);
      const removeAction = (isDirect || isSent) ? 'removeDirectPin' : 'removePin';
      const targetUserId = isSent ? currentUser.uid : (isDirect ? currentUser.uid : undefined);
      
      chrome.runtime.sendMessage({
          action: removeAction,
          meetingId: currentMeetingId,
          pinId: pinId,
          targetUserId: targetUserId
      })
      .then(response => {
          if (!response?.success) {
            console.error("CS: Failed to remove pin from DB:", response?.error);
            showMessage(`エラー: ピンをDBから削除できませんでした (${response?.error || '不明なエラー'})。UIからは削除されました。`, true);
          }
      })
      .catch(error => {
          handleMessageError(error, 'background', removeAction);
          showMessage('エラー: ピンのDB削除リクエストに失敗しました。UIからは削除されました。', true);
      });
    });
  } else {
     let pinTypeText = '';
     if (isDirect) {
         pinTypeText = '個別ピン';
     } else {
         pinTypeText = 'ピン';
     }
     pinElement.title = `${pingInfo.label} (送信者: ${senderName} - ${pinTypeText})`;
  }

  // 自分のピンに対しても効果音を再生
    playSound();

  const autoRemoveTimeoutId = setTimeout(() => {
    removePinElement(pinId, true);
  }, PIN_AUTO_REMOVE_DURATION);

  pinsArea.appendChild(pinElement);
  requestAnimationFrame(() => {
    pinElement.classList.add('show');
  });
  userPins[pinId] = { element: pinElement, timeoutId: autoRemoveTimeoutId };
}

function playSound() {
    try {
        const soundUrl = chrome.runtime.getURL('sounds/pin_created.mp3');
        const audio = new Audio(soundUrl);
        audio.volume = 0.3;
        audio.play().catch(e => console.error('CS: 音声再生エラー:', e));
    } catch (error) {
        console.error('CS: playSound関数でエラー:', error);
    }
}

function removePinElement(pinId, animate = true) {
    const pinInfo = userPins[pinId];
    if (pinInfo && pinInfo.timeoutId) {
        clearTimeout(pinInfo.timeoutId);
    }
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

// --- メッセージ送信エラーハンドリング ---
function handleMessageError(error, targetDesc, actionDesc = 'message') {
    if (!error) return;
    const ignoreErrors = ['Receiving end does not exist', 'Extension context invalidated', 'The message port closed before a response was received.'];
    if (!ignoreErrors.some(msg => error.message?.includes(msg))) {
        console.warn(`CS: Error sending ${actionDesc} to ${targetDesc}: ${error.message || error}`);
    }
}

function startParticipantsMonitoring() {
    // 既存の監視を停止
    stopParticipantsMonitoring();
    
    // 初回の参加者取得
    updateMeetParticipants();
    
    // 定期的な参加者更新 (30秒間隔)
    participantsUpdateInterval = setInterval(() => {
        updateMeetParticipants();
    }, 30000);
    
    // DOM変更の監視
    const meetContainer = document.querySelector('[role="main"], .T4LgNb, .crqnQb');
    if (meetContainer) {
        participantsObserver = new MutationObserver((mutations) => {
            let shouldUpdate = false;
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    // 参加者に関連する要素の変更を検知
                    const addedNodes = Array.from(mutation.addedNodes);
                    const removedNodes = Array.from(mutation.removedNodes);
                    
                    if (addedNodes.some(node => node.nodeType === 1 && 
                        (node.querySelector && (node.querySelector('.zWGUib, .z5xWsc, [data-participant-id]') || 
                         node.matches && node.matches('.zWGUib, .z5xWsc, [data-participant-id]'))))) {
                        shouldUpdate = true;
                    }
                    
                    if (removedNodes.some(node => node.nodeType === 1 && 
                        (node.querySelector && (node.querySelector('.zWGUib, .z5xWsc, [data-participant-id]') || 
                         node.matches && node.matches('.zWGUib, .z5xWsc, [data-participant-id]'))))) {
                        shouldUpdate = true;
                    }
                }
            });
            
            if (shouldUpdate) {
                // デバウンス処理：短時間に複数の変更があった場合は最後の変更から1秒後に更新
                clearTimeout(window.participantsUpdateTimeout);
                window.participantsUpdateTimeout = setTimeout(() => {
                    updateMeetParticipants();
                }, 1000);
            }
        });
        
        participantsObserver.observe(meetContainer, {
            childList: true,
            subtree: true
        });
    }
}

function stopParticipantsMonitoring() {
    if (participantsUpdateInterval) {
        clearInterval(participantsUpdateInterval);
        participantsUpdateInterval = null;
    }
    
    if (participantsObserver) {
        participantsObserver.disconnect();
        participantsObserver = null;
    }
    
    if (window.participantsUpdateTimeout) {
        clearTimeout(window.participantsUpdateTimeout);
        window.participantsUpdateTimeout = null;
    }
}

function updateMeetParticipants() {
    const newParticipants = extractParticipantsFromDOM();
    const participantsChanged = JSON.stringify(meetParticipants) !== JSON.stringify(newParticipants);
    
    if (participantsChanged) {
        console.log('CS: 参加者リストが更新されました:', newParticipants);
        meetParticipants = {};
        newParticipants.forEach(participant => {
            meetParticipants[participant.uid] = participant;
        });
        
        // 個別ピンメニューが表示されている場合は更新
        const participantsMenu = document.getElementById('ping-participants-menu');
        if (participantsMenu && !participantsMenu.classList.contains('hidden')) {
            updateParticipantsList();
        }
    }
}

// --- スクリプトロード時の処理 ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
    initializeContentScript();
}

console.log('Meet Ping Extension content script loaded and initialized (with auto-remove pins).');