// Google Meetu306eu753bu9762u306bu30d4u30f3u6a5fu80fdu3092u8ffdu52a0u3059u308bu30b3u30f3u30c6u30f3u30c4u30b9u30afu30eau30d7u30c8

// u30b0u30edu30fcu30d0u30ebu5909u6570
let currentUser = null;
let currentMeetingId = null;
let database = null;
let auth = null;
let pinsRef = null;
let userPins = {}; // u30e6u30fcu30b6u30fcu304cu4f5cu6210u3057u305fu30d4u30f3u3092u8ffdu8de1

// Firebaseu521du671fu5316
function initializeFirebase() {
  try {
    // Firebaseu8a2du5b9au306fu65e2u306bfirebase-config.jsu304bu3089u8aadu307fu8fbcu307eu308cu3066u3044u308bu306fu305a
    console.log('Firebaseu521du671fu5316u4e2d...');
    
    // Firebaseu304cu521du671fu5316u3055u308cu3066u3044u306au3044u5834u5408u306eu307f
    if (typeof firebase !== 'undefined' && !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    
    auth = firebase.auth();
    database = firebase.database();
    
    // u8a8du8a3cu72b6u614bu306eu76e3u8996u3092u8a2du5b9a
    setupAuthListener();
    
    // Meeting IDu3092u53d6u5f97
    detectMeetingId();
    
    console.log('Firebaseu521du671fu5316u5b8cu4e86');
  } catch (error) {
    console.error('Firebaseu521du671fu5316u30a8u30e9u30fc:', error);
  }
}

// Meeting IDu3092URLu304bu3089u53d6u5f97
function detectMeetingId() {
  const url = window.location.href;
  const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
  const match = url.match(meetRegex);
  
  if (match && match[1]) {
    currentMeetingId = match[1];
    console.log('u691cu51fau3055u308cu305fMeeting ID:', currentMeetingId);
    
    // u30d4u30f3u306eu53c2u7167u3092u8a2du5b9a
    if (database && currentUser) {
      setupPinsListener();
    }
    
    // UIu3092u8ffdu52a0
    setupUI();
  } else {
    console.log('Meeting IDu304cu898bu3064u304bu308au307eu305bu3093');
    currentMeetingId = null;
  }
}

// u8a8du8a3cu72b6u614bu306eu76e3u8996
function setupAuthListener() {
  if (!auth) return;
  auth.onAuthStateChanged((user) => {
    if (user) { // u30c9u30e1u30a4u30f3u5236u9650u306fu5fc5u8981u306bu5fdcu3058u3066u8ffdu52a0
      currentUser = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0]
      };
      
      console.log('u30edu30b0u30a4u30f3u4e2d:', currentUser.email);
      
      // Meeting IDu304cu3042u308cu3070u30d4u30f3u306eu30eau30b9u30cau30fcu3092u8a2du5b9a
      if (currentMeetingId) {
        setupPinsListener();
      }
      
      // UIu3092u8ffdu52a0
      setupUI();
    } else {
      console.log('u672au30edu30b0u30a4u30f3u72b6u614b');
      currentUser = null;
      cleanupUI();
    }
  });
}

// u30d4u30f3u306eu30eau30a2u30ebu30bfu30a4u30e0u30eau30b9u30cau30fcu3092u8a2du5b9a
function setupPinsListener() {
  if (!database || !currentMeetingId) return;
  
  // u65e2u5b58u306eu30eau30b9u30cau30fcu3092u30afu30eau30fcu30f3u30a2u30c3u30d7
  if (pinsRef) {
    pinsRef.off();
  }
  
  // u65b0u3057u3044u30eau30b9u30cau30fcu3092u8a2du5b9a
  pinsRef = database.ref(`meetings/${currentMeetingId}/pins`);
  
  // u65b0u3057u3044u30d4u30f3u304cu8ffdu52a0u3055u308cu305fu3068u304d
  pinsRef.on('child_added', (snapshot) => {
    const pinId = snapshot.key;
    const pin = snapshot.val();
    console.log('u65b0u3057u3044u30d4u30f3:', pinId, pin);
    renderPin(pinId, pin);
  });
  
  // u30d4u30f3u304cu524au9664u3055u308cu305fu3068u304d
  pinsRef.on('child_removed', (snapshot) => {
    const pinId = snapshot.key;
    console.log('u30d4u30f3u304cu524au9664u3055u308cu307eu3057u305f:', pinId);
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

// UIu8981u7d20u3092u524au9664
function cleanupUI() {
  const container = document.getElementById('lol-ping-container');
  if (container) {
    container.remove();
    console.log('u30d4u30f3UIu304cu524au9664u3055u308cu307eu3057u305f');
  }
}

// u30d4u30f3u3092u4f5cu6210
function createPin(pingType) {
  if (!currentUser || !currentMeetingId) {
    console.error('u30d4u30f3u3092u4f5cu6210u3067u304du307eu305bu3093: u30e6u30fcu30b6u30fcu304cu30edu30b0u30a4u30f3u3057u3066u3044u306au3044u304bu3001u30dfu30fcu30c6u30a3u30f3u30b0IDu304cu898bu3064u304bu308au307eu305bu3093u3002');
    showMessage('u30a8u30e9u30fc: u30d4u30f3u3092u4f5cu6210u3067u304du307eu305bu3093u3002u30edu30b0u30a4u30f3u72b6u614bu3092u78bau8a8du3057u3066u304fu3060u3055u3044u3002');
    return;
  }
  
  // u30d4u30f3u30c7u30fcu30bfu306eu4f5cu6210
  const pin = {
    type: pingType,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    createdBy: {
      uid: currentUser.uid,
      displayName: currentUser.displayName,
      email: currentUser.email
    },
    expiresAt: Date.now() + 30000 // 30u79d2u5f8cu306bu6d88u3048u308b
  };
  
  // u30c7u30fcu30bfu30d9u30fcu30b9u306bu30d4u30f3u3092u8ffdu52a0
  const newPinRef = pinsRef.push();
  newPinRef.set(pin)
    .then(() => {
      console.log('u30d4u30f3u304cu4f5cu6210u3055u308cu307eu3057u305f:', newPinRef.key);
      
      // u81eau5206u306eu30d4u30f3u3092u8ffdu8de1
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
