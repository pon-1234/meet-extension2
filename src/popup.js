// popup.js

// Language Manager for popup
const PopupLanguageManager = {
  currentLanguage: 'ja',
  
  async init() {
    try {
      const result = await chrome.storage.sync.get(['language']);
      this.currentLanguage = result.language || 'ja';
      this.updateLanguageSelector();
      this.updateTexts();
    } catch (error) {
      console.log('Language initialization failed, using default:', error);
      this.currentLanguage = 'ja';
      this.updateTexts();
    }
  },
  
  async setLanguage(language) {
    this.currentLanguage = language;
    try {
      await chrome.storage.sync.set({ language });
      this.updateTexts();
      // Notify content script about language change
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {action: 'languageChanged', language});
        }
      });
    } catch (error) {
      console.error('Failed to save language preference:', error);
    }
  },
  
  updateLanguageSelector() {
    const selector = document.getElementById('language-select');
    if (selector) {
      selector.value = this.currentLanguage;
    }
  },
  
  getText(category, key) {
    const texts = {
      ja: {
        ui: {
          status_loading: 'ステータス: 読み込み中...',
          status_checking: 'ステータス: 認証状態を確認中...',
          status_loggedIn: 'ステータス: ログイン済み',
          status_notLoggedIn: 'ステータス: 未ログイン',
          loginRequired: 'この拡張機能を使用するには、ログインが必要です。',
          loginButton: 'Googleアカウントでログイン',
          loginInProgress: 'ログイン処理中...',
          logoutButton: 'ログアウト',
          logoutInProgress: 'ログアウト中...',
          loggedInAs: 'ログイン中: ',
          selectGoogleAccount: 'Googleアカウントを選択してください...',
          instructions: '使い方'
        }
      },
      en: {
        ui: {
          status_loading: 'Status: Loading...',
          status_checking: 'Status: Checking authentication...',
          status_loggedIn: 'Status: Logged in',
          status_notLoggedIn: 'Status: Not logged in',
          loginRequired: 'Please log in to use this extension.',
          loginButton: 'Sign in with Google',
          loginInProgress: 'Signing in...',
          logoutButton: 'Sign out',
          logoutInProgress: 'Signing out...',
          loggedInAs: 'Signed in as: ',
          selectGoogleAccount: 'Please select your Google account...',
          instructions: 'How to use'
        }
      }
    };
    
    const langDef = texts[this.currentLanguage];
    if (!langDef || !langDef[category] || !langDef[category][key]) {
      return texts.ja[category]?.[key] || key;
    }
    return langDef[category][key];
  },
  
  updateTexts() {
    // Update all text elements
    const elements = [
      { id: 'login-section p', text: this.getText('ui', 'loginRequired') },
      { id: 'user-info p', textPrefix: this.getText('ui', 'loggedInAs') },
      { id: 'instructions h2', text: this.getText('ui', 'instructions') }
    ];
    
    elements.forEach(element => {
      const el = element.id.includes(' ') 
        ? document.querySelector(`#${element.id}`)
        : document.getElementById(element.id);
      
      if (el && element.text) {
        el.textContent = element.text;
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', function() {
  const statusElement = document.getElementById('status');
  const userInfoElement = document.getElementById('user-info');
  const userEmailElement = document.getElementById('user-email');
  const loginSectionElement = document.getElementById('login-section');
  const loginButton = document.getElementById('login-button');
  const logoutButton = document.getElementById('logout-button');
  const errorMessageElement = document.getElementById('error-message');
  const languageSelect = document.getElementById('language-select');
  
  // Initialize language manager
  PopupLanguageManager.init();
  
  // Language selector event listener
  languageSelect.addEventListener('change', function() {
    PopupLanguageManager.setLanguage(this.value);
  });

  function displayError(message) {
      errorMessageElement.textContent = message;
  }

  function updatePopupUI(user) {
    displayError('');
    if (user) {
      statusElement.textContent = PopupLanguageManager.getText('ui', 'status_loggedIn');
      userEmailElement.textContent = user.displayName || user.email;
      loginSectionElement.style.display = 'none';
      userInfoElement.style.display = 'block';
    } else {
      statusElement.textContent = PopupLanguageManager.getText('ui', 'status_notLoggedIn');
      loginSectionElement.style.display = 'block';
      userInfoElement.style.display = 'none';
    }
    loginButton.disabled = false;
    loginButton.textContent = PopupLanguageManager.getText('ui', 'loginButton');
    logoutButton.disabled = false;
    logoutButton.textContent = PopupLanguageManager.getText('ui', 'logoutButton');
  }

  loginButton.addEventListener('click', function() {
    loginButton.disabled = true;
    loginButton.textContent = PopupLanguageManager.getText('ui', 'loginInProgress');
    displayError('');
    // Backgroundにログイン"要求"を送信 (アクション名を変更)
    chrome.runtime.sendMessage({ action: 'requestLogin' }) // ★ 'signIn' から変更
        .then(response => {
            if (response && response.started) {
                statusElement.textContent = PopupLanguageManager.getText('ui', 'selectGoogleAccount');
                // ログイン成功後のUI更新はBackgroundからの通知に任せる
            } else {
                displayError(response?.error || 'ログインを開始できませんでした。');
                loginButton.disabled = false;
                loginButton.textContent = PopupLanguageManager.getText('ui', 'loginButton');
            }
        })
        .catch(error => {
            handleMessageError(error, 'background', 'requestLogin');
            displayError(`ログイン開始エラー: ${error.message || '不明なエラー'}`);
            loginButton.disabled = false;
            loginButton.textContent = PopupLanguageManager.getText('ui', 'loginButton');
        });
  });

  logoutButton.addEventListener('click', function() {
      logoutButton.disabled = true;
      logoutButton.textContent = PopupLanguageManager.getText('ui', 'logoutInProgress');
      chrome.runtime.sendMessage({ action: 'requestLogout' }) // ★アクション名変更
        .then(response => {
            if (!response?.success) {
                console.error("Logout request failed:", response?.error);
                displayError(`ログアウトエラー: ${response?.error || '不明なエラー'}`);
            } else {
                console.log("Logout successful via popup request.");
                // UI更新はBackgroundからの通知に任せる
            }
            logoutButton.disabled = false;
            logoutButton.textContent = PopupLanguageManager.getText('ui', 'logoutButton');
        })
        .catch(error => {
             handleMessageError(error, 'background', 'requestLogout');
             displayError(`ログアウトエラー: ${error.message || '不明なエラー'}`);
             logoutButton.disabled = false;
             logoutButton.textContent = PopupLanguageManager.getText('ui', 'logoutButton');
        });
  });

  // --- Background Scriptとの連携 ---
  statusElement.textContent = PopupLanguageManager.getText('ui', 'status_checking');
  chrome.runtime.sendMessage({ action: 'getAuthStatus' })
    .then(response => {
        // console.log("Initial auth status from background:", response?.user);
        updatePopupUI(response?.user);
    })
    .catch(error => {
        handleMessageError(error, 'background', 'getAuthStatus');
        statusElement.textContent = '状態取得エラー';
        displayError(`状態取得エラー: ${error.message || '不明なエラー'}`);
        updatePopupUI(null);
    });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (chrome.runtime.lastError) { return; }
      if (message.action === 'authStatusChanged') {
          // console.log("Popup received auth status update from background:", message.user);
          updatePopupUI(message.user);
          return true;
      }
  });

  // --- メッセージ送信エラーハンドリング ---
  function handleMessageError(error, targetDesc, actionDesc = 'message') {
      if (!error) return;
      const ignoreErrors = ['Receiving end does not exist', 'Extension context invalidated'];
      if (!ignoreErrors.some(msg => error.message?.includes(msg))) {
          console.warn(`Popup: Error sending ${actionDesc} to ${targetDesc}: ${error.message || error}`);
      }
  }

  // console.log("Popup script initialized.");
});