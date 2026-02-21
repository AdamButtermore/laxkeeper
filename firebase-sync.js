// LaxKeeper Firebase Sync Layer
// Transparently syncs localStorage to Firestore via team codes

var LaxSync = (function () {
    'use strict';

    // localStorage keys we care about and their Firestore doc names
    // current_game is intentionally excluded — device-local only
    var KEY_MAP = {
        'laxkeeper_roster': 'roster',
        'laxkeeper_games': 'games',
        'laxkeeper_team_name': 'settings'
    };

    var TEAM_CODE_KEY = 'laxkeeper_team_code';
    var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    var uid = null;
    var userDocRef = null; // teams/{code}/data/
    var originalSetItem = null;
    var originalRemoveItem = null;
    var activeListeners = []; // stores onSnapshot unsubscribe functions

    // Flag to suppress Firestore writes during snapshot hydration (prevents echo loops)
    var suppressSync = false;

    // ---- Init ----
    function init() {
        window.firebaseReady.then(function (user) {
            if (!user) {
                console.warn('[LaxSync] No auth user, sync disabled');
                loadTeamUI();
                return;
            }
            uid = user.uid;

            var teamCode = localStorage.getItem(TEAM_CODE_KEY);

            // Always install the monkey-patch (dormant if no team)
            monkeyPatchLocalStorage();

            if (teamCode) {
                // Connected to a team — sync to team path
                userDocRef = firebase.firestore().collection('teams').doc(teamCode).collection('data');

                hydrateFromFirestore().then(function () {
                    setupRealtimeListeners();
                    loadTeamUI();
                    console.log('[LaxSync] Sync active for team:', teamCode);
                });
            } else {
                // No team — monkey-patch installed but dormant
                loadTeamUI();
                console.log('[LaxSync] Sync layer installed (dormant, no team)');
            }
        });
    }

    // ---- Hydration (first load or join) ----
    function hydrateFromFirestore() {
        return userDocRef.get().then(function (snapshot) {
            var hasCloudData = false;
            var cloudDocs = {};

            snapshot.forEach(function (doc) {
                cloudDocs[doc.id] = doc.data();
                hasCloudData = true;
            });

            if (hasCloudData) {
                // Cloud has data — pull it into localStorage
                hydrateKey('laxkeeper_roster', cloudDocs.roster, 'items');
                hydrateKey('laxkeeper_games', cloudDocs.games, 'items');
                hydrateSettings(cloudDocs.settings);

                // Refresh the UI so it picks up hydrated data
                refreshUI();
            } else {
                // First time — push localStorage UP to Firestore
                pushAllToFirestore();
            }
        }).catch(function (err) {
            console.error('[LaxSync] Hydration failed:', err);
        });
    }

    function hydrateKey(localKey, cloudDoc, field) {
        if (!cloudDoc || cloudDoc[field] === undefined) return;

        var value = cloudDoc[field];
        if (value === null || value === undefined) {
            localStorage.removeItem(localKey);
        } else if (typeof value === 'string') {
            localStorage.setItem(localKey, value);
        } else {
            localStorage.setItem(localKey, JSON.stringify(value));
        }
    }

    function hydrateSettings(cloudDoc) {
        if (!cloudDoc) return;
        if (cloudDoc.teamName !== undefined) {
            localStorage.setItem('laxkeeper_team_name', cloudDoc.teamName);
        }
    }

    function pushAllToFirestore() {
        if (!userDocRef) return;

        var roster = localStorage.getItem('laxkeeper_roster');
        var games = localStorage.getItem('laxkeeper_games');
        var teamName = localStorage.getItem('laxkeeper_team_name');

        var batch = firebase.firestore().batch();
        var now = firebase.firestore.FieldValue.serverTimestamp();

        if (roster) {
            batch.set(userDocRef.doc('roster'), { items: JSON.parse(roster), updatedAt: now });
        }
        if (games) {
            batch.set(userDocRef.doc('games'), { items: JSON.parse(games), updatedAt: now });
        }
        if (teamName) {
            batch.set(userDocRef.doc('settings'), { teamName: teamName, updatedAt: now });
        }

        batch.commit().then(function () {
            console.log('[LaxSync] Push to Firestore complete');
        }).catch(function (err) {
            console.error('[LaxSync] Push failed:', err);
        });
    }

    // ---- Monkey-patch localStorage ----
    function monkeyPatchLocalStorage() {
        if (originalSetItem) return; // already patched

        originalSetItem = Storage.prototype.setItem;
        originalRemoveItem = Storage.prototype.removeItem;

        Storage.prototype.setItem = function (key, value) {
            // Always write to localStorage first (synchronous)
            originalSetItem.call(this, key, value);

            // Only intercept our keys, only on the real localStorage, and only when not suppressed
            if (this === localStorage && KEY_MAP[key] && !suppressSync) {
                syncToFirestore(key, value);
            }
        };

        Storage.prototype.removeItem = function (key) {
            originalRemoveItem.call(this, key);

            if (this === localStorage && KEY_MAP[key] && !suppressSync) {
                handleRemove(key);
            }
        };
    }

    function syncToFirestore(key, value) {
        if (!userDocRef) return;

        var docName = KEY_MAP[key];
        var now = firebase.firestore.FieldValue.serverTimestamp();

        if (key === 'laxkeeper_team_name') {
            userDocRef.doc(docName).set({ teamName: value, updatedAt: now }).catch(logError);
        } else {
            var parsed = safeJSONParse(value);
            if (parsed !== null) {
                userDocRef.doc(docName).set({ items: parsed, updatedAt: now }).catch(logError);
            }
        }
    }

    function handleRemove(key) {
        if (!userDocRef) return;

        var docName = KEY_MAP[key];
        userDocRef.doc(docName).delete().catch(logError);
    }

    // ---- Realtime listeners (other devices / tabs) ----
    function setupRealtimeListeners() {
        listenDoc('roster', function (data) {
            if (data && data.items) {
                writeLocalSuppressed('laxkeeper_roster', JSON.stringify(data.items));
                refreshUI();
            }
        });

        listenDoc('games', function (data) {
            if (data && data.items) {
                writeLocalSuppressed('laxkeeper_games', JSON.stringify(data.items));
                refreshUI();
            }
        });

        listenDoc('settings', function (data) {
            if (data && data.teamName !== undefined) {
                writeLocalSuppressed('laxkeeper_team_name', data.teamName);
                refreshUI();
            }
        });
    }

    function listenDoc(docName, callback) {
        var isFirstSnapshot = true;
        var unsubscribe = userDocRef.doc(docName).onSnapshot(function (snap) {
            // Skip the first snapshot (it's our own initial data)
            if (isFirstSnapshot) {
                isFirstSnapshot = false;
                return;
            }
            if (snap.exists) {
                callback(snap.data());
            }
        }, function (err) {
            console.error('[LaxSync] Listener error for ' + docName + ':', err);
        });
        activeListeners.push(unsubscribe);
    }

    function detachListeners() {
        activeListeners.forEach(function (unsub) {
            unsub();
        });
        activeListeners = [];
    }

    // Write to localStorage without triggering Firestore sync (avoids echo loop)
    function writeLocalSuppressed(key, value) {
        suppressSync = true;
        try {
            if (originalSetItem) {
                originalSetItem.call(localStorage, key, value);
            } else {
                localStorage.setItem(key, value);
            }
        } finally {
            suppressSync = false;
        }
    }

    // ---- Team Code Management ----
    function generateTeamCode() {
        var code = '';
        for (var i = 0; i < 6; i++) {
            code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
        }
        return code;
    }

    function switchToTeamPath(code) {
        detachListeners();
        userDocRef = firebase.firestore().collection('teams').doc(code).collection('data');
    }

    function createTeam() {
        if (!uid) {
            alert('Still connecting to cloud. Please wait a moment and try again.');
            return;
        }
        if (localStorage.getItem(TEAM_CODE_KEY)) {
            alert('You are already connected to a team. Leave first to create a new one.');
            return;
        }

        var code = generateTeamCode();
        var db = firebase.firestore();

        // Check for collision, then create team metadata doc
        db.collection('teams').doc(code).get().then(function (doc) {
            if (doc.exists) {
                // Extremely unlikely collision — retry once
                code = generateTeamCode();
                return db.collection('teams').doc(code).get();
            }
            return { exists: false };
        }).then(function (result) {
            if (result.exists) {
                alert('Error generating team code. Please try again.');
                return;
            }

            var teamName = localStorage.getItem('laxkeeper_team_name') || 'My Team';

            // Write team metadata document
            return db.collection('teams').doc(code).set({
                teamName: teamName,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: uid
            }).then(function () {
                // Store the team code locally
                localStorage.setItem(TEAM_CODE_KEY, code);

                // Switch sync target to team path
                switchToTeamPath(code);

                // Push current local data up to the new team path
                pushAllToFirestore();

                // Setup realtime listeners
                setupRealtimeListeners();

                loadTeamUI();
                console.log('[LaxSync] Team created with code:', code);
                alert('Team created! Your code is: ' + code);
            });
        }).catch(function (err) {
            console.error('[LaxSync] Create team failed:', err);
            alert('Failed to create team. Check your connection and try again.');
        });
    }

    function joinTeam() {
        if (!uid) {
            alert('Still connecting to cloud. Please wait a moment and try again.');
            return;
        }
        if (localStorage.getItem(TEAM_CODE_KEY)) {
            alert('You are already connected to a team. Leave first to join another.');
            return;
        }

        var input = document.getElementById('join-team-code');
        var code = (input ? input.value : '').toUpperCase().trim();

        if (code.length !== 6) {
            alert('Please enter a 6-character team code.');
            return;
        }

        var db = firebase.firestore();

        // Validate the team exists
        db.collection('teams').doc(code).get().then(function (doc) {
            if (!doc.exists) {
                alert('Team not found. Check the code and try again.');
                return;
            }

            var teamData = doc.data();
            var teamLabel = teamData.teamName || code;
            if (!confirm('Join team "' + teamLabel + '"? Your local roster and game history will be replaced with the team\'s data.')) {
                return;
            }

            // Store the team code locally
            localStorage.setItem(TEAM_CODE_KEY, code);

            // Switch sync target to team path
            switchToTeamPath(code);

            // Pull team data down to local (team data wins)
            hydrateFromFirestore().then(function () {
                setupRealtimeListeners();
                loadTeamUI();
                if (input) input.value = '';
                console.log('[LaxSync] Joined team:', code);
            });
        }).catch(function (err) {
            console.error('[LaxSync] Join team failed:', err);
            alert('Failed to join team. Check your connection and try again.');
        });
    }

    function leaveTeam() {
        if (!confirm('Leave this team? Your data will stay on your device but will no longer sync.')) {
            return;
        }

        detachListeners();
        localStorage.removeItem(TEAM_CODE_KEY);
        userDocRef = null;

        loadTeamUI();
        console.log('[LaxSync] Left team. Data preserved locally, sync disabled.');
    }

    function copyTeamCode() {
        var code = localStorage.getItem(TEAM_CODE_KEY);
        if (!code) return;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(function () {
                alert('Team code copied!');
            }).catch(function () {
                prompt('Copy this team code:', code);
            });
        } else {
            prompt('Copy this team code:', code);
        }
    }

    // ---- Settings UI ----
    function loadTeamUI() {
        var teamCode = localStorage.getItem(TEAM_CODE_KEY);
        var noSync = document.getElementById('team-no-sync');
        var connected = document.getElementById('team-connected');
        var codeDisplay = document.getElementById('display-team-code');

        if (!noSync || !connected) return; // settings screen not rendered yet

        if (teamCode) {
            noSync.style.display = 'none';
            connected.style.display = 'block';
            if (codeDisplay) codeDisplay.textContent = teamCode;
        } else {
            noSync.style.display = 'block';
            connected.style.display = 'none';
        }
    }

    // ---- UI Refresh ----
    function refreshUI() {
        // These are all global functions from app.js
        if (typeof loadTeamName === 'function') loadTeamName();
        if (typeof loadRoster === 'function') loadRoster();
        if (typeof loadScheduledGames === 'function') loadScheduledGames();
        if (typeof loadGameHistory === 'function') loadGameHistory();
    }

    // ---- Helpers ----
    function safeJSONParse(str) {
        try {
            return JSON.parse(str);
        } catch (e) {
            return null;
        }
    }

    function logError(err) {
        console.error('[LaxSync] Firestore write failed:', err);
    }

    // ---- Auto-init on DOMContentLoaded ----
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        init: init,
        createTeam: createTeam,
        joinTeam: joinTeam,
        leaveTeam: leaveTeam,
        copyTeamCode: copyTeamCode,
        loadTeamUI: loadTeamUI
    };
})();
