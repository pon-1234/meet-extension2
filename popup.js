// ポップアップのJavaScriptコード

let currentUser = null;

// DOMが読み込まれたら実行
document.addEventListener('DOMContentLoaded', function() {
  const statusElement = document.getElementById('status');
  const userInfoElement = document.getElementById('user-info');
  const userEmailElement = document.getElementById('user-email');
  const loginSectionElement = document.getElementById('login-section');
  const loginButton = document.getElementById('login-button');
  const logoutButton = document.getElementById('logout-button');
  const errorMessageElement = document.getElementById('error-message');

  // 認証状態の監視
  function setupAuthListener() {
    auth.onAuthStateChanged((user) => {
      if (user) {
        // ドメイン制限（必要に応じてコメントを解除）
        // if (!user.email.endsWith('@example.com')) {
        //   errorMessageElement.textContent = '許可されていないドメインです。組織アカウントでログインしてください。';
        //   auth.signOut();
        //   return;
        // }
        
        // ログイン成功
        currentUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || user.email.split('@')[0]
        };
        
        // UI更新
        statusElement.textContent = 'ステータス: ログイン済み';
        userEmailElement.textContent = currentUser.email;
        loginSectionElement.style.display = 'none';
        userInfoElement.style.display = 'block';
        errorMessageElement.textContent = '';
        
        // ログイン情報をコンテンツスクリプトに通知
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          if (tabs[0] && tabs[0].url && tabs[0].url.includes('meet.google.com')) {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'userLoggedIn', user: currentUser});
          }
        });
      } else {
        // 未ログイン状態
        currentUser = null;
        statusElement.textContent = 'ステータス: 未ログイン';
        loginSectionElement.style.display = 'block';
        userInfoElement.style.display = 'none';
      }
    });
  }

  // Googleログイン処理
  function loginWithGoogle() {
    // ログインボタンを無効化して連続クリックを防止
    loginButton.disabled = true;
    errorMessageElement.textContent = 'ログイン処理中...';
    
    // ポップアップではなくリダイレクトを使用
    auth.signInWithRedirect(googleProvider)
      .catch((error) => {
        console.error('ログインエラー:', error);
        errorMessageElement.textContent = `ログインエラー: ${error.message}`;
        loginButton.disabled = false;
      });
  }

  // リダイレクト後の処理
  function checkRedirectResult() {
    auth.getRedirectResult()
      .then((result) => {
        if (result.user) {
          console.log('リダイレクトログイン成功:', result.user.email);
        }
      })
      .catch((error) => {
        console.error('リダイレクト結果エラー:', error);
        errorMessageElement.textContent = `ログインエラー: ${error.message}`;
        loginButton.disabled = false;
      });
  }

  // ログアウト処理
  function logout() {
    auth.signOut()
      .then(() => {
        console.log('ログアウトしました');
        // コンテンツスクリプトにログアウトを通知
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          if (tabs[0] && tabs[0].url && tabs[0].url.includes('meet.google.com')) {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'userLoggedOut'});
          }
        });
      })
      .catch((error) => {
        console.error('ログアウトエラー:', error);
      });
  }

  // イベントリスナーの設定
  loginButton.addEventListener('click', loginWithGoogle);
  logoutButton.addEventListener('click', logout);

  // 初期化
  setupAuthListener();
  statusElement.textContent = 'ステータス: 初期化中...';
  
  // リダイレクト結果をチェック
  checkRedirectResult();
});
