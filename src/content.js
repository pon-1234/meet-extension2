// src/content.js

// --- グローバル変数 ---
let currentUser = null;
let currentMeetingId = null; // 現在のページの会議ID
let userPins = {}; // { pinId: { element: ..., timeoutId: ... } } // timeoutId を追加
let currentUrl = location.href; // 現在のURLを保持
let selectedTarget = 'everyone'; // デフォルトは全員
let selectedParticipant = null; // 選択された参加者情報
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

  // 送信先セレクター（ドロップダウン）を作成
  const targetSelector = document.createElement('div');
  targetSelector.id = 'ping-target-selector';
  
  const selectorButton = document.createElement('button');
  selectorButton.id = 'ping-selector-button';
  selectorButton.innerHTML = '<span id="selector-text">全員</span><span class="selector-arrow">▼</span>';
  selectorButton.addEventListener('click', toggleTargetDropdown);
  
  const dropdownList = document.createElement('div');
  dropdownList.id = 'ping-dropdown-list';
  dropdownList.classList.add('hidden');
  
  targetSelector.appendChild(selectorButton);
  targetSelector.appendChild(dropdownList);
  container.appendChild(targetSelector);

  // ピンメニューボタン
  const pingButton = document.createElement('button');
  pingButton.id = 'ping-menu-button';
  const menuButtonIcon = document.createElement('img');
  menuButtonIcon.src = chrome.runtime.getURL('icons/pin-menu.png'); // 新しいアイコン画像
  menuButtonIcon.alt = 'ピンメニューを開く';
  pingButton.appendChild(menuButtonIcon);
  pingButton.title = 'ピンメニューを開く';
  pingButton.addEventListener('click', togglePingMenu);
  container.appendChild(pingButton);

  // ピンオプションメニュー
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
  
  // 初回の参加者リスト更新
  updateTargetDropdown();
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
    const dropdown = document.getElementById('ping-dropdown-list');
    const selectorButton = document.getElementById('ping-selector-button');
    
    // ピンメニューの外側クリック判定
    if (menu && !menu.classList.contains('hidden')) {
        if (!menu.contains(event.target) && (!button || !button.contains(event.target))) {
             menu.classList.add('hidden');
        }
    }
    
    // ドロップダウンの外側クリック判定
    if (dropdown && !dropdown.classList.contains('hidden')) {
        if (!dropdown.contains(event.target) && (!selectorButton || !selectorButton.contains(event.target))) {
            dropdown.classList.add('hidden');
        }
    }
}

function toggleTargetDropdown(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('ping-dropdown-list');
    if (dropdown) {
        if (dropdown.classList.contains('hidden')) {
            updateTargetDropdown();
            dropdown.classList.remove('hidden');
        } else {
            dropdown.classList.add('hidden');
        }
    }
}

function updateTargetDropdown() {
    const dropdown = document.getElementById('ping-dropdown-list');
    if (!dropdown) return;
    
    // 既存の項目をクリア
    dropdown.innerHTML = '';
    
    // 「全員」オプションを追加
    const everyoneOption = document.createElement('div');
    everyoneOption.className = 'dropdown-item';
    everyoneOption.textContent = '全員';
    everyoneOption.addEventListener('click', () => selectTarget('everyone', null));
    dropdown.appendChild(everyoneOption);
    
    // セパレーター
    const separator = document.createElement('div');
    separator.className = 'dropdown-separator';
    dropdown.appendChild(separator);
    
    // 参加者リストを追加
    const participants = Object.values(meetParticipants).filter(participant => {
        // displayNameが存在することを確認
        if (!participant.displayName || participant.displayName.trim() === '') {
            return false;
        }
        
        
        // 自分を除外（複数の方法でチェック）
        // 1. currentUserのdisplayNameと比較
        if (currentUser?.displayName) {
            const myName = currentUser.displayName.replace(/さん$/, '');
            const participantName = participant.displayName.replace(/さん$/, '');
            if (myName === participantName) {
                return false;
            }
        }
        
        // 2. currentUserのemailから名前を推測して比較
        if (currentUser?.email) {
            const emailName = currentUser.email.split('@')[0];
            const participantName = participant.displayName.replace(/さん$/, '').toLowerCase();
            if (emailName.toLowerCase() === participantName) {
                return false;
            }
        }
        
        // 6. 自分の名前が参加者名に含まれているかチェック（特定のパターンのみ）
        if (currentUser?.displayName) {
            const myNameBase = currentUser.displayName.replace(/さん$/, '');
            const participantNameBase = participant.displayName.replace(/さん$/, '');
            
            // 特定のパターンのみ除外（自分の名前+自分の名前、または自分の名前+さん+自分の名前）
            const duplicatePattern1 = myNameBase + myNameBase; // "ponpon"
            const duplicatePattern2 = myNameBase + 'さん' + myNameBase; // "ponさんpon"
            
            if (participantNameBase.toLowerCase() === duplicatePattern1.toLowerCase() ||
                participantNameBase.toLowerCase() === duplicatePattern2.toLowerCase()) {
                return false;
            }
        }
        
        // 3. participant.isMe フラグがある場合
        if (participant.isMe) {
            return false;
        }
        
        // 4. currentUserのuidと比較（追加）
        if (currentUser?.uid && participant.uid && currentUser.uid === participant.uid) {
            return false;
        }
        
        // 5. emailの完全一致チェック（追加）
        if (currentUser?.email && participant.email && currentUser.email === participant.email) {
            return false;
        }
        
        return true;
    });
    
    
    if (participants.length === 0) {
        // 参加者がいない場合の処理
        // デモユーザーを表示するか、メッセージを表示
        const noParticipantMessage = document.createElement('div');
        noParticipantMessage.className = 'dropdown-item';
        noParticipantMessage.textContent = '他の参加者がいません';
        noParticipantMessage.style.opacity = '0.6';
        noParticipantMessage.style.cursor = 'default';
        dropdown.appendChild(noParticipantMessage);
    } else {
        participants.forEach(participant => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            // displayNameが正しく設定されているか確認
            const displayName = participant.displayName || '不明な参加者';
            item.textContent = displayName;
            item.addEventListener('click', () => selectTarget('individual', participant));
            dropdown.appendChild(item);
        });
    }
}

function selectTarget(mode, participant) {
    selectedTarget = mode;
    selectedParticipant = participant;
    
    // セレクターのテキストを更新
    const selectorText = document.getElementById('selector-text');
    if (selectorText) {
        selectorText.textContent = mode === 'everyone' ? '全員' : participant.displayName;
    }
    
    // ドロップダウンを閉じる
    const dropdown = document.getElementById('ping-dropdown-list');
    if (dropdown) {
        dropdown.classList.add('hidden');
    }
}

function togglePingMenu(event) {
    event.stopPropagation();
    const pingMenu = document.getElementById('ping-menu');
    if (pingMenu) {
        if (pingMenu.classList.contains('hidden')) {
            pingMenu.classList.remove('hidden');
        } else {
            closePingMenu();
        }
    }
}

function closePingMenu() {
    const pingMenu = document.getElementById('ping-menu');
    if (pingMenu) pingMenu.classList.add('hidden');
}

function handlePingSelection(pingType, pingInfo) {
    closePingMenu();
    
    if (selectedTarget === 'everyone') {
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
    } else if (selectedTarget === 'individual' && selectedParticipant) {
        // 個別向けピン
        chrome.runtime.sendMessage({
            action: 'createDirectPin',
            meetingId: currentMeetingId,
            targetUserId: selectedParticipant.uid,
            targetDisplayName: selectedParticipant.displayName,
            pinData: { type: pingType }
        })
        .then(response => {
            if (response?.success) {
                showMessage(`ピン「${pingInfo.label}」を${selectedParticipant.displayName}に送信しました`);
            } else {
                console.error("CS: Failed to create direct pin:", response?.error);
                showMessage(`エラー: 個別ピンを作成できませんでした (${response?.error || '不明なエラー'})`, true);
            }
        })
        .catch(error => {
            handleMessageError(error, 'background', 'createDirectPin');
            showMessage("エラー: 個別ピンの作成依頼に失敗しました。", true);
        });
    }
}

function extractParticipantsFromDOM() {
    const participants = [];
    const foundNames = new Set(); // 重複を防ぐためのセット
    
    try {
        // 自分の表示名を取得（複数の方法で）
        let myDisplayNames = [];
        
        // currentUserから自分の名前を取得
        if (currentUser) {
            if (currentUser.displayName) {
                myDisplayNames.push(currentUser.displayName);
                // 「さん」を除いたバージョンも追加
                myDisplayNames.push(currentUser.displayName.replace(/さん$/, ''));
            }
            if (currentUser.email) {
                // メールアドレスの@前の部分も名前として使われることがある
                const emailName = currentUser.email.split('@')[0];
                myDisplayNames.push(emailName);
            }
        }
        
        // 「（あなた）」を含む要素から自分の名前を検出
        const myNameElements = document.querySelectorAll('.NnTWjc');
        myNameElements.forEach(el => {
            if (el.textContent.includes('（あなた）')) {
                const parentEl = el.closest('[data-participant-id]');
                if (parentEl) {
                    const nameEl = parentEl.querySelector('.zWGUib');
                    if (nameEl) {
                        const myName = nameEl.textContent.trim().replace('さん', '');
                        if (myName && !myDisplayNames.includes(myName)) {
                            myDisplayNames.push(myName);
                            // 「さん」付きのバージョンも追加
                            myDisplayNames.push(myName + 'さん');
                        }
                    }
                }
            }
        });
        
        // 自分のビデオタイルを探す（「あなた」というラベルがある要素）
        const selfIndicators = document.querySelectorAll('[aria-label*="あなた"], [title*="あなた"], .NnTWjc');
        selfIndicators.forEach(indicator => {
            const container = indicator.closest('[data-participant-id], [data-requested-participant-id]');
            if (container) {
                const nameEl = container.querySelector('.zWGUib, .XEazBc, .adnwBd');
                if (nameEl) {
                    const myName = nameEl.textContent.trim().replace(/さん$/, '');
                    if (myName && !myDisplayNames.includes(myName)) {
                        myDisplayNames.push(myName);
                        myDisplayNames.push(myName + 'さん');
                    }
                }
            }
        });
        
        console.log('CS: 自分の表示名リスト:', myDisplayNames);
        
        // 方法1: ビデオタイルから参加者を検出（参加者パネルが閉じていても機能）
        const videoContainers = document.querySelectorAll('[data-participant-id], [data-requested-participant-id]');
        console.log('CS: 方法1 - ビデオコンテナ要素数:', videoContainers.length);
        
        videoContainers.forEach(container => {
            // 複数のセレクターを試す
            const nameSelectors = [
                '.zWGUib',              // 通常の名前表示
                '[jsname="EydYod"]',    // 別の名前要素
                '.XEazBc',              // ビデオタイルの名前
                '.adnwBd',              // ミュート時の名前表示
            ];
            
            let displayName = null;
            for (const selector of nameSelectors) {
                const nameEl = container.querySelector(selector);
                if (nameEl && nameEl.textContent.trim()) {
                    displayName = nameEl.textContent.trim();
                    break;
                }
            }
            
            // 名前が見つからない場合は、子要素のテキストを探す
            if (!displayName) {
                const textElements = container.querySelectorAll('*');
                for (const el of textElements) {
                    const text = el.textContent.trim();
                    if (text && text.length > 1 && text.length < 50 && 
                        !text.includes('ミュート') && 
                        !text.includes('カメラ') &&
                        !text.includes('画面') &&
                        el.children.length === 0) { // 子要素を持たない要素のみ
                        displayName = text;
                        break;
                    }
                }
            }
            
            if (displayName) {
                // 「さん」を除去
                displayName = displayName.replace(/さん$/, '');
                console.log('CS: 方法1で検出した名前:', displayName);
                
                // 無効な名前をフィルタリング
                if (displayName && 
                    displayName !== '' && 
                    displayName !== 'devices' && 
                    displayName !== 'peoplepeople' &&
                    !myDisplayNames.includes(displayName) &&
                    !displayName.includes('（あなた）') &&
                    !foundNames.has(displayName)) {
                    
                    foundNames.add(displayName);
                    
                    // 自分かどうかを判定
                    let isMe = false;
                    if (container.querySelector('.NnTWjc')?.textContent.includes('（あなた）')) {
                        isMe = true;
                    }
                    
                    participants.push({
                        uid: generateParticipantId(displayName),
                        displayName: displayName,
                        email: `${displayName.replace(/\s+/g, '').toLowerCase()}@unknown.com`,
                        isMe: isMe
                    });
                }
            }
        });
        
        // 方法2: 参加者パネルが開いている場合（data-participant-id要素から取得）
        const participantItems = document.querySelectorAll('[role="listitem"][data-participant-id]');
        console.log('CS: 方法2 - 参加者リスト要素数:', participantItems.length);
        
        if (participantItems.length > 0) {
            participantItems.forEach(item => {
                // より正確なセレクターで名前を取得
                const nameElement = item.querySelector('.zWGUib');
                const ariaLabel = item.getAttribute('aria-label');
                
                // 「（あなた）」が含まれていたらスキップ
                const isMe = item.querySelector('.NnTWjc')?.textContent.includes('（あなた）');
                if (isMe) {
                    console.log('CS: 自分を検出してスキップ');
                    return;
                }
                
                if (nameElement) {
                    let displayName = nameElement.textContent.trim();
                    // 「さん」を除去
                    displayName = displayName.replace(/さん$/, '');
                    console.log('CS: 方法2で検出した名前 (zWGUib):', displayName);
                    
                    // 無効な名前をフィルタリング
                    if (displayName && 
                        displayName !== '' && 
                        displayName !== 'devices' && 
                        displayName !== 'peoplepeople' &&
                        !myDisplayNames.includes(displayName) &&
                        !displayName.includes('（あなた）') &&
                        !foundNames.has(displayName)) {
                        
                        foundNames.add(displayName);
                        participants.push({
                            uid: generateParticipantId(displayName),
                            displayName: displayName,
                            email: `${displayName.replace(/\s+/g, '').toLowerCase()}@unknown.com`
                        });
                    }
                } else if (ariaLabel) {
                    // aria-labelから名前を取得（フォールバック）
                    console.log('CS: 方法2で検出したaria-label:', ariaLabel);
                    let displayName = ariaLabel.trim();
                    displayName = displayName.replace(/さん$/, '');
                    
                    if (displayName && 
                        displayName !== '' && 
                        displayName !== 'devices' && 
                        displayName !== 'peoplepeople' &&
                        !myDisplayNames.includes(displayName) &&
                        !displayName.includes('（あなた）') &&
                        !foundNames.has(displayName)) {
                        
                        foundNames.add(displayName);
                        participants.push({
                            uid: generateParticipantId(displayName),
                            displayName: displayName,
                            email: `${displayName.replace(/\s+/g, '').toLowerCase()}@unknown.com`
                        });
                    }
                }
            });
        }
        
        // 方法3: 画面下部のビデオタイルから参加者を検出
        const bottomBarTiles = document.querySelectorAll('.Gv1mTb-aTv5jf');
        console.log('CS: 方法3 - 画面下部タイル数:', bottomBarTiles.length);
        
        bottomBarTiles.forEach(tile => {
            const nameEl = tile.querySelector('.XEazBc, .adnwBd');
            if (nameEl) {
                let displayName = nameEl.textContent.trim();
                displayName = displayName.replace(/さん$/, '');
                console.log('CS: 方法3で検出した名前:', displayName);
                
                if (displayName && 
                    displayName !== '' && 
                    displayName !== '自分' && 
                    displayName !== 'devices' &&
                    displayName !== 'peoplepeople' &&
                    !myDisplayNames.includes(displayName) &&
                    !displayName.includes('ミュート') &&
                    !displayName.includes('（あなた）') &&
                    !foundNames.has(displayName)) {
                    
                    foundNames.add(displayName);
                    participants.push({
                        uid: generateParticipantId(displayName),
                        displayName: displayName,
                        email: `${displayName.replace(/\s+/g, '').toLowerCase()}@unknown.com`
                    });
                }
            }
        });
        
        console.log('CS: 最終的に検出された参加者:', participants);
        
    } catch (error) {
        console.error('CS: 参加者検出エラー:', error);
    }
    
    // 参加者がいない場合は空の配列を返す
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
        
        // ドロップダウンが開いている場合は更新
        const dropdown = document.getElementById('ping-dropdown-list');
        if (dropdown && !dropdown.classList.contains('hidden')) {
            updateTargetDropdown();
        }
    }
}

// --- スクリプトロード時の処理 ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
    initializeContentScript();
}

console.log('Meet Ping Extension content script loaded and initialized (with dropdown selector).');