// LaxKeeper - Lacrosse Stats Tracker
// Local Storage Keys
const STORAGE_KEYS = {
    ROSTER: 'laxkeeper_roster',
    GAMES: 'laxkeeper_games',
    TEAM_NAME: 'laxkeeper_team_name',
    CURRENT_GAME: 'laxkeeper_current_game'
};

// ===== GAME TYPE HELPERS (boys vs girls lacrosse) =====
// Returns display labels that differ between boys and girls lacrosse.
// The underlying stat keys ('faceoff-won', 'faceoff-lost') stay the same for data compatibility.
function getFaceoffLabel(gameType, which) {
    if (gameType === 'girls') {
        return which === 'won' ? 'Draw Won' : 'Draw Lost';
    }
    return which === 'won' ? 'Faceoff Won' : 'Faceoff Lost';
}
function getFaceoffAbbrev(gameType, which) {
    if (gameType === 'girls') {
        return which === 'won' ? 'DCW' : 'DCL';
    }
    return which === 'won' ? 'FOW' : 'FOL';
}
function getFaceoffPctLabel(gameType) {
    return gameType === 'girls' ? 'DC%' : 'FO%';
}
function getFaceoffPctLabelLong(gameType) {
    return gameType === 'girls' ? 'DC Win %' : 'FO Win %';
}
// Returns the stat display name map, adjusted for game type
function getStatNames(gameType) {
    return {
        'faceoff-won': getFaceoffLabel(gameType, 'won'),
        'faceoff-lost': getFaceoffLabel(gameType, 'lost'),
        'ground-ball': 'Ground Ball',
        'shot': 'Shot',
        'goal': 'Goal',
        'assist': 'Assist',
        'turnover': 'Turnover',
        'caused-turnover': 'Takeaway',
        'save': 'Save',
        'penalty': 'Penalty'
    };
}
// Get the gameType for the current or provided game, defaulting to 'boys'
function getGameType(game) {
    return (game && game.gameType) || 'boys';
}
// Create a fresh player stats object
function newPlayerStats() {
    return {
        'faceoff-won': [], 'faceoff-lost': [], 'ground-ball': [],
        'shot': [], 'goal': [], 'assist': [], 'turnover': [],
        'caused-turnover': [], 'save': [], 'penalty': []
    };
}

// Global State
let currentGame = null;
let clockInterval = null;
let selectedStat = null;

// ===== HTML ESCAPING =====
// Prevent XSS from user-controlled strings (player names, opponent names, etc.)
function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
// Escape a string for use inside an HTML attribute value (double-quoted)
function escapeAttr(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== STAT TIMESTAMP HELPERS =====
// Returns integer count from either old (number) or new (array) format
function getStatCount(val) {
    if (Array.isArray(val)) return val.length;
    if (typeof val === 'number') return val;
    return 0;
}

// Normalize legacy number stats to arrays so all code paths can assume arrays.
// Numbers become empty arrays (we lose the count, but gain consistency).
// Only needed for very old games — new games always init stats as [].
function normalizeGameStats(game) {
    if (!game) return;
    var statKeys = ['faceoff-won','faceoff-lost','ground-ball','shot','goal','assist','turnover','caused-turnover','save','penalty'];
    if (game.stats) {
        Object.keys(game.stats).forEach(function (pid) {
            var ps = game.stats[pid];
            statKeys.forEach(function (key) {
                if (ps[key] !== undefined && !Array.isArray(ps[key])) {
                    ps[key] = [];
                }
            });
        });
    }
    if (game.opponentStats) {
        statKeys.forEach(function (key) {
            if (game.opponentStats[key] !== undefined && !Array.isArray(game.opponentStats[key])) {
                game.opponentStats[key] = [];
            }
        });
    }
}

// Returns a timestamp object from current game clock state
function recordStatTimestamp() {
    if (!currentGame) return {};
    return {
        period: currentGame.currentPeriod,
        time: formatClockTime(currentGame.timeRemaining),
        timeRemaining: currentGame.timeRemaining
    };
}

// Format seconds into M:SS string
function formatClockTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Get total penalty minutes from a penalty stat value (array of entries with duration, or number)
function getPenaltyMinutes(val) {
    if (!Array.isArray(val)) return 0;
    return val.reduce((sum, entry) => sum + (entry.duration || 0), 0);
}

// Format penalty seconds as M:SS for display
function formatPIM(totalSeconds) {
    if (totalSeconds === 0) return '0:00';
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    // Wait for Firebase auth before loading data
    window.firebaseReady.then(function (user) {
        if (user) {
            // User is signed in — show main app
            showSignedInState(user);
        } else {
            // No user — stay on sign-in screen (already active in HTML)
            console.log('[App] Waiting for sign-in');
        }
    });
});

// Called by firebase-config.js when user signs in (after initial load)
function onAuthSignIn(user) {
    showSignedInState(user);
    // Re-init sync layer with the authenticated user
    LaxSync.init(user);
}

// Called by firebase-config.js when user signs out
function onAuthSignOut() {
    // Hide all screens, show sign-in
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById('signin-screen').classList.add('active');
}

function showSignedInState(user) {
    // Hide sign-in, show home
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById('home-screen').classList.add('active');

    // Load app data
    loadTeamName();
    loadRoster();
    loadScheduledGames();
    loadGameHistory();

    // Populate account section
    updateAccountUI(user);

    // Render team selector dropdown in header
    renderTeamSelector();

    // Check if new user — show welcome modal
    checkNewUser();

    // Update getting started banner visibility
    updateGettingStartedBanner();
}

// ===== TEAM SELECTOR DROPDOWN =====
function renderTeamSelector() {
    const select = document.getElementById('team-selector');
    if (!select) return;

    const teams = (typeof LaxSync !== 'undefined' && LaxSync.getUserTeams) ? LaxSync.getUserTeams() : [];
    const activeCode = (typeof LaxSync !== 'undefined' && LaxSync.getActiveTeam) ? LaxSync.getActiveTeam() : '';

    if (teams.length === 0) {
        select.innerHTML = '';
        select.style.display = 'none';
        return;
    }

    select.style.display = '';
    select.innerHTML = teams.map(t => {
        const typeTag = t.gameType === 'girls' ? ' (Girls)' : '';
        return `<option value="${t.code}"${t.code === activeCode ? ' selected' : ''}>${t.name}${typeTag}</option>`;
    }).join('');
}

function onTeamSelectorChange(code) {
    if (typeof LaxSync !== 'undefined' && LaxSync.switchTeam) {
        LaxSync.switchTeam(code);
    }
}

function checkNewUser() {
    const roster = getRoster();
    const teams = (typeof LaxSync !== 'undefined' && LaxSync.getUserTeams) ? LaxSync.getUserTeams() : [];
    const hasSeenWelcome = localStorage.getItem('laxtracular_welcomed');

    if (roster.length === 0 && teams.length === 0 && !hasSeenWelcome) {
        showWelcomeModal();
    }
}

function showWelcomeModal() {
    const overlay = document.createElement('div');
    overlay.className = 'welcome-overlay';
    overlay.innerHTML = `
        <div class="welcome-modal">
            <h2>Welcome to Laxtracular!</h2>
            <p>Track lacrosse stats in real-time, manage your roster, and sync data across devices with your team.</p>
            <div class="welcome-actions">
                <button class="btn-primary" onclick="dismissWelcome(); showScreen('roster-screen');">Build Your Roster</button>
                <button class="btn-secondary" onclick="dismissWelcome(); showScreen('settings-screen');">Join a Team with Code</button>
                <button class="btn-secondary" onclick="dismissWelcome();">Explore on My Own</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}

function dismissWelcome() {
    localStorage.setItem('laxtracular_welcomed', '1');
    const overlay = document.querySelector('.welcome-overlay');
    if (overlay) overlay.remove();
}

function updateGettingStartedBanner() {
    const banner = document.getElementById('getting-started-banner');
    if (!banner) return;

    const roster = getRoster();
    const games = getGames();
    const teams = (typeof LaxSync !== 'undefined' && LaxSync.getUserTeams) ? LaxSync.getUserTeams() : [];

    // Show banner if user hasn't done at least 2 of the 3 steps
    const steps = [roster.length > 0, games.length > 0, teams.length > 0];
    const completed = steps.filter(Boolean).length;

    banner.style.display = completed < 2 ? 'block' : 'none';
}

function updateAccountUI(user) {
    var nameEl = document.getElementById('account-name');
    var emailEl = document.getElementById('account-email');
    var avatarEl = document.getElementById('account-avatar');

    if (nameEl) nameEl.textContent = user.displayName || 'User';
    if (emailEl) emailEl.textContent = user.email || '';
    if (avatarEl) {
        if (user.photoURL) {
            avatarEl.innerHTML = '<img src="' + user.photoURL + '" alt="avatar" referrerpolicy="no-referrer">';
        } else {
            avatarEl.textContent = (user.displayName || 'U').charAt(0).toUpperCase();
        }
    }
}

// ===== OVERLAY FACTORY =====
// Creates a fullscreen overlay div, appends it to the body, and returns it.
// Options: id, centered (adds flex centering), z1100 (higher z-index), className (extra classes)
function createOverlay(opts) {
    opts = opts || {};
    const overlay = document.createElement('div');
    let cls = 'overlay';
    if (opts.centered) cls += ' overlay--centered';
    if (opts.z1100) cls += ' overlay--z1100';
    if (opts.className) cls += ' ' + opts.className;
    overlay.className = cls;
    if (opts.id) overlay.id = opts.id;
    document.body.appendChild(overlay);
    return overlay;
}

// ===== SCREEN NAVIGATION =====
function showScreen(screenId) {
    // Don't allow navigating away from sign-in if not authenticated
    if (!firebase.auth().currentUser && screenId !== 'signin-screen') {
        return;
    }

    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
    window.scrollTo(0, 0);

    // Refresh data when showing certain screens
    if (screenId === 'roster-screen') loadRoster();
    if (screenId === 'schedule-screen') {
        loadScheduledGames();
        // Populate team banner
        const schedTeamName = document.getElementById('schedule-team-name');
        const schedBanner = document.getElementById('schedule-team-banner');
        if (schedTeamName && schedBanner) {
            const teams = (typeof LaxSync !== 'undefined' && LaxSync.getUserTeams) ? LaxSync.getUserTeams() : [];
            const activeCode = (typeof LaxSync !== 'undefined' && LaxSync.getActiveTeam) ? LaxSync.getActiveTeam() : '';
            const activeTeam = teams.find(t => t.code === activeCode);
            if (activeTeam) {
                schedTeamName.textContent = activeTeam.name;
                schedBanner.style.display = '';
            } else {
                const fallback = localStorage.getItem(STORAGE_KEYS.TEAM_NAME);
                if (fallback) {
                    schedTeamName.textContent = fallback;
                    schedBanner.style.display = '';
                } else {
                    schedBanner.style.display = 'none';
                }
            }
        }
        // Pre-select game type from active team and apply defaults
        const teamGameType = (typeof LaxSync !== 'undefined' && LaxSync.getActiveTeamGameType) ? LaxSync.getActiveTeamGameType() : 'boys';
        const gameTypeRadio = document.querySelector(`input[name="game-type"][value="${teamGameType}"]`);
        if (gameTypeRadio) {
            gameTypeRadio.checked = true;
            applyGameTypeDefaults();
        }
    }
    if (screenId === 'games-screen') loadGamesList();
    if (screenId === 'history-screen') loadGameHistory();
    if (screenId === 'season-summary-screen') loadSeasonSummary();
    if (screenId === 'settings-screen') loadSettings();
    if (screenId === 'about-screen') renderAboutShotChartExample();
}

// ===== ROSTER MANAGEMENT =====
function logEvent(name, params) {
    if (typeof firebase !== 'undefined' && firebase.analytics) {
        firebase.analytics().logEvent(name, params);
    }
}

function addPlayer() {
    const name = document.getElementById('player-name').value.trim();
    const number = document.getElementById('player-number').value.trim();
    const position = document.getElementById('player-position').value;

    if (!name || !number || !position) {
        alert('Please fill in all fields');
        return;
    }

    const roster = getRoster();

    // Check if number already exists
    if (roster.some(p => p.number === number)) {
        alert('Player number already exists');
        return;
    }

    roster.push({
        id: Date.now().toString(),
        name,
        number,
        position
    });

    saveRoster(roster);
    loadRoster();
    logEvent('add_player', { position });

    // Clear form
    document.getElementById('player-name').value = '';
    document.getElementById('player-number').value = '';
    document.getElementById('player-position').value = '';
}

function deletePlayer(playerId) {
    const roster = getRoster();
    const player = roster.find(p => p.id === playerId);
    if (!player) return;

    // Check if player has stats in any completed game
    const games = getGames().filter(g => g.status === 'completed');
    const hasStats = games.some(g => {
        const pStats = g.stats && g.stats[playerId];
        if (!pStats) return false;
        return Object.values(pStats).some(v => getStatCount(v) > 0);
    });

    if (hasStats) {
        if (!confirm(`#${escapeHtml(player.number)} ${escapeHtml(player.name)} has stats in completed games. Deleting will remove them from the roster but their historical stats will be kept.\n\nContinue?`)) return;
    } else {
        if (!confirm('Are you sure you want to delete this player?')) return;
    }

    const filtered = roster.filter(p => p.id !== playerId);
    saveRoster(filtered);
    loadRoster();
}

function editPlayer(playerId) {
    const roster = getRoster();
    const player = roster.find(p => p.id === playerId);
    if (!player) return;

    const row = document.getElementById(`player-row-${playerId}`);
    row.classList.add('player-item-editing');
    row.innerHTML = `
        <div class="player-edit-form">
            <input type="text" id="edit-name-${playerId}" value="${escapeAttr(player.name)}" class="input-field" placeholder="Name">
            <div class="player-edit-row">
                <input type="number" id="edit-number-${playerId}" value="${escapeAttr(player.number)}" class="input-field" placeholder="#">
                <select id="edit-position-${playerId}" class="input-field">
                    <option value="Attack"${player.position === 'Attack' ? ' selected' : ''}>Attack</option>
                    <option value="Midfield"${player.position === 'Midfield' ? ' selected' : ''}>Midfield</option>
                    <option value="Defense"${player.position === 'Defense' ? ' selected' : ''}>Defense</option>
                    <option value="Goalie"${player.position === 'Goalie' ? ' selected' : ''}>Goalie</option>
                </select>
            </div>
            <div class="player-edit-actions">
                <button class="btn-primary" onclick="savePlayerEdit('${playerId}')">Save</button>
                <button class="btn-secondary" onclick="cancelPlayerEdit()">Cancel</button>
            </div>
        </div>
    `;
}

function savePlayerEdit(playerId) {
    const name = document.getElementById(`edit-name-${playerId}`).value.trim();
    const number = document.getElementById(`edit-number-${playerId}`).value.trim();
    const position = document.getElementById(`edit-position-${playerId}`).value;

    if (!name || !number || !position) {
        alert('Please fill in all fields');
        return;
    }

    const roster = getRoster();
    const player = roster.find(p => p.id === playerId);

    // Check if number is taken by a different player
    if (roster.some(p => p.number === number && p.id !== playerId)) {
        alert('That jersey number is already taken');
        return;
    }

    player.name = name;
    player.number = number;
    player.position = position;

    saveRoster(roster);
    loadRoster();
    logEvent('edit_player', { position });
}

function cancelPlayerEdit() {
    loadRoster();
}

function getRoster() {
    const data = localStorage.getItem(STORAGE_KEYS.ROSTER);
    return data ? JSON.parse(data) : [];
}

function saveRoster(roster) {
    localStorage.setItem(STORAGE_KEYS.ROSTER, JSON.stringify(roster));
}

function loadRoster() {
    const roster = getRoster();
    const display = document.getElementById('roster-display');

    if (roster.length === 0) {
        display.innerHTML = '<p style="text-align:center; color: #64748b;">No players added yet</p>';
        return;
    }

    // Sort by number
    roster.sort((a, b) => parseInt(a.number) - parseInt(b.number));

    display.innerHTML = roster.map(player => `
        <div class="player-item" id="player-row-${player.id}">
            <div class="player-info">
                <span class="player-number">#${escapeHtml(player.number)}</span>
                <strong>${escapeHtml(player.name)}</strong>
                <div class="player-position">${escapeHtml(player.position)}</div>
            </div>
            <div class="player-actions">
                <button class="edit-btn" onclick="editPlayer('${player.id}')">Edit</button>
                <button class="delete-btn" onclick="deletePlayer('${player.id}')">Delete</button>
            </div>
        </div>
    `).join('');
}

// ===== GAME SCHEDULING =====
function applyGameTypeDefaults() {
    const gameType = document.querySelector('input[name="game-type"]:checked').value;
    if (gameType === 'girls') {
        document.querySelector('input[name="game-format"][value="halves"]').checked = true;
        document.getElementById('period-duration').value = '25';
    } else {
        document.querySelector('input[name="game-format"][value="quarters"]').checked = true;
        document.getElementById('period-duration').value = '12';
    }
}

function scheduleGame() {
    const opponent = document.getElementById('opponent-name').value.trim();
    const gameDate = document.getElementById('game-date').value;
    const gameTime = document.getElementById('game-time').value;
    const location = document.getElementById('game-location').value.trim();
    const gameType = document.querySelector('input[name="game-type"]:checked').value;
    const format = document.querySelector('input[name="game-format"]:checked').value;
    const clockType = document.querySelector('input[name="clock-type"]:checked').value;
    const periodDuration = parseInt(document.getElementById('period-duration').value);

    if (!opponent || !gameDate) {
        alert('Please enter opponent name and game date');
        return;
    }

    // Combine date and time into a datetime string
    const datetime = gameTime ? `${gameDate}T${gameTime}` : `${gameDate}T00:00`;

    const games = getGames();
    games.push({
        id: Date.now().toString(),
        opponent,
        datetime,
        location,
        gameType,
        format,
        clockType,
        periodDuration,
        status: 'scheduled',
        createdAt: new Date().toISOString()
    });

    saveGames(games);
    loadScheduledGames();
    logEvent('schedule_game', { format });

    // Clear form
    document.getElementById('opponent-name').value = '';
    document.getElementById('game-date').value = '';
    document.getElementById('game-time').value = '';
    document.getElementById('game-location').value = '';
}

function getGames() {
    const data = localStorage.getItem(STORAGE_KEYS.GAMES);
    return data ? JSON.parse(data) : [];
}

function saveGames(games) {
    localStorage.setItem(STORAGE_KEYS.GAMES, JSON.stringify(games));
}

function loadScheduledGames() {
    const games = getGames().filter(g => g.status === 'scheduled');
    const display = document.getElementById('scheduled-games-list');

    if (games.length === 0) {
        display.innerHTML = '<p style="text-align:center; color: #64748b;">No scheduled games</p>';
        return;
    }

    // Sort by datetime
    games.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    display.innerHTML = games.map(game => {
        const date = new Date(game.datetime);
        return `
            <div class="game-card" onclick="startScheduledGame('${game.id}')">
                <h4>vs ${escapeHtml(game.opponent)}</h4>
                <p>📅 ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                ${game.location ? `<p>📍 ${escapeHtml(game.location)}</p>` : ''}
                <p>⏱️ ${game.format === 'quarters' ? '4 Quarters' : '2 Halves'} × ${game.periodDuration} min${game.clockType === 'running' ? ' (running)' : ' (stop)'}${game.gameType === 'girls' ? ' (Girls)' : ''}</p>
            </div>
        `;
    }).join('');
}

function loadGamesList() {
    const games = getGames().filter(g => g.status === 'scheduled');
    const display = document.getElementById('games-list');

    if (games.length === 0) {
        display.innerHTML = `
            <div style="text-align:center; padding: 2rem;">
                <p style="color: #64748b; margin-bottom: 1rem;">No scheduled games</p>
                <button class="btn-primary" onclick="showScreen('schedule-screen')">Schedule a Game</button>
            </div>
        `;
        return;
    }

    display.innerHTML = games.map(game => {
        const date = new Date(game.datetime);
        return `
            <div class="game-card" onclick="startScheduledGame('${game.id}')">
                <h4>vs ${escapeHtml(game.opponent)}</h4>
                <p>📅 ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                ${game.location ? `<p>📍 ${escapeHtml(game.location)}</p>` : ''}
                <p>⏱️ ${game.format === 'quarters' ? '4 Quarters' : '2 Halves'} × ${game.periodDuration} min${game.clockType === 'running' ? ' (running)' : ' (stop)'}${game.gameType === 'girls' ? ' (Girls)' : ''}</p>
            </div>
        `;
    }).join('');
}

// ===== LIVE GAME =====
function startScheduledGame(gameId) {
    const games = getGames();
    const game = games.find(g => g.id === gameId);

    if (!game) return;

    const roster = getRoster();

    // Prompt for team selection
    promptTeamSelection(game, roster);
}

function promptTeamSelection(game, roster) {
    const teamName = localStorage.getItem(STORAGE_KEYS.TEAM_NAME) || 'Home';

    // Create team selection overlay
    const overlay = createOverlay({ id: 'team-selection-overlay', centered: true });

    const container = document.createElement('div');
    container.className = 'overlay-content overlay-content--narrow';
    container.style.padding = '2rem';

    const title = document.createElement('h3');
    title.textContent = 'Which team are you tracking stats for?';
    title.style.cssText = 'margin-bottom: 1.5rem; text-align: center; color: #FFFFFF;';
    container.appendChild(title);

    // Home team button
    const homeBtn = document.createElement('button');
    homeBtn.className = 'btn-primary';
    homeBtn.textContent = teamName;
    homeBtn.style.marginBottom = '1rem';
    homeBtn.onclick = () => {
        overlay.remove();
        initializeGame(game, roster, 'home', teamName);
    };
    container.appendChild(homeBtn);

    // Away team button
    const awayBtn = document.createElement('button');
    awayBtn.className = 'btn-primary';
    awayBtn.textContent = game.opponent;
    awayBtn.onclick = () => {
        overlay.remove();
        initializeGame(game, roster, 'away', game.opponent);
    };
    container.appendChild(awayBtn);

    overlay.appendChild(container);
}

function initializeGame(game, roster, trackingTeam, trackingTeamName) {
    // Initialize game state
    currentGame = {
        ...game,
        status: 'in-progress',
        homeScore: 0,
        awayScore: 0,
        currentPeriod: 1,
        totalPeriods: game.format === 'quarters' ? 4 : 2,
        timeRemaining: game.periodDuration * 60, // in seconds
        clockRunning: false,
        stats: {},
        opponentStats: {
            'faceoff-won': [],
            'faceoff-lost': [],
            'ground-ball': [],
            'shot': [],
            'goal': [],
            'assist': [],
            'turnover': [],
            'caused-turnover': [],
            'save': [],
            'penalty': []
        },
        periodScores: {
            home: Array(game.format === 'quarters' ? 4 : 2).fill(0),
            away: Array(game.format === 'quarters' ? 4 : 2).fill(0)
        },
        activePenalties: [], // Array of {playerId, playerName, duration, timeRemaining}
        clears: [], // Array of {team, teamName, success, period, time, timeRemaining}
        trackingTeam: trackingTeam, // 'home' or 'away'
        trackingTeamName: trackingTeamName,
        startedAt: new Date().toISOString()
    };

    // Initialize stats for each player
    roster.forEach(player => {
        currentGame.stats[player.id] = newPlayerStats();
    });

    // Save current game
    localStorage.setItem(STORAGE_KEYS.CURRENT_GAME, JSON.stringify(currentGame));
    if (typeof LaxSync !== 'undefined' && LaxSync.setGameActive) LaxSync.setGameActive();
    logEvent('start_game', { format: game.format });

    // Load game screen
    loadGameScreen();
    showScreen('game-screen');
}

function loadGameScreen() {
    if (!currentGame) {
        // Try to load from localStorage
        const saved = localStorage.getItem(STORAGE_KEYS.CURRENT_GAME);
        if (saved) {
            currentGame = JSON.parse(saved);
            normalizeGameStats(currentGame);
        } else {
            showScreen('home-screen');
            return;
        }
    }

    // Update UI with team names based on tracking team
    const teamName = localStorage.getItem(STORAGE_KEYS.TEAM_NAME) || 'Home';

    // Update scoreboard headers
    if (currentGame.trackingTeam === 'home') {
        document.querySelector('.home-team h3').textContent = teamName;
        document.getElementById('opponent-display').textContent = currentGame.opponent;
    } else {
        document.querySelector('.home-team h3').textContent = currentGame.opponent;
        document.getElementById('opponent-display').textContent = teamName;
    }

    document.getElementById('home-score').textContent = currentGame.homeScore;
    document.getElementById('away-score').textContent = currentGame.awayScore;
    updatePeriodDisplay();
    updateClock();
    loadPlayerButtons();

    // Initialize penalties array if not present (for backward compatibility)
    if (!currentGame.activePenalties) {
        currentGame.activePenalties = [];
    }
    updatePenaltyDisplay();
    updateTimeoutDisplay();

    // Update opponent button name
    const opponentName = currentGame.trackingTeam === 'home' ? currentGame.opponent : teamName;
    const opponentBtn = document.getElementById('opponent-team-name');
    if (opponentBtn) {
        opponentBtn.textContent = opponentName;
    }

    // Update stat button labels for game type (boys vs girls)
    const gt = getGameType(currentGame);
    const btnFOW = document.getElementById('btn-faceoff-won');
    const btnFOL = document.getElementById('btn-faceoff-lost');
    if (btnFOW) btnFOW.textContent = getFaceoffLabel(gt, 'won');
    if (btnFOL) btnFOL.textContent = getFaceoffLabel(gt, 'lost');

    // Initialize voice recognition
    initVoiceRecognition();
}

function getPeriodLabel(game, full) {
    if (full) return game.format === 'quarters' ? 'Quarter' : 'Half';
    return game.format === 'quarters' ? 'Q' : 'H';
}

function updatePeriodDisplay() {
    document.getElementById('period-display').textContent =
        `${getPeriodLabel(currentGame)}${currentGame.currentPeriod}`;
}

// Core score update: mutates game state, updates period score, updates DOM. Does NOT save.
function updateScore(team, amount) {
    const side = team === 'home' ? 'home' : 'away';
    const scoreKey = side + 'Score';
    currentGame[scoreKey] = Math.max(0, currentGame[scoreKey] + amount);
    document.getElementById(side + '-score').textContent = currentGame[scoreKey];
    if (currentGame.periodScores) {
        const idx = currentGame.currentPeriod - 1;
        currentGame.periodScores[side][idx] = Math.max(0, (currentGame.periodScores[side][idx] || 0) + amount);
    }
}

function adjustScore(team, amount) {
    updateScore(team, amount);
    saveCurrentGame();
}

// ===== GAME CLOCK =====
// Clock pause reason helpers — abstracts the boolean flags for clarity
function isClockPausedForEvent() {
    return currentGame && (currentGame.clockPausedForGoal || currentGame.clockPausedForTimeout) && !currentGame.clockRunning;
}

function clearClockPauseReason() {
    currentGame.clockPausedForGoal = false;
    currentGame.clockPausedForTimeout = false;
}

function toggleClock() {
    clearClockPauseReason();
    if (currentGame.clockRunning) {
        pauseClock();
    } else {
        startClock();
    }
}

// Auto-resume clock if it was paused for a goal or timeout
function resumeClockIfGoalPaused() {
    if (isClockPausedForEvent()) {
        clearClockPauseReason();
        startClock();
    }
}

function startClock() {
    clearClockPauseReason();
    currentGame.clockRunning = true;
    document.getElementById('clock-btn-text').textContent = 'Pause';
    document.getElementById('left-clock-btn-text').textContent = 'PAUSE';

    clockInterval = setInterval(() => {
        if (currentGame.timeRemaining > 0) {
            currentGame.timeRemaining--;
            updateClock();
            updatePenalties();
            saveCurrentGame();
        } else {
            pauseClock();
            alert('Period ended!');
        }
    }, 1000);
}

function pauseClock() {
    currentGame.clockRunning = false;
    // Don't clear clockPausedForGoal here — it's set right after this call
    document.getElementById('clock-btn-text').textContent = 'Start';
    document.getElementById('left-clock-btn-text').textContent = 'START';

    if (clockInterval) {
        clearInterval(clockInterval);
        clockInterval = null;
    }
}

function resetClock() {
    if (!confirm('Reset clock to period start?')) return;

    pauseClock();
    currentGame.timeRemaining = currentGame.periodDuration * 60;
    updateClock();
    saveCurrentGame();
}

function updateClock() {
    const minutes = Math.floor(currentGame.timeRemaining / 60);
    const seconds = currentGame.timeRemaining % 60;
    document.getElementById('game-clock').textContent =
        `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function nextPeriod() {
    if (currentGame.currentPeriod >= currentGame.totalPeriods) {
        if (confirm('Game complete! End game and save stats?')) {
            endGame();
        }
        return;
    }

    const periodLabel = getPeriodLabel(currentGame, true);
    const nextNum = currentGame.currentPeriod + 1;
    if (!confirm(`Advance to ${periodLabel} ${nextNum}? This will reset the clock.`)) return;

    pauseClock();
    currentGame.currentPeriod++;
    currentGame.timeRemaining = currentGame.periodDuration * 60;
    updatePeriodDisplay();
    updateClock();
    saveCurrentGame();
}

// ===== TIMEOUTS =====
function callTimeout(team) {
    if (!currentGame) return;

    // Initialize timeouts array if needed
    if (!currentGame.timeouts) currentGame.timeouts = [];

    const ts = recordStatTimestamp();
    const teamName = team === 'home'
        ? (localStorage.getItem(STORAGE_KEYS.TEAM_NAME) || 'Home')
        : currentGame.opponent;

    currentGame.timeouts.push({
        team: team,
        teamName: teamName,
        ...ts
    });

    // Pause the clock
    if (currentGame.clockRunning) {
        pauseClock();
    }
    clearClockPauseReason();
    currentGame.clockPausedForTimeout = true;

    saveCurrentGame();
    updateTimeoutDisplay();
}

function updateTimeoutDisplay() {
    const container = document.getElementById('timeout-display');
    if (!container || !currentGame) return;

    if (!currentGame.timeouts || currentGame.timeouts.length === 0) {
        container.innerHTML = '';
        return;
    }

    const teamName = localStorage.getItem(STORAGE_KEYS.TEAM_NAME) || 'Home';
    const homeTimeouts = currentGame.timeouts.filter(t => t.team === 'home');
    const awayTimeouts = currentGame.timeouts.filter(t => t.team === 'away');

    const homeName = currentGame.trackingTeam === 'home' ? teamName : currentGame.opponent;
    const awayName = currentGame.trackingTeam === 'home' ? currentGame.opponent : teamName;

    let html = '<div style="font-size: 0.85rem; color: #94a3b8;">';
    if (homeTimeouts.length > 0) {
        html += `<div style="margin-bottom: 0.25rem;"><strong>${homeName}:</strong> ${homeTimeouts.length} TO`;
        html += ' (' + homeTimeouts.map(t => {
            return `${getPeriodLabel(currentGame)}${t.period} ${t.time}`;
        }).join(', ') + ')';
        html += '</div>';
    }
    if (awayTimeouts.length > 0) {
        html += `<div><strong>${awayName}:</strong> ${awayTimeouts.length} TO`;
        html += ' (' + awayTimeouts.map(t => {
            return `${getPeriodLabel(currentGame)}${t.period} ${t.time}`;
        }).join(', ') + ')';
        html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
}

// ===== CLEARS =====
function recordClear(team, success) {
    if (!currentGame) return;

    if (!currentGame.clears) currentGame.clears = [];

    const ts = recordStatTimestamp();
    const teamName = team === 'home'
        ? (localStorage.getItem(STORAGE_KEYS.TEAM_NAME) || 'Home')
        : currentGame.opponent;

    currentGame.clears.push({
        team: team,
        teamName: teamName,
        success: success,
        ...ts
    });

    resumeClockIfGoalPaused();
    saveCurrentGame();

    const label = success ? 'Clear' : 'Failed Clear';
    showVoiceFeedback('Recorded!', `${teamName} — ${label}`);
    setTimeout(hideVoiceFeedback, 1500);
}

// ===== STAT & PLAYER SELECTION =====
function loadPlayerButtons() {
    const roster = getRoster();
    const container = document.getElementById('player-buttons');

    container.innerHTML = roster.map(player => `
        <button class="player-btn" onclick="selectPlayerForStat('${player.id}')">
            <div class="player-btn-number">${escapeHtml(player.number)}</div>
            <div class="player-btn-name">${escapeHtml(player.name.split(' ')[0])}</div>
        </button>
    `).join('');
}

function selectStat(statType) {
    selectedStat = statType;

    // Format stat name for display (game-type aware)
    const statNames = getStatNames(getGameType(currentGame));

    document.getElementById('selected-stat-name').textContent = statNames[statType];

    // Hide stat buttons, show player selection
    document.getElementById('stat-buttons').classList.add('hidden');
    document.getElementById('player-selection').classList.remove('hidden');

    // Load player buttons
    loadPlayerButtons();
}

function clearStatSelection() {
    selectedStat = null;
    document.getElementById('stat-buttons').classList.remove('hidden');
    document.getElementById('player-selection').classList.add('hidden');
}

function selectPlayerForStat(playerId) {
    if (!selectedStat) return;
    resumeClockIfGoalPaused();

    const roster = getRoster();
    const player = roster.find(p => p.id === playerId);
    if (!player) return;

    // Special handling for penalty - show time selection
    if (selectedStat === 'penalty') {
        showPenaltyTimeSelector(playerId);
        return;
    }

    // Record the stat
    const ts = recordStatTimestamp();
    if (Array.isArray(currentGame.stats[playerId][selectedStat])) {
        currentGame.stats[playerId][selectedStat].push(ts);
    } else {
        currentGame.stats[playerId][selectedStat]++;
    }

    // Auto-increment score for goals and record shot
    if (selectedStat === 'goal') {
        // Also record a shot
        if (Array.isArray(currentGame.stats[playerId]['shot'])) {
            currentGame.stats[playerId]['shot'].push(ts);
        } else {
            currentGame.stats[playerId]['shot']++;
        }

        updateScore('home', 1);

        // Stop time: pause clock on goal
        if (currentGame.clockType === 'stop' && currentGame.clockRunning) {
            pauseClock();
            currentGame.clockPausedForGoal = true;
        }

        saveCurrentGame();

        // Show feedback
        const btn = event.target.closest('.player-btn');
        btn.classList.add('stat-flash');
        if (navigator.vibrate) navigator.vibrate(50);

        setTimeout(() => {
            btn.classList.remove('stat-flash');

            // Prompt for shot location, then assist
            promptShotLocation(ts, () => {
                promptForAssist(playerId, ts);
            });
        }, 500);
        return;
    }

    saveCurrentGame();

    // Show feedback
    const btn = event.target.closest('.player-btn');
    btn.classList.add('stat-flash');
    if (navigator.vibrate) navigator.vibrate(50);

    setTimeout(() => {
        btn.classList.remove('stat-flash');

        if (selectedStat === 'shot') {
            promptShotLocation(ts, () => {
                clearStatSelection();
            });
        } else {
            clearStatSelection();
        }
    }, 500);
}

function recordOpponentStat() {
    if (!selectedStat) return;
    resumeClockIfGoalPaused();

    // Special handling for opponent penalty — show time selector
    if (selectedStat === 'penalty') {
        showOpponentPenaltyTimeSelector();
        return;
    }

    // Record stat for opponent team
    const ts = recordStatTimestamp();
    if (Array.isArray(currentGame.opponentStats[selectedStat])) {
        currentGame.opponentStats[selectedStat].push(ts);
    } else {
        currentGame.opponentStats[selectedStat]++;
    }

    // Auto-increment opponent score for goals and record shot
    if (selectedStat === 'goal') {
        // Also record a shot
        if (Array.isArray(currentGame.opponentStats['shot'])) {
            currentGame.opponentStats['shot'].push(ts);
        } else {
            currentGame.opponentStats['shot']++;
        }

        // Determine which score to increment based on tracking team
        var opponentSide = currentGame.trackingTeam === 'home' ? 'away' : 'home';
        updateScore(opponentSide, 1);

        // Stop time: pause clock on goal
        if (currentGame.clockType === 'stop' && currentGame.clockRunning) {
            pauseClock();
            currentGame.clockPausedForGoal = true;
        }
    }

    saveCurrentGame();

    // Show feedback
    const btn = event.target;
    btn.classList.add('stat-flash');
    if (navigator.vibrate) navigator.vibrate(50);

    setTimeout(() => {
        btn.classList.remove('stat-flash');

        // Return to stat selection
        clearStatSelection();
    }, 500);
}

function promptForAssist(goalScorerId, goalTimestamp) {
    const roster = getRoster();

    // Clear stat selection UI
    clearStatSelection();

    // Create assist prompt overlay
    const overlay = createOverlay({ id: 'assist-prompt-overlay' });

    const container = document.createElement('div');
    container.className = 'overlay-content';
    container.style.maxWidth = '600px';

    const title = document.createElement('h3');
    title.textContent = 'Was there an assist?';
    title.style.cssText = 'margin-bottom: 1rem; text-align: center; color: #FFFFFF;';
    container.appendChild(title);

    // Player buttons for assist
    const playerGrid = document.createElement('div');
    playerGrid.className = 'player-grid';
    playerGrid.style.marginBottom = '1rem';

    roster.forEach(player => {
        // Don't show the goal scorer
        if (player.id === goalScorerId) return;

        const btn = document.createElement('button');
        btn.className = 'player-btn';
        btn.innerHTML = `
            <div class="player-btn-number">${escapeHtml(player.number)}</div>
            <div class="player-btn-name">${escapeHtml(player.name.split(' ')[0])}</div>
        `;
        btn.onclick = () => {
            const assistTs = goalTimestamp || recordStatTimestamp();
            if (Array.isArray(currentGame.stats[player.id]['assist'])) {
                currentGame.stats[player.id]['assist'].push(assistTs);
            } else {
                currentGame.stats[player.id]['assist']++;
            }
            saveCurrentGame();

            // Show confirmation
            btn.classList.add('stat-flash');

            setTimeout(() => {
                overlay.remove();
            }, 300);
        };
        playerGrid.appendChild(btn);
    });

    container.appendChild(playerGrid);

    // No assist button
    const noAssistBtn = document.createElement('button');
    noAssistBtn.className = 'btn-secondary';
    noAssistBtn.textContent = 'No Assist';
    noAssistBtn.onclick = () => {
        overlay.remove();
    };
    container.appendChild(noAssistBtn);

    overlay.appendChild(container);
}

// ===== GAME MANAGEMENT =====
function saveCurrentGame() {
    if (currentGame) {
        localStorage.setItem(STORAGE_KEYS.CURRENT_GAME, JSON.stringify(currentGame));
    }
}

function confirmEndGame() {
    if (!confirm('Are you sure you want to end this game? Stats will be saved.')) return;
    endGame();
}

function endGame() {
    pauseClock();

    currentGame.status = 'completed';
    currentGame.completedAt = new Date().toISOString();

    // Save to games history
    const games = getGames();
    const index = games.findIndex(g => g.id === currentGame.id);
    if (index !== -1) {
        games[index] = currentGame;
    } else {
        games.push(currentGame);
    }
    saveGames(games);
    logEvent('end_game', { home_score: currentGame.homeScore, away_score: currentGame.awayScore });

    // Clear current game
    localStorage.removeItem(STORAGE_KEYS.CURRENT_GAME);
    currentGame = null;
    if (typeof LaxSync !== 'undefined' && LaxSync.setGameInactive) LaxSync.setGameInactive();

    alert('Game saved!');
    showScreen('home-screen');
}

function toggleStatsView() {
    if (!currentGame) return;

    const roster = getRoster();
    const teamName = localStorage.getItem(STORAGE_KEYS.TEAM_NAME) || 'Home';
    const opponentName = currentGame.trackingTeam === 'home' ? currentGame.opponent : teamName;

    const _gt = getGameType(currentGame);
    let statsHtml = '<div class="overlay-content">';
    statsHtml += '<h3 style="margin-bottom: 1rem;">Game Statistics</h3>';

    // Your team stats table
    statsHtml += `<h4 style="margin-top: 1rem; color: var(--primary-color);">${currentGame.trackingTeamName}</h4>`;

    statsHtml += `
        <div style="overflow-x: auto;">
            <table class="stat-table" style="margin-top: 0.5rem;">
                <thead>
                    <tr>
                        <th>Player</th>
                        <th>G</th>
                        <th>A</th>
                        <th>Pts</th>
                        <th>Sh</th>
                        <th>GB</th>
                        <th>${getFaceoffAbbrev(_gt, 'won')}</th>
                        <th>${getFaceoffAbbrev(_gt, 'lost')}</th>
                        <th>TO</th>
                        <th>TA</th>
                        <th>Sv</th>
                        <th>Pen</th>
                    </tr>
                </thead>
                <tbody>`;

    let hasPlayerStats = false;
    roster.forEach(player => {
        const stats = currentGame.stats[player.id];
        if (!stats) return;

        const goals = getStatCount(stats.goal);
        const assists = getStatCount(stats.assist);
        const points = goals + assists;
        const totalStats = Object.values(stats).reduce((a, b) => a + getStatCount(b), 0);

        if (totalStats === 0) return;

        hasPlayerStats = true;
        statsHtml += `
            <tr>
                <td>#${escapeHtml(player.number)} ${escapeHtml(player.name)}</td>
                <td>${goals}</td>
                <td>${assists}</td>
                <td style="font-weight: 600;">${points}</td>
                <td>${getStatCount(stats.shot)}</td>
                <td>${getStatCount(stats['ground-ball'])}</td>
                <td>${getStatCount(stats['faceoff-won'])}</td>
                <td>${getStatCount(stats['faceoff-lost'])}</td>
                <td>${getStatCount(stats.turnover)}</td>
                <td>${getStatCount(stats['caused-turnover'])}</td>
                <td>${getStatCount(stats.save)}</td>
                <td>${getStatCount(stats.penalty)}</td>
            </tr>`;
    });

    if (!hasPlayerStats) {
        statsHtml += `<tr><td colspan="12" style="padding: 1rem; text-align: center; color: var(--text-secondary); font-style: italic;">No stats recorded yet</td></tr>`;
    }

    statsHtml += `</tbody></table></div>`;

    // Opponent stats
    if (currentGame.opponentStats) {
        const oppStats = currentGame.opponentStats;
        const totalOppStats = Object.values(oppStats).reduce((a, b) => a + getStatCount(b), 0);

        statsHtml += `<h4 style="margin-top: 1.5rem; color: var(--warning-color);">${opponentName}</h4>`;

        if (totalOppStats > 0) {
            const goals = getStatCount(oppStats.goal);
            const assists = getStatCount(oppStats.assist);
            statsHtml += `<div style="padding: 0.75rem; border: 1px solid var(--border-color); border-radius: 4px; background: rgba(255,109,0,0.08);">`;
            statsHtml += `<strong>Team Stats:</strong><br>`;
            statsHtml += `<div style="margin-top: 0.5rem; font-size: 0.9rem;">`;
            statsHtml += `Goals: ${goals} | Assists: ${assists} | Points: ${goals + assists} | `;
            statsHtml += `Shots: ${getStatCount(oppStats.shot)} | GB: ${getStatCount(oppStats['ground-ball'])} | `;
            statsHtml += `${getFaceoffAbbrev(_gt, 'won')}: ${getStatCount(oppStats['faceoff-won'])} | ${getFaceoffAbbrev(_gt, 'lost')}: ${getStatCount(oppStats['faceoff-lost'])} | `;
            statsHtml += `Turnovers: ${getStatCount(oppStats.turnover)} | Takeaways: ${getStatCount(oppStats['caused-turnover'])} | `;
            statsHtml += `Saves: ${getStatCount(oppStats.save)} | Penalties: ${getStatCount(oppStats.penalty)}`;
            statsHtml += `</div></div>`;
        } else {
            statsHtml += `<p style="color: var(--text-secondary); font-style: italic;">No stats recorded yet</p>`;
        }
    }

    statsHtml += '</div>';

    const container = createOverlay({ id: 'in-game-stats-overlay' });
    container.innerHTML = statsHtml;
    container.onclick = (e) => {
        if (e.target === container) container.remove();
    };

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 0.75rem; margin-top: 1rem;';

    const editLogBtn = document.createElement('button');
    editLogBtn.textContent = 'Edit Game Log';
    editLogBtn.className = 'btn-primary';
    editLogBtn.style.cssText = 'flex: 1;';
    editLogBtn.onclick = () => { container.remove(); showInGameEditLog(); };
    btnRow.appendChild(editLogBtn);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'btn-secondary';
    closeBtn.style.cssText = 'flex: 1;';
    closeBtn.onclick = () => container.remove();
    btnRow.appendChild(closeBtn);

    container.firstChild.appendChild(btnRow);
}

// ===== SHOT LOCATION CAPTURE =====
function createFieldSVG(darkMode) {
    const line = darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.85)';
    const faint = darkMode ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.35)';
    const bg1 = darkMode ? '#1a3a1a' : '#2d5a27';
    const bg2 = darkMode ? '#1e4d1e' : '#347a2e';
    return `<svg viewBox="0 0 300 250" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:400px;display:block;margin:0 auto;border-radius:8px;">
        <defs>
            <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${bg1}"/>
                <stop offset="30%" stop-color="${bg2}"/>
                <stop offset="50%" stop-color="${bg1}"/>
                <stop offset="70%" stop-color="${bg2}"/>
                <stop offset="100%" stop-color="${bg1}"/>
            </linearGradient>
            <radialGradient id="creaseFill" cx="150" cy="30" r="27" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="rgba(255,100,100,0.1)"/>
                <stop offset="100%" stop-color="rgba(255,100,100,0)"/>
            </radialGradient>
        </defs>
        <rect width="300" height="250" fill="url(#grass)" rx="8"/>
        <!-- Crease danger zone shading -->
        <circle cx="150" cy="30" r="27" fill="url(#creaseFill)"/>
        <!-- Endline -->
        <line x1="20" y1="30" x2="280" y2="30" stroke="${line}" stroke-width="2"/>
        <!-- Sidelines -->
        <line x1="20" y1="30" x2="20" y2="250" stroke="${line}" stroke-width="2"/>
        <line x1="280" y1="30" x2="280" y2="250" stroke="${line}" stroke-width="2"/>
        <!-- Restraining line -->
        <line x1="20" y1="220" x2="280" y2="220" stroke="${faint}" stroke-width="1.5" stroke-dasharray="6,4"/>
        <!-- Goal (net fill) -->
        <rect x="138" y="18" width="24" height="12" fill="rgba(255,255,255,0.08)" stroke="${line}" stroke-width="2" rx="2"/>
        <!-- Crease circle -->
        <circle cx="150" cy="30" r="27" fill="none" stroke="${line}" stroke-width="2"/>
        <!-- Goal line extension -->
        <line x1="100" y1="30" x2="200" y2="30" stroke="${line}" stroke-width="2.5"/>
        <!-- Center hash marks -->
        <line x1="146" y1="118" x2="154" y2="122" stroke="${faint}" stroke-width="1.5"/>
        <line x1="146" y1="168" x2="154" y2="172" stroke="${faint}" stroke-width="1.5"/>
        <!-- Wing area arcs -->
        <path d="M50,95 Q60,100 50,105" fill="none" stroke="${faint}" stroke-width="1.5"/>
        <path d="M250,95 Q240,100 250,105" fill="none" stroke="${faint}" stroke-width="1.5"/>
    </svg>`;
}

function promptShotLocation(ts, onDone) {
    const overlay = createOverlay({ id: 'shot-location-overlay', centered: true, className: 'shot-picker' });

    const title = document.createElement('div');
    title.className = 'shot-picker-title';
    title.textContent = 'Tap where the shot came from';
    overlay.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'shot-picker-subtitle';
    subtitle.textContent = 'Tap the field below';
    overlay.appendChild(subtitle);

    const fieldContainer = document.createElement('div');
    fieldContainer.className = 'shot-picker-field';
    fieldContainer.innerHTML = createFieldSVG(true);
    overlay.appendChild(fieldContainer);

    const svg = fieldContainer.querySelector('svg');
    svg.addEventListener('click', function(e) {
        const rect = svg.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        ts.x = Math.round(x * 1000) / 1000;
        ts.y = Math.round(y * 1000) / 1000;
        saveCurrentGame();

        const cx = x * 300;
        const cy = y * 250;

        // Inner solid dot
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', cx);
        dot.setAttribute('cy', cy);
        dot.setAttribute('r', '8');
        dot.setAttribute('fill', '#10b981');
        dot.setAttribute('stroke', 'white');
        dot.setAttribute('stroke-width', '2');
        svg.appendChild(dot);

        // Ripple ring 1
        const ring1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ring1.setAttribute('cx', cx);
        ring1.setAttribute('cy', cy);
        ring1.setAttribute('r', '8');
        ring1.setAttribute('fill', 'none');
        ring1.setAttribute('stroke', '#10b981');
        ring1.setAttribute('stroke-width', '2');
        ring1.innerHTML = `<animate attributeName="r" from="8" to="24" dur="0.4s" fill="freeze"/>
            <animate attributeName="stroke-opacity" from="0.8" to="0" dur="0.4s" fill="freeze"/>`;
        svg.appendChild(ring1);

        // Ripple ring 2 (delayed)
        const ring2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ring2.setAttribute('cx', cx);
        ring2.setAttribute('cy', cy);
        ring2.setAttribute('r', '8');
        ring2.setAttribute('fill', 'none');
        ring2.setAttribute('stroke', 'white');
        ring2.setAttribute('stroke-width', '1.5');
        ring2.innerHTML = `<animate attributeName="r" from="8" to="32" dur="0.5s" begin="0.1s" fill="freeze"/>
            <animate attributeName="stroke-opacity" from="0.6" to="0" dur="0.5s" begin="0.1s" fill="freeze"/>`;
        svg.appendChild(ring2);

        setTimeout(() => {
            overlay.remove();
            onDone();
        }, 500);
    });

    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn-secondary';
    skipBtn.textContent = 'Skip';
    skipBtn.style.cssText = 'margin-top: 1.5rem; max-width: 200px;';
    skipBtn.onclick = () => {
        overlay.remove();
        onDone();
    };
    overlay.appendChild(skipBtn);
}

function buildShotChartSVG(shots, options) {
    options = options || {};
    const filterId = options.highlightPlayerId || null;
    const filtered = filterId ? shots.filter(s => s.playerId === filterId) : shots;

    let dots = '';
    filtered.forEach(s => {
        const cx = s.x * 300;
        const cy = s.y * 250;
        const color = s.isGoal ? '#10b981' : '#ef4444';
        const opacity = s.isGoal ? 0.8 : 0.6;
        dots += `<circle cx="${cx}" cy="${cy}" r="8" fill="${color}" fill-opacity="${opacity}" stroke="white" stroke-width="1.5"/>`;
    });

    // Build legend
    const goalCount = filtered.filter(s => s.isGoal).length;
    const shotCount = filtered.filter(s => !s.isGoal).length;

    return `<div style="position:relative;">
        <svg viewBox="0 0 300 250" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:400px;display:block;margin:0 auto;border-radius:8px;">
            <rect width="300" height="250" fill="#2d5a27" rx="8"/>
            <line x1="20" y1="30" x2="280" y2="30" stroke="rgba(255,255,255,0.85)" stroke-width="2"/>
            <line x1="20" y1="30" x2="20" y2="250" stroke="rgba(255,255,255,0.85)" stroke-width="2"/>
            <line x1="280" y1="30" x2="280" y2="250" stroke="rgba(255,255,255,0.85)" stroke-width="2"/>
            <line x1="20" y1="220" x2="280" y2="220" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-dasharray="6,4"/>
            <rect x="138" y="18" width="24" height="12" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="2" rx="2"/>
            <circle cx="150" cy="30" r="27" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="2"/>
            <line x1="100" y1="30" x2="200" y2="30" stroke="rgba(255,255,255,0.85)" stroke-width="2.5"/>
            <line x1="148" y1="120" x2="152" y2="120" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>
            <line x1="148" y1="170" x2="152" y2="170" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>
            <line x1="60" y1="100" x2="66" y2="100" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>
            <line x1="234" y1="100" x2="240" y2="100" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>
            ${dots}
        </svg>
        <div style="display:flex;gap:1rem;justify-content:center;margin-top:0.5rem;font-size:0.8rem;color:var(--text-secondary,#64748b);">
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#10b981;margin-right:4px;"></span>Goals (${goalCount})</span>
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;margin-right:4px;"></span>Missed (${shotCount})</span>
        </div>
    </div>`;
}

// Sample shot chart for the Get Started / About screen
function renderAboutShotChartExample() {
    const container = document.getElementById('about-shot-chart-example');
    if (!container) return;
    // Realistic sample data: mix of goals and misses from various positions
    const sampleShots = [
        // Close-range goals (near crease)
        { x: 0.48, y: 0.18, isGoal: true },
        { x: 0.53, y: 0.22, isGoal: true },
        { x: 0.42, y: 0.25, isGoal: true },
        { x: 0.56, y: 0.16, isGoal: true },
        // Mid-range goals
        { x: 0.38, y: 0.35, isGoal: true },
        { x: 0.60, y: 0.30, isGoal: true },
        // Long-range goal
        { x: 0.50, y: 0.55, isGoal: true },
        // Missed shots - close range
        { x: 0.45, y: 0.20, isGoal: false },
        { x: 0.55, y: 0.24, isGoal: false },
        // Missed shots - wings
        { x: 0.22, y: 0.38, isGoal: false },
        { x: 0.78, y: 0.35, isGoal: false },
        { x: 0.25, y: 0.28, isGoal: false },
        { x: 0.75, y: 0.30, isGoal: false },
        // Missed shots - mid range
        { x: 0.40, y: 0.42, isGoal: false },
        { x: 0.58, y: 0.45, isGoal: false },
        { x: 0.50, y: 0.38, isGoal: false },
        // Missed shots - outside
        { x: 0.35, y: 0.60, isGoal: false },
        { x: 0.65, y: 0.58, isGoal: false },
        { x: 0.50, y: 0.65, isGoal: false },
    ];
    container.innerHTML = buildShotChartSVG(sampleShots);
}

// ===== IN-GAME EDIT LOG =====
function buildGameLog() {
    const roster = getRoster();
    const pLabel = getPeriodLabel(currentGame);
    const entries = [];

    const statDisplayNames = getStatNames(getGameType(currentGame));

    // Player stats
    for (const playerId of Object.keys(currentGame.stats)) {
        const playerStats = currentGame.stats[playerId];
        const player = roster.find(p => p.id === playerId);
        const playerLabel = player ? `#${escapeHtml(player.number)} ${escapeHtml(player.name)}` : `Player ${playerId}`;

        for (const statType of Object.keys(playerStats)) {
            const val = playerStats[statType];
            if (!Array.isArray(val)) continue;
            val.forEach((ts, index) => {
                if (!ts.period) return; // skip empty timestamp objects
                entries.push({
                    source: 'player', playerId, playerLabel,
                    statType, statLabel: statDisplayNames[statType] || statType,
                    period: ts.period, time: ts.time, timeRemaining: ts.timeRemaining || 0,
                    index, pLabel
                });
            });
        }
    }

    // Opponent stats
    if (currentGame.opponentStats) {
        for (const statType of Object.keys(currentGame.opponentStats)) {
            const val = currentGame.opponentStats[statType];
            if (!Array.isArray(val)) continue;
            val.forEach((ts, index) => {
                if (!ts.period) return;
                entries.push({
                    source: 'opponent', playerId: null,
                    playerLabel: 'Opponent',
                    statType, statLabel: statDisplayNames[statType] || statType,
                    period: ts.period, time: ts.time, timeRemaining: ts.timeRemaining || 0,
                    index, pLabel
                });
            });
        }
    }

    // Clears
    if (currentGame.clears) {
        currentGame.clears.forEach((cl, index) => {
            if (!cl.period) return;
            entries.push({
                source: 'clear', playerId: null,
                playerLabel: `Clear (${cl.teamName})`,
                statType: cl.success ? 'clear-success' : 'clear-fail',
                statLabel: cl.success ? 'Clear' : 'Failed Clear',
                period: cl.period, time: cl.time, timeRemaining: cl.timeRemaining || 0,
                index, pLabel
            });
        });
    }

    // Sort: by period ascending, then timeRemaining descending (most recent first within period)
    entries.sort((a, b) => {
        if (a.period !== b.period) return a.period - b.period;
        return b.timeRemaining - a.timeRemaining;
    });

    return entries;
}

function showInGameEditLog() {
    if (!currentGame) return;

    const overlay = createOverlay({ id: 'edit-log-overlay' });

    function renderLog() {
        const entries = buildGameLog();
        const container = document.createElement('div');
        container.className = 'edit-log-container';

        container.innerHTML = '<h3 style="margin-bottom: 1rem;">Edit Game Log</h3>';

        if (entries.length === 0) {
            container.innerHTML += '<p style="text-align: center; color: var(--text-secondary); font-style: italic; padding: 2rem 0;">No events recorded yet</p>';
        } else {
            let currentPeriod = null;
            entries.forEach(entry => {
                // Period header
                if (entry.period !== currentPeriod) {
                    currentPeriod = entry.period;
                    const header = document.createElement('div');
                    header.className = 'edit-log-header';
                    header.textContent = `${entry.pLabel}${entry.period}`;
                    container.appendChild(header);
                }

                const row = document.createElement('div');
                row.className = 'edit-log-row';

                // Time
                const timeSpan = document.createElement('span');
                timeSpan.className = 'edit-log-time';
                timeSpan.textContent = entry.time || '--';
                row.appendChild(timeSpan);

                // Player + stat
                const descSpan = document.createElement('span');
                descSpan.className = 'edit-log-desc';
                descSpan.innerHTML = `<strong>${entry.playerLabel}</strong> — ${entry.statLabel}`;
                row.appendChild(descSpan);

                // Edit button (player stats only, not clears or opponent)
                if (entry.source === 'player') {
                    const editBtn = document.createElement('button');
                    editBtn.textContent = 'Edit';
                    editBtn.className = 'btn-action-sm btn-action-sm--edit';
                    editBtn.onclick = () => reassignStat(entry.statType, entry.index, entry.playerId, overlay, renderLog);
                    row.appendChild(editBtn);
                }

                // Delete button
                const delBtn = document.createElement('button');
                delBtn.textContent = 'Del';
                delBtn.className = 'btn-action-sm btn-action-sm--delete';
                delBtn.onclick = () => deleteStatEntry(entry.source, entry.statType, entry.index, entry.playerId, overlay, renderLog);
                row.appendChild(delBtn);

                container.appendChild(row);
            });
        }

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.className = 'btn-secondary';
        closeBtn.style.cssText = 'width: 100%; margin-top: 1rem;';
        closeBtn.onclick = () => overlay.remove();
        container.appendChild(closeBtn);

        overlay.innerHTML = '';
        overlay.appendChild(container);
    }

    renderLog();
}

function reassignStat(statType, index, oldPlayerId, overlay, refreshFn) {
    if (!currentGame) return;
    const roster = getRoster();

    // Build a player picker overlay on top
    const picker = createOverlay({ id: 'reassign-picker-overlay', z1100: true });

    const box = document.createElement('div');
    box.className = 'overlay-content overlay-content--narrow';
    box.style.marginTop = '2rem';
    box.innerHTML = '<h3 style="margin-bottom: 1rem;">Reassign to which player?</h3>';

    const grid = document.createElement('div');
    grid.className = 'picker-grid';

    roster.forEach(player => {
        if (player.id === oldPlayerId) return; // skip current player
        const btn = document.createElement('button');
        btn.textContent = `#${escapeHtml(player.number)} ${escapeHtml(player.name)}`;
        btn.className = 'picker-btn';
        btn.onclick = () => {
            const newPlayerId = player.id;

            // Initialize stats for new player if needed
            if (!currentGame.stats[newPlayerId]) {
                currentGame.stats[newPlayerId] = newPlayerStats();
            }

            const oldArr = currentGame.stats[oldPlayerId][statType];
            if (!Array.isArray(oldArr) || index >= oldArr.length) { picker.remove(); return; }

            // Move the timestamp entry
            const entry = oldArr.splice(index, 1)[0];
            if (Array.isArray(currentGame.stats[newPlayerId][statType])) {
                currentGame.stats[newPlayerId][statType].push(entry);
            }

            // If goal, also move the matching auto-recorded shot
            if (statType === 'goal') {
                const oldShots = currentGame.stats[oldPlayerId]['shot'];
                if (Array.isArray(oldShots)) {
                    const shotIdx = oldShots.findIndex(s =>
                        s.period === entry.period && s.timeRemaining === entry.timeRemaining
                    );
                    if (shotIdx !== -1) {
                        const shotEntry = oldShots.splice(shotIdx, 1)[0];
                        if (Array.isArray(currentGame.stats[newPlayerId]['shot'])) {
                            currentGame.stats[newPlayerId]['shot'].push(shotEntry);
                        }
                    }
                }
            }

            saveCurrentGame();
            picker.remove();
            refreshFn();
        };
        grid.appendChild(btn);
    });

    box.appendChild(grid);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.style.cssText = 'width: 100%; margin-top: 1rem;';
    cancelBtn.onclick = () => picker.remove();
    box.appendChild(cancelBtn);

    picker.appendChild(box);
}

function deleteStatEntry(source, statType, index, playerId, overlay, refreshFn) {
    if (!currentGame) return;

    if (!confirm('Delete this stat entry?')) return;

    let deletedEntry = null;

    if (source === 'player' && playerId) {
        const arr = currentGame.stats[playerId][statType];
        if (Array.isArray(arr) && index < arr.length) {
            deletedEntry = arr.splice(index, 1)[0];
        }

        // Goal side effects
        if (statType === 'goal' && deletedEntry) {
            // Decrement home team score (player goals always count for tracking team)
            if (currentGame.trackingTeam === 'home') {
                currentGame.homeScore = Math.max(0, currentGame.homeScore - 1);
                document.getElementById('home-score').textContent = currentGame.homeScore;
                if (currentGame.periodScores && deletedEntry.period) {
                    const idx = deletedEntry.period - 1;
                    currentGame.periodScores.home[idx] = Math.max(0, (currentGame.periodScores.home[idx] || 0) - 1);
                }
            } else {
                currentGame.awayScore = Math.max(0, currentGame.awayScore - 1);
                document.getElementById('away-score').textContent = currentGame.awayScore;
                if (currentGame.periodScores && deletedEntry.period) {
                    const idx = deletedEntry.period - 1;
                    currentGame.periodScores.away[idx] = Math.max(0, (currentGame.periodScores.away[idx] || 0) - 1);
                }
            }

            // Remove matching auto-recorded shot
            const shots = currentGame.stats[playerId]['shot'];
            if (Array.isArray(shots)) {
                const shotIdx = shots.findIndex(s =>
                    s.period === deletedEntry.period && s.timeRemaining === deletedEntry.timeRemaining
                );
                if (shotIdx !== -1) shots.splice(shotIdx, 1);
            }

            // Offer to delete paired assist
            const roster = getRoster();
            for (const pid of Object.keys(currentGame.stats)) {
                const assists = currentGame.stats[pid]['assist'];
                if (!Array.isArray(assists)) continue;
                const assistIdx = assists.findIndex(a =>
                    a.period === deletedEntry.period && a.timeRemaining === deletedEntry.timeRemaining
                );
                if (assistIdx !== -1) {
                    const assistPlayer = roster.find(p => p.id === pid);
                    const label = assistPlayer ? `#${assistPlayer.number} ${assistPlayer.name}` : pid;
                    if (confirm(`Also delete the paired assist by ${label}?`)) {
                        assists.splice(assistIdx, 1);
                    }
                    break;
                }
            }
        }
    } else if (source === 'opponent') {
        const arr = currentGame.opponentStats[statType];
        if (Array.isArray(arr) && index < arr.length) {
            deletedEntry = arr.splice(index, 1)[0];
        }

        // Opponent goal side effects
        if (statType === 'goal' && deletedEntry) {
            if (currentGame.trackingTeam === 'home') {
                currentGame.awayScore = Math.max(0, currentGame.awayScore - 1);
                document.getElementById('away-score').textContent = currentGame.awayScore;
                if (currentGame.periodScores && deletedEntry.period) {
                    const idx = deletedEntry.period - 1;
                    currentGame.periodScores.away[idx] = Math.max(0, (currentGame.periodScores.away[idx] || 0) - 1);
                }
            } else {
                currentGame.homeScore = Math.max(0, currentGame.homeScore - 1);
                document.getElementById('home-score').textContent = currentGame.homeScore;
                if (currentGame.periodScores && deletedEntry.period) {
                    const idx = deletedEntry.period - 1;
                    currentGame.periodScores.home[idx] = Math.max(0, (currentGame.periodScores.home[idx] || 0) - 1);
                }
            }

            // Remove matching auto-recorded shot
            const oppShots = currentGame.opponentStats['shot'];
            if (Array.isArray(oppShots)) {
                const shotIdx = oppShots.findIndex(s =>
                    s.period === deletedEntry.period && s.timeRemaining === deletedEntry.timeRemaining
                );
                if (shotIdx !== -1) oppShots.splice(shotIdx, 1);
            }

            // Offer to delete paired assist
            const oppAssists = currentGame.opponentStats['assist'];
            if (Array.isArray(oppAssists)) {
                const assistIdx = oppAssists.findIndex(a =>
                    a.period === deletedEntry.period && a.timeRemaining === deletedEntry.timeRemaining
                );
                if (assistIdx !== -1) {
                    if (confirm('Also delete the paired opponent assist?')) {
                        oppAssists.splice(assistIdx, 1);
                    }
                }
            }
        }
    } else if (source === 'clear') {
        if (currentGame.clears && index < currentGame.clears.length) {
            deletedEntry = currentGame.clears.splice(index, 1)[0];
        }
    }

    saveCurrentGame();
    refreshFn();
}

// ===== GAME HISTORY =====
function loadGameHistory() {
    const games = getGames().filter(g => g.status === 'completed');
    const display = document.getElementById('history-list');

    if (games.length === 0) {
        display.innerHTML = '<p style="text-align:center; color: #64748b;">No completed games yet</p>';
        return;
    }

    // Sort by date, newest first
    games.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    display.innerHTML = games.map(game => {
        const date = new Date(game.completedAt);
        const result = game.homeScore > game.awayScore ? 'W' :
                      game.homeScore < game.awayScore ? 'L' : 'T';
        const resultColor = result === 'W' ? '#10b981' : result === 'L' ? '#ef4444' : '#64748b';

        return `
            <div class="history-item">
                <h4>vs ${escapeHtml(game.opponent)}</h4>
                <div class="history-score" style="color: ${resultColor}">
                    ${result} ${game.homeScore} - ${game.awayScore}
                </div>
                <p style="color: #64748b; font-size: 0.9rem;">
                    ${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </p>
                <button class="btn-secondary" onclick="viewGameStats('${game.id}')">View Stats</button>
                <button class="btn-secondary" onclick="editGameStats('${game.id}')" style="margin-top: 0.5rem;">Edit Stats</button>
                <button class="btn-move-team" onclick="moveGameToTeam('${game.id}')">Move to Team...</button>
                <button class="btn-danger" onclick="deleteGame('${game.id}')" style="margin-top: 0.5rem;">Delete Game</button>
            </div>
        `;
    }).join('');
}

function deleteGame(gameId) {
    const games = getGames();
    const game = games.find(g => g.id === gameId);
    if (!game) return;

    const label = `vs ${escapeHtml(game.opponent)} (${game.homeScore}-${game.awayScore})`;

    if (!confirm(`Delete the game ${label}?\n\nThis will permanently remove all stats from this game.`)) return;
    if (!confirm(`Are you REALLY sure?\n\nAll player stats for ${label} will be gone forever.`)) return;
    if (!confirm(`Last chance! Type-level serious.\n\nDeleting ${label} — this CANNOT be undone. Proceed?`)) return;

    const updated = games.filter(g => g.id !== gameId);
    saveGames(updated);
    // Explicitly delete from cloud (bypasses adds-only merge)
    if (typeof LaxSync !== 'undefined' && LaxSync.deleteGameFromCloud) {
        LaxSync.deleteGameFromCloud(gameId);
    }
    loadGameHistory();
}

function moveGameToTeam(gameId) {
    const games = getGames();
    const game = games.find(g => g.id === gameId);
    if (!game) return;

    const teams = (typeof LaxSync !== 'undefined' && LaxSync.getUserTeams) ? LaxSync.getUserTeams() : [];
    const activeCode = (typeof LaxSync !== 'undefined' && LaxSync.getActiveTeam) ? LaxSync.getActiveTeam() : '';

    // Filter out active team
    const otherTeams = teams.filter(t => t.code !== activeCode);

    if (otherTeams.length === 0) {
        alert('You need at least one other team to move a game. Join or create another team in Settings.');
        return;
    }

    // Build overlay to pick destination team
    const overlay = createOverlay({ id: 'move-game-overlay', centered: true });

    const content = document.createElement('div');
    content.className = 'overlay-content overlay-content--narrow';
    content.innerHTML = `<h3 style="margin-bottom:1rem;text-align:center;">Move Game</h3>
        <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:1rem;text-align:center;">
            Move <strong>vs ${escapeHtml(game.opponent)}</strong> to which team?
        </p>`;

    otherTeams.forEach(team => {
        const btn = document.createElement('button');
        btn.className = 'btn-primary';
        btn.style.marginBottom = '0.5rem';
        btn.textContent = team.name;
        btn.onclick = () => {
            if (!confirm(`Move this game to "${team.name}"? It will be removed from the current team.`)) return;

            // Write game to destination team's Firestore
            const db = firebase.firestore();
            const destRef = db.collection('teams').doc(team.code).collection('data').doc('games');

            destRef.get().then(doc => {
                const existingItems = (doc.exists && doc.data().items) ? doc.data().items : [];
                existingItems.push(game);
                return destRef.set({
                    items: existingItems,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }).then(() => {
                // Remove from local games and save (which syncs to active team's Firestore)
                const updated = games.filter(g => g.id !== gameId);
                saveGames(updated);
                loadGameHistory();
                overlay.remove();
                alert('Game moved to "' + team.name + '"!');
            }).catch(err => {
                console.error('[MoveGame] Failed:', err);
                alert('Failed to move game: ' + err.message);
            });
        };
        content.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => overlay.remove();
    content.appendChild(cancelBtn);

    overlay.appendChild(content);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

function editGameStats(gameId) {
    const games = getGames();
    const game = games.find(g => g.id === gameId);
    if (!game) return;

    const roster = getRoster();
    const _gt = getGameType(game);
    const statKeys = ['goal', 'assist', 'shot', 'ground-ball', 'faceoff-won', 'faceoff-lost', 'turnover', 'caused-turnover', 'save', 'penalty'];
    const statLabels = ['Goals', 'Assists', 'Shots', 'Ground Balls',
        getFaceoffLabel(_gt, 'won').replace('Won', 'Wins'),
        getFaceoffLabel(_gt, 'lost').replace('Lost', 'Losses'),
        'Turnovers', 'Takeaways', 'Saves', 'Penalties'];

    let html = '<div class="overlay-content overlay-content--medium">';
    html += `<h3>Edit Stats: vs ${escapeHtml(game.opponent)}</h3>`;

    // Editable score
    html += '<div style="display: flex; gap: 1rem; align-items: center; margin: 1rem 0;">';
    html += '<label style="font-weight: 700;">Home:</label>';
    html += `<input type="number" id="edit-home-score" value="${game.homeScore}" min="0" class="dark-input dark-input--score">`;
    html += '<label style="font-weight: 700;">Away:</label>';
    html += `<input type="number" id="edit-away-score" value="${game.awayScore}" min="0" class="dark-input dark-input--score">`;
    html += '</div>';

    // Editable stats table
    html += '<div style="overflow-x: auto;">';
    html += '<table class="stat-table" style="margin-top: 0.5rem;">';
    html += '<thead><tr>';
    html += '<th>Player</th>';
    statLabels.forEach(label => {
        html += `<th>${label}</th>`;
    });
    html += '</tr></thead><tbody>';

    [...roster].sort((a, b) => Number(a.number) - Number(b.number)).forEach(player => {
        const stats = game.stats[player.id];
        if (!stats) return;

        html += `<tr>`;
        html += `<td>#${escapeHtml(player.number)} ${escapeHtml(player.name)}</td>`;
        statKeys.forEach(key => {
            const val = getStatCount(stats[key]);
            html += `<td style="padding: 0.25rem;">`;
            html += `<input type="number" data-player="${player.id}" data-stat="${key}" value="${val}" min="0" class="dark-input dark-input--stat">`;
            html += `</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table></div>';

    // Team Stats section
    const ts = game.teamStats || {};
    const tsInput = (id, val) => `<input type="number" id="edit-ts-${id}" value="${val || 0}" min="0" class="dark-input dark-input--stat" style="width: 56px;">`;
    html += '<div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 2px solid var(--border-color);">';
    html += '<h4 style="margin-bottom: 0.75rem;">Team Stats</h4>';
    html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">';
    // Clears
    html += '<div style="background: rgba(255,255,255,0.04); padding: 0.75rem; border-radius: 8px;">';
    html += '<div style="font-weight: 700; margin-bottom: 0.5rem; font-size: 0.85rem;">Clears</div>';
    html += `<div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;"><label style="font-size: 0.8rem; min-width: 70px;">Successful:</label>${tsInput('clearsSuccess', ts.clearsSuccess)}</div>`;
    html += `<div style="display: flex; align-items: center; gap: 0.5rem;"><label style="font-size: 0.8rem; min-width: 70px;">Failed:</label>${tsInput('clearsFail', ts.clearsFail)}</div>`;
    html += '</div>';
    // Opp Clears
    html += '<div style="background: rgba(255,255,255,0.04); padding: 0.75rem; border-radius: 8px;">';
    html += '<div style="font-weight: 700; margin-bottom: 0.5rem; font-size: 0.85rem;">Opponent Clears</div>';
    html += `<div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;"><label style="font-size: 0.8rem; min-width: 70px;">Successful:</label>${tsInput('oppClearsSuccess', ts.oppClearsSuccess)}</div>`;
    html += `<div style="display: flex; align-items: center; gap: 0.5rem;"><label style="font-size: 0.8rem; min-width: 70px;">Failed:</label>${tsInput('oppClearsFail', ts.oppClearsFail)}</div>`;
    html += '</div>';
    // Man-Up (EMO)
    html += '<div style="background: rgba(255,255,255,0.04); padding: 0.75rem; border-radius: 8px;">';
    html += '<div style="font-weight: 700; margin-bottom: 0.5rem; font-size: 0.85rem;">Man-Up (EMO)</div>';
    html += `<div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;"><label style="font-size: 0.8rem; min-width: 70px;">Opportunities:</label>${tsInput('emoOpportunities', ts.emoOpportunities)}</div>`;
    html += `<div style="display: flex; align-items: center; gap: 0.5rem;"><label style="font-size: 0.8rem; min-width: 70px;">Goals:</label>${tsInput('emoGoals', ts.emoGoals)}</div>`;
    html += '</div>';
    // Penalty Kill
    html += '<div style="background: rgba(255,255,255,0.04); padding: 0.75rem; border-radius: 8px;">';
    html += '<div style="font-weight: 700; margin-bottom: 0.5rem; font-size: 0.85rem;">Penalty Kill</div>';
    html += `<div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;"><label style="font-size: 0.8rem; min-width: 70px;">Opportunities:</label>${tsInput('pkOpportunities', ts.pkOpportunities)}</div>`;
    html += `<div style="display: flex; align-items: center; gap: 0.5rem;"><label style="font-size: 0.8rem; min-width: 70px;">Goals Against:</label>${tsInput('pkGoalsAgainst', ts.pkGoalsAgainst)}</div>`;
    html += '</div>';
    html += '</div></div>';

    html += '</div>';

    // Create overlay
    const container = createOverlay({ id: 'edit-game-stats-overlay' });
    container.innerHTML = html;
    container.style.padding = '2rem 1rem';

    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Changes';
    saveBtn.className = 'btn-primary';
    saveBtn.style.marginTop = '1rem';
    saveBtn.onclick = () => {
        // Read score
        game.homeScore = parseInt(document.getElementById('edit-home-score').value) || 0;
        game.awayScore = parseInt(document.getElementById('edit-away-score').value) || 0;

        // Read all stat inputs — editing collapses timestamp arrays to plain numbers
        container.querySelectorAll('input[data-player]').forEach(input => {
            const playerId = input.dataset.player;
            const statKey = input.dataset.stat;
            const newVal = parseInt(input.value) || 0;
            if (game.stats[playerId]) {
                const oldVal = game.stats[playerId][statKey];
                if (Array.isArray(oldVal)) {
                    // If count changed, trim or pad the array
                    if (newVal < oldVal.length) {
                        game.stats[playerId][statKey] = oldVal.slice(0, newVal);
                    } else if (newVal > oldVal.length) {
                        for (let i = oldVal.length; i < newVal; i++) {
                            oldVal.push({});
                        }
                    }
                } else {
                    game.stats[playerId][statKey] = newVal;
                }
            }
        });

        // Save team stats
        game.teamStats = {
            clearsSuccess: parseInt(document.getElementById('edit-ts-clearsSuccess').value) || 0,
            clearsFail: parseInt(document.getElementById('edit-ts-clearsFail').value) || 0,
            oppClearsSuccess: parseInt(document.getElementById('edit-ts-oppClearsSuccess').value) || 0,
            oppClearsFail: parseInt(document.getElementById('edit-ts-oppClearsFail').value) || 0,
            emoOpportunities: parseInt(document.getElementById('edit-ts-emoOpportunities').value) || 0,
            emoGoals: parseInt(document.getElementById('edit-ts-emoGoals').value) || 0,
            pkOpportunities: parseInt(document.getElementById('edit-ts-pkOpportunities').value) || 0,
            pkGoalsAgainst: parseInt(document.getElementById('edit-ts-pkGoalsAgainst').value) || 0
        };

        // Save
        const allGames = getGames();
        const idx = allGames.findIndex(g => g.id === gameId);
        if (idx !== -1) {
            allGames[idx] = game;
            saveGames(allGames);
        }

        container.remove();
        loadGameHistory();
        alert('Stats updated!');
    };
    container.firstChild.appendChild(saveBtn);

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.style.marginTop = '0.5rem';
    cancelBtn.onclick = () => container.remove();
    container.firstChild.appendChild(cancelBtn);
}

// Render period box score table
function renderBoxScore(game) {
    if (!game.periodScores) return '';
    const ps = game.periodScores;
    const numPeriods = ps.home.length;
    const periodLabel = getPeriodLabel(game);
    const teamName = localStorage.getItem(STORAGE_KEYS.TEAM_NAME) || 'Home';
    const homeLabel = game.trackingTeam === 'home' ? teamName : game.opponent;
    const awayLabel = game.trackingTeam === 'home' ? game.opponent : teamName;

    let html = '<div style="overflow-x: auto; margin-bottom: 1.5rem;">';
    html += '<table class="stat-table" style="width: auto;"><thead><tr><th></th>';
    for (let i = 0; i < numPeriods; i++) {
        html += `<th style="padding: 0.5rem 0.75rem;">${periodLabel}${i + 1}</th>`;
    }
    html += '<th style="padding: 0.5rem 0.75rem; border-left: 2px solid var(--border-color);">Final</th>';
    html += '</tr></thead><tbody>';

    [['home', homeLabel, game.homeScore], ['away', awayLabel, game.awayScore]].forEach(([side, label, total]) => {
        html += `<tr><td style="padding: 0.5rem 1rem;">${label}</td>`;
        for (let i = 0; i < numPeriods; i++) {
            html += `<td style="padding: 0.5rem 0.75rem;">${ps[side][i]}</td>`;
        }
        html += `<td style="padding: 0.5rem 0.75rem; font-weight: 700; border-left: 2px solid var(--border-color);">${total}</td></tr>`;
    });

    html += '</tbody></table></div>';
    return html;
}

// Compute player stat rows for a game (used by both game stats and season summary)
function computePlayerRows(game, roster) {
    const rosterById = {};
    roster.forEach(p => { rosterById[p.id] = p; });
    const allPlayers = [...roster];
    if (game.stats) {
        Object.keys(game.stats).forEach(pid => {
            if (!rosterById[pid] && pid !== 'opponent') {
                allPlayers.push({ id: pid, number: '?', name: 'Unknown (#' + pid.slice(-4) + ')', position: '' });
            }
        });
    }

    const rows = [];
    [...allPlayers].sort((a, b) => Number(a.number) - Number(b.number)).forEach(player => {
        const stats = game.stats && game.stats[player.id];
        if (!stats) return;
        const totalStats = Object.values(stats).reduce((a, b) => a + getStatCount(b), 0);
        if (totalStats === 0) return;
        const goals = getStatCount(stats.goal);
        const assists = getStatCount(stats.assist);
        const shots = getStatCount(stats.shot);
        const fow = getStatCount(stats['faceoff-won']);
        const fol = getStatCount(stats['faceoff-lost']);
        rows.push({
            player, goals, assists, points: goals + assists, shots,
            shotPct: shots > 0 ? Math.round(goals / shots * 100) : -1,
            gb: getStatCount(stats['ground-ball']), fow, fol,
            foPct: (fow + fol) > 0 ? Math.round(fow / (fow + fol) * 100) : -1,
            to: getStatCount(stats.turnover), ta: getStatCount(stats['caused-turnover']),
            sv: getStatCount(stats.save), pen: getStatCount(stats.penalty),
            pim: getPenaltyMinutes(stats.penalty)
        });
    });
    return rows;
}

// Render player stats table with column highlighting
function renderPlayerStatsTable(game, roster) {
    const playerRows = computePlayerRows(game, roster);

    const colKeys = ['goals','assists','points','shots','shotPct','gb','fow','fol','foPct','ta','sv'];
    const maxVals = {};
    colKeys.forEach(k => {
        const vals = playerRows.map(r => r[k]).filter(v => v > 0);
        maxVals[k] = vals.length > 0 ? Math.max(...vals) : -1;
    });
    const grn = (val, key) => val > 0 && val === maxVals[key] ? 'color: var(--color-green-text); font-weight: 700;' : '';

    let html = '<h4 style="margin-top: 1rem;">Player Statistics</h4>';
    html += `<div style="overflow-x: auto;"><table class="stat-table stat-table-sticky" style="margin-top: 0.5rem;"><thead><tr>
        <th>Player</th><th>Goals</th><th>Assists</th><th>Points</th><th>Shots</th><th>Shot %</th>
        <th>Ground Balls</th><th>${getFaceoffLabel(getGameType(game), 'won').replace('Won','Wins')}</th><th>${getFaceoffLabel(getGameType(game), 'lost').replace('Lost','Losses')}</th><th>${getFaceoffPctLabel(getGameType(game))}</th>
        <th>Turnovers</th><th>Takeaways</th><th>Saves</th><th>Penalties</th><th>PIM</th>
    </tr></thead><tbody>`;

    playerRows.forEach(r => {
        html += `<tr>
            <td>#${escapeHtml(r.player.number)} ${escapeHtml(r.player.name)}</td>
            <td style="${grn(r.goals,'goals')}">${r.goals}</td>
            <td style="${grn(r.assists,'assists')}">${r.assists}</td>
            <td style="font-weight: 600; ${grn(r.points,'points')}">${r.points}</td>
            <td style="${grn(r.shots,'shots')}">${r.shots}</td>
            <td style="${grn(r.shotPct,'shotPct')}">${r.shotPct >= 0 ? r.shotPct + '%' : '-'}</td>
            <td style="${grn(r.gb,'gb')}">${r.gb}</td>
            <td style="${grn(r.fow,'fow')}">${r.fow}</td>
            <td style="${grn(r.fol,'fol')}">${r.fol}</td>
            <td style="${grn(r.foPct,'foPct')}">${r.foPct >= 0 ? r.foPct + '%' : '-'}</td>
            <td>${r.to}</td>
            <td style="${grn(r.ta,'ta')}">${r.ta}</td>
            <td style="${grn(r.sv,'sv')}">${r.sv}</td>
            <td>${r.pen}</td>
            <td>${r.pim > 0 ? formatPIM(r.pim) : '-'}</td>
        </tr>`;
    });

    if (playerRows.length === 0) {
        html += `<tr><td colspan="15" style="padding: 1rem; text-align: center; color: var(--text-secondary); font-style: italic;">No stats recorded</td></tr>`;
    }
    html += `</tbody></table></div>`;
    return html;
}

// Render team stats card (clears, EMO, PK)
function renderTeamStatsCard(game) {
    const liveClears = game.clears || [];
    const ts = game.teamStats || {};
    const trackSide = game.trackingTeam || 'home';
    const clrSuccess = liveClears.length > 0
        ? liveClears.filter(c => c.team === trackSide && c.success).length
        : (ts.clearsSuccess || 0);
    const clrFail = liveClears.length > 0
        ? liveClears.filter(c => c.team === trackSide && !c.success).length
        : (ts.clearsFail || 0);
    const oppClrSuccess = liveClears.length > 0
        ? liveClears.filter(c => c.team !== trackSide && c.success).length
        : (ts.oppClearsSuccess || 0);
    const oppClrFail = liveClears.length > 0
        ? liveClears.filter(c => c.team !== trackSide && !c.success).length
        : (ts.oppClearsFail || 0);

    const hasClears = (clrSuccess + clrFail + oppClrSuccess + oppClrFail) > 0;
    const hasEMO = (ts.emoOpportunities || 0) > 0 || (ts.emoGoals || 0) > 0;
    const hasPK = (ts.pkOpportunities || 0) > 0;

    if (!hasClears && !hasEMO && !hasPK) return '';

    const pct = (num, den) => den > 0 ? Math.round(num / den * 100) + '%' : '-';
    const clrTotal = clrSuccess + clrFail;
    const oppClrTotal = oppClrSuccess + oppClrFail;
    const pkSuccessful = (ts.pkOpportunities || 0) - (ts.pkGoalsAgainst || 0);

    let html = '<div class="team-stats-card">';
    html += '<h4 style="margin-bottom: 0.75rem;">Team Stats</h4>';
    html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; font-size: 0.9rem;">';
    if (hasClears) {
        html += `<div><strong>Clearing:</strong> ${clrSuccess}/${clrTotal} (${pct(clrSuccess, clrTotal)})</div>`;
        html += `<div><strong>Opp Clearing:</strong> ${oppClrSuccess}/${oppClrTotal} (${pct(oppClrSuccess, oppClrTotal)})</div>`;
    }
    if (hasEMO) {
        html += `<div><strong>Man-Up (EMO):</strong> ${ts.emoGoals || 0}/${ts.emoOpportunities || 0} (${pct(ts.emoGoals || 0, ts.emoOpportunities || 0)})</div>`;
    }
    if (hasPK) {
        html += `<div><strong>Penalty Kill:</strong> ${pkSuccessful >= 0 ? pkSuccessful : 0}/${ts.pkOpportunities || 0} (${pct(pkSuccessful >= 0 ? pkSuccessful : 0, ts.pkOpportunities || 0)})</div>`;
    }
    html += '</div></div>';
    return html;
}

function viewGameStats(gameId) {
    const games = getGames();
    const game = games.find(g => g.id === gameId);
    if (!game) return;

    const roster = getRoster();
    let statsHtml = '<div class="overlay-content overlay-content--wide">';
    statsHtml += `<h3>vs ${escapeHtml(game.opponent)}</h3>`;
    statsHtml += `<p style="font-size: 1.5rem; font-weight: bold; margin: 1rem 0;">Score: ${game.homeScore} - ${game.awayScore}</p>`;

    const gameDate = game.completedAt ? new Date(game.completedAt) : null;
    if (gameDate) {
        statsHtml += `<p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1rem;">${gameDate.toLocaleDateString()} at ${gameDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>`;
    }

    statsHtml += renderBoxScore(game);
    statsHtml += renderPlayerStatsTable(game, roster);
    statsHtml += renderTeamStatsCard(game);

    // === GAME LOG (chronological event list) ===
    const gameLogEvents = [];
    const statNames = getStatNames(getGameType(game));

    // Collect player events
    if (game.stats) {
        Object.keys(game.stats).forEach(playerId => {
            const playerStats = game.stats[playerId];
            const player = roster.find(p => p.id === playerId);
            if (!player) return;

            Object.keys(playerStats).forEach(statKey => {
                const val = playerStats[statKey];
                if (Array.isArray(val)) {
                    val.forEach(entry => {
                        if (entry && entry.period) {
                            gameLogEvents.push({
                                period: entry.period,
                                time: entry.time || '',
                                timeRemaining: entry.timeRemaining != null ? entry.timeRemaining : 0,
                                label: `#${escapeHtml(player.number)} ${escapeHtml(player.name)}`,
                                stat: statNames[statKey] || statKey,
                                statKey: statKey,
                                isGoal: statKey === 'goal',
                                isOpponent: false
                            });
                        }
                    });
                }
            });
        });
    }

    // Collect opponent events
    if (game.opponentStats) {
        const oppName = game.trackingTeam === 'home' ? game.opponent : (localStorage.getItem(STORAGE_KEYS.TEAM_NAME) || 'Opponent');
        Object.keys(game.opponentStats).forEach(statKey => {
            const val = game.opponentStats[statKey];
            if (Array.isArray(val)) {
                val.forEach(entry => {
                    if (entry && entry.period) {
                        gameLogEvents.push({
                            period: entry.period,
                            time: entry.time || '',
                            timeRemaining: entry.timeRemaining != null ? entry.timeRemaining : 0,
                            label: oppName,
                            stat: statNames[statKey] || statKey,
                            statKey: statKey,
                            isGoal: statKey === 'goal',
                            isOpponent: true
                        });
                    }
                });
            }
        });
    }

    // Collect timeout events
    if (game.timeouts) {
        game.timeouts.forEach(to => {
            if (to.period) {
                gameLogEvents.push({
                    period: to.period,
                    time: to.time || '',
                    timeRemaining: to.timeRemaining != null ? to.timeRemaining : 0,
                    label: to.teamName || (to.team === 'home' ? 'Home' : 'Away'),
                    stat: 'Timeout',
                    statKey: 'timeout',
                    isGoal: false,
                    isOpponent: to.team !== game.trackingTeam
                });
            }
        });
    }

    // Collect clear events
    if (game.clears) {
        game.clears.forEach(cl => {
            if (cl.period) {
                gameLogEvents.push({
                    period: cl.period,
                    time: cl.time || '',
                    timeRemaining: cl.timeRemaining != null ? cl.timeRemaining : 0,
                    label: cl.teamName || (cl.team === 'home' ? 'Home' : 'Away'),
                    stat: cl.success ? 'Clear' : 'Failed Clear',
                    statKey: cl.success ? 'clear' : 'failed-clear',
                    isGoal: false,
                    isOpponent: cl.team !== game.trackingTeam
                });
            }
        });
    }

    if (gameLogEvents.length > 0) {
        // Sort: period ASC, then timeRemaining DESC (higher time remaining = earlier in period)
        gameLogEvents.sort((a, b) => {
            if (a.period !== b.period) return a.period - b.period;
            return b.timeRemaining - a.timeRemaining;
        });

        const periodLabel = getPeriodLabel(game);

        // === SCORING SUMMARY (goals + assists only) ===
        const scoringEvents = gameLogEvents.filter(e => e.statKey === 'goal' || e.statKey === 'assist');
        if (scoringEvents.length > 0) {
            statsHtml += '<h4 style="margin-top: 1.5rem;">Scoring Summary</h4>';
            statsHtml += '<div style="border: 1px solid var(--border-color); border-radius: 8px; margin-top: 0.5rem; overflow: hidden;">';
            statsHtml += '<table class="stat-log-table">';

            scoringEvents.forEach((evt, i) => {
                const goalStyle = evt.isGoal ? 'font-weight: 700; color: var(--color-green-text);' : 'color: var(--text-secondary); font-style: italic;';
                const oppStyle = evt.isOpponent ? 'color: var(--color-opponent);' : '';
                statsHtml += `<tr>`;
                statsHtml += `<td style="white-space: nowrap; color: var(--text-secondary); font-family: monospace;">${periodLabel}${evt.period} ${evt.time}</td>`;
                statsHtml += `<td style="${oppStyle}">${evt.label}</td>`;
                statsHtml += `<td style="${goalStyle}">${evt.stat}</td>`;
                statsHtml += '</tr>';
            });

            statsHtml += '</table></div>';
        }

        // === SHOT CHART ===
        const shotChartData = [];
        if (game.stats) {
            Object.keys(game.stats).forEach(playerId => {
                const ps = game.stats[playerId];
                const player = roster.find(p => p.id === playerId);
                if (!player || !Array.isArray(ps.shot)) return;
                const goalTimestamps = Array.isArray(ps.goal) ? ps.goal : [];
                ps.shot.forEach(shotTs => {
                    if (shotTs && typeof shotTs.x === 'number' && typeof shotTs.y === 'number') {
                        const isGoal = goalTimestamps.some(gTs => gTs.period === shotTs.period && gTs.timeRemaining === shotTs.timeRemaining);
                        shotChartData.push({ x: shotTs.x, y: shotTs.y, isGoal, playerId, playerLabel: `#${escapeHtml(player.number)} ${escapeHtml(player.name)}` });
                    }
                });
            });
        }

        if (shotChartData.length > 0) {
            // Collect unique players who have shot location data
            const shotPlayers = [];
            const seenIds = {};
            shotChartData.forEach(s => {
                if (!seenIds[s.playerId]) {
                    seenIds[s.playerId] = true;
                    shotPlayers.push({ id: s.playerId, label: s.playerLabel });
                }
            });
            shotPlayers.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

            const chartId = 'game-shot-chart-' + (game.id || Date.now());
            statsHtml += '<h4 style="margin-top: 1.5rem;">Shot Chart</h4>';
            statsHtml += `<div style="margin-top: 0.5rem;">`;
            statsHtml += `<select id="${chartId}-filter" onchange="window._updateGameShotChart_${game.id ? game.id.replace(/[^a-zA-Z0-9]/g, '_') : 'x'}()" class="dark-input" style="padding: 0.5rem; font-size: 0.9rem; border-radius: 6px; margin-bottom: 0.75rem;">`;
            statsHtml += `<option value="">All Players</option>`;
            shotPlayers.forEach(sp => {
                statsHtml += `<option value="${sp.id}">${sp.label}</option>`;
            });
            statsHtml += `</select>`;
            statsHtml += `<div id="${chartId}-container">${buildShotChartSVG(shotChartData)}</div>`;
            statsHtml += `</div>`;

            // Create update function on window for the filter dropdown
            const fnName = `_updateGameShotChart_${game.id ? game.id.replace(/[^a-zA-Z0-9]/g, '_') : 'x'}`;
            window[fnName] = function() {
                const sel = document.getElementById(`${chartId}-filter`);
                const ctr = document.getElementById(`${chartId}-container`);
                if (sel && ctr) {
                    ctr.innerHTML = buildShotChartSVG(shotChartData, { highlightPlayerId: sel.value || null });
                }
            };
        }

        // === FULL GAME LOG ===
        statsHtml += '<h4 style="margin-top: 1.5rem;">Game Log</h4>';
        statsHtml += '<div style="max-height: 300px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; margin-top: 0.5rem;">';
        statsHtml += '<table class="stat-log-table">';

        gameLogEvents.forEach((evt, i) => {
            const goalStyle = evt.isGoal ? 'font-weight: 700; color: var(--color-green-text);' : '';
            const oppStyle = evt.isOpponent ? 'color: var(--color-opponent);' : '';
            statsHtml += `<tr>`;
            statsHtml += `<td style="white-space: nowrap; color: var(--text-secondary); font-family: monospace;">${periodLabel}${evt.period} ${evt.time}</td>`;
            statsHtml += `<td style="${oppStyle}">${evt.label}</td>`;
            statsHtml += `<td style="${goalStyle}">${evt.stat}</td>`;
            statsHtml += '</tr>';
        });

        statsHtml += '</table></div>';
    }

    statsHtml += '</div>';

    const container = createOverlay({ id: 'view-game-stats-overlay' });
    container.innerHTML = statsHtml;
    container.style.padding = '2rem 1rem';
    container.onclick = (e) => {
        if (e.target === container) container.remove();
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'btn-secondary';
    closeBtn.style.marginTop = '1rem';
    closeBtn.onclick = () => container.remove();
    container.firstChild.appendChild(closeBtn);
}

// ===== SEASON SUMMARY =====
function loadSeasonSummary() {
    const games = getGames().filter(g => g.status === 'completed');
    const roster = getRoster();
    const display = document.getElementById('season-summary-display');

    if (games.length === 0) {
        display.innerHTML = '<p style="text-align:center; color: #64748b;">No completed games yet</p>';
        return;
    }

    // Determine predominant game type for labeling
    const _seasonGt = games.filter(g => g.gameType === 'girls').length > games.length / 2 ? 'girls' : 'boys';

    // Sort games chronologically
    const sortedGames = [...games].sort((a, b) => new Date(a.completedAt || a.datetime) - new Date(b.completedAt || b.datetime));

    // Helper: aggregate all player stats for a single game into team totals
    function getTeamGameStats(game) {
        const t = { g: 0, a: 0, pts: 0, sh: 0, gb: 0, fow: 0, fol: 0, to: 0, ta: 0, sv: 0, pen: 0 };
        if (!game.stats) return t;
        Object.values(game.stats).forEach(ps => {
            t.g += getStatCount(ps.goal);
            t.a += getStatCount(ps.assist);
            t.sh += getStatCount(ps.shot);
            t.gb += getStatCount(ps['ground-ball']);
            t.fow += getStatCount(ps['faceoff-won']);
            t.fol += getStatCount(ps['faceoff-lost']);
            t.to += getStatCount(ps.turnover);
            t.ta += getStatCount(ps['caused-turnover']);
            t.sv += getStatCount(ps.save);
            t.pen += getStatCount(ps.penalty);
        });
        t.pts = t.g + t.a;
        return t;
    }

    // Helper: get a single player's stats for a single game
    function getPlayerGameStats(game, playerId) {
        const ps = game.stats && game.stats[playerId];
        if (!ps) return null;
        const g = getStatCount(ps.goal);
        const a = getStatCount(ps.assist);
        const sh = getStatCount(ps.shot);
        const fow = getStatCount(ps['faceoff-won']);
        const fol = getStatCount(ps['faceoff-lost']);
        return {
            g, a, pts: g + a, sh,
            gb: getStatCount(ps['ground-ball']), fow, fol,
            to: getStatCount(ps.turnover), ta: getStatCount(ps['caused-turnover']),
            sv: getStatCount(ps.save), pen: getStatCount(ps.penalty)
        };
    }

    // Common table header style
    const thStyle = 'padding: 0.6rem 0.5rem; text-align: center; font-weight: 700;';
    const tdStyle = 'padding: 0.6rem 0.5rem; text-align: center; color: var(--text-primary);';
    const stickyTh = thStyle + ' text-align: left; position: sticky; left: 0; z-index: 1;';
    const stickyTd = 'padding: 0.6rem 0.5rem; font-weight: 600; color: var(--text-primary); position: sticky; left: 0; z-index: 1; background: var(--card-bg); white-space: nowrap;';

    // Build stat header columns (reusable)
    function statHeaders(headerBg) {
        return `<th style="${stickyTh} background: ${headerBg};">Game</th>
            <th style="${thStyle}">Score</th>
            <th style="${thStyle}">G</th><th style="${thStyle}">A</th><th style="${thStyle}">Pts</th>
            <th style="${thStyle}">Sh</th><th style="${thStyle}">Sh%</th>
            <th style="${thStyle}">GB</th><th style="${thStyle}">${getFaceoffAbbrev(_seasonGt, 'won')}</th><th style="${thStyle}">${getFaceoffAbbrev(_seasonGt, 'lost')}</th><th style="${thStyle}">${getFaceoffPctLabel(_seasonGt)}</th>
            <th style="${thStyle}">TO</th><th style="${thStyle}">TA</th><th style="${thStyle}">Sv</th><th style="${thStyle}">Pen</th>`;
    }

    // Build a stat row from a stats object
    function statRow(label, score, s, bg) {
        const shPct = s.sh > 0 ? Math.round(s.g / s.sh * 100) + '%' : '-';
        const foPct = (s.fow + s.fol) > 0 ? Math.round(s.fow / (s.fow + s.fol) * 100) + '%' : '-';
        return `<tr style="border-bottom: 1px solid var(--border-color); ${bg ? 'background:' + bg + ';' : ''}">
            <td style="${stickyTd} ${bg ? 'background:' + bg + ';' : ''}">${label}</td>
            <td style="${tdStyle} font-weight: 600;">${score}</td>
            <td style="${tdStyle}">${s.g}</td><td style="${tdStyle}">${s.a}</td><td style="${tdStyle} font-weight: 700;">${s.pts}</td>
            <td style="${tdStyle}">${s.sh}</td><td style="${tdStyle}">${shPct}</td>
            <td style="${tdStyle}">${s.gb}</td><td style="${tdStyle}">${s.fow}</td><td style="${tdStyle}">${s.fol}</td><td style="${tdStyle}">${foPct}</td>
            <td style="${tdStyle}">${s.to}</td><td style="${tdStyle}">${s.ta}</td><td style="${tdStyle}">${s.sv}</td><td style="${tdStyle}">${s.pen}</td>
        </tr>`;
    }

    let html = '<div style="padding: 0.5rem; max-width: 1200px; margin: 0 auto;">';

    // ========== 1. TEAM GAME-BY-GAME ==========
    html += `<div style="background: var(--card-bg); padding: 1.25rem; border-radius: 12px; margin-bottom: 1.5rem; border: 2px solid var(--primary-color);">`;
    html += `<h3 style="margin-bottom: 1rem; color: var(--text-primary);">Team Stats by Game</h3>`;
    html += `<div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">`;
    html += `<thead><tr style="background: var(--primary-color); color: white;">${statHeaders('var(--primary-color)')}</tr></thead><tbody>`;

    // Team totals accumulator
    const teamTotals = { g: 0, a: 0, pts: 0, sh: 0, gb: 0, fow: 0, fol: 0, to: 0, ta: 0, sv: 0, pen: 0 };

    sortedGames.forEach((game, i) => {
        const t = getTeamGameStats(game);
        Object.keys(teamTotals).forEach(k => teamTotals[k] += t[k]);
        const date = new Date(game.completedAt || game.datetime);
        const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const result = game.homeScore > game.awayScore ? 'W' : game.homeScore < game.awayScore ? 'L' : 'T';
        const resultColor = result === 'W' ? '#10b981' : result === 'L' ? '#ef4444' : '#94a3b8';
        const label = `<span style="color: ${resultColor}; font-weight: 700;">${result}</span> vs ${escapeHtml(game.opponent)}<br><span style="font-size: 0.75rem; color: var(--text-secondary);">${dateStr}</span>`;
        const score = `<span style="color: ${resultColor};">${game.homeScore}-${game.awayScore}</span>`;
        const bg = i % 2 === 0 ? '' : 'rgba(255,255,255,0.02)';
        html += statRow(label, score, t, bg);
    });

    // Totals row
    const totalShPct = teamTotals.sh > 0 ? Math.round(teamTotals.g / teamTotals.sh * 100) + '%' : '-';
    const totalFoPct = (teamTotals.fow + teamTotals.fol) > 0 ? Math.round(teamTotals.fow / (teamTotals.fow + teamTotals.fol) * 100) + '%' : '-';
    html += `<tr style="border-top: 3px solid var(--primary-color); font-weight: 700;">
        <td style="${stickyTd} background: var(--card-bg);">Season Totals</td>
        <td style="${tdStyle}">${sortedGames.length} GP</td>
        <td style="${tdStyle}">${teamTotals.g}</td><td style="${tdStyle}">${teamTotals.a}</td><td style="${tdStyle}">${teamTotals.pts}</td>
        <td style="${tdStyle}">${teamTotals.sh}</td><td style="${tdStyle}">${totalShPct}</td>
        <td style="${tdStyle}">${teamTotals.gb}</td><td style="${tdStyle}">${teamTotals.fow}</td><td style="${tdStyle}">${teamTotals.fol}</td><td style="${tdStyle}">${totalFoPct}</td>
        <td style="${tdStyle}">${teamTotals.to}</td><td style="${tdStyle}">${teamTotals.ta}</td><td style="${tdStyle}">${teamTotals.sv}</td><td style="${tdStyle}">${teamTotals.pen}</td>
    </tr>`;

    html += `</tbody></table></div></div>`;

    // ========== TEAM STATS (Clears, EMO, PK) ==========
    // Helper: get clear counts from a game (live clears take precedence over post-game entry)
    function getGameClears(game) {
        const lc = game.clears || [];
        const ts = game.teamStats || {};
        const tracking = game.trackingTeam || 'home';
        if (lc.length > 0) {
            return {
                cs: lc.filter(c => c.team === tracking && c.success).length,
                cf: lc.filter(c => c.team === tracking && !c.success).length,
                ocs: lc.filter(c => c.team !== tracking && c.success).length,
                ocf: lc.filter(c => c.team !== tracking && !c.success).length
            };
        }
        return { cs: ts.clearsSuccess || 0, cf: ts.clearsFail || 0, ocs: ts.oppClearsSuccess || 0, ocf: ts.oppClearsFail || 0 };
    }

    const gamesWithTeamData = sortedGames.filter(g => g.teamStats || (g.clears && g.clears.length > 0));
    if (gamesWithTeamData.length > 0) {
        const tsTh = 'padding: 0.6rem 0.5rem; text-align: center; font-weight: 700;';
        const tsTd = 'padding: 0.6rem 0.5rem; text-align: center; color: var(--text-primary);';
        const tsStickyTh = tsTh + ' text-align: left; position: sticky; left: 0; z-index: 1;';
        const tsStickyTd = 'padding: 0.6rem 0.5rem; font-weight: 600; color: var(--text-primary); position: sticky; left: 0; z-index: 1; background: var(--card-bg); white-space: nowrap;';

        const pct = (num, den) => den > 0 ? Math.round(num / den * 100) + '%' : '-';
        const frac = (num, den) => den > 0 ? `${num}/${den}` : '-';

        html += `<div style="background: var(--card-bg); padding: 1.25rem; border-radius: 12px; margin-bottom: 1.5rem; border: 2px solid #6366f1;">`;
        html += `<h3 style="margin-bottom: 1rem; color: var(--text-primary);">Team Stats by Game</h3>`;
        html += `<div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">`;
        html += `<thead><tr style="background: #6366f1; color: white;">`;
        html += `<th style="${tsStickyTh} background: #6366f1;">Game</th>`;
        html += `<th style="${tsTh}">Clr</th><th style="${tsTh}">Clr%</th>`;
        html += `<th style="${tsTh}">Opp Clr</th><th style="${tsTh}">Opp Clr%</th>`;
        html += `<th style="${tsTh}">EMO</th><th style="${tsTh}">EMO%</th>`;
        html += `<th style="${tsTh}">PK</th><th style="${tsTh}">PK%</th>`;
        html += `</tr></thead><tbody>`;

        const tsTotals = { cs: 0, cf: 0, ocs: 0, ocf: 0, emoOpp: 0, emoG: 0, pkOpp: 0, pkGA: 0 };

        sortedGames.forEach((game, i) => {
            const ts = game.teamStats || {};
            const cl = getGameClears(game);
            const hasData = (cl.cs + cl.cf + cl.ocs + cl.ocf) > 0 || ts.emoOpportunities || ts.pkOpportunities;

            const date = new Date(game.completedAt || game.datetime);
            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
            const result = game.homeScore > game.awayScore ? 'W' : game.homeScore < game.awayScore ? 'L' : 'T';
            const resultColor = result === 'W' ? '#10b981' : result === 'L' ? '#ef4444' : '#94a3b8';
            const label = `<span style="color: ${resultColor}; font-weight: 700;">${result}</span> vs ${escapeHtml(game.opponent)}<br><span style="font-size: 0.75rem; color: var(--text-secondary);">${dateStr}</span>`;
            const bg = i % 2 === 0 ? '' : 'rgba(255,255,255,0.02)';

            if (hasData) {
                const clrT = cl.cs + cl.cf;
                const oClrT = cl.ocs + cl.ocf;
                const emoO = ts.emoOpportunities || 0;
                const emoG = ts.emoGoals || 0;
                const pkO = ts.pkOpportunities || 0;
                const pkGA = ts.pkGoalsAgainst || 0;
                const pkOk = pkO - pkGA;
                tsTotals.cs += cl.cs; tsTotals.cf += cl.cf;
                tsTotals.ocs += cl.ocs; tsTotals.ocf += cl.ocf;
                tsTotals.emoOpp += emoO; tsTotals.emoG += emoG;
                tsTotals.pkOpp += pkO; tsTotals.pkGA += pkGA;

                html += `<tr style="border-bottom: 1px solid var(--border-color); ${bg ? 'background:' + bg + ';' : ''}">`;
                html += `<td style="${tsStickyTd} ${bg ? 'background:' + bg + ';' : ''}">${label}</td>`;
                html += `<td style="${tsTd}">${frac(cl.cs, clrT)}</td><td style="${tsTd}">${pct(cl.cs, clrT)}</td>`;
                html += `<td style="${tsTd}">${frac(cl.ocs, oClrT)}</td><td style="${tsTd}">${pct(cl.ocs, oClrT)}</td>`;
                html += `<td style="${tsTd}">${frac(emoG, emoO)}</td><td style="${tsTd}">${pct(emoG, emoO)}</td>`;
                html += `<td style="${tsTd}">${frac(pkOk >= 0 ? pkOk : 0, pkO)}</td><td style="${tsTd}">${pct(pkOk >= 0 ? pkOk : 0, pkO)}</td>`;
                html += `</tr>`;
            } else {
                html += `<tr style="border-bottom: 1px solid var(--border-color); ${bg ? 'background:' + bg + ';' : ''}">`;
                html += `<td style="${tsStickyTd} ${bg ? 'background:' + bg + ';' : ''}">${label}</td>`;
                html += `<td style="${tsTd}" colspan="8">—</td>`;
                html += `</tr>`;
            }
        });

        const sClrT = tsTotals.cs + tsTotals.cf;
        const sOClrT = tsTotals.ocs + tsTotals.ocf;
        const sPkOk = tsTotals.pkOpp - tsTotals.pkGA;
        html += `<tr style="border-top: 3px solid #6366f1; font-weight: 700;">`;
        html += `<td style="${tsStickyTd} background: var(--card-bg);">Season Totals</td>`;
        html += `<td style="${tsTd}">${frac(tsTotals.cs, sClrT)}</td><td style="${tsTd}">${pct(tsTotals.cs, sClrT)}</td>`;
        html += `<td style="${tsTd}">${frac(tsTotals.ocs, sOClrT)}</td><td style="${tsTd}">${pct(tsTotals.ocs, sOClrT)}</td>`;
        html += `<td style="${tsTd}">${frac(tsTotals.emoG, tsTotals.emoOpp)}</td><td style="${tsTd}">${pct(tsTotals.emoG, tsTotals.emoOpp)}</td>`;
        html += `<td style="${tsTd}">${frac(sPkOk >= 0 ? sPkOk : 0, tsTotals.pkOpp)}</td><td style="${tsTd}">${pct(sPkOk >= 0 ? sPkOk : 0, tsTotals.pkOpp)}</td>`;
        html += `</tr>`;

        html += `</tbody></table></div></div>`;
    }

    // ========== Calculate per-player season stats ==========
    const seasonStats = {};
    roster.forEach(player => {
        seasonStats[player.id] = {
            player, gamesPlayed: 0,
            totalGoals: 0, totalAssists: 0, totalPoints: 0, totalShots: 0,
            totalGroundBalls: 0, totalFaceoffWon: 0, totalFaceoffLost: 0,
            totalTurnovers: 0, totalCausedTurnovers: 0, totalSaves: 0, totalPenalties: 0, totalPIM: 0
        };
    });

    games.forEach(game => {
        if (!game.stats) return;
        Object.keys(game.stats).forEach(playerId => {
            if (!seasonStats[playerId]) return;
            const ps = game.stats[playerId];
            const ss = seasonStats[playerId];
            ss.gamesPlayed++;
            ss.totalGoals += getStatCount(ps.goal);
            ss.totalAssists += getStatCount(ps.assist);
            ss.totalShots += getStatCount(ps.shot);
            ss.totalGroundBalls += getStatCount(ps['ground-ball']);
            ss.totalFaceoffWon += getStatCount(ps['faceoff-won']);
            ss.totalFaceoffLost += getStatCount(ps['faceoff-lost']);
            ss.totalTurnovers += getStatCount(ps.turnover);
            ss.totalCausedTurnovers += getStatCount(ps['caused-turnover']);
            ss.totalSaves += getStatCount(ps.save);
            ss.totalPenalties += getStatCount(ps.penalty);
            ss.totalPIM += getPenaltyMinutes(ps.penalty);
        });
    });

    Object.values(seasonStats).forEach(s => { s.totalPoints = s.totalGoals + s.totalAssists; });

    const sortedPlayers = Object.values(seasonStats)
        .filter(s => s.gamesPlayed > 0)
        .sort((a, b) => Number(a.player.number) - Number(b.player.number));

    // ========== 2. INDIVIDUAL PLAYER TOTALS ==========
    html += `<div style="background: var(--card-bg); padding: 1.25rem; border-radius: 12px; margin-bottom: 1.5rem; border: 2px solid var(--primary-color);">`;
    html += `<h3 style="margin-bottom: 1rem; color: var(--text-primary);">Individual Player Stats</h3>`;
    html += `<div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">`;
    html += `<thead><tr style="background: var(--primary-color); color: white;">
        <th style="${stickyTh} background: var(--primary-color);">Player</th>
        <th style="${thStyle}">GP</th><th style="${thStyle}">G</th><th style="${thStyle}">A</th><th style="${thStyle}">Pts</th>
        <th style="${thStyle}">Sh</th><th style="${thStyle}">Sh%</th><th style="${thStyle}">GB</th>
        <th style="${thStyle}">${getFaceoffAbbrev(_seasonGt, 'won')}</th><th style="${thStyle}">${getFaceoffAbbrev(_seasonGt, 'lost')}</th><th style="${thStyle}">${getFaceoffPctLabel(_seasonGt)}</th>
        <th style="${thStyle}">TO</th><th style="${thStyle}">TA</th><th style="${thStyle}">Sv</th><th style="${thStyle}">Pen</th><th style="${thStyle}">PIM</th>
    </tr></thead><tbody>`;

    // Green highlighting
    const colKeys = ['totalGoals','totalAssists','totalPoints','totalShots','shPct','totalGroundBalls','totalFaceoffWon','seasonFoPct','totalCausedTurnovers','totalSaves'];
    sortedPlayers.forEach(s => {
        s.shPct = s.totalShots > 0 ? Math.round(s.totalGoals / s.totalShots * 100) : -1;
        s.seasonFoPct = (s.totalFaceoffWon + s.totalFaceoffLost) > 0 ? Math.round(s.totalFaceoffWon / (s.totalFaceoffWon + s.totalFaceoffLost) * 100) : -1;
    });
    const colMax = {};
    colKeys.forEach(k => {
        const vals = sortedPlayers.map(s => s[k]).filter(v => v > 0);
        colMax[k] = vals.length > 0 ? Math.max(...vals) : -1;
    });
    const grn = (val, key) => val > 0 && val === colMax[key] ? 'color: #16a34a; font-weight: 700;' : 'color: var(--text-primary);';

    sortedPlayers.forEach((s, i) => {
        const bg = i % 2 === 0 ? '' : 'background: rgba(255,255,255,0.02);';
        html += `<tr style="border-bottom: 1px solid var(--border-color); ${bg}">
            <td style="${stickyTd} ${bg}">#${escapeHtml(s.player.number)} ${escapeHtml(s.player.name)}</td>
            <td style="${tdStyle}">${s.gamesPlayed}</td>
            <td style="${tdStyle} ${grn(s.totalGoals,'totalGoals')}">${s.totalGoals}</td>
            <td style="${tdStyle} ${grn(s.totalAssists,'totalAssists')}">${s.totalAssists}</td>
            <td style="${tdStyle} font-weight: 700; ${grn(s.totalPoints,'totalPoints')}">${s.totalPoints}</td>
            <td style="${tdStyle} ${grn(s.totalShots,'totalShots')}">${s.totalShots}</td>
            <td style="${tdStyle} ${grn(s.shPct,'shPct')}">${s.shPct >= 0 ? s.shPct + '%' : '-'}</td>
            <td style="${tdStyle} ${grn(s.totalGroundBalls,'totalGroundBalls')}">${s.totalGroundBalls}</td>
            <td style="${tdStyle} ${grn(s.totalFaceoffWon,'totalFaceoffWon')}">${s.totalFaceoffWon}</td>
            <td style="${tdStyle}">${s.totalFaceoffLost}</td>
            <td style="${tdStyle} ${grn(s.seasonFoPct,'seasonFoPct')}">${s.seasonFoPct >= 0 ? s.seasonFoPct + '%' : '-'}</td>
            <td style="${tdStyle}">${s.totalTurnovers}</td>
            <td style="${tdStyle} ${grn(s.totalCausedTurnovers,'totalCausedTurnovers')}">${s.totalCausedTurnovers}</td>
            <td style="${tdStyle} ${grn(s.totalSaves,'totalSaves')}">${s.totalSaves}</td>
            <td style="${tdStyle}">${s.totalPenalties}</td>
            <td style="${tdStyle}">${s.totalPIM > 0 ? formatPIM(s.totalPIM) : '-'}</td>
        </tr>`;
    });

    html += `</tbody></table></div></div>`;

    // ========== 3. PER-GAME AVERAGES ==========
    html += `<div style="background: var(--card-bg); padding: 1.25rem; border-radius: 12px; margin-bottom: 1.5rem; border: 2px solid var(--success-color);">`;
    html += `<h3 style="margin-bottom: 1rem; color: var(--text-primary);">Per-Game Averages</h3>`;
    html += `<div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">`;
    html += `<thead><tr style="background: var(--success-color); color: white;">
        <th style="${stickyTh} background: var(--success-color);">Player</th>
        <th style="${thStyle}">GP</th><th style="${thStyle}">G/G</th><th style="${thStyle}">A/G</th><th style="${thStyle}">Pts/G</th>
        <th style="${thStyle}">Sh/G</th><th style="${thStyle}">Sh%</th><th style="${thStyle}">GB/G</th>
        <th style="${thStyle}">${getFaceoffPctLabel(_seasonGt)}</th><th style="${thStyle}">Sv/G</th>
    </tr></thead><tbody>`;

    sortedPlayers.forEach((s, i) => {
        const gp = s.gamesPlayed;
        const avg = (v) => gp > 0 ? (v / gp).toFixed(1) : '0.0';
        const bg = i % 2 === 0 ? '' : 'background: rgba(255,255,255,0.02);';
        html += `<tr style="border-bottom: 1px solid var(--border-color); ${bg}">
            <td style="${stickyTd} ${bg}">#${escapeHtml(s.player.number)} ${escapeHtml(s.player.name)}</td>
            <td style="${tdStyle}">${gp}</td>
            <td style="${tdStyle}">${avg(s.totalGoals)}</td>
            <td style="${tdStyle}">${avg(s.totalAssists)}</td>
            <td style="${tdStyle} font-weight: 700; color: var(--success-color);">${avg(s.totalPoints)}</td>
            <td style="${tdStyle}">${avg(s.totalShots)}</td>
            <td style="${tdStyle}">${s.shPct >= 0 ? s.shPct + '%' : '-'}</td>
            <td style="${tdStyle}">${avg(s.totalGroundBalls)}</td>
            <td style="${tdStyle}">${s.seasonFoPct >= 0 ? s.seasonFoPct + '%' : '-'}</td>
            <td style="${tdStyle}">${avg(s.totalSaves)}</td>
        </tr>`;
    });

    html += `</tbody></table></div></div>`;

    // ========== 4. PLAYER GAME-BY-GAME DROPDOWN ==========
    html += `<div style="background: var(--card-bg); padding: 1.25rem; border-radius: 12px; margin-bottom: 1.5rem; border: 2px solid var(--warning-color);">`;
    html += `<h3 style="margin-bottom: 1rem; color: var(--text-primary);">Player Game Log</h3>`;
    html += `<select id="player-gamelog-select" onchange="renderPlayerGameLog()" style="width: 100%; padding: 0.75rem; font-size: 1rem; border-radius: 8px; border: 2px solid var(--border-color); background: var(--bg-color); color: var(--text-primary); margin-bottom: 1rem; cursor: pointer;">`;
    html += `<option value="">Select a player...</option>`;
    sortedPlayers.forEach(s => {
        html += `<option value="${s.player.id}">#${escapeHtml(s.player.number)} ${escapeHtml(s.player.name)}</option>`;
    });
    html += `</select>`;
    html += `<div id="player-gamelog-table"></div>`;
    html += `</div>`;

    // ========== 5. SEASON SHOT CHART ==========
    const seasonShotData = [];
    games.forEach(game => {
        if (!game.stats) return;
        Object.keys(game.stats).forEach(playerId => {
            const ps = game.stats[playerId];
            const player = roster.find(p => p.id === playerId);
            if (!player || !Array.isArray(ps.shot)) return;
            const goalTimestamps = Array.isArray(ps.goal) ? ps.goal : [];
            ps.shot.forEach(shotTs => {
                if (shotTs && typeof shotTs.x === 'number' && typeof shotTs.y === 'number') {
                    const isGoal = goalTimestamps.some(gTs => gTs.period === shotTs.period && gTs.timeRemaining === shotTs.timeRemaining);
                    seasonShotData.push({ x: shotTs.x, y: shotTs.y, isGoal, playerId, playerLabel: `#${escapeHtml(player.number)} ${escapeHtml(player.name)}` });
                }
            });
        });
    });

    if (seasonShotData.length > 0) {
        const shotPlayers = [];
        const seenIds = {};
        seasonShotData.forEach(s => {
            if (!seenIds[s.playerId]) {
                seenIds[s.playerId] = true;
                shotPlayers.push({ id: s.playerId, label: s.playerLabel });
            }
        });
        shotPlayers.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

        html += `<div style="background: var(--card-bg); padding: 1.25rem; border-radius: 12px; margin-bottom: 1.5rem; border: 2px solid #8b5cf6;">`;
        html += `<h3 style="margin-bottom: 1rem; color: var(--text-primary);">Season Shot Chart</h3>`;
        html += `<select id="season-shot-chart-filter" onchange="window._updateSeasonShotChart()" style="width: 100%; padding: 0.75rem; font-size: 1rem; border-radius: 8px; border: 2px solid var(--border-color); background: var(--bg-color); color: var(--text-primary); margin-bottom: 1rem; cursor: pointer;">`;
        html += `<option value="">All Players</option>`;
        shotPlayers.forEach(sp => {
            html += `<option value="${sp.id}">${sp.label}</option>`;
        });
        html += `</select>`;
        html += `<div id="season-shot-chart-container">${buildShotChartSVG(seasonShotData)}</div>`;
        html += `<div id="season-shot-chart-stats" style="margin-top:0.75rem;font-size:0.85rem;color:var(--text-secondary);text-align:center;"></div>`;
        html += `</div>`;

        // Store data for filter function
        window._seasonShotData = seasonShotData;
        window._updateSeasonShotChart = function() {
            const sel = document.getElementById('season-shot-chart-filter');
            const ctr = document.getElementById('season-shot-chart-container');
            const statsDiv = document.getElementById('season-shot-chart-stats');
            if (!sel || !ctr) return;
            const filterId = sel.value || null;
            ctr.innerHTML = buildShotChartSVG(window._seasonShotData, { highlightPlayerId: filterId });

            // Show per-player stats when filtered
            if (filterId && statsDiv) {
                const playerShots = window._seasonShotData.filter(s => s.playerId === filterId);
                const goals = playerShots.filter(s => s.isGoal).length;
                const total = playerShots.length;
                const pct = total > 0 ? Math.round(goals / total * 100) : 0;
                const label = playerShots.length > 0 ? playerShots[0].playerLabel : '';
                statsDiv.innerHTML = `<strong>${label}</strong>: ${goals} goals on ${total} shots (${pct}% shooting)`;
            } else if (statsDiv) {
                const goals = window._seasonShotData.filter(s => s.isGoal).length;
                const total = window._seasonShotData.length;
                const pct = total > 0 ? Math.round(goals / total * 100) : 0;
                statsDiv.innerHTML = `Team: ${goals} goals on ${total} shots (${pct}% shooting)`;
            }
        };
        // Trigger initial stats display
        setTimeout(() => { if (window._updateSeasonShotChart) window._updateSeasonShotChart(); }, 0);
    }

    html += '</div>';
    display.innerHTML = html;
}

function renderPlayerGameLog() {
    const playerId = document.getElementById('player-gamelog-select').value;
    const container = document.getElementById('player-gamelog-table');
    if (!playerId) { container.innerHTML = ''; return; }

    const games = getGames().filter(g => g.status === 'completed');
    const sortedGames = [...games].sort((a, b) => new Date(a.completedAt || a.datetime) - new Date(b.completedAt || b.datetime));
    const roster = getRoster();
    const player = roster.find(p => p.id === playerId);
    if (!player) { container.innerHTML = ''; return; }

    // Determine predominant game type for column labels
    const _seasonGt = games.filter(g => g.gameType === 'girls').length > games.length / 2 ? 'girls' : 'boys';

    const thStyle = 'padding: 0.6rem 0.5rem; text-align: center; font-weight: 700;';
    const tdStyle = 'padding: 0.6rem 0.5rem; text-align: center; color: var(--text-primary);';
    const stickyTh = thStyle + ' text-align: left; position: sticky; left: 0; z-index: 1; background: var(--warning-color);';
    const stickyTd = 'padding: 0.6rem 0.5rem; font-weight: 600; color: var(--text-primary); position: sticky; left: 0; z-index: 1; background: var(--card-bg); white-space: nowrap;';

    let html = `<div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">`;
    html += `<thead><tr style="background: var(--warning-color); color: white;">
        <th style="${stickyTh}">Game</th><th style="${thStyle}">Score</th>
        <th style="${thStyle}">G</th><th style="${thStyle}">A</th><th style="${thStyle}">Pts</th>
        <th style="${thStyle}">Sh</th><th style="${thStyle}">Sh%</th><th style="${thStyle}">GB</th>
        <th style="${thStyle}">${getFaceoffAbbrev(_seasonGt, 'won')}</th><th style="${thStyle}">${getFaceoffAbbrev(_seasonGt, 'lost')}</th><th style="${thStyle}">${getFaceoffPctLabel(_seasonGt)}</th>
        <th style="${thStyle}">TO</th><th style="${thStyle}">TA</th><th style="${thStyle}">Sv</th><th style="${thStyle}">Pen</th>
    </tr></thead><tbody>`;

    const totals = { g: 0, a: 0, pts: 0, sh: 0, gb: 0, fow: 0, fol: 0, to: 0, ta: 0, sv: 0, pen: 0 };
    let gamesPlayed = 0;

    sortedGames.forEach((game, i) => {
        if (!game.stats || !game.stats[playerId]) return;
        gamesPlayed++;
        const ps = game.stats[playerId];
        const g = getStatCount(ps.goal), a = getStatCount(ps.assist), sh = getStatCount(ps.shot);
        const fow = getStatCount(ps['faceoff-won']), fol = getStatCount(ps['faceoff-lost']);
        const gb = getStatCount(ps['ground-ball']), to = getStatCount(ps.turnover);
        const ta = getStatCount(ps['caused-turnover']), sv = getStatCount(ps.save), pen = getStatCount(ps.penalty);
        const pts = g + a;
        totals.g += g; totals.a += a; totals.pts += pts; totals.sh += sh; totals.gb += gb;
        totals.fow += fow; totals.fol += fol; totals.to += to; totals.ta += ta; totals.sv += sv; totals.pen += pen;

        const date = new Date(game.completedAt || game.datetime);
        const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const result = game.homeScore > game.awayScore ? 'W' : game.homeScore < game.awayScore ? 'L' : 'T';
        const resultColor = result === 'W' ? '#10b981' : result === 'L' ? '#ef4444' : '#94a3b8';
        const shPct = sh > 0 ? Math.round(g / sh * 100) + '%' : '-';
        const foPct = (fow + fol) > 0 ? Math.round(fow / (fow + fol) * 100) + '%' : '-';
        const bg = i % 2 === 0 ? '' : 'background: rgba(255,255,255,0.02);';

        html += `<tr style="border-bottom: 1px solid var(--border-color); ${bg}">
            <td style="${stickyTd} ${bg}"><span style="color: ${resultColor}; font-weight: 700;">${result}</span> vs ${escapeHtml(game.opponent)}<br><span style="font-size: 0.75rem; color: var(--text-secondary);">${dateStr}</span></td>
            <td style="${tdStyle} font-weight: 600;"><span style="color: ${resultColor};">${game.homeScore}-${game.awayScore}</span></td>
            <td style="${tdStyle}">${g}</td><td style="${tdStyle}">${a}</td><td style="${tdStyle} font-weight: 700;">${pts}</td>
            <td style="${tdStyle}">${sh}</td><td style="${tdStyle}">${shPct}</td><td style="${tdStyle}">${gb}</td>
            <td style="${tdStyle}">${fow}</td><td style="${tdStyle}">${fol}</td><td style="${tdStyle}">${foPct}</td>
            <td style="${tdStyle}">${to}</td><td style="${tdStyle}">${ta}</td><td style="${tdStyle}">${sv}</td><td style="${tdStyle}">${pen}</td>
        </tr>`;
    });

    // Totals row
    const tShPct = totals.sh > 0 ? Math.round(totals.g / totals.sh * 100) + '%' : '-';
    const tFoPct = (totals.fow + totals.fol) > 0 ? Math.round(totals.fow / (totals.fow + totals.fol) * 100) + '%' : '-';
    html += `<tr style="border-top: 3px solid var(--warning-color); font-weight: 700;">
        <td style="${stickyTd} background: var(--card-bg);">Season Totals</td>
        <td style="${tdStyle}">${gamesPlayed} GP</td>
        <td style="${tdStyle}">${totals.g}</td><td style="${tdStyle}">${totals.a}</td><td style="${tdStyle}">${totals.pts}</td>
        <td style="${tdStyle}">${totals.sh}</td><td style="${tdStyle}">${tShPct}</td><td style="${tdStyle}">${totals.gb}</td>
        <td style="${tdStyle}">${totals.fow}</td><td style="${tdStyle}">${totals.fol}</td><td style="${tdStyle}">${tFoPct}</td>
        <td style="${tdStyle}">${totals.to}</td><td style="${tdStyle}">${totals.ta}</td><td style="${tdStyle}">${totals.sv}</td><td style="${tdStyle}">${totals.pen}</td>
    </tr>`;

    html += `</tbody></table></div>`;
    container.innerHTML = html;
}

// ===== SETTINGS =====
function loadSettings() {
    const teamName = localStorage.getItem(STORAGE_KEYS.TEAM_NAME) || '';
    document.getElementById('team-name').value = teamName;

    // Refresh account UI if user is signed in
    var user = firebase.auth().currentUser;
    if (user) updateAccountUI(user);

    // Refresh team list
    if (typeof LaxSync !== 'undefined' && LaxSync.loadTeamUI) {
        LaxSync.loadTeamUI();
    }
}

function saveTeamName() {
    const teamName = document.getElementById('team-name').value.trim();
    localStorage.setItem(STORAGE_KEYS.TEAM_NAME, teamName);
    alert('Team name saved!');
}

function loadTeamName() {
    const teamName = localStorage.getItem(STORAGE_KEYS.TEAM_NAME);
    if (teamName) {
        // Could update header or other places with team name
    }
}

function exportData() {
    const data = {
        roster: getRoster(),
        games: getGames(),
        teamName: localStorage.getItem(STORAGE_KEYS.TEAM_NAME),
        exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laxkeeper-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function exportCSV() {
    const games = getGames().filter(g => g.status === 'completed');
    const roster = getRoster();
    const teamName = localStorage.getItem(STORAGE_KEYS.TEAM_NAME) || 'Team';

    if (games.length === 0) {
        alert('No completed games to export.');
        return;
    }

    const sortedGames = [...games].sort((a, b) => new Date(a.completedAt || a.datetime) - new Date(b.completedAt || b.datetime));

    // Build CSV rows: one row per player per game + season totals row per player
    const _csvGt = games.filter(g => g.gameType === 'girls').length > games.length / 2 ? 'girls' : 'boys';
    const headers = ['Player', 'Number', 'Position', 'Game', 'Date', 'Result', 'Score', 'Goals', 'Assists', 'Points', 'Shots', 'Shot%', 'Ground Balls',
        getFaceoffLabel(_csvGt, 'won').replace('Won','Wins'), getFaceoffLabel(_csvGt, 'lost').replace('Lost','Losses'), getFaceoffPctLabel(_csvGt),
        'Turnovers', 'Caused Turnovers', 'Saves', 'Penalties'];
    const rows = [headers];

    roster.forEach(player => {
        const totals = { g: 0, a: 0, sh: 0, gb: 0, fow: 0, fol: 0, to: 0, ta: 0, sv: 0, pen: 0 };
        let gamesPlayed = 0;

        sortedGames.forEach(game => {
            if (!game.stats || !game.stats[player.id]) return;
            gamesPlayed++;
            const ps = game.stats[player.id];
            const g = getStatCount(ps.goal);
            const a = getStatCount(ps.assist);
            const sh = getStatCount(ps.shot);
            const gb = getStatCount(ps['ground-ball']);
            const fow = getStatCount(ps['faceoff-won']);
            const fol = getStatCount(ps['faceoff-lost']);
            const to = getStatCount(ps.turnover);
            const ta = getStatCount(ps['caused-turnover']);
            const sv = getStatCount(ps.save);
            const pen = getStatCount(ps.penalty);
            const pts = g + a;
            const shPct = sh > 0 ? Math.round(g / sh * 100) : 0;
            const foPct = (fow + fol) > 0 ? Math.round(fow / (fow + fol) * 100) : 0;

            totals.g += g; totals.a += a; totals.sh += sh; totals.gb += gb;
            totals.fow += fow; totals.fol += fol; totals.to += to;
            totals.ta += ta; totals.sv += sv; totals.pen += pen;

            const date = new Date(game.completedAt || game.datetime);
            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
            const result = game.homeScore > game.awayScore ? 'W' : game.homeScore < game.awayScore ? 'L' : 'T';
            const score = `${game.homeScore}-${game.awayScore}`;

            rows.push([
                player.name, player.number, player.position || '',
                `vs ${escapeHtml(game.opponent)}`, dateStr, result, score,
                g, a, pts, sh, shPct + '%', gb, fow, fol, foPct + '%', to, ta, sv, pen
            ]);
        });

        // Season totals row for this player
        if (gamesPlayed > 0) {
            const tPts = totals.g + totals.a;
            const tShPct = totals.sh > 0 ? Math.round(totals.g / totals.sh * 100) : 0;
            const tFoPct = (totals.fow + totals.fol) > 0 ? Math.round(totals.fow / (totals.fow + totals.fol) * 100) : 0;
            rows.push([
                player.name, player.number, player.position || '',
                `SEASON TOTAL (${gamesPlayed} GP)`, '', '', '',
                totals.g, totals.a, tPts, totals.sh, tShPct + '%', totals.gb, totals.fow, totals.fol, tFoPct + '%', totals.to, totals.ta, totals.sv, totals.pen
            ]);
        }
    });

    // Add opponent stats section
    rows.push([]);
    rows.push(['--- OPPONENT STATS ---']);
    rows.push(['Opponent', '', '', 'Game', 'Date', 'Result', 'Score', 'Goals', '', '', 'Shots', '', 'Ground Balls', '', '', '', 'Turnovers', 'Caused Turnovers', 'Saves', '']);

    sortedGames.forEach(game => {
        if (!game.opponentStats) return;
        const os = game.opponentStats;
        const date = new Date(game.completedAt || game.datetime);
        const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        const result = game.homeScore > game.awayScore ? 'W' : game.homeScore < game.awayScore ? 'L' : 'T';
        const score = `${game.homeScore}-${game.awayScore}`;
        rows.push([
            game.opponent, '', '', `vs ${teamName}`, dateStr, result, score,
            getStatCount(os.goal), '', '', getStatCount(os.shot), '', getStatCount(os['ground-ball']),
            '', '', '', getStatCount(os.turnover), getStatCount(os['caused-turnover']),
            getStatCount(os.save), ''
        ]);
    });

    // Team stats section
    const gamesWithTS = sortedGames.filter(g => g.teamStats);
    if (gamesWithTS.length > 0) {
        rows.push([]);
        rows.push(['--- TEAM STATS ---']);
        rows.push(['Game', 'Date', 'Result', 'Score', 'Clears', 'Clr Failed', 'Clr%', 'Opp Clears', 'Opp Clr Failed', 'Opp Clr%', 'EMO Goals', 'EMO Opps', 'EMO%', 'PK Successful', 'PK Opps', 'PK%']);

        const tsTot = { cs: 0, cf: 0, ocs: 0, ocf: 0, emoG: 0, emoO: 0, pkO: 0, pkGA: 0 };

        sortedGames.forEach(game => {
            const ts = game.teamStats;
            if (!ts) return;
            const date = new Date(game.completedAt || game.datetime);
            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
            const result = game.homeScore > game.awayScore ? 'W' : game.homeScore < game.awayScore ? 'L' : 'T';
            const score = `${game.homeScore}-${game.awayScore}`;
            const clrT = ts.clearsSuccess + ts.clearsFail;
            const oClrT = ts.oppClearsSuccess + ts.oppClearsFail;
            const pkOk = ts.pkOpportunities - ts.pkGoalsAgainst;
            tsTot.cs += ts.clearsSuccess; tsTot.cf += ts.clearsFail;
            tsTot.ocs += ts.oppClearsSuccess; tsTot.ocf += ts.oppClearsFail;
            tsTot.emoG += ts.emoGoals; tsTot.emoO += ts.emoOpportunities;
            tsTot.pkO += ts.pkOpportunities; tsTot.pkGA += ts.pkGoalsAgainst;

            const p = (n, d) => d > 0 ? Math.round(n / d * 100) + '%' : '-';
            rows.push([
                `vs ${escapeHtml(game.opponent)}`, dateStr, result, score,
                ts.clearsSuccess, ts.clearsFail, p(ts.clearsSuccess, clrT),
                ts.oppClearsSuccess, ts.oppClearsFail, p(ts.oppClearsSuccess, oClrT),
                ts.emoGoals, ts.emoOpportunities, p(ts.emoGoals, ts.emoOpportunities),
                pkOk >= 0 ? pkOk : 0, ts.pkOpportunities, p(pkOk >= 0 ? pkOk : 0, ts.pkOpportunities)
            ]);
        });

        // Season totals
        const sClrT = tsTot.cs + tsTot.cf;
        const sOClrT = tsTot.ocs + tsTot.ocf;
        const sPkOk = tsTot.pkO - tsTot.pkGA;
        const p = (n, d) => d > 0 ? Math.round(n / d * 100) + '%' : '-';
        rows.push([
            'SEASON TOTAL', '', '', '',
            tsTot.cs, tsTot.cf, p(tsTot.cs, sClrT),
            tsTot.ocs, tsTot.ocf, p(tsTot.ocs, sOClrT),
            tsTot.emoG, tsTot.emoO, p(tsTot.emoG, tsTot.emoO),
            sPkOk >= 0 ? sPkOk : 0, tsTot.pkO, p(sPkOk >= 0 ? sPkOk : 0, tsTot.pkO)
        ]);
    }

    // Convert to CSV string
    const csvContent = rows.map(row =>
        row.map(cell => {
            const str = String(cell === undefined || cell === null ? '' : cell);
            return str.includes(',') || str.includes('"') || str.includes('\n')
                ? '"' + str.replace(/"/g, '""') + '"'
                : str;
        }).join(',')
    ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laxtracular-stats-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function importData() {
    document.getElementById('import-file').click();
}

function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);

            if (confirm('This will replace all current data. Continue?')) {
                if (data.roster) saveRoster(data.roster);
                if (data.games) saveGames(data.games);
                if (data.teamName) localStorage.setItem(STORAGE_KEYS.TEAM_NAME, data.teamName);

                alert('Data imported successfully!');
                location.reload();
            }
        } catch (err) {
            alert('Error importing data: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function clearAllData() {
    if (!confirm('Are you sure? This will delete ALL data permanently!')) return;
    if (!confirm('Really sure? This cannot be undone!')) return;

    localStorage.removeItem(STORAGE_KEYS.ROSTER);
    localStorage.removeItem(STORAGE_KEYS.GAMES);
    localStorage.removeItem(STORAGE_KEYS.TEAM_NAME);
    localStorage.removeItem(STORAGE_KEYS.CURRENT_GAME);
    if (typeof LaxSync !== 'undefined' && LaxSync.setGameInactive) LaxSync.setGameInactive();

    alert('All data cleared');
    location.reload();
}

// ===== PENALTY SYSTEM =====
function showPenaltyTimeSelector(playerId) {
    const roster = getRoster();
    const player = roster.find(p => p.id === playerId);
    if (!player) return;

    // Create overlay
    const overlay = createOverlay({ id: 'penalty-time-overlay', centered: true });
    overlay.style.flexDirection = 'column';

    overlay.innerHTML = `
        <h2 style="color: #FF1744; margin-bottom: 1rem; font-size: 1.8rem;">Penalty Time</h2>
        <h3 style="color: white; margin-bottom: 2rem;">#${escapeHtml(player.number)} ${escapeHtml(player.name)}</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; width: 100%; max-width: 400px;">
            <button class="penalty-time-btn" data-seconds="30">30 sec</button>
            <button class="penalty-time-btn" data-seconds="60">1 min</button>
            <button class="penalty-time-btn" data-seconds="90">1:30</button>
            <button class="penalty-time-btn" data-seconds="120">2 min</button>
            <button class="penalty-time-btn" data-seconds="150">2:30</button>
            <button class="penalty-time-btn" data-seconds="180">3 min</button>
        </div>
        <button id="cancel-penalty" class="btn-secondary" style="margin-top: 2rem; max-width: 400px;">Cancel</button>
    `;

    // Add click handlers
    overlay.querySelectorAll('.penalty-time-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const seconds = parseInt(btn.dataset.seconds);
            addPenalty(playerId, player.name, player.number, seconds);
            document.body.removeChild(overlay);
            clearStatSelection();
        });
    });

    document.getElementById('cancel-penalty').addEventListener('click', () => {
        document.body.removeChild(overlay);
        clearStatSelection();
    });
}

function addPenalty(playerId, playerName, playerNumber, duration) {
    // Record penalty stat (include duration for PIM tracking)
    const penTs = recordStatTimestamp();
    penTs.duration = duration;
    if (Array.isArray(currentGame.stats[playerId]['penalty'])) {
        currentGame.stats[playerId]['penalty'].push(penTs);
    } else {
        currentGame.stats[playerId]['penalty']++;
    }

    // Add to active penalties
    currentGame.activePenalties.push({
        playerId,
        playerName,
        playerNumber,
        duration,
        timeRemaining: duration
    });

    // Stop time: pause clock on penalty
    if (currentGame.clockType === 'stop' && currentGame.clockRunning) {
        pauseClock();
        currentGame.clockPausedForGoal = true; // reuse flag so next stat auto-resumes
    }

    saveCurrentGame();
    updatePenaltyDisplay();
}

function showOpponentPenaltyTimeSelector() {
    const opponentName = currentGame.trackingTeam === 'home'
        ? currentGame.opponent
        : (localStorage.getItem(STORAGE_KEYS.TEAM_NAME) || 'Opponent');

    const overlay = createOverlay({ id: 'penalty-time-overlay', centered: true });
    overlay.style.flexDirection = 'column';

    overlay.innerHTML = `
        <h2 style="color: #FF9100; margin-bottom: 1rem; font-size: 1.8rem;">Opponent Penalty</h2>
        <h3 style="color: white; margin-bottom: 2rem;">${opponentName}</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; width: 100%; max-width: 400px;">
            <button class="penalty-time-btn" data-seconds="30">30 sec</button>
            <button class="penalty-time-btn" data-seconds="60">1 min</button>
            <button class="penalty-time-btn" data-seconds="90">1:30</button>
            <button class="penalty-time-btn" data-seconds="120">2 min</button>
            <button class="penalty-time-btn" data-seconds="150">2:30</button>
            <button class="penalty-time-btn" data-seconds="180">3 min</button>
        </div>
        <button id="cancel-penalty" class="btn-secondary" style="margin-top: 2rem; max-width: 400px;">Cancel</button>
    `;

    overlay.querySelectorAll('.penalty-time-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const seconds = parseInt(btn.dataset.seconds);
            addOpponentPenalty(opponentName, seconds);
            overlay.remove();
        });
    });

    overlay.querySelector('#cancel-penalty').addEventListener('click', () => {
        overlay.remove();
    });

    clearStatSelection();
}

function addOpponentPenalty(opponentName, duration) {
    // Record penalty stat for opponent
    const penTs = recordStatTimestamp();
    penTs.duration = duration;
    if (Array.isArray(currentGame.opponentStats['penalty'])) {
        currentGame.opponentStats['penalty'].push(penTs);
    } else {
        currentGame.opponentStats['penalty']++;
    }

    // Add to active penalties with opponent flag
    if (!currentGame.activePenalties) currentGame.activePenalties = [];
    currentGame.activePenalties.push({
        playerName: opponentName,
        playerNumber: '',
        duration,
        timeRemaining: duration,
        isOpponent: true
    });

    // Stop time: pause clock on penalty
    if (currentGame.clockType === 'stop' && currentGame.clockRunning) {
        pauseClock();
        currentGame.clockPausedForGoal = true;
    }

    saveCurrentGame();
    updatePenaltyDisplay();
}

function updatePenalties() {
    if (!currentGame || !currentGame.activePenalties) return;

    // Decrement all active penalties
    currentGame.activePenalties = currentGame.activePenalties.filter(penalty => {
        penalty.timeRemaining--;
        return penalty.timeRemaining > 0;
    });

    updatePenaltyDisplay();
}

function updatePenaltyDisplay() {
    const container = document.getElementById('penalty-display');
    if (!container) return;

    if (!currentGame.activePenalties || currentGame.activePenalties.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = currentGame.activePenalties.map(penalty => {
        const minutes = Math.floor(penalty.timeRemaining / 60);
        const seconds = penalty.timeRemaining % 60;
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        const bg = penalty.isOpponent ? '#FF9100' : '#FF1744';
        const label = penalty.isOpponent
            ? penalty.playerName
            : `#${penalty.playerNumber} ${penalty.playerName}`;

        return `
            <div style="background: ${bg}; color: white; padding: 0.5rem 1rem; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <span style="font-weight: 700;">${label}</span>
                <span style="font-family: 'Courier New', monospace; font-size: 1.2rem; font-weight: 900;">${timeStr}</span>
            </div>
        `;
    }).join('');
}

// ===== VOICE INPUT SYSTEM =====
let voiceRecognition = null;
let voiceIsListening = false;
let voiceUndoStack = [];
let voiceUndoTimeout = null;
let voiceAssistTimeout = null;

function initVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    // Show mic button on game screen
    const micBtn = document.getElementById('voice-mic-btn');
    if (micBtn) micBtn.style.display = 'flex';

    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = false;
    voiceRecognition.maxAlternatives = 3;

    // Safari iOS workaround: interimResults can cause issues
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    voiceRecognition.interimResults = !isSafari;
    voiceRecognition.lang = 'en-US';

    voiceRecognition.onstart = () => {
        voiceIsListening = true;
        const micBtn = document.getElementById('voice-mic-btn');
        micBtn.classList.add('listening');
        micBtn.classList.remove('processing');
        showVoiceFeedback('Listening...', '');
    };

    voiceRecognition.onresult = (event) => {
        const micBtn = document.getElementById('voice-mic-btn');
        micBtn.classList.remove('listening');
        micBtn.classList.add('processing');

        // Try each alternative transcript (multi-stat chaining)
        let parsedList = [];
        for (let i = 0; i < event.results[0].length; i++) {
            const transcript = event.results[0][i].transcript;

            if (event.results[0].isFinal || !voiceRecognition.interimResults) {
                showVoiceFeedback('Processing...', transcript);
                parsedList = parseVoiceCommands(transcript);
                if (parsedList.length > 0) break;
            } else {
                // Interim result - just show transcript
                showVoiceFeedback('Listening...', transcript);
                return;
            }
        }

        if (parsedList.length === 1) {
            // Single command — use original flow (with feedback/prompts)
            executeVoiceCommand(parsedList[0]);
        } else if (parsedList.length > 1) {
            // Multi-stat chain — execute silently, aggregate feedback
            const descriptions = [];
            const chainResults = [];
            for (const parsed of parsedList) {
                const res = executeVoiceCommand(parsed, { silent: true });
                if (res) {
                    // res may be a string (clears, penalties) or structured object
                    const desc = typeof res === 'string' ? res : res.description;
                    descriptions.push(desc);
                    if (typeof res === 'object') chainResults.push(res);
                }
            }
            if (descriptions.length > 0) {
                showVoiceFeedback('Recorded!', descriptions.join(', '));

                // After chain, trigger shot chart for the last goal or shot
                const lastGoal = [...chainResults].reverse().find(r => r.stat === 'goal');
                const lastShot = [...chainResults].reverse().find(r => r.stat === 'shot');
                const shotChartTarget = lastGoal || lastShot;

                if (shotChartTarget) {
                    setTimeout(() => {
                        hideVoiceFeedback();
                        if (shotChartTarget.stat === 'goal') {
                            promptShotLocation(shotChartTarget.timestamp, () => {
                                promptForAssist(shotChartTarget.playerId, shotChartTarget.timestamp);
                            });
                        } else {
                            promptShotLocation(shotChartTarget.timestamp, () => {});
                        }
                    }, 800);
                } else {
                    setTimeout(hideVoiceFeedback, 2000);
                }
            }
        } else {
            const heard = event.results[0][0].transcript;
            showVoiceFeedback(
                'Could not understand command',
                `Heard: "${heard}" — Try: "goal 7" or "ground ball 14"`
            );
            setTimeout(hideVoiceFeedback, 3000);
        }
    };

    voiceRecognition.onerror = (event) => {
        voiceIsListening = false;
        const micBtn = document.getElementById('voice-mic-btn');
        micBtn.classList.remove('listening', 'processing');

        if (event.error === 'not-allowed') {
            showVoiceFeedback('Microphone blocked', 'Enable mic access in browser settings');
            setTimeout(hideVoiceFeedback, 4000);
        } else if (event.error === 'no-speech') {
            showVoiceFeedback('No speech detected', 'Tap mic to try again');
            setTimeout(hideVoiceFeedback, 2000);
        } else {
            hideVoiceFeedback();
        }
    };

    voiceRecognition.onend = () => {
        voiceIsListening = false;
        const micBtn = document.getElementById('voice-mic-btn');
        micBtn.classList.remove('listening', 'processing');
    };
}

function toggleVoiceInput() {
    if (!voiceRecognition) {
        initVoiceRecognition();
        if (!voiceRecognition) return;
    }

    if (voiceIsListening) {
        voiceRecognition.abort();
        voiceIsListening = false;
        hideVoiceFeedback();
    } else {
        try {
            voiceRecognition.start();
        } catch (e) {
            // Already started - ignore
        }
    }
}

function showVoiceFeedback(status, transcript) {
    const fb = document.getElementById('voice-feedback');
    const st = document.getElementById('voice-feedback-status');
    const tr = document.getElementById('voice-feedback-transcript');
    st.textContent = status;
    tr.textContent = transcript || '';
    fb.classList.remove('hidden');
    fb.classList.add('visible');
}

function hideVoiceFeedback() {
    const fb = document.getElementById('voice-feedback');
    fb.classList.remove('visible');
    fb.classList.add('hidden');
}

// ===== SPEECH PARSING =====

// Levenshtein distance between two strings
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = [];
    for (let i = 0; i <= m; i++) {
        dp[i] = [i];
        for (let j = 1; j <= n; j++) {
            if (i === 0) { dp[i][j] = j; continue; }
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

// Known speech-to-text mishearings → corrected word
const VOICE_ALIASES = {
    // Goal
    'call': 'goal', 'cole': 'goal', 'coal': 'goal', 'gold': 'goal',
    'gall': 'goal', 'gol': 'goal', 'cool': 'goal', 'gaul': 'goal',
    'gull': 'goal', 'colt': 'goal', 'go': 'goal', 'ghoul': 'goal',
    // Score
    'store': 'score', 'scored': 'score', 'core': 'score', 'scar': 'score',
    // Shot
    'shop': 'shot', 'shut': 'shot', 'shout': 'shot', 'short': 'shot',
    'showed': 'shot', 'shock': 'shot', 'shots': 'shot', 'shah': 'shot',
    // Save
    'safe': 'save', 'saved': 'save', 'shave': 'save', 'saves': 'save',
    'say': 'save', 'sage': 'save',
    // Assist
    'assess': 'assist', 'assessed': 'assist', 'insist': 'assist',
    'assists': 'assist', 'exist': 'assist', 'assisted': 'assist',
    // Penalty
    'penalize': 'penalty', 'penalties': 'penalty',
    // Faceoff helpers
    'won': 'win', 'want': 'win', 'when': 'win', 'juan': 'win',
    'loss': 'lost', 'laws': 'lost', 'los': 'lost',
    'phase': 'face', 'faith': 'face', 'bass': 'face',
    // Draw helpers (girls lacrosse)
    'draws': 'draw', 'drawed': 'draw', 'drone': 'draw',
    // Ground ball helpers
    'grown': 'ground', 'round': 'ground', 'crowned': 'ground',
    // Turnover / Takeaway
    'turnovers': 'turnover',
    'takeaways': 'takeaway',
    // Clear helpers
    'cleared': 'clear', 'clears': 'clear', 'claire': 'clear', 'kleer': 'clear',
    'failed': 'failed', 'fail': 'failed', 'fell': 'failed',
};

// Stat trigger phrases — multi-word first (higher priority)
const STAT_TRIGGERS = [
    { phrases: ['failed clear'], stat: 'failed-clear' },
    { phrases: ['opponent failed clear', 'opp failed clear'], stat: 'opp-failed-clear' },
    { phrases: ['opponent clear', 'opp clear'], stat: 'opp-clear' },
    { phrases: ['ground ball'], stat: 'ground-ball' },
    { phrases: ['draw control win', 'draw win', 'draw won', 'draw control won'], stat: 'faceoff-won' },
    { phrases: ['draw control lost', 'draw loss', 'draw lost', 'draw control loss'], stat: 'faceoff-lost' },
    { phrases: ['faceoff win', 'face off win', 'faceoff one', 'face off one'], stat: 'faceoff-won' },
    { phrases: ['faceoff lost', 'face off lost', 'faceoff loss', 'face off loss'], stat: 'faceoff-lost' },
    { phrases: ['takeaway', 'take away'], stat: 'caused-turnover' },
    { phrases: ['turnover', 'turn over'], stat: 'turnover' },
    { phrases: ['clear'], stat: 'clear' },
    { phrases: ['goal', 'score'], stat: 'goal' },
    { phrases: ['assist'], stat: 'assist' },
    { phrases: ['shot'], stat: 'shot' },
    { phrases: ['save'], stat: 'save' },
    { phrases: ['penalty'], stat: 'penalty' },
];

function convertSpokenNumbers(text) {
    const numberWords = {
        'zero': '0', 'two': '2', 'three': '3', 'four': '4',
        'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
        'ten': '10', 'eleven': '11', 'twelve': '12', 'thirteen': '13',
        'fourteen': '14', 'fifteen': '15', 'sixteen': '16', 'seventeen': '17',
        'eighteen': '18', 'nineteen': '19', 'twenty': '20',
        'twenty-one': '21', 'twenty one': '21', 'twenty-two': '22', 'twenty two': '22',
        'twenty-three': '23', 'twenty three': '23', 'twenty-four': '24', 'twenty four': '24',
        'twenty-five': '25', 'twenty five': '25', 'twenty-six': '26', 'twenty six': '26',
        'twenty-seven': '27', 'twenty seven': '27', 'twenty-eight': '28', 'twenty eight': '28',
        'twenty-nine': '29', 'twenty nine': '29', 'thirty': '30',
        'thirty-one': '31', 'thirty one': '31', 'thirty-two': '32', 'thirty two': '32',
        'thirty-three': '33', 'thirty three': '33', 'thirty-four': '34', 'thirty four': '34',
        'thirty-five': '35', 'thirty five': '35', 'forty': '40', 'fifty': '50',
        'sixty': '60', 'seventy': '70', 'eighty': '80', 'ninety': '90', 'hundred': '99'
    };
    // Note: 'one' intentionally excluded — too often a mishearing of 'won'

    let result = text;
    const sorted = Object.keys(numberWords).sort((a, b) => b.length - a.length);
    for (const word of sorted) {
        result = result.replace(new RegExp('\\b' + word + '\\b', 'gi'), numberWords[word]);
    }
    return result;
}

function parseVoiceCommand(rawText) {
    let text = rawText.toLowerCase().trim();

    // 1. Detect opponent keywords
    const isOpponent = /\b(opponent|them|their|other\s*team|opposing)\b/.test(text);

    // 2. Extract player number — prefer explicit digits, use LAST number
    //    (stat words come first in speech: "goal 7", not "7 goal")
    let allNumbers = text.match(/\b\d{1,3}\b/g);
    let playerNumber = allNumbers ? allNumbers[allNumbers.length - 1] : null;

    // 3. If no explicit digits, try converting spelled-out number words
    if (!playerNumber) {
        const converted = convertSpokenNumbers(text);
        allNumbers = converted.match(/\b\d{1,3}\b/g);
        playerNumber = allNumbers ? allNumbers[allNumbers.length - 1] : null;
    }

    // 4a. Handle "one" specially — excluded from convertSpokenNumbers because
    //     speech API often transcribes "won" as "one" (e.g. "faceoff won" → "faceoff one").
    //     Treat "one" as player #1 only when it's NOT the word right after "faceoff" or "draw".
    if (!playerNumber && /\bone\b/i.test(text) && !/face[\s-]?off\s+one\b/i.test(text) && !/draw\s+one\b/i.test(text)) {
        playerNumber = '1';
    }

    // 4. Strip non-stat text for matching: numbers, filler, opponent words, punctuation
    let statText = text.replace(/\b\d+\b/g, '');
    // If "one" was consumed as player number, strip it from stat text too
    if (playerNumber === '1') statText = statText.replace(/\bone\b/gi, '');
    statText = statText.replace(/\b(um|uh|like|the|a|an|so|okay|hey|please|number|player|for|is|it|on|and|at|of|opponent|them|their|other|opposing|team)\b/g, '');
    statText = statText.replace(/[^a-z\s]/g, '');
    statText = statText.replace(/\s+/g, ' ').trim();

    // 5. Apply word-level aliases (fixes known mishearings before fuzzy match)
    let words = statText.split(/\s+/).filter(w => w.length > 0);
    words = words.map(w => VOICE_ALIASES[w] || w);

    if (words.length === 0) return null;

    // 6. Fuzzy match against stat triggers using Levenshtein distance
    let bestStat = null;
    let bestDist = Infinity;

    for (let winSize = Math.min(3, words.length); winSize >= 1; winSize--) {
        for (let i = 0; i <= words.length - winSize; i++) {
            const candidate = words.slice(i, i + winSize).join(' ');

            for (const trigger of STAT_TRIGGERS) {
                for (const phrase of trigger.phrases) {
                    const dist = levenshtein(candidate, phrase);
                    // Threshold: ~35% of phrase length, minimum 2
                    const threshold = Math.max(2, Math.ceil(phrase.length * 0.35));

                    if (dist <= threshold && dist < bestDist) {
                        bestDist = dist;
                        bestStat = trigger.stat;
                    }
                }
            }
        }
    }

    if (!bestStat) return null;

    return {
        stat: bestStat,
        playerNumber: playerNumber,
        isOpponent: isOpponent || !playerNumber
    };
}

// ===== MULTI-STAT CHAINING =====
// Stat keywords used for boundary detection (no-conjunction splitting)
const STAT_KEYWORDS = new Set(
    STAT_TRIGGERS.flatMap(t => t.phrases.flatMap(p => [p.split(' ')[0]]))
);
// Also include common aliases that map to stat keywords
for (const [alias, canonical] of Object.entries(VOICE_ALIASES)) {
    if (STAT_KEYWORDS.has(canonical)) STAT_KEYWORDS.add(alias);
}

function parseVoiceCommands(rawText) {
    // 1. Split on commas, " and ", " then " (common chaining conjunctions)
    const segments = rawText
        .split(/\s*,\s*|\s+and\s+|\s+then\s+/i)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    if (segments.length > 1) {
        const results = segments.map(seg => parseVoiceCommand(seg)).filter(Boolean);
        if (results.length > 0) return results;
    }

    // 2. No conjunctions found (or conjunction split produced nothing).
    //    Try boundary detection: find consecutive [stat-word][number] pairs.
    const converted = convertSpokenNumbers(rawText.toLowerCase().trim());
    const words = converted.split(/\s+/);
    const boundaries = [];

    for (let i = 0; i < words.length; i++) {
        const aliased = VOICE_ALIASES[words[i]] || words[i];
        if (STAT_KEYWORDS.has(aliased) || STAT_KEYWORDS.has(words[i])) {
            boundaries.push(i);
        }
    }

    if (boundaries.length >= 2) {
        const boundarySegments = [];
        for (let b = 0; b < boundaries.length; b++) {
            const start = boundaries[b];
            const end = b + 1 < boundaries.length ? boundaries[b + 1] : words.length;
            boundarySegments.push(words.slice(start, end).join(' '));
        }
        // Use original rawText words for parsing (convertSpokenNumbers is called inside parseVoiceCommand)
        const rawWords = rawText.toLowerCase().trim().split(/\s+/);
        const rawSegments = [];
        for (let b = 0; b < boundaries.length; b++) {
            const start = boundaries[b];
            const end = b + 1 < boundaries.length ? boundaries[b + 1] : rawWords.length;
            rawSegments.push(rawWords.slice(start, end).join(' '));
        }
        const results = rawSegments.map(seg => parseVoiceCommand(seg)).filter(Boolean);
        if (results.length >= 2) return results;
    }

    // 3. Fall back to single command (current behavior)
    const single = parseVoiceCommand(rawText);
    return single ? [single] : [];
}

// ===== VOICE COMMAND EXECUTION =====
// Returns description string on success, null on failure.
// When silent=true, suppresses feedback/undo (caller handles it for multi-stat).
function executeVoiceCommand(parsed, { silent = false } = {}) {
    if (!currentGame) {
        if (!silent) {
            showVoiceFeedback('No active game', 'Start a game first');
            setTimeout(hideVoiceFeedback, 2000);
        }
        return null;
    }

    // Handle clear commands (team-level, no player needed)
    if (parsed.stat === 'clear') {
        recordClear('home', true);
        if (navigator.vibrate) navigator.vibrate(50);
        return 'Clear';
    }
    if (parsed.stat === 'failed-clear') {
        recordClear('home', false);
        if (navigator.vibrate) navigator.vibrate(50);
        return 'Failed Clear';
    }
    if (parsed.stat === 'opp-clear') {
        recordClear('away', true);
        if (navigator.vibrate) navigator.vibrate(50);
        return 'Opp Clear';
    }
    if (parsed.stat === 'opp-failed-clear') {
        recordClear('away', false);
        if (navigator.vibrate) navigator.vibrate(50);
        return 'Opp Failed Clear';
    }

    if (parsed.isOpponent && !parsed.playerNumber) {
        // Opponent penalty — show time selector
        if (parsed.stat === 'penalty') {
            showOpponentPenaltyTimeSelector();
            if (!silent) {
                showVoiceFeedback('Select penalty time', 'Opponent Penalty');
                setTimeout(hideVoiceFeedback, 1500);
            }
            return 'Opponent Penalty';
        }
        // Opponent stat
        const result = recordVoiceOpponentStat(parsed.stat);
        if (result) {
            if (!silent) {
                showVoiceFeedback('Recorded!', result.description);
            }
            pushUndo(result.undoActions, result.description);
            if (navigator.vibrate) navigator.vibrate(50);
            if (!silent) setTimeout(hideVoiceFeedback, 1500);
            return result.description;
        }
        return null;
    }

    if (parsed.playerNumber) {
        // Find player by number
        const roster = getRoster();
        const player = roster.find(p => p.number === parsed.playerNumber);

        if (!player) {
            if (!silent) {
                showVoiceFeedback('Player not found', `No player #${parsed.playerNumber} on roster`);
                setTimeout(hideVoiceFeedback, 3000);
            }
            return null;
        }

        // Handle penalty - open time selector
        if (parsed.stat === 'penalty') {
            if (!silent) {
                showVoiceFeedback('Select penalty time', `Penalty for #${escapeHtml(player.number)} ${escapeHtml(player.name)}`);
                setTimeout(() => {
                    hideVoiceFeedback();
                    showPenaltyTimeSelector(player.id);
                }, 800);
            }
            return `Penalty #${player.number}`;
        }

        const result = recordVoicePlayerStat(player.id, parsed.stat);
        if (result) {
            if (!silent) {
                showVoiceFeedback('Recorded!', result.description);
            }
            pushUndo(result.undoActions, result.description);
            if (navigator.vibrate) navigator.vibrate(50);

            if (!silent) {
                // Prompt for shot location, then assist for goals
                if (parsed.stat === 'goal') {
                    const goalTs = result.timestamp;
                    voiceAssistTimeout = setTimeout(() => {
                        hideVoiceFeedback();
                        promptShotLocation(goalTs, () => {
                            promptForAssist(player.id, goalTs);
                        });
                    }, 800);
                } else if (parsed.stat === 'shot') {
                    setTimeout(() => {
                        hideVoiceFeedback();
                        promptShotLocation(result.timestamp, () => {});
                    }, 800);
                } else {
                    setTimeout(hideVoiceFeedback, 1500);
                }
            }
            // Return structured info for chain handler
            return { description: result.description, stat: parsed.stat, timestamp: result.timestamp, playerId: player.id };
        }
        return null;
    }

    if (!silent) {
        showVoiceFeedback('Need a player number', 'Try: "goal 7" or "opponent ground ball"');
        setTimeout(hideVoiceFeedback, 3000);
    }
    return null;
}

// ===== VOICE STAT RECORDING (decoupled from tap DOM events) =====
function recordVoicePlayerStat(playerId, statType) {
    if (!currentGame || !currentGame.stats[playerId]) return null;
    resumeClockIfGoalPaused();

    const roster = getRoster();
    const player = roster.find(p => p.id === playerId);
    if (!player) return null;

    const statNames = getStatNames(getGameType(currentGame));

    const undoActions = [];
    const ts = recordStatTimestamp();

    // Record the stat
    if (Array.isArray(currentGame.stats[playerId][statType])) {
        currentGame.stats[playerId][statType].push(ts);
        undoActions.push({ type: 'playerStatPop', playerId, statType });
    } else {
        currentGame.stats[playerId][statType]++;
        undoActions.push({ type: 'playerStat', playerId, statType, delta: -1 });
    }

    // Goal: auto-increment score + shot
    if (statType === 'goal') {
        if (Array.isArray(currentGame.stats[playerId]['shot'])) {
            currentGame.stats[playerId]['shot'].push(ts);
            undoActions.push({ type: 'playerStatPop', playerId, statType: 'shot' });
        } else {
            currentGame.stats[playerId]['shot']++;
            undoActions.push({ type: 'playerStat', playerId, statType: 'shot', delta: -1 });
        }

        var scoreSide = currentGame.trackingTeam === 'home' ? 'home' : 'away';
        updateScore(scoreSide, 1);
        undoActions.push({ type: 'score', team: scoreSide, delta: -1 });
        if (currentGame.periodScores) {
            undoActions.push({ type: 'periodScore', team: scoreSide, period: currentGame.currentPeriod - 1, delta: -1 });
        }

        // Stop time: pause clock on goal
        if (currentGame.clockType === 'stop' && currentGame.clockRunning) {
            pauseClock();
            currentGame.clockPausedForGoal = true;
        }
    }

    saveCurrentGame();

    const description = `${statNames[statType] || statType} #${player.number}`;
    return { undoActions, description, timestamp: ts };
}

function recordVoiceOpponentStat(statType) {
    if (!currentGame) return null;
    resumeClockIfGoalPaused();

    const statNames = getStatNames(getGameType(currentGame));

    const undoActions = [];
    const ts = recordStatTimestamp();

    if (Array.isArray(currentGame.opponentStats[statType])) {
        currentGame.opponentStats[statType].push(ts);
        undoActions.push({ type: 'opponentStatPop', statType });
    } else {
        currentGame.opponentStats[statType]++;
        undoActions.push({ type: 'opponentStat', statType, delta: -1 });
    }

    if (statType === 'goal') {
        if (Array.isArray(currentGame.opponentStats['shot'])) {
            currentGame.opponentStats['shot'].push(ts);
            undoActions.push({ type: 'opponentStatPop', statType: 'shot' });
        } else {
            currentGame.opponentStats['shot']++;
            undoActions.push({ type: 'opponentStat', statType: 'shot', delta: -1 });
        }

        // Opponent's score depends on tracking team
        var opponentScoreSide = currentGame.trackingTeam === 'home' ? 'away' : 'home';
        updateScore(opponentScoreSide, 1);
        undoActions.push({ type: 'score', team: opponentScoreSide, delta: -1 });
        if (currentGame.periodScores) {
            undoActions.push({ type: 'periodScore', team: opponentScoreSide, period: currentGame.currentPeriod - 1, delta: -1 });
        }

        // Stop time: pause clock on goal
        if (currentGame.clockType === 'stop' && currentGame.clockRunning) {
            pauseClock();
            currentGame.clockPausedForGoal = true;
        }
    }

    saveCurrentGame();

    const opponentName = currentGame.trackingTeam === 'home' ? currentGame.opponent : (localStorage.getItem(STORAGE_KEYS.TEAM_NAME) || 'Opponent');
    const description = `${opponentName} ${statNames[statType] || statType}`;
    return { undoActions, description };
}

// ===== UNDO SYSTEM =====
function pushUndo(actions, description) {
    voiceUndoStack.push({ actions, description, timestamp: Date.now() });

    // Show toast
    const toast = document.getElementById('undo-toast');
    const toastText = document.getElementById('undo-toast-text');
    toastText.textContent = `Recorded: ${description}`;
    toast.classList.remove('hidden');
    toast.classList.add('visible');

    // Auto-dismiss after 5 seconds
    if (voiceUndoTimeout) clearTimeout(voiceUndoTimeout);
    voiceUndoTimeout = setTimeout(hideUndoToast, 5000);
}

function hideUndoToast() {
    const toast = document.getElementById('undo-toast');
    toast.classList.remove('visible');
    toast.classList.add('hidden');
    if (voiceUndoTimeout) {
        clearTimeout(voiceUndoTimeout);
        voiceUndoTimeout = null;
    }
}

function undoLastVoiceStat() {
    if (voiceUndoStack.length === 0) return;

    const last = voiceUndoStack.pop();

    // Cancel pending assist prompt if undoing a goal
    if (voiceAssistTimeout) {
        clearTimeout(voiceAssistTimeout);
        voiceAssistTimeout = null;
    }
    // Remove any existing assist overlay
    const assistOverlay = document.getElementById('assist-prompt-overlay');
    if (assistOverlay) assistOverlay.remove();

    // Reverse each action
    for (const action of last.actions) {
        if (action.type === 'playerStatPop') {
            if (Array.isArray(currentGame.stats[action.playerId][action.statType])) {
                currentGame.stats[action.playerId][action.statType].pop();
            }
        } else if (action.type === 'playerStat') {
            currentGame.stats[action.playerId][action.statType] += action.delta;
        } else if (action.type === 'opponentStatPop') {
            if (Array.isArray(currentGame.opponentStats[action.statType])) {
                currentGame.opponentStats[action.statType].pop();
            }
        } else if (action.type === 'opponentStat') {
            currentGame.opponentStats[action.statType] += action.delta;
        } else if (action.type === 'periodScore') {
            if (currentGame.periodScores) {
                currentGame.periodScores[action.team][action.period] = Math.max(0, currentGame.periodScores[action.team][action.period] + action.delta);
            }
        } else if (action.type === 'score') {
            if (action.team === 'home') {
                currentGame.homeScore += action.delta;
                document.getElementById('home-score').textContent = currentGame.homeScore;
            } else {
                currentGame.awayScore += action.delta;
                document.getElementById('away-score').textContent = currentGame.awayScore;
            }
        }
    }

    saveCurrentGame();
    hideUndoToast();

    showVoiceFeedback('Undone!', last.description);
    setTimeout(hideVoiceFeedback, 1500);
}

// Check for ongoing game on load (only after auth)
window.addEventListener('load', () => {
    window.firebaseReady.then(function (user) {
        if (!user) return; // Not signed in, skip game resume
        const saved = localStorage.getItem(STORAGE_KEYS.CURRENT_GAME);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && parsed.status === 'completed') {
                // Stale completed game — clean up silently (crash between saveGames and removeItem)
                console.log('[LaxKeeper] Cleaning up stale completed current_game:', parsed.id);
                localStorage.removeItem(STORAGE_KEYS.CURRENT_GAME);
                if (typeof LaxSync !== 'undefined' && LaxSync.setGameInactive) LaxSync.setGameInactive();
                return;
            }
            if (confirm('You have a game in progress. Continue?')) {
                currentGame = parsed;
                normalizeGameStats(currentGame);
                if (typeof LaxSync !== 'undefined' && LaxSync.setGameActive) LaxSync.setGameActive();
                loadGameScreen();
                showScreen('game-screen');
            }
        }
    });
});
