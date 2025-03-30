// Firebase設定
// 実際のFirebase設定情報

const firebaseConfig = {
  apiKey: "AIzaSyAT-3emNdtHDBqODO8cwyT8JE4aCa1nZbg",
  authDomain: "meet-ping-extension.firebaseapp.com",
  databaseURL: "https://meet-ping-extension-default-rtdb.firebaseio.com",
  projectId: "meet-ping-extension",
  storageBucket: "meet-ping-extension.appspot.com",
  messagingSenderId: "217193969712",
  appId: "1:217193969712:web:e5bf03e9544a87a010d5f5"
};

// Firebaseu306eu521du671fu5316
const firebaseApp = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();

// Googleu8a8du8a3cu30d7u30edu30d0u30a4u30c0u30fcu306eu8a2du5b9a
const googleProvider = new firebase.auth.GoogleAuthProvider();
googleProvider.setCustomParameters({
  // u7279u5b9au306eu30c9u30e1u30a4u30f3u306eu307fu3092u8a31u53efu3059u308bu5834u5408u306fu3001u3053u3053u3067u8a2du5b9au3057u307eu3059
  // hd: 'example.com' // u7d44u7e54u5185u5229u7528u306eu5834u5408u3001u3053u3053u306bu30c9u30e1u30a4u30f3u3092u6307u5b9a
});
