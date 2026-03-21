// LaxKeeper Firebase Sync Layer
// Transparently syncs localStorage to Firestore via team codes
// Supports multiple teams per user with a team switcher

var LaxSync = (function () {
    'use strict';

    // localStorage keys we care about and their Firestore doc names
    // current_game is intentionally excluded — device-local only
    var KEY_MAP = {
        'laxkeeper_roster': 'roster',
        'laxkeeper_games': 'games',
        'laxkeeper_team_name': 'settings'
    };

    // Old single-team key (for migration)
    var OLD_TEAM_CODE_KEY = 'laxkeeper_team_code';

    // New multi-team keys
    var USER_TEAMS_KEY = 'laxkeeper_user_teams';   // JSON array of { code, name }
    var ACTIVE_TEAM_KEY = 'laxkeeper_active_team';  // string code

    var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    var uid = null;
    var userDocRef = null; // teams/{code}/data/
    var originalSetItem = null;
    var originalRemoveItem = null;
    var activeListeners = []; // stores onSnapshot unsubscribe functions

    // Flag to suppress Firestore writes during snapshot hydration (prevents echo loops)
    var suppressSync = false;

    // Queue for writes that happen before Firestore connection is ready
    var pendingWrites = [];
    // Track whether we've completed initial hydration (prevents queue flush before merge)
    var hydrationComplete = false;

    // Game-in-progress guard: all incoming snapshots are dropped while active
    var gameInProgress = false;

    // ---- Init ----
    function init(passedUser) {
        var startup = passedUser
            ? Promise.resolve(passedUser)
            : window.firebaseReady;

        startup.then(function (user) {
            if (!user) {
                console.warn('[LaxSync] No auth user, sync disabled');
                loadTeamUI();
                return;
            }
            uid = user.uid;

            // Run migration from old single-team format
            migrateOldTeamCode();

            // Sync teams from Firestore user doc into localStorage
            syncTeamsFromFirestore(user);

            var activeCode = getActiveTeam();

            // Always install the monkey-patch (dormant if no team)
            monkeyPatchLocalStorage();

            if (activeCode) {
                // Connected to a team — sync to team path
                userDocRef = firebase.firestore().collection('teams').doc(activeCode).collection('data');

                hydrateFromFirestore().then(function () {
                    setupRealtimeListeners();
                    loadTeamUI();
                    updateActiveTeamDisplay();
                    console.log('[LaxSync] Sync active for team:', activeCode);
                });
            } else {
                // No team — monkey-patch installed but dormant
                loadTeamUI();
                updateActiveTeamDisplay();
                console.log('[LaxSync] Sync layer installed (dormant, no team)');
            }
        });
    }

    // ---- Migration from old single-team key ----
    function migrateOldTeamCode() {
        var oldCode = localStorage.getItem(OLD_TEAM_CODE_KEY);
        if (!oldCode) return;

        var existingTeams = getUserTeams();
        // Only migrate if we haven't already
        if (existingTeams.some(function (t) { return t.code === oldCode; })) {
            localStorage.removeItem(OLD_TEAM_CODE_KEY);
            return;
        }

        var teamName = localStorage.getItem('laxkeeper_team_name') || 'My Team';
        existingTeams.push({ code: oldCode, name: teamName });
        localStorage.setItem(USER_TEAMS_KEY, JSON.stringify(existingTeams));
        localStorage.setItem(ACTIVE_TEAM_KEY, oldCode);
        localStorage.removeItem(OLD_TEAM_CODE_KEY);
        console.log('[LaxSync] Migrated old team code:', oldCode);
    }

    // ---- Sync teams list from Firestore user doc ----
    function syncTeamsFromFirestore(user, retryCount) {
        if (!user) return;
        retryCount = retryCount || 0;

        // Force fresh auth token then read
        user.getIdToken(true).then(function () {
            console.log('[LaxSync] Auth token refreshed, reading user doc:', user.uid);
            var userRef = firebase.firestore().collection('users').doc(user.uid);
            return userRef.get({ source: 'server' });
        }).then(function (doc) {
            if (doc.exists && doc.data().teams && doc.data().teams.length > 0) {
                var cloudTeams = doc.data().teams;
                var localTeams = getUserTeams();

                // Merge: add any cloud teams not already local
                var localCodes = {};
                localTeams.forEach(function (t) { localCodes[t.code] = true; });

                var merged = localTeams.slice();
                cloudTeams.forEach(function (ct) {
                    if (!localCodes[ct.code]) {
                        merged.push({ code: ct.code, name: ct.name || ct.code, gameType: ct.gameType || 'boys' });
                    }
                });

                localStorage.setItem(USER_TEAMS_KEY, JSON.stringify(merged));
                console.log('[LaxSync] Synced teams from cloud:', merged.length, 'teams');

                // If no active team but we have teams, set the first one
                if (!getActiveTeam() && merged.length > 0) {
                    var activeFromCloud = doc.data().activeTeam;
                    if (activeFromCloud && merged.some(function (t) { return t.code === activeFromCloud; })) {
                        localStorage.setItem(ACTIVE_TEAM_KEY, activeFromCloud);
                    } else {
                        localStorage.setItem(ACTIVE_TEAM_KEY, merged[0].code);
                    }

                    // Re-activate sync now that we have a team
                    var code = getActiveTeam();
                    if (code) {
                        switchToTeamPath(code);
                        hydrateFromFirestore().then(function () {
                            setupRealtimeListeners();
                            console.log('[LaxSync] Activated sync for team:', code);
                        });
                    }
                }
            }

            // Always update UI
            loadTeamUI();
            updateActiveTeamDisplay();
        }).catch(function (err) {
            if (retryCount < 3) {
                console.log('[LaxSync] Team sync retry', retryCount + 1, 'in 1s (auth token may not be ready)');
                setTimeout(function () {
                    syncTeamsFromFirestore(user, retryCount + 1);
                }, 1000);
            } else {
                console.error('[LaxSync] Failed to sync teams from Firestore:', err);
                loadTeamUI();
            }
        });
    }

    // ---- Team getters/setters ----
    function getActiveTeam() {
        return localStorage.getItem(ACTIVE_TEAM_KEY) || '';
    }

    function getUserTeams() {
        return getLocalArray(USER_TEAMS_KEY);
    }

    function getActiveTeamGameType() {
        var code = getActiveTeam();
        if (!code) return 'boys';
        var teams = getUserTeams();
        var team = teams.find(function (t) { return t.code === code; });
        return (team && team.gameType) || 'boys';
    }

    function setUserTeams(teams) {
        localStorage.setItem(USER_TEAMS_KEY, JSON.stringify(teams));
    }

    // ---- Persist teams to Firestore user doc ----
    function persistTeamsToFirestore() {
        if (!uid) return;
        var teams = getUserTeams().map(function (t) {
            return { code: t.code, name: t.name, gameType: t.gameType || 'boys', joinedAt: t.joinedAt || null };
        });
        var userRef = firebase.firestore().collection('users').doc(uid);
        userRef.set({
            teams: teams,
            activeTeam: getActiveTeam(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(function (err) {
            console.error('[LaxSync] Failed to persist teams:', err);
        });
    }

    // ---- Team Switching ----
    function switchTeam(code) {
        var teams = getUserTeams();
        if (!teams.some(function (t) { return t.code === code; })) {
            console.warn('[LaxSync] Cannot switch to team not in list:', code);
            return;
        }

        // Block switching while a game is in progress
        if (gameInProgress || localStorage.getItem('laxkeeper_current_game')) {
            alert('You have a game in progress. Please end or cancel the game before switching teams.');
            return;
        }

        // Flush pending writes to the CURRENT team before switching
        var flushPromise;
        if (userDocRef && pendingWrites.length > 0) {
            console.log('[LaxSync] Flushing', pendingWrites.length, 'pending write(s) to current team before switch');
            flushPromise = flushPendingWritesAsync();
        } else if (userDocRef) {
            // Even without pending writes, push current local state to ensure nothing is lost
            flushPromise = buildDataBatch().commit().then(function () {
                console.log('[LaxSync] Saved current team data before switch');
            }).catch(function (err) {
                console.warn('[LaxSync] Pre-switch save failed (will proceed):', err.message);
            });
        } else {
            flushPromise = Promise.resolve();
        }

        flushPromise.then(function () {
            // Clear pending writes — they belonged to the old team
            pendingWrites = [];

            // Detach old listeners
            detachListeners();

            // Set new active team
            localStorage.setItem(ACTIVE_TEAM_KEY, code);

            // Point at new Firestore path
            userDocRef = firebase.firestore().collection('teams').doc(code).collection('data');

            // When switching teams, cloud replaces local (different team's data)
            hydrateFromFirestore(true).then(function () {
                setupRealtimeListeners();
                loadTeamUI();
                updateActiveTeamDisplay();
                refreshUI();
                persistTeamsToFirestore();
                console.log('[LaxSync] Switched to team:', code);
            });
        });
    }

    // Flush pending writes and return a Promise that resolves when done
    function flushPendingWritesAsync() {
        if (!userDocRef || pendingWrites.length === 0) return Promise.resolve();

        var writes = pendingWrites.slice();
        pendingWrites = [];
        var promises = [];

        writes.forEach(function (w) {
            var docName = KEY_MAP[w.key];
            if (!docName) return;
            var now = firebase.firestore.FieldValue.serverTimestamp();

            if (w.key === 'laxkeeper_team_name') {
                promises.push(
                    userDocRef.doc(docName).set({ teamName: w.value, updatedAt: now }).catch(logError)
                );
            } else {
                var parsed = safeJSONParse(w.value);
                if (parsed !== null) {
                    promises.push(
                        userDocRef.doc(docName).set({ items: parsed, updatedAt: now }).catch(logError)
                    );
                }
            }
        });

        return Promise.all(promises).then(function () {
            console.log('[LaxSync] Flushed', writes.length, 'pending write(s)');
        }).catch(function (err) {
            console.warn('[LaxSync] Some pending writes failed during flush:', err.message);
        });
    }

    // ---- Hydration (first load or join) ----
    // Merges cloud and local data by ID instead of overwriting
    // replaceMode: true = cloud fully replaces local (used for team switching)
    //              false/undefined = merge by ID (used for normal startup)
    function hydrateFromFirestore(replaceMode, retryCount) {
        retryCount = retryCount || 0;
        hydrationComplete = false;
        return userDocRef.get().then(function (snapshot) {
            var hasCloudData = false;
            var cloudDocs = {};

            snapshot.forEach(function (doc) {
                cloudDocs[doc.id] = doc.data();
                hasCloudData = true;
            });

            suppressSync = true;
            try {
                if (hasCloudData) {
                    var mergedGames, mergedRoster;

                    if (replaceMode) {
                        // Team switch: roster replaces (team-specific), games use conflict resolution
                        mergedGames = cloudDocs.games ? cloudDocs.games.items : null;
                        mergedRoster = cloudDocs.roster ? cloudDocs.roster.items : null;
                        // Note: local data was flushed to the previous team's Firestore before switch
                    } else {
                        // Normal startup: merge with conflict resolution
                        var localGamesJSON = localStorage.getItem('laxkeeper_games');
                        var localGamesArr = localGamesJSON ? safeJSONParse(localGamesJSON) : null;
                        var cloudGamesArr = cloudDocs.games ? cloudDocs.games.items : null;
                        mergedGames = mergeGames(localGamesArr, cloudGamesArr);

                        mergedRoster = mergeArrayById(
                            localStorage.getItem('laxkeeper_roster'),
                            cloudDocs.roster ? cloudDocs.roster.items : null
                        );
                    }

                    if (mergedGames !== null) {
                        localStorage.setItem('laxkeeper_games', JSON.stringify(mergedGames));
                    }
                    if (mergedRoster !== null) {
                        localStorage.setItem('laxkeeper_roster', JSON.stringify(mergedRoster));
                    }

                    // Settings: cloud wins (simple string)
                    if (cloudDocs.settings && cloudDocs.settings.teamName !== undefined) {
                        localStorage.setItem('laxkeeper_team_name', cloudDocs.settings.teamName);
                    }

                    refreshUI();

                    // In merge mode, push merged result back so cloud has any local-only items
                    if (!replaceMode) {
                        pushAllToFirestoreQuiet();
                    }
                } else {
                    // First time — push localStorage UP to Firestore
                    pushAllToFirestore();
                }
            } finally {
                hydrationComplete = true;
                suppressSync = false;
                // Flush any writes that happened before we connected
                flushPendingWrites();
            }
        }).catch(function (err) {
            console.error('[LaxSync] Hydration failed:', err);
            if (retryCount < 3) {
                // Retry after 5s with incremented count
                setTimeout(function () {
                    console.log('[LaxSync] Retrying hydration (attempt ' + (retryCount + 2) + '/4)...');
                    hydrateFromFirestore(replaceMode, retryCount + 1);
                }, 5000);
            } else {
                // Max retries exhausted — unblock the app so it isn't permanently stuck
                console.error('[LaxSync] Hydration failed after 4 attempts, unblocking app');
                hydrationComplete = true;
                flushPendingWrites();
            }
        });
    }

    // Merge two arrays by item.id — cloud version wins on conflict, local-only items are kept
    function mergeArrayById(localJSON, cloudArray) {
        var localArray = null;
        if (localJSON) {
            try { localArray = JSON.parse(localJSON); } catch (e) { localArray = null; }
        }

        // If only one side has data, use it
        if (!localArray && !cloudArray) return null;
        if (!localArray || !Array.isArray(localArray)) return cloudArray || null;
        if (!cloudArray || !Array.isArray(cloudArray)) return localArray;

        // Build map of cloud items by ID
        var cloudById = {};
        cloudArray.forEach(function (item) {
            if (item && item.id) cloudById[item.id] = item;
        });

        // Start with all cloud items
        var merged = cloudArray.slice();
        var mergedIds = {};
        merged.forEach(function (item) {
            if (item && item.id) mergedIds[item.id] = true;
        });

        // Add local-only items (not in cloud)
        var localOnlyCount = 0;
        localArray.forEach(function (item) {
            if (item && item.id && !mergedIds[item.id]) {
                merged.push(item);
                localOnlyCount++;
            }
        });

        if (localOnlyCount > 0) {
            console.log('[LaxSync] Merge kept', localOnlyCount, 'local-only item(s)');
        }

        return merged;
    }

    // Push merged data to Firestore without alerts (used after merge hydration)
    // Build a Firestore batch containing all local data (roster, games, settings)
    function buildDataBatch() {
        var roster = localStorage.getItem('laxkeeper_roster');
        var games = localStorage.getItem('laxkeeper_games');
        var teamName = localStorage.getItem('laxkeeper_team_name');

        var batch = firebase.firestore().batch();
        var now = firebase.firestore.FieldValue.serverTimestamp();

        var parsedRoster = roster ? safeJSONParse(roster) : null;
        var parsedGames = games ? safeJSONParse(games) : null;

        if (parsedRoster !== null) {
            batch.set(userDocRef.doc('roster'), { items: parsedRoster, updatedAt: now });
        }
        if (parsedGames !== null) {
            batch.set(userDocRef.doc('games'), { items: parsedGames, updatedAt: now });
        }
        if (teamName) {
            batch.set(userDocRef.doc('settings'), { teamName: teamName, updatedAt: now });
        }

        return batch;
    }

    function pushAllToFirestoreQuiet() {
        if (!userDocRef) return;
        buildDataBatch().commit().then(function () {
            console.log('[LaxSync] Pushed merged data to Firestore');
        }).catch(function (err) {
            console.error('[LaxSync] Post-merge push failed:', err);
        });
    }

    function pushAllToFirestore() {
        if (!userDocRef) return;
        buildDataBatch().commit().then(function () {
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

    // Replace any existing queued write for the same key (only latest value matters)
    function queuePendingWrite(key, value) {
        pendingWrites = pendingWrites.filter(function (w) { return w.key !== key; });
        pendingWrites.push({ key: key, value: value });
    }

    function syncToFirestore(key, value) {
        if (!userDocRef || !hydrationComplete) {
            // Queue the write — will be flushed after hydration completes
            queuePendingWrite(key, value);
            console.log('[LaxSync] Queued write for', key, (!userDocRef ? '(not connected yet)' : '(hydration pending)'));
            return;
        }

        var docName = KEY_MAP[key];
        var now = firebase.firestore.FieldValue.serverTimestamp();

        if (key === 'laxkeeper_team_name') {
            userDocRef.doc(docName).set({ teamName: value, updatedAt: now }).catch(logError);

            // Also update the team name in our local teams array
            var activeCode = getActiveTeam();
            if (activeCode) {
                var teams = getUserTeams();
                teams.forEach(function (t) {
                    if (t.code === activeCode) t.name = value;
                });
                setUserTeams(teams);
            }
        } else {
            var parsed = safeJSONParse(value);
            if (parsed !== null) {
                // Adds-only merge with conflict resolution (completed beats scheduled)
                var docRef = userDocRef.doc(docName);
                firebase.firestore().runTransaction(function (transaction) {
                    return transaction.get(docRef).then(function (doc) {
                        var cloudArray = (doc.exists && doc.data() && doc.data().items) ? doc.data().items : [];
                        var merged = mergeGames(parsed, cloudArray);
                        transaction.set(docRef, { items: merged || parsed, updatedAt: now });
                    });
                }).catch(function (err) {
                    console.warn('[LaxSync] Transaction failed for ' + docName + ', queuing for retry:', err.message);
                    queuePendingWrite(key, value);
                });
            }
        }
    }

    // Flush any writes that were queued before connection was ready
    function flushPendingWrites() {
        if (!userDocRef || pendingWrites.length === 0) return;
        console.log('[LaxSync] Flushing', pendingWrites.length, 'queued write(s)');
        var writes = pendingWrites.slice();
        pendingWrites = [];
        writes.forEach(function (w) {
            syncToFirestore(w.key, w.value);
        });
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
                if (gameInProgress) {
                    console.log('[LaxSync] Dropped roster snapshot (game in progress)');
                    return;
                }
                writeLocalSuppressed('laxkeeper_roster', JSON.stringify(data.items));
                refreshUI();
            }
        });

        listenDoc('games', function (data) {
            if (data && data.items) {
                if (gameInProgress) {
                    console.log('[LaxSync] Dropped games snapshot (game in progress)');
                    return;
                }
                // Merge incoming cloud games with local — local wins on conflict
                // to protect recently-saved games that may not have synced yet
                var localGames = safeJSONParse(localStorage.getItem('laxkeeper_games'));
                var merged = mergeGames(localGames, data.items);
                writeLocalSuppressed('laxkeeper_games', JSON.stringify(merged || data.items));
                refreshUI();
            }
        });

        listenDoc('settings', function (data) {
            if (data && data.teamName !== undefined) {
                if (gameInProgress) {
                    console.log('[LaxSync] Dropped settings snapshot (game in progress)');
                    return;
                }
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
        // Ensure we have an authenticated user before proceeding
        var user = firebase.auth().currentUser;
        if (user) uid = user.uid;

        if (!uid) {
            alert('You must be signed in to create a team.');
            return;
        }

        // Block creating a new team while a game is in progress
        if (gameInProgress || localStorage.getItem('laxkeeper_current_game')) {
            alert('You have a game in progress. Please end or cancel the game before creating a new team.');
            return;
        }

        // Show create team dialog with name + game type
        _showCreateTeamDialog(function (teamName, gameType) {
            _doCreateTeam(teamName, gameType);
        });
    }

    function _showCreateTeamDialog(onConfirm) {
        var overlay = document.createElement('div');
        overlay.className = 'overlay overlay--centered';
        overlay.style.zIndex = '1100';
        var content = document.createElement('div');
        content.className = 'overlay-content overlay-content--narrow';
        content.style.padding = '2rem';
        content.innerHTML =
            '<h3 style="margin-bottom: 1.5rem; text-align: center; color: #FFFFFF;">Create a Team</h3>' +
            '<input type="text" id="create-team-name" placeholder="Team Name" class="input-field" style="margin-bottom: 1rem;">' +
            '<h4 style="color: var(--text-primary); margin-bottom: 0.5rem;">Game Type</h4>' +
            '<div class="radio-group" style="margin-bottom: 1.5rem;">' +
                '<label><input type="radio" name="create-team-type" value="boys" checked> Boys Lacrosse</label>' +
                '<label><input type="radio" name="create-team-type" value="girls"> Girls Lacrosse</label>' +
            '</div>' +
            '<button class="btn-primary" id="create-team-confirm" style="margin-bottom: 0.75rem;">Create Team</button>' +
            '<button class="btn-secondary" id="create-team-cancel">Cancel</button>';
        overlay.appendChild(content);
        document.body.appendChild(overlay);

        document.getElementById('create-team-cancel').onclick = function () { overlay.remove(); };
        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        document.getElementById('create-team-confirm').onclick = function () {
            var name = document.getElementById('create-team-name').value.trim();
            if (!name) { alert('Please enter a team name.'); return; }
            var gameType = document.querySelector('input[name="create-team-type"]:checked').value;
            overlay.remove();
            onConfirm(name, gameType);
        };
        // Focus the name input
        setTimeout(function () { document.getElementById('create-team-name').focus(); }, 100);
    }

    function _doCreateTeam(teamName, gameType) {
        monkeyPatchLocalStorage();

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

            // Save current team's data to Firestore before creating the new team
            var saveCurrentPromise = userDocRef
                ? buildDataBatch().commit().catch(function (err) {
                    console.warn('[LaxSync] Pre-create save failed:', err.message);
                })
                : Promise.resolve();

            // Write team metadata document
            return saveCurrentPromise.then(function () {
                return db.collection('teams').doc(code).set({
                    teamName: teamName,
                    gameType: gameType || 'boys',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    createdBy: uid
                });
            }).then(function () {
                // Add to local teams array
                var teams = getUserTeams();
                teams.push({ code: code, name: teamName, gameType: gameType || 'boys', joinedAt: new Date().toISOString() });
                setUserTeams(teams);

                // Set as active team
                localStorage.setItem(ACTIVE_TEAM_KEY, code);

                // Drain pending writes and deferred snapshots from old team
                pendingWrites = [];
    
                // Prevent stale hydration state from flushing old data to new team
                hydrationComplete = false;

                // Switch sync target to team path
                switchToTeamPath(code);

                // Clear ALL local data so the new team starts completely fresh
                suppressSync = true;
                try {
                    localStorage.removeItem('laxkeeper_roster');
                    localStorage.removeItem('laxkeeper_games');
                    localStorage.removeItem('laxkeeper_current_game');
                    localStorage.setItem('laxkeeper_team_name', teamName);
                } finally {
                    suppressSync = false;
                }

                // Mark hydration complete for the new (empty) team
                hydrationComplete = true;

                refreshUI();

                // Navigate to home screen so user sees the fresh team
                if (typeof showScreen === 'function') showScreen('home-screen');

                // Setup realtime listeners
                setupRealtimeListeners();

                // Persist teams to user doc
                persistTeamsToFirestore();

                loadTeamUI();
                updateActiveTeamDisplay();

                // Log new team creation for admin notifications
                var user = firebase.auth().currentUser;
                db.collection('team_events').add({
                    type: 'team_created',
                    teamCode: code,
                    teamName: teamName,
                    gameType: gameType || 'boys',
                    createdBy: user ? user.displayName || user.email || uid : uid,
                    createdByEmail: user ? user.email || '' : '',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                console.log('[LaxSync] Team created with code:', code);
                alert('Team created! Your code is: ' + code);
            });
        }).catch(function (err) {
            console.error('[LaxSync] Create team failed:', err);
            alert('Failed to create team. Check your connection and try again.');
        });
    }

    function joinTeam() {
        var user = firebase.auth().currentUser;
        if (user) uid = user.uid;

        if (!uid) {
            alert('You must be signed in to join a team.');
            return;
        }

        // Block joining while a game is in progress
        if (gameInProgress || localStorage.getItem('laxkeeper_current_game')) {
            alert('You have a game in progress. Please end or cancel the game before joining a team.');
            return;
        }

        var input = document.getElementById('join-team-code');
        var code = (input ? input.value : '').toUpperCase().trim();

        if (code.length !== 6) {
            alert('Please enter a 6-character team code.');
            return;
        }

        // Check if already a member
        var teams = getUserTeams();
        if (teams.some(function (t) { return t.code === code; })) {
            alert('You are already a member of this team.');
            if (input) input.value = '';
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
            if (!confirm('Join team "' + teamLabel + '"? This will switch you to the team\'s data.')) {
                return;
            }

            // Save current team data before switching
            var savePromise = userDocRef
                ? buildDataBatch().commit().catch(function (err) {
                    console.warn('[LaxSync] Pre-join save failed:', err.message);
                })
                : Promise.resolve();

            savePromise.then(function () {
                // Clear pending writes from old team
                pendingWrites = [];
    
                // Add to local teams array (inherit gameType from team metadata)
                var joinedGameType = teamData.gameType || 'boys';
                teams.push({ code: code, name: teamLabel, gameType: joinedGameType, joinedAt: new Date().toISOString() });
                setUserTeams(teams);

                // Set as active team
                localStorage.setItem(ACTIVE_TEAM_KEY, code);

                // Switch sync target to team path
                switchToTeamPath(code);

                // Pull team data down to local (team data wins — replace mode)
                hydrateFromFirestore(true).then(function () {
                    setupRealtimeListeners();

                    // Persist teams to user doc
                    persistTeamsToFirestore();

                    loadTeamUI();
                    updateActiveTeamDisplay();
                    if (input) input.value = '';
                    console.log('[LaxSync] Joined team:', code);
                });
            });
        }).catch(function (err) {
            console.error('[LaxSync] Join team failed:', err);
            alert('Failed to join team. Check your connection and try again.');
        });
    }

    function leaveTeam(code) {
        if (!code) code = getActiveTeam();
        if (!code) return;

        // Block leaving while a game is in progress
        if (getActiveTeam() === code && (gameInProgress || localStorage.getItem('laxkeeper_current_game'))) {
            alert('You have a game in progress. Please end or cancel the game before leaving the team.');
            return;
        }

        var teams = getUserTeams();
        var team = teams.find(function (t) { return t.code === code; });
        var teamLabel = team ? team.name : code;

        if (!confirm('Leave team "' + teamLabel + '"? Your data will stay on the device but will no longer sync.')) {
            return;
        }

        // Flush pending writes to the current team before leaving
        var flushPromise = (getActiveTeam() === code && userDocRef)
            ? buildDataBatch().commit().catch(function (err) {
                console.warn('[LaxSync] Pre-leave save failed:', err.message);
            })
            : Promise.resolve();

        flushPromise.then(function () {
            // Clear pending writes — they belonged to the team we're leaving
            pendingWrites = [];

            // Remove from teams array
            teams = teams.filter(function (t) { return t.code !== code; });
            setUserTeams(teams);

            // If we left the active team, switch to another or clear
            if (getActiveTeam() === code) {
                detachListeners();
                userDocRef = null;

                if (teams.length > 0) {
                    // Switch to the first remaining team — clear local data first
                    // to prevent old team's data from contaminating the new team
                    suppressSync = true;
                    try {
                        localStorage.removeItem('laxkeeper_roster');
                        localStorage.removeItem('laxkeeper_games');
                        localStorage.removeItem('laxkeeper_current_game');
                    } finally {
                        suppressSync = false;
                    }
                    localStorage.setItem(ACTIVE_TEAM_KEY, teams[0].code);
                    userDocRef = firebase.firestore().collection('teams').doc(teams[0].code).collection('data');
                    hydrateFromFirestore().then(function () {
                        setupRealtimeListeners();
                        loadTeamUI();
                        updateActiveTeamDisplay();
                        refreshUI();
                        persistTeamsToFirestore();
                    });
                    return;
                } else {
                    localStorage.removeItem(ACTIVE_TEAM_KEY);
                }
            }

            persistTeamsToFirestore();
            loadTeamUI();
            updateActiveTeamDisplay();
            console.log('[LaxSync] Left team:', code);
        });
    }

    function forcePush() {
        try {
            var user = firebase.auth().currentUser;
            if (user) uid = user.uid;

            if (!uid) {
                alert('You must be signed in to sync.');
                return;
            }

            var activeCode = getActiveTeam();
            if (!activeCode) {
                alert('No active team. Create or join a team first.');
                return;
            }

            if (!confirm('This will overwrite cloud data with what\'s on this device. Continue?')) {
                return;
            }

            monkeyPatchLocalStorage();
            userDocRef = firebase.firestore().collection('teams').doc(activeCode).collection('data');

            buildDataBatch().commit().then(function () {
                setupRealtimeListeners();
                persistTeamsToFirestore();
                alert('Sync complete! Local data pushed to cloud for team ' + activeCode + '.');
                console.log('[LaxSync] Force push complete for team:', activeCode);
            }).catch(function (err) {
                console.error('[LaxSync] Force push failed:', err);
                alert('Sync failed: ' + err.message);
            });
        } catch (err) {
            console.error('[LaxSync] Force push error:', err);
            alert('Sync error: ' + err.message);
        }
    }

    function recoverData() {
        var user = firebase.auth().currentUser;
        if (user) uid = user.uid;
        if (!uid) { alert('You must be signed in.'); return; }

        var activeCode = getActiveTeam();
        if (!activeCode) { alert('No active team.'); return; }

        var resultsDiv = document.getElementById('recover-results');
        if (resultsDiv) resultsDiv.innerHTML = '<p style="color:var(--text-secondary);padding:0.5rem 0;">Scanning...</p>';

        var db = firebase.firestore();
        var localGames = getLocalArray('laxkeeper_games');
        var localRoster = getLocalArray('laxkeeper_roster');
        var localGameIds = {};
        localGames.forEach(function (g) { if (g.id) localGameIds[g.id] = true; });
        var localPlayerIds = {};
        localRoster.forEach(function (p) { if (p.id) localPlayerIds[p.id] = true; });

        // Scan all teams the user belongs to
        var teams = getUserTeams();
        var allTeamCodes = teams.map(function (t) { return t.code; });
        // Also include active code in case it's not in the list
        if (allTeamCodes.indexOf(activeCode) === -1) allTeamCodes.push(activeCode);

        var foundGames = [];
        var foundPlayers = [];
        var orphanPlayerIds = {};
        var scanned = 0;

        function scanTeam(code) {
            var teamRef = db.collection('teams').doc(code).collection('data');
            return Promise.all([
                teamRef.doc('games').get(),
                teamRef.doc('roster').get()
            ]).then(function (results) {
                var gamesDoc = results[0];
                var rosterDoc = results[1];

                var teamGames = gamesDoc.exists && gamesDoc.data().items ? gamesDoc.data().items : [];
                var teamRoster = rosterDoc.exists && rosterDoc.data().items ? rosterDoc.data().items : [];

                // Find games not in local
                teamGames.forEach(function (g) {
                    if (g.id && !localGameIds[g.id]) {
                        foundGames.push({ game: g, fromTeam: code });
                    }
                    // Check for orphaned player IDs in game stats
                    if (g.stats) {
                        Object.keys(g.stats).forEach(function (pid) {
                            if (!localPlayerIds[pid]) {
                                orphanPlayerIds[pid] = true;
                            }
                        });
                    }
                });

                // Also check local games for orphaned players
                localGames.forEach(function (g) {
                    if (g.stats) {
                        Object.keys(g.stats).forEach(function (pid) {
                            if (!localPlayerIds[pid]) {
                                orphanPlayerIds[pid] = true;
                            }
                        });
                    }
                });

                // Try to resolve orphan IDs from this team's roster
                teamRoster.forEach(function (p) {
                    if (orphanPlayerIds[p.id] && !localPlayerIds[p.id]) {
                        var isDuplicate = foundPlayers.some(function (fp) { return fp.id === p.id; });
                        if (!isDuplicate) {
                            foundPlayers.push({ id: p.id, name: p.name, number: p.number, position: p.position, fromTeam: code });
                        }
                    }
                });
            }).catch(function (err) {
                console.warn('[Recover] Error scanning team ' + code + ':', err.message);
            });
        }

        var scanPromises = allTeamCodes.map(function (code) { return scanTeam(code); });

        Promise.all(scanPromises).then(function () {
            var html = '';

            if (foundGames.length === 0 && foundPlayers.length === 0) {
                html = '<p style="color:var(--text-secondary);padding:0.5rem 0;">No missing data found. Everything looks good!</p>';
            } else {
                if (foundGames.length > 0) {
                    html += '<h4 style="margin:1rem 0 0.5rem;color:var(--text-primary);">Missing Games (' + foundGames.length + ')</h4>';
                    foundGames.forEach(function (fg, i) {
                        var g = fg.game;
                        var score = (g.homeScore != null ? g.homeScore : '?') + '-' + (g.awayScore != null ? g.awayScore : '?');
                        var label = (g.opponent || 'Unknown') + ' ' + score + ' (' + (g.date || 'no date') + ')';
                        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;margin-bottom:0.25rem;background:var(--bg-color);border-radius:8px;">';
                        html += '<span style="color:var(--text-primary);font-size:0.9rem;">' + escapeHtml(label) + '</span>';
                        html += '<button class="btn-primary" style="padding:0.4rem 0.75rem;font-size:0.8rem;" onclick="LaxSync.recoverGame(' + i + ')">Recover</button>';
                        html += '</div>';
                    });
                }

                if (foundPlayers.length > 0) {
                    html += '<h4 style="margin:1rem 0 0.5rem;color:var(--text-primary);">Orphaned Players (' + foundPlayers.length + ')</h4>';
                    html += '<p style="color:var(--text-secondary);font-size:0.8rem;margin-bottom:0.5rem;">Players with stats in games but missing from your roster.</p>';
                    foundPlayers.forEach(function (p, i) {
                        var label = '#' + p.number + ' ' + p.name + ' (' + p.position + ')';
                        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;margin-bottom:0.25rem;background:var(--bg-color);border-radius:8px;">';
                        html += '<span style="color:var(--text-primary);font-size:0.9rem;">' + escapeHtml(label) + '</span>';
                        html += '<button class="btn-primary" style="padding:0.4rem 0.75rem;font-size:0.8rem;" onclick="LaxSync.recoverPlayer(' + i + ')">Add to Roster</button>';
                        html += '</div>';
                    });
                }

                if (foundGames.length > 0 || foundPlayers.length > 0) {
                    html += '<button class="btn-primary" style="width:100%;margin-top:0.75rem;" onclick="LaxSync.recoverAll()">Recover All</button>';
                }
            }

            if (resultsDiv) resultsDiv.innerHTML = html;

            // Store results for recovery buttons
            recoverState.games = foundGames;
            recoverState.players = foundPlayers;
        });
    }

    var recoverState = { games: [], players: [] };

    function recoverGame(index) {
        var fg = recoverState.games[index];
        if (!fg) return;
        var localGames = getLocalArray('laxkeeper_games');
        if (localGames.some(function (g) { return g.id === fg.game.id; })) {
            alert('Game already in your data.');
            return;
        }
        localGames.push(fg.game);
        localStorage.setItem('laxkeeper_games', JSON.stringify(localGames));
        if (typeof loadGameHistory === 'function') loadGameHistory();
        if (typeof loadScheduledGames === 'function') loadScheduledGames();
        alert('Game recovered: ' + (fg.game.opponent || 'Unknown'));
        recoverData(); // refresh results
    }

    function recoverPlayer(index) {
        var p = recoverState.players[index];
        if (!p) return;
        var roster = getLocalArray('laxkeeper_roster');
        if (roster.some(function (r) { return r.id === p.id; })) {
            alert('Player already in roster.');
            return;
        }
        roster.push({ id: p.id, name: p.name, number: p.number, position: p.position });
        localStorage.setItem('laxkeeper_roster', JSON.stringify(roster));
        if (typeof loadRoster === 'function') loadRoster();
        alert('Added #' + p.number + ' ' + p.name + ' to roster.');
        recoverData(); // refresh results
    }

    function recoverAll() {
        var localGames = getLocalArray('laxkeeper_games');
        var localGameIds = {};
        localGames.forEach(function (g) { if (g.id) localGameIds[g.id] = true; });

        var gamesAdded = 0;
        recoverState.games.forEach(function (fg) {
            if (!localGameIds[fg.game.id]) {
                localGames.push(fg.game);
                gamesAdded++;
            }
        });
        if (gamesAdded) localStorage.setItem('laxkeeper_games', JSON.stringify(localGames));

        var roster = getLocalArray('laxkeeper_roster');
        var rosterIds = {};
        roster.forEach(function (p) { if (p.id) rosterIds[p.id] = true; });

        var playersAdded = 0;
        recoverState.players.forEach(function (p) {
            if (!rosterIds[p.id]) {
                roster.push({ id: p.id, name: p.name, number: p.number, position: p.position });
                playersAdded++;
            }
        });
        if (playersAdded) localStorage.setItem('laxkeeper_roster', JSON.stringify(roster));

        if (typeof loadGameHistory === 'function') loadGameHistory();
        if (typeof loadScheduledGames === 'function') loadScheduledGames();
        if (typeof loadRoster === 'function') loadRoster();

        alert('Recovered ' + gamesAdded + ' game(s) and ' + playersAdded + ' player(s).');
        recoverData(); // refresh results
    }

    function forcePull() {
        var user = firebase.auth().currentUser;
        if (user) uid = user.uid;
        if (!uid) { alert('You must be signed in.'); return; }

        var activeCode = getActiveTeam();
        if (!activeCode) { alert('No active team.'); return; }

        if (!confirm('This will overwrite local data with what\'s in the cloud. Continue?')) return;

        userDocRef = firebase.firestore().collection('teams').doc(activeCode).collection('data');
        monkeyPatchLocalStorage();

        userDocRef.get().then(function (snapshot) {
            var cloudDocs = {};
            snapshot.forEach(function (doc) { cloudDocs[doc.id] = doc.data(); });

            suppressSync = true;
            try {
                if (cloudDocs.roster && cloudDocs.roster.items) {
                    localStorage.setItem('laxkeeper_roster', JSON.stringify(cloudDocs.roster.items));
                }
                if (cloudDocs.games && cloudDocs.games.items) {
                    localStorage.setItem('laxkeeper_games', JSON.stringify(cloudDocs.games.items));
                }
                if (cloudDocs.settings && cloudDocs.settings.teamName) {
                    localStorage.setItem('laxkeeper_team_name', cloudDocs.settings.teamName);
                }
            } finally {
                suppressSync = false;
            }

            refreshUI();
            setupRealtimeListeners();

            var gameCount = cloudDocs.games && cloudDocs.games.items ? cloudDocs.games.items.length : 0;
            alert('Pulled cloud data: ' + gameCount + ' game(s) loaded for team ' + activeCode);
        }).catch(function (err) {
            console.error('[LaxSync] Force pull failed:', err);
            alert('Pull failed: ' + err.message);
        });
    }

    function recoverFromTeam() {
        var user = firebase.auth().currentUser;
        if (user) uid = user.uid;
        if (!uid) { alert('You must be signed in.'); return; }

        var input = document.getElementById('recover-team-code');
        var code = (input ? input.value : '').toUpperCase().trim();
        if (code.length !== 6) { alert('Enter a 6-character team code.'); return; }

        var resultsDiv = document.getElementById('recover-results');
        if (resultsDiv) resultsDiv.innerHTML = '<p style="color:var(--text-secondary);padding:0.5rem 0;">Scanning team ' + code + '...</p>';

        var db = firebase.firestore();
        var teamRef = db.collection('teams').doc(code).collection('data');

        var localGames = getLocalArray('laxkeeper_games');
        var localGameIds = {};
        localGames.forEach(function (g) { if (g.id) localGameIds[g.id] = true; });

        var localRoster = getLocalArray('laxkeeper_roster');
        var localPlayerIds = {};
        localRoster.forEach(function (p) { if (p.id) localPlayerIds[p.id] = true; });

        Promise.all([teamRef.doc('games').get(), teamRef.doc('roster').get()]).then(function (results) {
            var gamesDoc = results[0];
            var rosterDoc = results[1];
            var teamGames = gamesDoc.exists && gamesDoc.data().items ? gamesDoc.data().items : [];
            var teamRoster = rosterDoc.exists && rosterDoc.data().items ? rosterDoc.data().items : [];

            var foundGames = [];
            teamGames.forEach(function (g) {
                if (g.id && !localGameIds[g.id]) foundGames.push({ game: g, fromTeam: code });
            });

            var foundPlayers = [];
            teamRoster.forEach(function (p) {
                if (p.id && !localPlayerIds[p.id]) foundPlayers.push({ id: p.id, name: p.name, number: p.number, position: p.position, fromTeam: code });
            });

            recoverState.games = foundGames;
            recoverState.players = foundPlayers;

            var html = '';
            if (foundGames.length === 0 && foundPlayers.length === 0) {
                html = '<p style="color:var(--text-secondary);padding:0.5rem 0;">No new data found in team ' + code + '.</p>';
            } else {
                if (foundGames.length > 0) {
                    html += '<h4 style="margin:1rem 0 0.5rem;color:var(--text-primary);">Games (' + foundGames.length + ')</h4>';
                    foundGames.forEach(function (fg, i) {
                        var g = fg.game;
                        var score = (g.homeScore != null ? g.homeScore : '?') + '-' + (g.awayScore != null ? g.awayScore : '?');
                        var label = (g.opponent || 'Unknown') + ' ' + score + ' (' + (g.date || 'no date') + ')';
                        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;margin-bottom:0.25rem;background:var(--bg-color);border-radius:8px;">';
                        html += '<span style="color:var(--text-primary);font-size:0.9rem;">' + escapeHtml(label) + '</span>';
                        html += '<button class="btn-primary" style="padding:0.4rem 0.75rem;font-size:0.8rem;" onclick="LaxSync.recoverGame(' + i + ')">Recover</button>';
                        html += '</div>';
                    });
                }
                if (foundPlayers.length > 0) {
                    html += '<h4 style="margin:1rem 0 0.5rem;color:var(--text-primary);">Players (' + foundPlayers.length + ')</h4>';
                    foundPlayers.forEach(function (p, i) {
                        var label = '#' + p.number + ' ' + p.name + ' (' + p.position + ')';
                        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;margin-bottom:0.25rem;background:var(--bg-color);border-radius:8px;">';
                        html += '<span style="color:var(--text-primary);font-size:0.9rem;">' + escapeHtml(label) + '</span>';
                        html += '<button class="btn-primary" style="padding:0.4rem 0.75rem;font-size:0.8rem;" onclick="LaxSync.recoverPlayer(' + i + ')">Add to Roster</button>';
                        html += '</div>';
                    });
                }
                html += '<button class="btn-primary" style="width:100%;margin-top:0.75rem;" onclick="LaxSync.recoverAll()">Recover All</button>';
            }
            if (resultsDiv) resultsDiv.innerHTML = html;
        }).catch(function (err) {
            console.error('[Recover] Error scanning team:', err);
            if (resultsDiv) resultsDiv.innerHTML = '<p style="color:var(--danger-color);padding:0.5rem 0;">Error: ' + err.message + '</p>';
        });
    }

    function copyTeamCode(code) {
        if (!code) code = getActiveTeam();
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
        var container = document.getElementById('team-list-container');
        if (!container) return; // settings screen not rendered yet

        var teams = getUserTeams();
        var activeCode = getActiveTeam();

        if (teams.length === 0) {
            container.innerHTML = '<div class="team-list-empty">No teams yet. Create or join a team to sync data across devices.</div>';
            return;
        }

        var html = '<div class="team-list">';
        teams.forEach(function (team) {
            var isActive = team.code === activeCode;
            html += '<div class="team-list-item' + (isActive ? ' active' : '') + '" onclick="LaxSync.switchTeam(\'' + team.code + '\')">';
            html += '  <div class="team-list-item-info">';
            var typeLabel = team.gameType === 'girls' ? 'Girls' : 'Boys';
            html += '    <div class="team-list-item-name">' + escapeHtml(team.name) + ' <span style="font-size:0.75rem;color:var(--text-secondary);font-weight:400;">(' + typeLabel + ')</span></div>';
            html += '    <div class="team-list-item-code">' + team.code;
            html += '      <button class="team-copy-btn" style="margin-left:0.5rem;" onclick="event.stopPropagation(); LaxSync.copyTeamCode(\'' + team.code + '\')">Copy</button>';
            html += '    </div>';
            html += '  </div>';
            if (isActive) {
                html += '  <span class="team-list-item-active-label">Active</span>';
            }
            html += '  <div class="team-leave-section" onclick="event.stopPropagation();">';
            html += '    <button class="team-leave-btn" onclick="LaxSync.leaveTeam(\'' + team.code + '\')">Leave Team</button>';
            html += '  </div>';
            html += '</div>';
        });
        html += '</div>';

        container.innerHTML = html;
    }

    // ---- Active Team Display on Home Screen ----
    function updateActiveTeamDisplay() {
        var badge = document.getElementById('active-team-display');
        if (badge) {
            var activeCode = getActiveTeam();
            if (!activeCode) {
                badge.textContent = '';
            } else {
                var teams = getUserTeams();
                var activeTeam = teams.find(function (t) { return t.code === activeCode; });
                badge.textContent = activeTeam ? activeTeam.name : activeCode;
            }
        }

        // Also update the team selector dropdown if the app has defined it
        if (typeof renderTeamSelector === 'function') {
            renderTeamSelector();
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

    // Read a localStorage key as a parsed array, with fallback to []
    function getLocalArray(key) {
        var val = localStorage.getItem(key);
        if (!val) return [];
        try { return JSON.parse(val); } catch (e) { return []; }
    }

    function logError(err) {
        console.error('[LaxSync] Firestore write failed:', err);
        // If auth-related, refresh token so next write succeeds
        if (err.code === 'permission-denied' || err.code === 'unauthenticated') {
            var user = firebase.auth().currentUser;
            if (user) {
                user.getIdToken(true).then(function () {
                    console.log('[LaxSync] Token refreshed after write failure');
                }).catch(function () {});
            }
        }
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ---- Game-in-progress guard ----
    function setGameActive() {
        gameInProgress = true;
        console.log('[LaxSync] Game checked out — all incoming snapshots dropped until end game');
    }

    function setGameInactive() {
        gameInProgress = false;
        console.log('[LaxSync] Game ended — merging back to Firestore (adds only)');

        if (!userDocRef) return;

        // Read current local games (includes the just-completed game)
        var localGames = safeJSONParse(localStorage.getItem('laxkeeper_games')) || [];

        // Merge into Firestore: add/update local games, never delete cloud games
        var gamesRef = userDocRef.doc('games');
        var now = firebase.firestore.FieldValue.serverTimestamp();

        firebase.firestore().runTransaction(function (transaction) {
            return transaction.get(gamesRef).then(function (doc) {
                var cloudGames = (doc.exists && doc.data() && doc.data().items) ? doc.data().items : [];
                var merged = mergeGames(localGames, cloudGames);
                transaction.set(gamesRef, { items: merged || localGames, updatedAt: now });
                return merged || localGames;
            });
        }).then(function (merged) {
            // Update local with the merged result (adds cloud-only games locally)
            writeLocalSuppressed('laxkeeper_games', JSON.stringify(merged));
            refreshUI();
            console.log('[LaxSync] Post-game merge complete:', merged.length, 'games');
        }).catch(function (err) {
            console.error('[LaxSync] Post-game merge failed, queuing:', err.message);
            queuePendingWrite('laxkeeper_games', localStorage.getItem('laxkeeper_games'));
        });
    }

    // ---- Conflict Resolution ----
    // Rule: completed ALWAYS wins. A completed game has stats and must never
    // be overwritten by a scheduled/in_progress version without user consent.
    function resolveGameConflict(a, b) {
        if (!a) return b;
        if (!b) return a;

        var aCompleted = a.status === 'completed';
        var bCompleted = b.status === 'completed';

        // Completed always wins over non-completed
        if (aCompleted && !bCompleted) return a;
        if (bCompleted && !aCompleted) return b;

        // Both completed — keep the one with more recent completedAt
        if (aCompleted && bCompleted) {
            if (a.completedAt && b.completedAt) {
                return new Date(a.completedAt) >= new Date(b.completedAt) ? a : b;
            }
            return a.completedAt ? a : b;
        }

        // Neither completed — prefer the one with more data (e.g. in_progress over scheduled)
        var STATUS_RANK = { 'in_progress': 1, 'scheduled': 0 };
        var rankA = STATUS_RANK[a.status] || 0;
        var rankB = STATUS_RANK[b.status] || 0;
        if (rankA !== rankB) return rankA > rankB ? a : b;

        return a;
    }

    // Adds-only merge of two game arrays.
    // - Never deletes games from either side
    // - On ID conflict, resolveGameConflict picks the winner (completed beats scheduled)
    // - localArray is passed as first arg to resolveGameConflict (tie-break favors local)
    function mergeGames(localArray, cloudArray) {
        if (!localArray && !cloudArray) return null;
        if (!localArray || !Array.isArray(localArray)) return cloudArray || null;
        if (!cloudArray || !Array.isArray(cloudArray)) return localArray;

        // Index cloud by ID
        var cloudById = {};
        cloudArray.forEach(function (item) {
            if (item && item.id) cloudById[item.id] = item;
        });

        // Start with resolved versions of all games that exist in local
        var mergedById = {};
        var merged = [];

        localArray.forEach(function (localItem) {
            if (!localItem || !localItem.id) return;
            var cloudItem = cloudById[localItem.id];
            var winner = cloudItem ? resolveGameConflict(localItem, cloudItem) : localItem;
            merged.push(winner);
            mergedById[localItem.id] = true;
        });

        // Add cloud-only games (not in local — never delete)
        cloudArray.forEach(function (cloudItem) {
            if (cloudItem && cloudItem.id && !mergedById[cloudItem.id]) {
                merged.push(cloudItem);
            }
        });

        return merged;
    }

    // ---- Online/offline reconnect ----
    // When phone wakes up or regains connectivity, re-verify auth and flush pending writes
    function setupConnectivityHandlers() {
        window.addEventListener('online', function () {
            console.log('[LaxSync] Back online — checking sync state');
            var user = firebase.auth().currentUser;
            if (user) {
                // Refresh auth token (may have expired while offline/asleep)
                user.getIdToken(true).then(function () {
                    console.log('[LaxSync] Auth token refreshed after reconnect');
                    if (userDocRef) {
                        flushPendingWrites();
                    } else if (getActiveTeam()) {
                        // userDocRef lost — re-establish
                        var code = getActiveTeam();
                        userDocRef = firebase.firestore().collection('teams').doc(code).collection('data');
                        flushPendingWrites();
                    }
                }).catch(function (err) {
                    console.warn('[LaxSync] Token refresh failed after reconnect:', err.message);
                    // Retry once after 5s
                    setTimeout(function () {
                        var retryUser = firebase.auth().currentUser;
                        if (retryUser) {
                            retryUser.getIdToken(true).then(function () {
                                console.log('[LaxSync] Token refresh succeeded on retry');
                                if (userDocRef && pendingWrites.length > 0) flushPendingWrites();
                            }).catch(function (retryErr) {
                                console.warn('[LaxSync] Token refresh retry also failed:', retryErr.message);
                                // Third attempt at 30s — next online/visibility event covers further retries
                                setTimeout(function () {
                                    var lastUser = firebase.auth().currentUser;
                                    if (lastUser) {
                                        lastUser.getIdToken(true).then(function () {
                                            console.log('[LaxSync] Token refresh succeeded on third attempt');
                                            if (userDocRef && pendingWrites.length > 0) flushPendingWrites();
                                        }).catch(function (thirdErr) {
                                            console.warn('[LaxSync] Token refresh third attempt failed:', thirdErr.message);
                                        });
                                    }
                                }, 30000);
                            });
                        }
                    }, 5000);
                });
            }
        });

        // Also handle visibility change (phone screen wake)
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible' && navigator.onLine) {
                var user = firebase.auth().currentUser;
                if (user && getActiveTeam()) {
                    // Silently refresh token to keep Firestore writes working
                    user.getIdToken(true).catch(function (err) {
                        console.warn('[LaxSync] Token refresh on wake failed:', err.message);
                        setTimeout(function () {
                            var retryUser = firebase.auth().currentUser;
                            if (retryUser) {
                                retryUser.getIdToken(true).then(function () {
                                    console.log('[LaxSync] Token refresh succeeded on wake retry');
                                    if (userDocRef && pendingWrites.length > 0) flushPendingWrites();
                                }).catch(function () {});
                            }
                        }, 5000);
                    });
                    // Flush anything queued while backgrounded
                    if (pendingWrites.length > 0 && userDocRef) {
                        flushPendingWrites();
                    }
                }
            }
        });
    }

    // ---- Explicit game deletion (user-initiated, bypasses adds-only merge) ----
    function deleteGameFromCloud(gameId) {
        if (!userDocRef) return;

        var gamesRef = userDocRef.doc('games');
        var now = firebase.firestore.FieldValue.serverTimestamp();

        firebase.firestore().runTransaction(function (transaction) {
            return transaction.get(gamesRef).then(function (doc) {
                var cloudGames = (doc.exists && doc.data() && doc.data().items) ? doc.data().items : [];
                var filtered = cloudGames.filter(function (g) { return !g || g.id !== gameId; });
                transaction.set(gamesRef, { items: filtered, updatedAt: now });
            });
        }).then(function () {
            console.log('[LaxSync] Deleted game from cloud:', gameId);
        }).catch(function (err) {
            console.error('[LaxSync] Failed to delete game from cloud:', err);
        });
    }

    // ---- Auto-init on DOMContentLoaded ----
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            init();
            setupConnectivityHandlers();
        });
    } else {
        init();
        setupConnectivityHandlers();
    }

    return {
        init: init,
        createTeam: createTeam,
        joinTeam: joinTeam,
        leaveTeam: leaveTeam,
        copyTeamCode: copyTeamCode,
        switchTeam: switchTeam,
        forcePush: forcePush,
        forcePull: forcePull,
        recoverData: recoverData,
        recoverFromTeam: recoverFromTeam,
        recoverGame: recoverGame,
        recoverPlayer: recoverPlayer,
        recoverAll: recoverAll,
        loadTeamUI: loadTeamUI,
        getActiveTeam: getActiveTeam,
        getActiveTeamGameType: getActiveTeamGameType,
        getUserTeams: getUserTeams,
        updateActiveTeamDisplay: updateActiveTeamDisplay,
        setGameActive: setGameActive,
        setGameInactive: setGameInactive,
        deleteGameFromCloud: deleteGameFromCloud
    };
})();
