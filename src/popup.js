// popup.js

document.addEventListener('DOMContentLoaded', function() {
  const statusElement = document.getElementById('status');
  const userInfoElement = document.getElementById('user-info');
  const userEmailElement = document.getElementById('user-email');
  const loginSectionElement = document.getElementById('login-section');
  const loginButton = document.getElementById('login-button');
  const logoutButton = document.getElementById('logout-button');
  const errorMessageElement = document.getElementById('error-message');

  function displayError(message) {
      errorMessageElement.textContent = message;
  }

  function updatePopupUI(user) {
    displayError('');
    if (user) {
      statusElement.textContent = 'ステータス: ログイン済み';
      userEmailElement.textContent = user.displayName || user.email;
      loginSectionElement.style.display = 'none';
      userInfoElement.style.display = 'block';
    } else {
      statusElement.textContent = 'ステータス: 未ログイン';
      loginSectionElement.style.display = 'block';
      userInfoElement.style.display = 'none';
    }
    loginButton.disabled = false;
    loginButton.textContent = 'Googleアカウントでログイン';
    logoutButton.disabled = false;
    logoutButton.textContent = 'ログアウト';
  }

  loginButton.addEventListener('click', function() {
    loginButton.disabled = true;
    loginButton.textContent = 'ログイン処理中...';
    displayError('');
    // Backgroundにログイン"要求"を送信 (アクション名を変更)
    chrome.runtime.sendMessage({ action: 'requestLogin' }) // ★ 'signIn' から変更
        .then(response => {
            if (response && response.started) {
                statusElement.textContent = 'Googleアカウントを選択してください...';
                // ログイン成功後のUI更新はBackgroundからの通知に任せる
            } else {
                displayError(response?.error || 'ログインを開始できませんでした。');
                loginButton.disabled = false;
                loginButton.textContent = 'Googleアカウントでログイン';
            }
        })
        .catch(error => {
            handleMessageError(error, 'background', 'requestLogin');
            displayError(`ログイン開始エラー: ${error.message || '不明なエラー'}`);
            loginButton.disabled = false;
            loginButton.textContent = 'Googleアカウントでログイン';
        });
  });

  logoutButton.addEventListener('click', function() {
      logoutButton.disabled = true;
      logoutButton.textContent = 'ログアウト中...';
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
            logoutButton.textContent = 'ログアウト';
        })
        .catch(error => {
             handleMessageError(error, 'background', 'requestLogout');
             displayError(`ログアウトエラー: ${error.message || '不明なエラー'}`);
             logoutButton.disabled = false;
             logoutButton.textContent = 'ログアウト';
        });
  });

  // --- Background Scriptとの連携 ---
  statusElement.textContent = 'ステータス: 認証状態を確認中...';
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