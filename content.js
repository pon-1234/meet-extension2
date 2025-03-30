// content.js

// --- u30b0u30edu30fcu30d0u30ebu5909u6570 --- (u5909u66f4u306au3057)
let currentUser = null;
let currentMeetingId = null;
let database = null;
let auth = null;
let pinsRef = null;
let userPins = {};

// u30d4u30f3u306eu7a2eu985eu5b9au7fa9 (setupUIu306eu5916u306bu79fbu52d5u63a8u5968)
const PING_DEFINITIONS = {
    danger: { icon: 'u26a0ufe0f', label: 'u5371u967a' },
    onMyWay: { icon: 'u27a1ufe0f', label: 'u5411u304bu3063u3066u3044u308b' },
    question: { icon: 'u2753', label: 'u8ceau554f' },
    assist: { icon: 'ud83cudd98', label: 'u52a9u3051u3066' }
};
// u30e1u30cbu30e5u30fcu306eu914du7f6eu8a08u7b97u7528 (u89d2u5ea6[u5ea6]u3068u8dddu96e2[px])
const PING_MENU_POSITIONS = {
    danger: { angle: -90, distance: 70 },  // u4e0a
    onMyWay: { angle: 0, distance: 70 },   // u53f3
    question: { angle: 90, distance: 70 },  // u4e0b
    assist: { angle: 180, distance: 70 }  // u5de6
};

// --- Firebase u521du671fu5316/u8a8du8a3cu95a2u9023 --- (u5909u66f4u306au3057)
function initializeFirebase() {
  try {
    // firebaseConfig u306f firebase-config.js u3067u30b0u30edu30fcu30d0u30ebu306bu5b9au7fa9u3055u308cu3066u3044u308bu524du63d0
    if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') {
      console.error('Firebase SDK u307eu305fu306fu8a2du5b9au304cu8aadu307fu8fbcu307eu308cu3066u3044u307eu305bu3093u3002');
      showMessage('u30a8u30e9u30fc: u521du671fu5316u306bu5931u6557u3057u307eu3057u305fu3002');
      return;
    }

    // Background Script u3067u521du671fu5316u6e08u307fu306eu306fu305au306au306eu3067u3001u3053u3053u3067u306fu30a4u30f3u30b9u30bfu30f3u30b9u53d6u5f97u306eu307fu8a66u307fu308b
    console.log('Content script: Firebase SDK/Config loaded.');

    // u8a8du8a3cu72b6u614bu3092Background Scriptu306bu554fu3044u5408u308fu305bu308b
    requestAuthStatusFromBackground();

    // Meeting IDu3092u691cu51fa
    detectMeetingId();

  } catch (error) {
    console.error('Content script Firebase u521du671fu5316u51e6u7406u30a8u30e9u30fc:', error);
    showMessage('u30a8u30e9u30fc: u521du671fu5316u4e2du306bu554fu984cu304cu767au751fu3057u307eu3057u305fu3002');
  }
}

function requestAuthStatusFromBackground() {
  chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Error sending message to background:", chrome.runtime.lastError.message);
      // u30eau30c8u30e9u30a4u3084u30a8u30e9u30fcu8868u793au306au3069
      return;
    }
    handleAuthResponse(response); // u5fdcu7b54u3092u51e6u7406u3059u308bu95a2u6570u3092u547cu3073u51fau3059
  });
}

function handleAuthResponse(response) {
  const user = response?.user;
  console.log('Received auth status from background:', user);
  if (user && user.email.endsWith(`@${COMPANY_DOMAIN}`)) {
    currentUser = user;
    startPingSystem(); // UIu4f5cu6210u3084u30eau30b9u30cau30fcu8a2du5b9au3092u542bu3080u95a2u6570
  } else {
    currentUser = null;
    if (user) {
      console.warn('User not from allowed domain.');
      showMessage('u8a31u53efu3055u308cu305fu30c9u30e1u30a4u30f3u306eu30a2u30abu30a6u30f3u30c8u3067u306fu3042u308au307eu305bu3093u3002');
    } else {
      console.log('User not logged in.');
      // u30edu30b0u30a4u30f3u30d7u30edu30f3u30d7u30c8u8868u793au306au3069 (showLoginPrompt())
      showLoginPrompt();
    }
    cleanupUI(); // UIu3092u524au9664u307eu305fu306fu975eu8868u793au306bu3059u308b
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'authStatusChanged') {
    console.log('Auth status changed notification received:', message.user);
    // UIu306eu72b6u614bu3082u8a8du8a3cu72b6u614bu306bu5408u308fu305bu3066u66f4u65b0
    handleAuthResponse(message);
    // u3082u3057UIu304cu306au3044u72b6u614bu3067u30edu30b0u30a4u30f3u3057u305fu5834u5408u3001UIu3092u4f5cu308bu30c8u30eau30acu30fcu306b
    if (message.user && !document.getElementById('lol-ping-container') && currentMeetingId) {
      console.log('User logged in and UI not found, setting up UI.');
      setupUI();
      setupPinsListener(); // UIu3068u30eau30b9u30cau30fcu306fu30bbu30c3u30c8u3067
    } else if (!message.user) {
      cleanupUI(); // u30edu30b0u30a2u30a6u30c8u3057u305fu3089UIu524au9664
    }
    sendResponse({ received: true });
    return true;
  }
  // ... u4ed6u306eu30a2u30afu30b7u30e7u30f3 ...
});

// --- Meetu95a2u9023u51e6u7406 ---
function detectMeetingId() {
  const url = window.location.href;
  const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
  const match = url.match(meetRegex);

  const newMeetingId = match ? match[1] : null;

  // Meeting IDu304cu5909u66f4u3055u308cu305fu304bu3001Meetu30dau30fcu30b8u3067u306au304fu306au3063u305fu304b
  if (newMeetingId !== currentMeetingId) {
    console.log(`Meeting ID changed from ${currentMeetingId} to ${newMeetingId}`);

    // u4ee5u524du306eUIu3068u30eau30b9u30cau30fcu3092u30afu30eau30fcu30f3u30a2u30c3u30d7
    cleanupUI();

    currentMeetingId = newMeetingId;

    if (currentMeetingId) {
      // u65b0u3057u3044Meetu30dau30fcu30b8u306eu5834u5408u3001u8a8du8a3cu6e08u307fu306au3089u30b7u30b9u30c6u30e0u958bu59cb
      if (currentUser) {
        console.log("New meeting detected, user is logged in. Starting ping system.");
        startPingSystem();
      } else {
        console.log("New meeting detected, user is not logged in. Requesting auth status.");
        requestAuthStatusFromBackground(); // u8a8du8a3cu72b6u614bu3092u78bau8a8d
      }
    } else {
      console.log("Not on a Meet page or ID not found.");
      // Meetu30dau30fcu30b8u3067u306au304fu306au3063u305fu306eu3067u4f55u3082u3057u306au3044 (cleanupUIu306fu65e2u306bu547cu3070u308cu305f)
    }
  } else if (currentMeetingId && currentUser && !document.getElementById('lol-ping-container')) {
    // u540cu3058Meetu30dau30fcu30b8u3060u304cUIu304cu306au3044u5834u5408 (u30eau30edu30fcu30c9u5f8cu306au3069)
    console.log("Same meeting ID, but UI not found. Setting up UI.");
    setupUI();
    setupPinsListener();
  } else {
    console.log("Meeting ID has not changed.");
  }
}
// --- u30d4u30f3u30b7u30b9u30c6u30e0u521du671fu5316u30fbu958bu59cb ---
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

  // UIu4f5cu6210u3068u30eau30b9u30cau30fcu8a2du5b9au3092u547cu3073u51fau3059
  setupUI(); // setupUIu5185u3067u5b58u5728u30c1u30a7u30c3u30afu3092u884cu3046
  setupPinsListener(); // setupPinsListeneru5185u3067u30eau30b9u30cau30fcu306eu91cdu8907u8a2du5b9au3092u9632u3050

  showMessage(`u30d4u30f3u30b7u30b9u30c6u30e0u8d77u52d5 (${currentUser.displayName || currentUser.email.split('@')[0]})`);
}

// --- UIu95a2u9023 ---

// UIu8981u7d20u3092u8ffdu52a0
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

  // u5168u4f53u306eu30b3u30f3u30c6u30ca (u4f4du7f6eu6c7au3081u7528)
  const container = document.createElement('div');
  container.id = 'lol-ping-container'; // styles.cssu3067 position: fixed u306au3069

  // --- u30d4u30f3u30e1u30cbu30e5u30fcu30dcu30bfu30f3 ---
  const pingButton = document.createElement('button');
  pingButton.id = 'ping-menu-button'; // u65e2u5b58u306eIDu3068u30b9u30bfu30a4u30ebu3092u6d41u7528
  pingButton.innerHTML = '<span>!</span>';
  pingButton.title = 'u30d4u30f3u30e1u30cbu30e5u30fcu3092u958bu304f';
  pingButton.addEventListener('click', togglePingMenu);
  container.appendChild(pingButton); // u30b3u30f3u30c6u30cau306bu8ffdu52a0

  // --- u30d4u30f3u30e1u30cbu30e5u30fc (u5186u5f62) ---
  const pingMenu = document.createElement('div');
  pingMenu.id = 'ping-menu';
  pingMenu.classList.add('hidden'); // u521du671fu72b6u614bu306fu975eu8868u793a

  // u4e2du592eu306e "PING" u30c6u30adu30b9u30c8
  const pingCenter = document.createElement('div');
  pingCenter.id = 'ping-center';
  pingCenter.textContent = 'PING';
  pingMenu.appendChild(pingCenter);

  // u30d4u30f3u30aau30d7u30b7u30e7u30f3u3092u5186u5468u4e0au306bu914du7f6e
  Object.keys(PING_DEFINITIONS).forEach(key => {
    const pingInfo = PING_DEFINITIONS[key];
    const posInfo = PING_MENU_POSITIONS[key];
    const option = document.createElement('div');
    option.className = 'ping-option';
    option.dataset.type = key;
    option.title = pingInfo.label; // u30c4u30fcu30ebu30c1u30c3u30d7u3067u30e9u30d9u30ebu8868u793a

    // u30a2u30a4u30b3u30f3u306eu307fu8868u793a
    const iconDiv = document.createElement('div');
    iconDiv.className = 'ping-icon';
    iconDiv.textContent = pingInfo.icon;
    option.appendChild(iconDiv);

    // u4f4du7f6eu8a08u7b97 (translateu3092u4f7fu7528)
    if (posInfo) {
        const angleRad = posInfo.angle * (Math.PI / 180);
        const x = Math.cos(angleRad) * posInfo.distance;
        const y = Math.sin(angleRad) * posInfo.distance;
        // calc(50% ...) u306eu4ee3u308fu308au306b translate u3067u4e2du5fc3u304bu3089u306eu76f8u5bfeu4f4du7f6eu3092u6307u5b9a
        option.style.position = 'absolute';
        option.style.top = '50%';
        option.style.left = '50%';
        // u8981u7d20u81eau8eabu306eu30b5u30a4u30bau306eu534au5206u3092u5f15u3044u3066u4e2du5fc3u306bu914du7f6e
        option.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    }

    option.addEventListener('click', (event) => {
      event.stopPropagation();
      createPin(key);
      pingMenu.classList.add('hidden'); // u30e1u30cbu30e5u30fcu3092u9589u3058u308b
    });
    pingMenu.appendChild(option);
  });
  container.appendChild(pingMenu); // u30b3u30f3u30c6u30cau306bu8ffdu52a0

  // --- u30d4u30f3u8868u793au30a8u30eau30a2 (u53f3u4e0au306bu8868u793a) ---
  const pinsArea = document.createElement('div');
  pinsArea.id = 'pins-area'; // u30b9u30bfu30a4u30ebu306fCSSu3067u6307u5b9a
  container.appendChild(pinsArea); // u30b3u30f3u30c6u30cau306bu8ffdu52a0

  // --- u8aacu660eu8868u793a (u5de6u4e0bu30dcu30bfu30f3u4ed8u8fd1) ---
  const instructions = document.createElement('div');
  instructions.id = 'ping-instructions'; // CSSu3067u30b9u30bfu30a4u30ebu6307u5b9a
  instructions.innerHTML = `
    <div class="font-bold mb-1">u4f7fu3044u65b9:</div>
    <div>1. u5de6u4e0bu306e[!]u30dcu30bfu30f3u3067u30e1u30cbu30e5u30fcu958bu9589</div>
    <div>2. u30a2u30a4u30b3u30f3u3092u9078u629eu3057u3066u30d4u30f3u4f5cu6210</div>
    <div>3. u8868u793au3055u308cu305fu30d4u30f3u3092u30afu30eau30c3u30afu3057u3066u524au9664</div>
  `;
  container.appendChild(instructions); // u30b3u30f3u30c6u30cau306bu8ffdu52a0


  // u5168u4f53u306eu30b3u30f3u30c6u30cau3092bodyu306bu8ffdu52a0
  document.body.appendChild(container);

  // u30e1u30cbu30e5u30fcu5916u30afu30eau30c3u30afu3067u9589u3058u308bu30a4u30d9u30f3u30c8u30eau30b9u30cau30fc
  document.removeEventListener('click', handleDocumentClickForMenu);
  document.addEventListener('click', handleDocumentClickForMenu);

  console.log('u30d4u30f3UIu304c body u306bu8ffdu52a0u3055u308cu307eu3057u305f');
}

// UIu8981u7d20u3092u524au9664
function cleanupUI() {
  console.log("cleanupUI: Attempting to remove UI...");

  // Firebaseu30eau30b9u30cau30fcu3092u30c7u30bfu30c3u30c1
  if (pinsRef) {
      pinsRef.off();
      pinsRef = null;
      console.log("Detached Firebase pins listener during cleanup.");
  }

  // u30a4u30d9u30f3u30c8u30eau30b9u30cau30fcu524au9664
  document.removeEventListener('click', handleDocumentClickForMenu);

  // UIu8981u7d20u306eu524au9664
  const container = document.getElementById('lol-ping-container');
  if (container) {
    container.remove();
    console.log('u30d4u30f3UIu30b3u30f3u30c6u30cau304cu524au9664u3055u308cu307eu3057u305f');
  } else {
    console.log("cleanupUI: UI container not found.");
  }
  // u500bu5225u306eu8981u7d20uff08u30d7u30edu30f3u30d7u30c8u306au3069uff09u3082u524au9664
  const loginPrompt = document.getElementById('ping-login-prompt');
  if (loginPrompt) loginPrompt.remove();
  const messageArea = document.getElementById('lol-ping-message');
  if (messageArea) messageArea.remove();
}

// u30e1u30cbu30e5u30fcu5916u30afu30eau30c3u30afu3067u9589u3058u308bu30cfu30f3u30c9u30e9
function handleDocumentClickForMenu(event) {
    const menu = document.getElementById('ping-menu');
    const button = document.getElementById('ping-menu-button'); // IDu78bau8a8d
    if (menu && !menu.classList.contains('hidden')) {
        // u30e1u30cbu30e5u30fcu81eau8eabu307eu305fu306fu30dcu30bfu30f3uff08u3068u305du306eu5185u90e8u8981u7d20uff09u4ee5u5916u304cu30afu30eau30c3u30afu3055u308cu305fu3089u9589u3058u308b
        if (!menu.contains(event.target) && !button.contains(event.target)) {
             menu.classList.add('hidden');
        }
    }
}

// u30d4u30f3u30e1u30cbu30e5u30fcu306eu8868u793au5207u66ffu95a2u6570
function togglePingMenu(event) {
    event.stopPropagation(); // u30c9u30adu30e5u30e1u30f3u30c8u30afu30eau30c3u30afu3078u306eu4f1du64adu3092u9632u3050
    const pingMenu = document.getElementById('ping-menu');
    if (pingMenu) {
        pingMenu.classList.toggle('hidden');
    }
}

// u30edu30b0u30a4u30f3u30d7u30edu30f3u30d7u30c8u8868u793a
function showLoginPrompt() {
  // u65e2u5b58u306eu30d7u30edu30f3u30d7u30c8u304cu3042u308cu3070u524au9664
  const existingPrompt = document.getElementById('ping-login-prompt');
  if (existingPrompt) {
    existingPrompt.remove();
  }

  const prompt = document.createElement('div');
  prompt.id = 'ping-login-prompt';
  prompt.innerHTML = `
    <div class="ping-login-content">
      <h3>u30d4u30f3u6a5fu80fdu3078u306eu30edu30b0u30a4u30f3</h3>
      <p>u30d4u30f3u6a5fu80fdu3092u4f7fu7528u3059u308bu306bu306fu3001u30edu30b0u30a4u30f3u304cu5fc5u8981u3067u3059u3002</p>
      <button id="ping-login-button">u30edu30b0u30a4u30f3</button>
    </div>
  `;

  document.body.appendChild(prompt);

  // u30edu30b0u30a4u30f3u30dcu30bfu30f3u306eu30a4u30d9u30f3u30c8u30eau30b9u30cau30fc
  document.getElementById('ping-login-button').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'requestLogin' }, (response) => {
      if (response && response.started) {
        prompt.remove();
      }
    });
  });
}
// --- Firebase Realtime Database u64cdu4f5c ---
// u30c7u30fcu30bfu30d9u30fcu30b9u30a4u30f3u30b9u30bfu30f3u30b9u3092u53d6u5f97u3059u308bu30d8u30ebu30d1u30fcu95a2u6570
function getDatabase() {
  if (!database) {
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
      database = firebase.database();
      console.log('u30c7u30fcu30bfu30d9u30fcu30b9u30a4u30f3u30b9u30bfu30f3u30b9u3092u53d6u5f97u3057u307eu3057u305f');
    } else {
      console.error('u30c7u30fcu30bfu30d9u30fcu30b9u3092u53d6u5f97u3067u304du307eu305bu3093: Firebase u304cu521du671fu5316u3055u308cu3066u3044u307eu305bu3093u3002');
      return null;
    }
  }
  return database;
}

// u30d4u30f3u3092u4f5cu6210
function createPin(pingType) {
  if (!currentUser || !currentMeetingId) {
    console.error('u30d4u30f3u3092u4f5cu6210u3067u304du307eu305bu3093: u30e6u30fcu30b6u30fcu304cu30edu30b0u30a4u30f3u3057u3066u3044u306au3044u304bu3001u30dfu30fcu30c6u30a3u30f3u30b0IDu304cu898bu3064u304bu308au307eu305bu3093u3002');
    showMessage('u30a8u30e9u30fc: u30d4u30f3u3092u4f5cu6210u3067u304du307eu305bu3093u3002u30edu30b0u30a4u30f3u72b6u614bu3092u78bau8a8du3057u3066u304fu3060u3055u3044u3002');
    return;
  }

  // u30c7u30fcu30bfu30d9u30fcu30b9u30a4u30f3u30b9u30bfu30f3u30b9u3092u53d6u5f97
  const db = getDatabase();
  if (!db) {
    console.error('u30c7u30fcu30bfu30d9u30fcu30b9u304cu5229u7528u3067u304du306au3044u305fu3081u30d4u30f3u3092u4f5cu6210u3067u304du307eu305bu3093');
    showMessage('u30a8u30e9u30fc: u30c7u30fcu30bfu30d9u30fcu30b9u63a5u7d9au306bu554fu984cu304cu3042u308au307eu3059u3002');
    return;
  }

  // pinsRefu304cu672au8a2du5b9au306eu5834u5408u306fu8a2du5b9a
  if (!pinsRef) {
    pinsRef = db.ref(`meetings/${currentMeetingId}/pins`);
  }

  // u30d4u30f3u30c7u30fcu30bfu306eu4f5cu6210
  const pin = {
    type: pingType,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    createdBy: {
      uid: currentUser.uid,
      displayName: currentUser.displayName || currentUser.email.split('@')[0],
      email: currentUser.email
    },
    expiresAt: Date.now() + 30000 // 30u79d2u5f8cu306bu6d88u3048u308b
  };

  // u30c7u30fcu30bfu30d9u30fcu30b9u306bu30d4u30f3u3092u8ffdu52a0
  const newPinRef = pinsRef.push();
  newPinRef.set(pin)
    .then(() => {
      console.log('u30d4u30f3u304cu4f5cu6210u3055u308cu307eu3057u305f:', newPinRef.key);

      // u81eau5206u306eu30d4u30f3u3092u8ffbu8de1
      userPins[newPinRef.key] = true;

      // u671fu9650u5207u308cu3067u81eau52d5u524au9664
      setTimeout(() => {
        newPinRef.remove()
          .then(() => console.log('u30d4u30f3u306eu671fu9650u304cu5207u308cu307eu3057u305f:', newPinRef.key))
          .catch(error => console.error('u30d4u30f3u306eu81eau52d5u524au9664u30a8u30e9u30fc:', error));
      }, 30000);
    })
    .catch(error => {
      console.error('u30d4u30f3u306eu4f5cu6210u30a8u30e9u30fc:', error);
      showMessage(`u30a8u30e9u30fc: u30d4u30f3u3092u4f5cu6210u3067u304du307eu305bu3093u3067u3057u305f: ${error.message}`);
    });
}

// DBu304bu3089u30d4u30f3u3092u524au9664u3059u308bu95a2u6570 (removePinu304bu3089u6539u540d or removePinu3092u4feeu6b63)
function removePinFromDb(pinId) {
    if (!currentUser || !currentMeetingId) return;
    const db = firebase.database();
    if (!db) return;
    const pinRef = db.ref(`meetings/${currentMeetingId}/pins/${pinId}`);

    pinRef.once('value')
      .then(snapshot => {
        const pin = snapshot.val();
        if (pin && pin.createdBy.uid === currentUser.uid) {
          return pinRef.remove(); // DBu304bu3089u524au9664
        } else {
          // u4ed6u4ebau306eu30d4u30f3u3084u5b58u5728u3057u306au3044u30d4u30f3
          return Promise.reject('Permission denied or Pin not found');
        }
      })
      .then(() => {
        console.log('u30d4u30f3u3092DBu304bu3089u524au9664u3057u307eu3057u305f:', pinId);
        // DOMu8981u7d20u306eu524au9664u306f child_removed u30eau30b9u30cau30fcu306bu4efbu305bu308b
         showMessage('u30d4u30f3u3092u524au9664u3057u307eu3057u305f');
      })
      .catch(error => {
        if (error !== 'Permission denied or Pin not found') {
          console.error('u30d4u30f3u306eDBu524au9664u30a8u30e9u30fc:', error);
           showMessage('u30a8u30e9u30fc: u30d4u30f3u306eu524au9664u306bu5931u6557u3057u307eu3057u305fu3002');
        }
      });
}

// u30d4u30f3u306eu5909u66f4u3092u30eau30c3u30b9u30f3
function setupPinsListener() {
  if (!currentUser || !currentMeetingId) {
    console.log("setupPinsListener: Skipping, no user or meeting ID.");
    return;
  }

  // u30c7u30fcu30bfu30d9u30fcu30b9u30a4u30f3u30b9u30bfu30f3u30b9u3092u53d6u5f97
  const db = getDatabase();
  if (!db) {
    console.error("setupPinsListener: Database not available.");
    return;
  }

  const newPinsRef = db.ref(`meetings/${currentMeetingId}/pins`);

  // u65e2u306bu540cu3058Refu3067u30eau30b9u30cau30fcu304cu8a2du5b9au3055u308cu3066u3044u308bu304bu30c1u30a7u30c3u30af (u53b3u5bc6u306bu306fu96e3u3057u3044u304cu3001u8a66u307fu308b)
  // u7c21u5358u306au65b9u6cd5u306fu3001u53e4u3044u53c2u7167u304cu3042u308cu3070offu306bu3057u3066u65b0u3057u3044u53c2u7167u3067onu306bu3059u308bu3053u3068
  if (pinsRef) {
    console.log("setupPinsListener: Detaching previous listener.");
    pinsRef.off();
  }

  pinsRef = newPinsRef; // u73feu5728u306eu53c2u7167u3092u4fddu6301
  console.log("Setting up new pins listener for:", currentMeetingId);

  // child_added u30eau30b9u30cau30fc
  pinsRef.on('child_added', (snapshot) => {
    const pinId = snapshot.key;
    const pin = snapshot.val();
    if (!pin) return; // u30c7u30fcu30bfu304cu306au3044u5834u5408u306fu7121u8996
    console.log('Pin added (child_added):', pinId, pin);
    renderPin(pinId, pin);
  }, (error) => {
    console.error('Error listening for child_added:', error);
    showMessage('u30a8u30e9u30fc: u30d4u30f3u306eu53d7u4fe1u306bu5931u6557u3057u307eu3057u305fu3002');
  });

  // child_removed u30eau30b9u30cau30fc
  pinsRef.on('child_removed', (snapshot) => {
    const pinId = snapshot.key;
    console.log('Pin removed (child_removed):', pinId);
    const pinElement = document.getElementById(`pin-${pinId}`);
    if (pinElement) {
      // u30a2u30cbu30e1u30fcu30b7u30e7u30f3u4ed8u304du3067u524au9664u3059u308bu5834u5408
      pinElement.classList.remove('show');
      pinElement.classList.add('hide');
      setTimeout(() => {
        pinElement.remove();
        console.log('DOMu304bu3089u30d4u30f3u8981u7d20u3092u524au9664:', pinId);
      }, 300); // u30a2u30cbu30e1u30fcu30b7u30e7u30f3u6642u9593

      if (userPins[pinId]) {
        delete userPins[pinId];
      }
    }
  }, (error) => {
    console.error('Error listening for child_removed:', error);
  });
}

// u30d4u30f3u3092u8868u793a
function renderPin(pinId, pin) {
  const pinsArea = document.getElementById('pins-area');
  if (!pinsArea) {
      console.error("renderPin: #pins-area not found.");
      return;
  }

  // u53e4u3044u30d4u30f3u304cu3042u308cu3070u524au9664
  const existingPin = document.getElementById(`pin-${pinId}`);
  if (existingPin) {
    existingPin.remove();
  }

  const pingInfo = PING_DEFINITIONS[pin.type] || { icon: 'u2753', label: 'u4e0du660e' };

  // u30d4u30f3u8981u7d20u3092u4f5cu6210 (Reactu30b3u30f3u30ddu30fcu30cdu30f3u30c8u306eu69d8u9020u306bu5408u308fu305bu308b)
  const pinElement = document.createElement('div');
  pinElement.id = `pin-${pinId}`;
  pinElement.className = 'pin'; // u5fc5u8981u306au3089 pin.type u30afu30e9u30b9u3082u8ffdu52a0
  pinElement.dataset.createdBy = pin.createdBy.uid; // u524au9664u5224u5b9au7528u306bUIDu3092u4fddu6301

  // u30a2u30a4u30b3u30f3u90e8u5206
  const iconDiv = document.createElement('div');
  iconDiv.className = 'pin-icon'; // CSSu3067u30b9u30bfu30a4u30ebu6307u5b9a
  iconDiv.textContent = pingInfo.icon;
  pinElement.appendChild(iconDiv);

   // u8a73u7d30u90e8u5206uff08u30e9u30d9u30ebu3068u30e6u30fcu30b6u30fcu540duff09
   const detailsDiv = document.createElement('div');
   detailsDiv.className = 'pin-details';

   const labelDiv = document.createElement('div');
   labelDiv.className = 'pin-label';
   labelDiv.textContent = pingInfo.label;
   detailsDiv.appendChild(labelDiv);

   const userDiv = document.createElement('div');
   userDiv.className = 'pin-user';
   userDiv.textContent = pin.createdBy.displayName || 'u4e0du660e'; // Firebaseu306eu30c7u30fcu30bfu69d8u9020u306bu5408u308fu305bu308b
   detailsDiv.appendChild(userDiv);

   pinElement.appendChild(detailsDiv);


  // u81eau5206u306eu30d4u30f3u306au3089u30afu30eau30c3u30afu3067u524au9664u53efu80fdu306b
  if (currentUser && pin.createdBy.uid === currentUser.uid) {
    pinElement.classList.add('my-pin');
    pinElement.title = 'u30afu30eau30c3u30afu3057u3066u524au9664';
    pinElement.addEventListener('click', () => removePinFromDb(pinId)); // DBu304bu3089u524au9664u3059u308bu95a2u6570u3092u547cu3076
  }

  // u753bu9762u306bu8ffdu52a0u3057u3066u8868u793au30a2u30cbu30e1u30fcu30b7u30e7u30f3
  pinsArea.appendChild(pinElement);
  // requestAnimationFrame u3092u4f7fu3046u3068u3088u308au30b9u30e0u30fcu30bau306bu306au308bu5834u5408u304cu3042u308b
  setTimeout(() => {
    pinElement.classList.add('show');
  }, 10); // u5c11u3057u9045u5ef6u3055u305bu3066CSSu30c8u30e9u30f3u30b8u30b7u30e7u30f3u3092u767au52d5

  // u53e4u3044u30d4u30f3u3092u81eau52d5u524au9664uff08u671fu9650u5207u308cuff09- u3053u306eu30edu30b8u30c3u30afu306fDBu5074(createPin)u3067u62c5u4fddu3055u308cu3066u3044u308bu306fu305a
  // u3082u3057u30afu30e9u30a4u30a2u30f3u30c8u5074u3067u3082u6d88u3059u306au3089 expiresAt u3092u4f7fu3046
   const expiresAt = pin.expiresAt || (pin.timestamp + 30000); // expiresAtu304cu306au3044u5834u5408u306ftimestampu304bu3089u8a08u7b97(u8981u8abfu6574)
   const timeoutDuration = Math.max(0, expiresAt - Date.now());
   setTimeout(() => {
       if (pinElement.parentNode) {
           pinElement.classList.remove('show');
           pinElement.classList.add('hide');
           setTimeout(() => pinElement.remove(), 300); // u30a2u30cbu30e1u30fcu30b7u30e7u30f3u5f8cu306bu524au9664
       }
   }, timeoutDuration);
}

// u30e1u30c3u30bbu30fcu30b8u3092u8868u793auff08u4e00u6642u7684uff09
let messageTimeout;
function showMessage(text, isError = false) { // u30a8u30e9u30fcu8868u793au5bfeu5fdc
  const messageArea = document.getElementById('lol-ping-message') || createMessageArea(); // IDu5909u66f4

  clearTimeout(messageTimeout);
  messageArea.textContent = text;
  // u30a8u30e9u30fcu304bu3069u3046u304bu3067u30b9u30bfu30a4u30ebu3092u5909u66f4
  messageArea.style.backgroundColor = isError ? 'rgba(244, 67, 54, 0.9)' : 'rgba(76, 175, 80, 0.9)';
  messageArea.classList.add('show'); // u8868u793au30afu30e9u30b9u8ffdu52a0

  messageTimeout = setTimeout(() => {
    messageArea.classList.remove('show'); // u975eu8868u793au30afu30e9u30b9u524au9664
  }, 3000);
}

// u30e1u30c3u30bbu30fcu30b8u8868u793au7528u306eu9818u57dfu3092u4f5cu6210
function createMessageArea() {
    let area = document.getElementById('lol-ping-message'); // IDu5909u66f4
    if (!area) {
        area = document.createElement('div');
        area.id = 'lol-ping-message'; // IDu5909u66f4
        // u30b9u30bfu30a4u30ebu306f styles.css u3067u5b9au7fa9
        document.body.appendChild(area);
    }
    return area;
}

// --- u521du671fu5316u30c8u30eau30acu30fc --- (u5909u66f4u306au3057)
let lastUrl = location.href;
const observer = new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    console.log(`URL changed from ${lastUrl} to ${url}`);
    lastUrl = url;
    // URLu304cu5909u308fu3063u305fu3089Meeting IDu3092u518du691cu51fa → UI/u30eau30b9u30cau30fcu306eu30eau30bbu30c3u30c8u3082u3053u3053u3067u884cu3046
    detectMeetingId();
  }
});

// DOMu306eu5909u66f4u76e3u8996u3092u958bu59cbu3059u308bu95a2u6570
function startObserver() {
  // u65e2u306bu76e3u8996u4e2du304bu3082u3057u308cu306au3044u306eu3067u3001u5ff5u306eu305fu3081u505cu6b62
  observer.disconnect();
  // bodyu8981u7d20u306eu6e96u5099u3092u5f85u3064 (Meetu306eu30edu30fcu30c9u304cu9045u3044u5834u5408u304cu3042u308bu305fu3081)
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
    // u521du56deu306eMeeting IDu691cu51fa
    detectMeetingId();
  });
}

// u521du671fu5316u51e6u7406
initializeFirebase(); // Firebaseu8a2du5b9au8aadu307fu8fbcu307fu3068u8a8du8a3cu72b6u614bu78bau8a8du958bu59cb
startObserver();    // DOMu76e3u8996u958bu59cb

console.log('Meet LoL-Style Ping content script loaded.');
