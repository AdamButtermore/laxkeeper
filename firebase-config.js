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

// Initialize Analytics
const analytics = firebase.analytics();

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

// Sign in with Google — tries popup first, falls back to redirect (more reliable on mobile)
function signInWithGoogle() {
    var btn = document.getElementById('google-signin-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Signing in...';
    }

    firebase.auth().signInWithPopup(googleProvider).then(function (result) {
        console.log('[Firebase] Google sign-in success:', result.user.displayName);
        firebase.analytics().logEvent('login', { method: 'google' });
        // onAuthStateChanged will fire and handle the rest
    }).catch(function (err) {
        console.error('[Firebase] Google popup sign-in failed:', err.code);
        // Popup failed — fall back to redirect (works better on mobile/in-app browsers)
        if (err.code === 'auth/popup-closed-by-user') {
            // User intentionally closed — reset button, don't redirect
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Sign in with Google';
            }
        } else if (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request' ||
                   err.code === 'auth/operation-not-supported-in-this-environment') {
            console.log('[Firebase] Falling back to redirect sign-in');
            firebase.auth().signInWithRedirect(googleProvider);
        } else {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Sign in with Google';
            }
            alert('Sign-in failed: ' + err.message);
        }
    });
}

// Handle redirect result (for when popup fallback was used)
firebase.auth().getRedirectResult().then(function (result) {
    if (result.user) {
        console.log('[Firebase] Redirect sign-in success:', result.user.displayName);
        firebase.analytics().logEvent('login', { method: 'google_redirect' });
    }
}).catch(function (err) {
    console.error('[Firebase] Redirect result error:', err);
});

// Sign out
function signOutUser() {
    firebase.auth().signOut().then(function () {
        console.log('[Firebase] Signed out');
        window.firebaseUser = null;

        // Clear all user/team data from localStorage to prevent next user seeing it
        localStorage.removeItem('laxkeeper_roster');
        localStorage.removeItem('laxkeeper_games');
        localStorage.removeItem('laxkeeper_current_game');
        localStorage.removeItem('laxkeeper_team_name');
        localStorage.removeItem('laxkeeper_user_teams');
        localStorage.removeItem('laxkeeper_active_team');
    }).catch(function (err) {
        console.error('[Firebase] Sign-out failed:', err);
    });
}

// Create or update user profile doc in Firestore
function syncUserProfile(user) {
    if (!user) return;

    var userRef = firebase.firestore().collection('users').doc(user.uid);

    // Check if this is a brand-new user (doc doesn't exist yet)
    userRef.get().then(function (doc) {
        if (!doc.exists) {
            // New signup — log to signups collection for notifications
            firebase.firestore().collection('signups').add({
                uid: user.uid,
                displayName: user.displayName || '',
                email: user.email || '',
                signedUpAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    });

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
