// popup.js - Firebase SDK v9モジュラー形式に変換

document.addEventListener('DOMContentLoaded', function() {
  const statusElement = document.getElementById('status');
  const userInfoElement = document.getElementById('user-info');
  const userEmailElement = document.getElementById('user-email');
  const loginSectionElement = document.getElementById('login-section');
  const loginButton = document.getElementById('login-button');
  const logoutButton = document.getElementById('logout-button');
  const errorMessageElement = document.getElementById('error-message');

  // エラーメッセージ表示関数
  function displayError(message) {
      errorMessageElement.textContent = message;
  }

  // UI更新関数
  function updatePopupUI(user) {
    displayError(''); // エラークリア
    if (user) {
      statusElement.textContent = 'ステータス: ログイン済み';
      userEmailElement.textContent = user.displayName || user.email; // displayName優先
      loginSectionElement.style.display = 'none';
      userInfoElement.style.display = 'block';
    } else {
      statusElement.textContent = 'ステータス: 未ログイン';
      loginSectionElement.style.display = 'block';
      userInfoElement.style.display = 'none';
    }
    // ボタンの状態リセット
    loginButton.disabled = false;
    loginButton.textContent = 'Googleアカウントでログイン';
  }

  // ログインボタンのクリックイベント
  loginButton.addEventListener('click', function() {
    loginButton.disabled = true;
    loginButton.textContent = 'ログイン処理中...';
    displayError('');

    // Background Scriptにログインをリクエスト
    chrome.runtime.sendMessage({ action: 'requestLogin' }, function(response) {
      if (chrome.runtime.lastError) {
          console.error("Login request error:", chrome.runtime.lastError.message);
          displayError(`ログイン開始エラー: ${chrome.runtime.lastError.message}`);
          loginButton.disabled = false;
          loginButton.textContent = 'Googleアカウントでログイン';
          return;
      }
      if (response && response.started) {
        statusElement.textContent = 'Googleアカウントを選択してください...';
        // 状態更新は Background からの通知を待つ
      } else {
        displayError(response?.error || 'ログインを開始できませんでした。');
        loginButton.disabled = false;
        loginButton.textContent = 'Googleアカウントでログイン';
      }
    });
  });

  // ログアウトボタンのクリックイベント
  logoutButton.addEventListener('click', function() {
      logoutButton.disabled = true;
      logoutButton.textContent = 'ログアウト中...';
      chrome.runtime.sendMessage({ action: 'requestLogout' }, function(response) {
          if (chrome.runtime.lastError || !response?.success) {
              console.error("Logout request error:", chrome.runtime.lastError?.message || response?.error);
              displayError(`ログアウトエラー: ${chrome.runtime.lastError?.message || response?.error}`);
          } else {
              console.log("Logout successful via popup request.");
              // UI更新はBackgroundからの通知に任せる
          }
          logoutButton.disabled = false;
          logoutButton.textContent = 'ログアウト';
      });
  });


  // --- Background Scriptとの連携 ---

  // Popupが開いたときに現在の認証状態を問い合わせる
  statusElement.textContent = 'ステータス: 認証状態を確認中...';
  chrome.runtime.sendMessage({ action: 'getAuthStatus' }, function(response) {
    if (chrome.runtime.lastError) {
      console.error("Error getting auth status:", chrome.runtime.lastError.message);
      statusElement.textContent = '状態取得エラー';
      displayError(`状態取得エラー: ${chrome.runtime.lastError.message}`);
      updatePopupUI(null); // エラー時は未ログインとして表示
      return;
    }
    console.log("Initial auth status from background:", response?.user);
    updatePopupUI(response?.user);
  });

  // Background Scriptからの認証状態変更通知を受け取るリスナー
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'authStatusChanged') {
          console.log("Popup received auth status update from background:", message.user);
          updatePopupUI(message.user);
          // 確認応答は任意 (sendResponse({received: true});)
          return true; // 非同期応答を示す場合
      }
      // 他のメッセージタイプに対する処理 ...
  });

  // --- 初期化完了 ---
  console.log("Popup script initialized.");

});
