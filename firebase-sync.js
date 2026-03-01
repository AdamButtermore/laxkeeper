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
    function syncTeamsFromFirestore(user) {
        if (!user) return;
        var userRef = firebase.firestore().collection('users').doc(user.uid);
        userRef.get().then(function (doc) {
            if (doc.exists && doc.data().teams && doc.data().teams.length > 0) {
                var cloudTeams = doc.data().teams;
                var localTeams = getUserTeams();

                // Merge: add any cloud teams not already local
                var localCodes = {};
                localTeams.forEach(function (t) { localCodes[t.code] = true; });

                var merged = localTeams.slice();
                cloudTeams.forEach(function (ct) {
                    if (!localCodes[ct.code]) {
                        merged.push({ code: ct.code, name: ct.name || ct.code });
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
            console.error('[LaxSync] Failed to sync teams from Firestore:', err);
            loadTeamUI();
        });
    }

    // ---- Team getters/setters ----
    function getActiveTeam() {
        return localStorage.getItem(ACTIVE_TEAM_KEY) || '';
    }

    function getUserTeams() {
        var raw = localStorage.getItem(USER_TEAMS_KEY);
        if (!raw) return [];
        try { return JSON.parse(raw); } catch (e) { return []; }
    }

    function setUserTeams(teams) {
        localStorage.setItem(USER_TEAMS_KEY, JSON.stringify(teams));
    }

    // ---- Persist teams to Firestore user doc ----
    function persistTeamsToFirestore() {
        if (!uid) return;
        var teams = getUserTeams().map(function (t) {
            return { code: t.code, name: t.name, joinedAt: t.joinedAt || null };
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

        // Detach old listeners
        detachListeners();

        // Set new active team
        localStorage.setItem(ACTIVE_TEAM_KEY, code);

        // Point at new Firestore path
        userDocRef = firebase.firestore().collection('teams').doc(code).collection('data');

        // Hydrate localStorage from the new team's Firestore data
        hydrateFromFirestore().then(function () {
            setupRealtimeListeners();
            loadTeamUI();
            updateActiveTeamDisplay();
            refreshUI();
            persistTeamsToFirestore();
            console.log('[LaxSync] Switched to team:', code);
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
                // Add to local teams array
                var teams = getUserTeams();
                teams.push({ code: code, name: teamName, joinedAt: new Date().toISOString() });
                setUserTeams(teams);

                // Set as active team
                localStorage.setItem(ACTIVE_TEAM_KEY, code);

                // Switch sync target to team path
                switchToTeamPath(code);

                // Push current local data up to the new team path
                pushAllToFirestore();

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
        if (!uid) {
            alert('Still connecting to cloud. Please wait a moment and try again.');
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

            // Add to local teams array
            teams.push({ code: code, name: teamLabel, joinedAt: new Date().toISOString() });
            setUserTeams(teams);

            // Set as active team
            localStorage.setItem(ACTIVE_TEAM_KEY, code);

            // Switch sync target to team path
            switchToTeamPath(code);

            // Pull team data down to local (team data wins)
            hydrateFromFirestore().then(function () {
                setupRealtimeListeners();

                // Persist teams to user doc
                persistTeamsToFirestore();

                loadTeamUI();
                updateActiveTeamDisplay();
                if (input) input.value = '';
                console.log('[LaxSync] Joined team:', code);
            });
        }).catch(function (err) {
            console.error('[LaxSync] Join team failed:', err);
            alert('Failed to join team. Check your connection and try again.');
        });
    }

    function leaveTeam(code) {
        if (!code) code = getActiveTeam();
        if (!code) return;

        var teams = getUserTeams();
        var team = teams.find(function (t) { return t.code === code; });
        var teamLabel = team ? team.name : code;

        if (!confirm('Leave team "' + teamLabel + '"? Your data will stay on the device but will no longer sync.')) {
            return;
        }

        // Remove from teams array
        teams = teams.filter(function (t) { return t.code !== code; });
        setUserTeams(teams);

        // If we left the active team, switch to another or clear
        if (getActiveTeam() === code) {
            detachListeners();
            userDocRef = null;

            if (teams.length > 0) {
                // Switch to the first remaining team
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
            html += '    <div class="team-list-item-name">' + escapeHtml(team.name) + '</div>';
            html += '    <div class="team-list-item-code">' + team.code + '</div>';
            html += '  </div>';
            if (isActive) {
                html += '  <span class="team-list-item-active-label">Active</span>';
            }
            html += '  <div class="team-list-item-actions">';
            html += '    <button class="team-copy-btn" onclick="event.stopPropagation(); LaxSync.copyTeamCode(\'' + team.code + '\')">Copy</button>';
            html += '    <button class="team-leave-btn" onclick="event.stopPropagation(); LaxSync.leaveTeam(\'' + team.code + '\')">Leave</button>';
            html += '  </div>';
            html += '</div>';
        });
        html += '</div>';

        container.innerHTML = html;
    }

    // ---- Active Team Display on Home Screen ----
    function updateActiveTeamDisplay() {
        var badge = document.getElementById('active-team-display');
        if (!badge) return;

        var activeCode = getActiveTeam();
        if (!activeCode) {
            badge.textContent = '';
            return;
        }

        var teams = getUserTeams();
        var activeTeam = teams.find(function (t) { return t.code === activeCode; });
        badge.textContent = activeTeam ? activeTeam.name : activeCode;
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

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
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
        switchTeam: switchTeam,
        loadTeamUI: loadTeamUI,
        getActiveTeam: getActiveTeam,
        getUserTeams: getUserTeams,
        updateActiveTeamDisplay: updateActiveTeamDisplay
    };
})();
