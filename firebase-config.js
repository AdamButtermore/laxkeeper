// Firebase Configuration for LaxKeeper
// Replace the firebaseConfig values with your project's config from:
// Firebase Console > Project Settings > Your apps > Web app

const firebaseConfig = {
    apiKey: "AIzaSyDb3xrQA2Q435C_ytVpCLp3L0p3RgW7U7c",
    authDomain: "lax-keeper.firebaseapp.com",
    projectId: "lax-keeper",
    storageBucket: "lax-keeper.firebasestorage.app",
    messagingSenderId: "711126342851",
    appId: "1:711126342851:web:0c04c13e172d06506bd676"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Enable Firestore offline persistence (queues writes when offline)
const db = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch(function (err) {
    if (err.code === 'failed-precondition') {
        console.warn('[Firebase] Persistence failed: multiple tabs open');
    } else if (err.code === 'unimplemented') {
        console.warn('[Firebase] Persistence not supported in this browser');
    }
});

// Sign in anonymously and export a ready promise
window.firebaseReady = firebase.auth().signInAnonymously().then(function (cred) {
    console.log('[Firebase] Anonymous auth UID:', cred.user.uid);
    return cred.user;
}).catch(function (err) {
    console.error('[Firebase] Auth failed:', err);
    return null;
});
