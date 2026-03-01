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

// Google Auth provider
var googleProvider = new firebase.auth.GoogleAuthProvider();

// firebaseReady resolves with the signed-in Google user, or null if not yet signed in.
// It resolves immediately if already signed in, or waits for the first auth state change.
window.firebaseReady = new Promise(function (resolve) {
    var resolved = false;
    firebase.auth().onAuthStateChanged(function (user) {
        if (!resolved) {
            resolved = true;
            if (user && !user.isAnonymous) {
                console.log('[Firebase] Google auth UID:', user.uid);
                syncUserProfile(user);
                resolve(user);
            } else {
                console.log('[Firebase] No authenticated user, showing sign-in screen');
                resolve(null);
            }
        } else {
            // Subsequent auth changes (sign-out, sign-in from another tab)
            if (user && !user.isAnonymous) {
                console.log('[Firebase] Auth state changed, user:', user.uid);
                syncUserProfile(user);
                if (typeof onAuthSignIn === 'function') onAuthSignIn(user);
            } else {
                console.log('[Firebase] Auth state changed, signed out');
                if (typeof onAuthSignOut === 'function') onAuthSignOut();
            }
        }
    });
});

// Sign in with Google popup
function signInWithGoogle() {
    var btn = document.getElementById('google-signin-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Signing in...';
    }

    firebase.auth().signInWithPopup(googleProvider).then(function (result) {
        var user = result.user;
        console.log('[Firebase] Google sign-in success:', user.displayName);
        syncUserProfile(user);

        // Re-resolve for any code waiting on firebaseReady after sign-in
        window.firebaseUser = user;
        if (typeof onAuthSignIn === 'function') onAuthSignIn(user);
    }).catch(function (err) {
        console.error('[Firebase] Google sign-in failed:', err);
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Sign in with Google';
        }
        if (err.code === 'auth/popup-closed-by-user') {
            // User closed the popup — no alert needed
        } else if (err.code === 'auth/popup-blocked') {
            alert('Pop-up blocked. Please allow pop-ups for this site and try again.');
        } else {
            alert('Sign-in failed: ' + err.message);
        }
    });
}

// Sign out
function signOutUser() {
    firebase.auth().signOut().then(function () {
        console.log('[Firebase] Signed out');
        window.firebaseUser = null;
    }).catch(function (err) {
        console.error('[Firebase] Sign-out failed:', err);
    });
}

// Create or update user profile doc in Firestore
function syncUserProfile(user) {
    if (!user) return;

    var userRef = firebase.firestore().collection('users').doc(user.uid);
    userRef.set({
        displayName: user.displayName || '',
        email: user.email || '',
        photoURL: user.photoURL || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).then(function () {
        console.log('[Firebase] User profile synced');
    }).catch(function (err) {
        console.error('[Firebase] User profile sync failed:', err);
    });
}
