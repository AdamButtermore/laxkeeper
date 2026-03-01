// LaxKeeper - Lacrosse Stats Tracker
// Local Storage Keys
const STORAGE_KEYS = {
    ROSTER: 'laxkeeper_roster',
    GAMES: 'laxkeeper_games',
    TEAM_NAME: 'laxkeeper_team_name',
    CURRENT_GAME: 'laxkeeper_current_game'
};

// Global State
let currentGame = null;
let clockInterval = null;
let selectedStat = null;

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

    // Refresh data when showing certain screens
    if (screenId === 'roster-screen') loadRoster();
    if (screenId === 'schedule-screen') loadScheduledGames();
    if (screenId === 'games-screen') loadGamesList();
    if (screenId === 'history-screen') loadGameHistory();
    if (screenId === 'season-summary-screen') loadSeasonSummary();
    if (screenId === 'settings-screen') loadSettings();
}

// ===== ROSTER MANAGEMENT =====
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

    // Clear form
    document.getElementById('player-name').value = '';
    document.getElementById('player-number').value = '';
    document.getElementById('player-position').value = '';
}

function deletePlayer(playerId) {
    if (!confirm('Are you sure you want to delete this player?')) return;

    const roster = getRoster().filter(p => p.id !== playerId);
    saveRoster(roster);
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
        <div class="player-item">
            <div class="player-info">
                <span class="player-number">#${player.number}</span>
                <strong>${player.name}</strong>
                <div class="player-position">${player.position}</div>
            </div>
            <button class="delete-btn" onclick="deletePlayer('${player.id}')">Delete</button>
        </div>
    `).join('');
}

// ===== GAME SCHEDULING =====
function scheduleGame() {
    const opponent = document.getElementById('opponent-name').value.trim();
    const gameDate = document.getElementById('game-date').value;
    const gameTime = document.getElementById('game-time').value;
    const location = document.getElementById('game-location').value.trim();
    const format = document.querySelector('input[name="game-format"]:checked').value;
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
        format,
        periodDuration,
        status: 'scheduled',
        createdAt: new Date().toISOString()
    });

    saveGames(games);
    loadScheduledGames();

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
                <h4>vs ${game.opponent}</h4>
                <p>📅 ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                ${game.location ? `<p>📍 ${game.location}</p>` : ''}
                <p>⏱️ ${game.format === 'quarters' ? '4 Quarters' : '2 Halves'} × ${game.periodDuration} min</p>
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
                <h4>vs ${game.opponent}</h4>
                <p>📅 ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                ${game.location ? `<p>📍 ${game.location}</p>` : ''}
                <p>⏱️ ${game.format === 'quarters' ? '4 Quarters' : '2 Halves'} × ${game.periodDuration} min</p>
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
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.9); z-index: 1000; padding: 1rem; display: flex; align-items: center; justify-content: center;';

    const container = document.createElement('div');
    container.style.cssText = 'background: #1a1a1a; border-radius: 12px; padding: 2rem; max-width: 500px; width: 100%; border: 3px solid #0066FF;';

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
    document.body.appendChild(overlay);
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
            'faceoff-won': 0,
            'faceoff-lost': 0,
            'ground-ball': 0,
            'shot': 0,
            'goal': 0,
            'assist': 0,
            'turnover': 0,
            'caused-turnover': 0,
            'save': 0,
            'penalty': 0
        },
        activePenalties: [], // Array of {playerId, playerName, duration, timeRemaining}
        trackingTeam: trackingTeam, // 'home' or 'away'
        trackingTeamName: trackingTeamName,
        startedAt: new Date().toISOString()
    };

    // Initialize stats for each player
    roster.forEach(player => {
        currentGame.stats[player.id] = {
            'faceoff-won': 0,
            'faceoff-lost': 0,
            'ground-ball': 0,
            'shot': 0,
            'goal': 0,
            'assist': 0,
            'turnover': 0,
            'caused-turnover': 0,
            'save': 0,
            'penalty': 0
        };
    });

    // Save current game
    localStorage.setItem(STORAGE_KEYS.CURRENT_GAME, JSON.stringify(currentGame));

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

    // Update opponent button name
    const opponentName = currentGame.trackingTeam === 'home' ? currentGame.opponent : teamName;
    const opponentBtn = document.getElementById('opponent-team-name');
    if (opponentBtn) {
        opponentBtn.textContent = opponentName;
    }

    // Initialize voice recognition
    initVoiceRecognition();
}

function updatePeriodDisplay() {
    const periodLabel = currentGame.format === 'quarters' ? 'Q' : 'H';
    document.getElementById('period-display').textContent =
        `${periodLabel}${currentGame.currentPeriod}`;
}

function adjustScore(team, amount) {
    if (team === 'home') {
        currentGame.homeScore = Math.max(0, currentGame.homeScore + amount);
        document.getElementById('home-score').textContent = currentGame.homeScore;
    } else {
        currentGame.awayScore = Math.max(0, currentGame.awayScore + amount);
        document.getElementById('away-score').textContent = currentGame.awayScore;
    }
    saveCurrentGame();
}

// ===== GAME CLOCK =====
function toggleClock() {
    if (currentGame.clockRunning) {
        pauseClock();
    } else {
        startClock();
    }
}

function startClock() {
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

    const periodLabel = currentGame.format === 'quarters' ? 'Quarter' : 'Half';
    const nextNum = currentGame.currentPeriod + 1;
    if (!confirm(`Advance to ${periodLabel} ${nextNum}? This will reset the clock.`)) return;

    pauseClock();
    currentGame.currentPeriod++;
    currentGame.timeRemaining = currentGame.periodDuration * 60;
    updatePeriodDisplay();
    updateClock();
    saveCurrentGame();
}

// ===== STAT & PLAYER SELECTION =====
function loadPlayerButtons() {
    const roster = getRoster();
    const container = document.getElementById('player-buttons');

    container.innerHTML = roster.map(player => `
        <button class="player-btn" onclick="selectPlayerForStat('${player.id}')">
            <div class="player-btn-number">${player.number}</div>
            <div class="player-btn-name">${player.name.split(' ')[0]}</div>
        </button>
    `).join('');
}

function selectStat(statType) {
    selectedStat = statType;

    // Format stat name for display
    const statNames = {
        'faceoff-won': 'Faceoff Won',
        'faceoff-lost': 'Faceoff Lost',
        'ground-ball': 'Ground Ball',
        'shot': 'Shot',
        'goal': 'Goal',
        'assist': 'Assist',
        'turnover': 'Turnover',
        'caused-turnover': 'Takeaway',
        'save': 'Save',
        'penalty': 'Penalty'
    };

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

    const roster = getRoster();
    const player = roster.find(p => p.id === playerId);
    if (!player) return;

    // Special handling for penalty - show time selection
    if (selectedStat === 'penalty') {
        showPenaltyTimeSelector(playerId);
        return;
    }

    // Record the stat
    currentGame.stats[playerId][selectedStat]++;

    // Auto-increment score for goals and record shot
    if (selectedStat === 'goal') {
        // Also record a shot
        currentGame.stats[playerId]['shot']++;

        currentGame.homeScore++;
        document.getElementById('home-score').textContent = currentGame.homeScore;
        saveCurrentGame();

        // Show feedback
        const btn = event.target.closest('.player-btn');
        const originalBg = btn.style.background;
        btn.style.background = '#10b981';
        btn.style.color = 'white';

        setTimeout(() => {
            btn.style.background = originalBg;
            btn.style.color = '';

            // Prompt for assist
            promptForAssist(playerId);
        }, 500);
        return;
    }

    saveCurrentGame();

    // Show feedback
    const btn = event.target.closest('.player-btn');
    const originalBg = btn.style.background;
    btn.style.background = '#10b981';
    btn.style.color = 'white';

    setTimeout(() => {
        btn.style.background = originalBg;
        btn.style.color = '';

        // Return to stat selection
        clearStatSelection();
    }, 500);
}

function recordOpponentStat() {
    if (!selectedStat) return;

    // Record stat for opponent team
    currentGame.opponentStats[selectedStat]++;

    // Auto-increment opponent score for goals and record shot
    if (selectedStat === 'goal') {
        // Also record a shot
        currentGame.opponentStats['shot']++;

        // Determine which score to increment based on tracking team
        if (currentGame.trackingTeam === 'home') {
            currentGame.awayScore++;
            document.getElementById('away-score').textContent = currentGame.awayScore;
        } else {
            currentGame.homeScore++;
            document.getElementById('home-score').textContent = currentGame.homeScore;
        }
    }

    saveCurrentGame();

    // Show feedback
    const btn = event.target;
    const originalBg = btn.style.background;
    btn.style.background = '#10b981';

    setTimeout(() => {
        btn.style.background = originalBg;

        // Return to stat selection
        clearStatSelection();
    }, 500);
}

function promptForAssist(goalScorerId) {
    const roster = getRoster();

    // Clear stat selection UI
    clearStatSelection();

    // Create assist prompt overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.9); z-index: 1000; padding: 1rem; overflow-y: auto;';

    const container = document.createElement('div');
    container.style.cssText = 'background: #1a1a1a; border-radius: 12px; padding: 1.5rem; max-width: 600px; margin: 2rem auto; border: 3px solid #0066FF;';

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
            <div class="player-btn-number">${player.number}</div>
            <div class="player-btn-name">${player.name.split(' ')[0]}</div>
        `;
        btn.onclick = () => {
            currentGame.stats[player.id]['assist']++;
            saveCurrentGame();

            // Show confirmation
            btn.style.background = '#10b981';
            btn.style.color = 'white';

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
    document.body.appendChild(overlay);
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

    // Clear current game
    localStorage.removeItem(STORAGE_KEYS.CURRENT_GAME);
    currentGame = null;

    alert('Game saved!');
    showScreen('home-screen');
}

function toggleStatsView() {
    if (!currentGame) return;

    const roster = getRoster();
    const teamName = localStorage.getItem(STORAGE_KEYS.TEAM_NAME) || 'Home';
    const opponentName = currentGame.trackingTeam === 'home' ? currentGame.opponent : teamName;

    let statsHtml = '<div style="padding: 1rem; background: white; border-radius: 8px; color: #1e293b;">';
    statsHtml += '<h3 style="margin-bottom: 1rem; color: #1e293b;">Game Statistics</h3>';

    // Your team stats table
    statsHtml += `<h4 style="margin-top: 1rem; color: #2563eb;">${currentGame.trackingTeamName}</h4>`;

    statsHtml += `
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.85rem;">
                <thead>
                    <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                        <th style="padding: 0.5rem; text-align: left; font-weight: 700;">Player</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">G</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">A</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Pts</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Sh</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">GB</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">FOW</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">FOL</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">TO</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">TA</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Sv</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Pen</th>
                    </tr>
                </thead>
                <tbody>`;

    let hasPlayerStats = false;
    roster.forEach(player => {
        const stats = currentGame.stats[player.id];
        if (!stats) return;

        const goals = stats.goal || 0;
        const assists = stats.assist || 0;
        const points = goals + assists;
        const totalStats = Object.values(stats).reduce((a, b) => a + b, 0);

        if (totalStats === 0) return;

        hasPlayerStats = true;
        statsHtml += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 0.5rem; font-weight: 600;">#${player.number} ${player.name}</td>
                <td style="padding: 0.5rem; text-align: center;">${goals}</td>
                <td style="padding: 0.5rem; text-align: center;">${assists}</td>
                <td style="padding: 0.5rem; text-align: center; font-weight: 600;">${points}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats.shot || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats['ground-ball'] || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats['faceoff-won'] || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats['faceoff-lost'] || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats.turnover || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats['caused-turnover'] || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats.save || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats.penalty || 0}</td>
            </tr>`;
    });

    if (!hasPlayerStats) {
        statsHtml += `<tr><td colspan="12" style="padding: 1rem; text-align: center; color: #64748b; font-style: italic;">No stats recorded yet</td></tr>`;
    }

    statsHtml += `</tbody></table></div>`;

    // Opponent stats
    if (currentGame.opponentStats) {
        const oppStats = currentGame.opponentStats;
        const totalOppStats = Object.values(oppStats).reduce((a, b) => a + b, 0);

        statsHtml += `<h4 style="margin-top: 1.5rem; color: #f59e0b;">${opponentName}</h4>`;

        if (totalOppStats > 0) {
            const goals = oppStats.goal || 0;
            const assists = oppStats.assist || 0;
            statsHtml += `<div style="padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 4px; background: #fef3c7;">`;
            statsHtml += `<strong>Team Stats:</strong><br>`;
            statsHtml += `<div style="margin-top: 0.5rem; font-size: 0.9rem;">`;
            statsHtml += `Goals: ${goals} | Assists: ${assists} | Points: ${goals + assists} | `;
            statsHtml += `Shots: ${oppStats.shot || 0} | GB: ${oppStats['ground-ball'] || 0} | `;
            statsHtml += `FO Won: ${oppStats['faceoff-won'] || 0} | FO Lost: ${oppStats['faceoff-lost'] || 0} | `;
            statsHtml += `Turnovers: ${oppStats.turnover || 0} | Takeaways: ${oppStats['caused-turnover'] || 0} | `;
            statsHtml += `Saves: ${oppStats.save || 0} | Penalties: ${oppStats.penalty || 0}`;
            statsHtml += `</div></div>`;
        } else {
            statsHtml += `<p style="color: #64748b; font-style: italic;">No stats recorded yet</p>`;
        }
    }

    statsHtml += '</div>';

    const container = document.createElement('div');
    container.innerHTML = statsHtml;
    container.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 1000; overflow-y: auto; padding: 1rem;';
    container.onclick = (e) => {
        if (e.target === container) container.remove();
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'btn-secondary';
    closeBtn.onclick = () => container.remove();
    container.firstChild.appendChild(closeBtn);

    document.body.appendChild(container);
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
                <h4>vs ${game.opponent}</h4>
                <div class="history-score" style="color: ${resultColor}">
                    ${result} ${game.homeScore} - ${game.awayScore}
                </div>
                <p style="color: #64748b; font-size: 0.9rem;">
                    ${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </p>
                <button class="btn-secondary" onclick="viewGameStats('${game.id}')">View Stats</button>
                <button class="btn-secondary" onclick="editGameStats('${game.id}')" style="margin-top: 0.5rem;">Edit Stats</button>
                <button class="btn-danger" onclick="deleteGame('${game.id}')" style="margin-top: 0.5rem;">Delete Game</button>
            </div>
        `;
    }).join('');
}

function deleteGame(gameId) {
    const games = getGames();
    const game = games.find(g => g.id === gameId);
    if (!game) return;

    const label = `vs ${game.opponent} (${game.homeScore}-${game.awayScore})`;

    if (!confirm(`Delete the game ${label}?\n\nThis will permanently remove all stats from this game.`)) return;
    if (!confirm(`Are you REALLY sure?\n\nAll player stats for ${label} will be gone forever.`)) return;
    if (!confirm(`Last chance! Type-level serious.\n\nDeleting ${label} — this CANNOT be undone. Proceed?`)) return;

    const updated = games.filter(g => g.id !== gameId);
    saveGames(updated);
    loadGameHistory();
}

function editGameStats(gameId) {
    const games = getGames();
    const game = games.find(g => g.id === gameId);
    if (!game) return;

    const roster = getRoster();
    const statKeys = ['goal', 'assist', 'shot', 'ground-ball', 'faceoff-won', 'faceoff-lost', 'turnover', 'caused-turnover', 'save', 'penalty'];
    const statLabels = ['Goals', 'Assists', 'Shots', 'Ground Balls', 'Faceoff Wins', 'Faceoff Losses', 'Turnovers', 'Takeaways', 'Saves', 'Penalties'];

    let html = '<div style="padding: 1rem; background: white; border-radius: 8px; max-width: 900px; margin: auto; color: #1e293b;">';
    html += `<h3 style="color: #1e293b;">Edit Stats: vs ${game.opponent}</h3>`;

    // Editable score
    html += '<div style="display: flex; gap: 1rem; align-items: center; margin: 1rem 0;">';
    html += '<label style="font-weight: 700;">Home:</label>';
    html += `<input type="number" id="edit-home-score" value="${game.homeScore}" min="0" style="width: 60px; padding: 0.5rem; font-size: 1.2rem; font-weight: 700; text-align: center; border: 2px solid #cbd5e1; border-radius: 8px;">`;
    html += '<label style="font-weight: 700;">Away:</label>';
    html += `<input type="number" id="edit-away-score" value="${game.awayScore}" min="0" style="width: 60px; padding: 0.5rem; font-size: 1.2rem; font-weight: 700; text-align: center; border: 2px solid #cbd5e1; border-radius: 8px;">`;
    html += '</div>';

    // Editable stats table
    html += '<div style="overflow-x: auto;">';
    html += '<table style="width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.85rem;">';
    html += '<thead><tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">';
    html += '<th style="padding: 0.5rem; text-align: left; font-weight: 700;">Player</th>';
    statLabels.forEach(label => {
        html += `<th style="padding: 0.5rem; text-align: center; font-weight: 700;">${label}</th>`;
    });
    html += '</tr></thead><tbody>';

    roster.forEach(player => {
        const stats = game.stats[player.id];
        if (!stats) return;

        html += `<tr style="border-bottom: 1px solid #e2e8f0;">`;
        html += `<td style="padding: 0.5rem; font-weight: 600; white-space: nowrap;">#${player.number} ${player.name}</td>`;
        statKeys.forEach(key => {
            const val = stats[key] || 0;
            html += `<td style="padding: 0.25rem; text-align: center;">`;
            html += `<input type="number" data-player="${player.id}" data-stat="${key}" value="${val}" min="0" `;
            html += `style="width: 44px; padding: 0.3rem; text-align: center; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.85rem;">`;
            html += `</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    html += '</div>';

    // Create overlay
    const container = document.createElement('div');
    container.innerHTML = html;
    container.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.9); z-index: 1000; overflow-y: auto; padding: 2rem 1rem;';

    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Changes';
    saveBtn.className = 'btn-primary';
    saveBtn.style.marginTop = '1rem';
    saveBtn.onclick = () => {
        // Read score
        game.homeScore = parseInt(document.getElementById('edit-home-score').value) || 0;
        game.awayScore = parseInt(document.getElementById('edit-away-score').value) || 0;

        // Read all stat inputs
        container.querySelectorAll('input[data-player]').forEach(input => {
            const playerId = input.dataset.player;
            const statKey = input.dataset.stat;
            const val = parseInt(input.value) || 0;
            if (game.stats[playerId]) {
                game.stats[playerId][statKey] = val;
            }
        });

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

    document.body.appendChild(container);
}

function viewGameStats(gameId) {
    const games = getGames();
    const game = games.find(g => g.id === gameId);
    if (!game) return;

    const roster = getRoster();
    let statsHtml = '<div style="padding: 1rem; background: white; border-radius: 8px; max-width: 900px; margin: auto; color: #1e293b;">';
    statsHtml += `<h3 style="color: #1e293b;">vs ${game.opponent}</h3>`;
    statsHtml += `<p style="font-size: 1.5rem; font-weight: bold; margin: 1rem 0;">Score: ${game.homeScore} - ${game.awayScore}</p>`;

    const gameDate = game.completedAt ? new Date(game.completedAt) : null;
    if (gameDate) {
        statsHtml += `<p style="color: #64748b; font-size: 0.9rem; margin-bottom: 1rem;">${gameDate.toLocaleDateString()} at ${gameDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>`;
    }

    statsHtml += '<h4 style="margin-top: 1rem; color: #1e293b;">Player Statistics</h4>';

    statsHtml += `
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.85rem;">
                <thead>
                    <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                        <th style="padding: 0.5rem; text-align: left; font-weight: 700;">Player</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Goals</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Assists</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Points</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Shots</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Shot %</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Ground Balls</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Faceoff Wins</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Faceoff Losses</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">FO Win %</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Turnovers</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Takeaways</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Saves</th>
                        <th style="padding: 0.5rem; text-align: center; font-weight: 700;">Penalties</th>
                    </tr>
                </thead>
                <tbody>`;

    let hasStats = false;
    roster.forEach(player => {
        const stats = game.stats[player.id];
        if (!stats) return;

        const goals = stats.goal || 0;
        const assists = stats.assist || 0;
        const points = goals + assists;
        const totalStats = Object.values(stats).reduce((a, b) => a + b, 0);
        if (totalStats === 0) return;

        hasStats = true;
        statsHtml += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 0.5rem; font-weight: 600;">#${player.number} ${player.name}</td>
                <td style="padding: 0.5rem; text-align: center;">${goals}</td>
                <td style="padding: 0.5rem; text-align: center;">${assists}</td>
                <td style="padding: 0.5rem; text-align: center; font-weight: 600;">${points}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats.shot || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${(stats.shot || 0) > 0 ? Math.round(goals / (stats.shot || 1) * 100) + '%' : '-'}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats['ground-ball'] || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats['faceoff-won'] || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats['faceoff-lost'] || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${((stats['faceoff-won'] || 0) + (stats['faceoff-lost'] || 0)) > 0 ? Math.round((stats['faceoff-won'] || 0) / ((stats['faceoff-won'] || 0) + (stats['faceoff-lost'] || 0)) * 100) + '%' : '-'}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats.turnover || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats['caused-turnover'] || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats.save || 0}</td>
                <td style="padding: 0.5rem; text-align: center;">${stats.penalty || 0}</td>
            </tr>`;
    });

    if (!hasStats) {
        statsHtml += `<tr><td colspan="14" style="padding: 1rem; text-align: center; color: #64748b; font-style: italic;">No stats recorded</td></tr>`;
    }

    statsHtml += `</tbody></table></div>`;
    statsHtml += '</div>';

    const container = document.createElement('div');
    container.innerHTML = statsHtml;
    container.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.9); z-index: 1000; overflow-y: auto; padding: 2rem 1rem;';
    container.onclick = (e) => {
        if (e.target === container) container.remove();
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'btn-secondary';
    closeBtn.style.marginTop = '1rem';
    closeBtn.onclick = () => container.remove();
    container.firstChild.appendChild(closeBtn);

    document.body.appendChild(container);
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

    // Calculate per-player season stats
    const seasonStats = {};
    roster.forEach(player => {
        seasonStats[player.id] = {
            player: player,
            gamesPlayed: 0,
            totalGoals: 0,
            totalAssists: 0,
            totalPoints: 0,
            totalShots: 0,
            totalGroundBalls: 0,
            totalFaceoffWon: 0,
            totalFaceoffLost: 0,
            totalTurnovers: 0,
            totalCausedTurnovers: 0,
            totalSaves: 0,
            totalPenalties: 0
        };
    });

    // Aggregate stats from all games
    games.forEach(game => {
        if (!game.stats) return;

        Object.keys(game.stats).forEach(playerId => {
            if (!seasonStats[playerId]) return;

            const playerGameStats = game.stats[playerId];
            const playerSeasonStats = seasonStats[playerId];

            // Check if player has any stats in this game
            const totalGameStats = Object.values(playerGameStats).reduce((a, b) => a + b, 0);
            if (totalGameStats > 0) {
                playerSeasonStats.gamesPlayed++;
            }

            playerSeasonStats.totalGoals += playerGameStats.goal || 0;
            playerSeasonStats.totalAssists += playerGameStats.assist || 0;
            playerSeasonStats.totalShots += playerGameStats.shot || 0;
            playerSeasonStats.totalGroundBalls += playerGameStats['ground-ball'] || 0;
            playerSeasonStats.totalFaceoffWon += playerGameStats['faceoff-won'] || 0;
            playerSeasonStats.totalFaceoffLost += playerGameStats['faceoff-lost'] || 0;
            playerSeasonStats.totalTurnovers += playerGameStats.turnover || 0;
            playerSeasonStats.totalCausedTurnovers += playerGameStats['caused-turnover'] || 0;
            playerSeasonStats.totalSaves += playerGameStats.save || 0;
            playerSeasonStats.totalPenalties += playerGameStats.penalty || 0;
        });
    });

    // Calculate totals and averages
    Object.values(seasonStats).forEach(stats => {
        stats.totalPoints = stats.totalGoals + stats.totalAssists;
    });

    // Sort by total points (goals + assists)
    const sortedPlayers = Object.values(seasonStats)
        .filter(s => s.gamesPlayed > 0)
        .sort((a, b) => b.totalPoints - a.totalPoints);

    let html = '<div style="padding: 0.5rem;">';

    // Season Overview
    html += `<div style="background: var(--card-bg); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; border: 2px solid var(--primary-color);">`;
    html += `<h3 style="margin-bottom: 0.5rem; color: var(--text-primary);">Season Overview</h3>`;
    html += `<p style="color: var(--text-secondary); font-size: 1rem;">Total Games: <strong>${games.length}</strong></p>`;
    html += `</div>`;

    // Individual Player Stats - Full Table
    html += `<div style="background: var(--card-bg); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; border: 2px solid var(--primary-color);">`;
    html += `<h3 style="margin-bottom: 1rem; color: var(--text-primary);">Individual Player Stats</h3>`;

    html += `
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.75rem;">
                <thead>
                    <tr style="background: var(--primary-color); color: white; border-bottom: 3px solid var(--primary-color);">
                        <th style="padding: 0.6rem 0.4rem; text-align: left; font-weight: 700; position: sticky; left: 0; background: var(--primary-color);">Player</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">GP</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">G</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">A</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">Pts</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">Sh</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">Sh%</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">GB</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">FOW</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">FOL</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">FO%</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">TO</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">TA</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">Sv</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">Pen</th>
                    </tr>
                </thead>
                <tbody>`;

    sortedPlayers.forEach(stats => {
        html += `
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 0.6rem 0.4rem; font-weight: 600; color: var(--text-primary); position: sticky; left: 0; background: var(--card-bg);">#${stats.player.number} ${stats.player.name}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${stats.gamesPlayed}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${stats.totalGoals}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${stats.totalAssists}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700; color: var(--success-color);">${stats.totalPoints}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${stats.totalShots}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${stats.totalShots > 0 ? Math.round(stats.totalGoals / stats.totalShots * 100) + '%' : '-'}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${stats.totalGroundBalls}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${stats.totalFaceoffWon}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${stats.totalFaceoffLost}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${(stats.totalFaceoffWon + stats.totalFaceoffLost) > 0 ? Math.round(stats.totalFaceoffWon / (stats.totalFaceoffWon + stats.totalFaceoffLost) * 100) + '%' : '-'}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${stats.totalTurnovers}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${stats.totalCausedTurnovers}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${stats.totalSaves}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${stats.totalPenalties}</td>
            </tr>`;
    });

    html += `</tbody></table></div></div>`;

    // Per-Game Averages Table
    html += `<div style="background: var(--card-bg); padding: 1rem; border-radius: 8px; border: 2px solid var(--success-color);">`;
    html += `<h3 style="margin-bottom: 1rem; color: var(--text-primary);">Per-Game Averages</h3>`;

    html += `
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.75rem;">
                <thead>
                    <tr style="background: var(--success-color); color: white; border-bottom: 3px solid var(--success-color);">
                        <th style="padding: 0.6rem 0.4rem; text-align: left; font-weight: 700; position: sticky; left: 0; background: var(--success-color);">Player</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">GP</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">G/G</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">A/G</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">Pts/G</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">GB/G</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">Sh/G</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">Sh%</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">FO%</th>
                        <th style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700;">Sv/G</th>
                    </tr>
                </thead>
                <tbody>`;

    sortedPlayers.forEach(stats => {
        const gp = stats.gamesPlayed;
        const goalsPerGame = gp > 0 ? (stats.totalGoals / gp).toFixed(1) : '0.0';
        const assistsPerGame = gp > 0 ? (stats.totalAssists / gp).toFixed(1) : '0.0';
        const pointsPerGame = gp > 0 ? (stats.totalPoints / gp).toFixed(1) : '0.0';
        const gbPerGame = gp > 0 ? (stats.totalGroundBalls / gp).toFixed(1) : '0.0';
        const shotsPerGame = gp > 0 ? (stats.totalShots / gp).toFixed(1) : '0.0';
        const savesPerGame = gp > 0 ? (stats.totalSaves / gp).toFixed(1) : '0.0';

        html += `
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 0.6rem 0.4rem; font-weight: 600; color: var(--text-primary); position: sticky; left: 0; background: var(--card-bg);">#${stats.player.number} ${stats.player.name}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${gp}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${goalsPerGame}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${assistsPerGame}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; font-weight: 700; color: var(--success-color);">${pointsPerGame}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${gbPerGame}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${shotsPerGame}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${stats.totalShots > 0 ? Math.round(stats.totalGoals / stats.totalShots * 100) + '%' : '-'}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${(stats.totalFaceoffWon + stats.totalFaceoffLost) > 0 ? Math.round(stats.totalFaceoffWon / (stats.totalFaceoffWon + stats.totalFaceoffLost) * 100) + '%' : '-'}</td>
                <td style="padding: 0.6rem 0.4rem; text-align: center; color: var(--text-primary);">${savesPerGame}</td>
            </tr>`;
    });

    html += `</tbody></table></div></div>`;
    html += '</div>';

    display.innerHTML = html;
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

    alert('All data cleared');
    location.reload();
}

// ===== PENALTY SYSTEM =====
function showPenaltyTimeSelector(playerId) {
    const roster = getRoster();
    const player = roster.find(p => p.id === playerId);
    if (!player) return;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.95);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        padding: 2rem;
    `;

    overlay.innerHTML = `
        <h2 style="color: #FF1744; margin-bottom: 1rem; font-size: 1.8rem;">Penalty Time</h2>
        <h3 style="color: white; margin-bottom: 2rem;">#${player.number} ${player.name}</h3>
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

    document.body.appendChild(overlay);

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
    // Record penalty stat
    currentGame.stats[playerId]['penalty']++;

    // Add to active penalties
    currentGame.activePenalties.push({
        playerId,
        playerName,
        playerNumber,
        duration,
        timeRemaining: duration
    });

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

        return `
            <div style="background: #FF1744; color: white; padding: 0.5rem 1rem; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <span style="font-weight: 700;">#${penalty.playerNumber} ${penalty.playerName}</span>
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

        // Try each alternative transcript
        let parsed = null;
        for (let i = 0; i < event.results[0].length; i++) {
            const transcript = event.results[0][i].transcript;

            if (event.results[0].isFinal || !voiceRecognition.interimResults) {
                showVoiceFeedback('Processing...', transcript);
                parsed = parseVoiceCommand(transcript);
                if (parsed) break;
            } else {
                // Interim result - just show transcript
                showVoiceFeedback('Listening...', transcript);
                return;
            }
        }

        if (parsed) {
            executeVoiceCommand(parsed);
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
    'won': 'win', 'one': 'win', 'want': 'win', 'when': 'win', 'juan': 'win',
    'loss': 'lost', 'laws': 'lost', 'los': 'lost',
    'phase': 'face', 'faith': 'face', 'bass': 'face',
    // Ground ball helpers
    'grown': 'ground', 'round': 'ground', 'crowned': 'ground',
    // Turnover / Takeaway
    'turnovers': 'turnover',
    'takeaways': 'takeaway',
};

// Stat trigger phrases — multi-word first (higher priority)
const STAT_TRIGGERS = [
    { phrases: ['ground ball'], stat: 'ground-ball' },
    { phrases: ['faceoff win', 'face off win'], stat: 'faceoff-won' },
    { phrases: ['faceoff lost', 'face off lost', 'faceoff loss', 'face off loss'], stat: 'faceoff-lost' },
    { phrases: ['takeaway', 'take away'], stat: 'caused-turnover' },
    { phrases: ['turnover', 'turn over'], stat: 'turnover' },
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

    // 4. Strip non-stat text for matching: numbers, filler, opponent words, punctuation
    let statText = text.replace(/\b\d+\b/g, '');
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

// ===== VOICE COMMAND EXECUTION =====
function executeVoiceCommand(parsed) {
    if (!currentGame) {
        showVoiceFeedback('No active game', 'Start a game first');
        setTimeout(hideVoiceFeedback, 2000);
        return;
    }

    if (parsed.isOpponent && !parsed.playerNumber) {
        // Opponent stat
        const result = recordVoiceOpponentStat(parsed.stat);
        if (result) {
            showVoiceFeedback('Recorded!', result.description);
            pushUndo(result.undoActions, result.description);
        }
        setTimeout(hideVoiceFeedback, 1500);
        return;
    }

    if (parsed.playerNumber) {
        // Find player by number
        const roster = getRoster();
        const player = roster.find(p => p.number === parsed.playerNumber);

        if (!player) {
            showVoiceFeedback('Player not found', `No player #${parsed.playerNumber} on roster`);
            setTimeout(hideVoiceFeedback, 3000);
            return;
        }

        // Handle penalty - open time selector
        if (parsed.stat === 'penalty') {
            showVoiceFeedback('Select penalty time', `Penalty for #${player.number} ${player.name}`);
            setTimeout(() => {
                hideVoiceFeedback();
                showPenaltyTimeSelector(player.id);
            }, 800);
            return;
        }

        const result = recordVoicePlayerStat(player.id, parsed.stat);
        if (result) {
            showVoiceFeedback('Recorded!', result.description);
            pushUndo(result.undoActions, result.description);

            // Prompt for assist after goal (delayed)
            if (parsed.stat === 'goal') {
                voiceAssistTimeout = setTimeout(() => {
                    hideVoiceFeedback();
                    promptForAssist(player.id);
                }, 800);
            } else {
                setTimeout(hideVoiceFeedback, 1500);
            }
        }
        return;
    }

    showVoiceFeedback('Need a player number', 'Try: "goal 7" or "opponent ground ball"');
    setTimeout(hideVoiceFeedback, 3000);
}

// ===== VOICE STAT RECORDING (decoupled from tap DOM events) =====
function recordVoicePlayerStat(playerId, statType) {
    if (!currentGame || !currentGame.stats[playerId]) return null;

    const roster = getRoster();
    const player = roster.find(p => p.id === playerId);
    if (!player) return null;

    const statNames = {
        'faceoff-won': 'Faceoff Won', 'faceoff-lost': 'Faceoff Lost',
        'ground-ball': 'Ground Ball', 'shot': 'Shot', 'goal': 'Goal',
        'assist': 'Assist', 'turnover': 'Turnover',
        'caused-turnover': 'Takeaway', 'save': 'Save'
    };

    const undoActions = [];

    // Record the stat
    currentGame.stats[playerId][statType]++;
    undoActions.push({ type: 'playerStat', playerId, statType, delta: -1 });

    // Goal: auto-increment score + shot
    if (statType === 'goal') {
        currentGame.stats[playerId]['shot']++;
        undoActions.push({ type: 'playerStat', playerId, statType: 'shot', delta: -1 });

        if (currentGame.trackingTeam === 'home') {
            currentGame.homeScore++;
            document.getElementById('home-score').textContent = currentGame.homeScore;
            undoActions.push({ type: 'score', team: 'home', delta: -1 });
        } else {
            currentGame.awayScore++;
            document.getElementById('away-score').textContent = currentGame.awayScore;
            undoActions.push({ type: 'score', team: 'away', delta: -1 });
        }
    }

    saveCurrentGame();

    const description = `${statNames[statType] || statType} #${player.number}`;
    return { undoActions, description };
}

function recordVoiceOpponentStat(statType) {
    if (!currentGame) return null;

    const statNames = {
        'faceoff-won': 'Faceoff Won', 'faceoff-lost': 'Faceoff Lost',
        'ground-ball': 'Ground Ball', 'shot': 'Shot', 'goal': 'Goal',
        'assist': 'Assist', 'turnover': 'Turnover',
        'caused-turnover': 'Takeaway', 'save': 'Save'
    };

    const undoActions = [];

    currentGame.opponentStats[statType]++;
    undoActions.push({ type: 'opponentStat', statType, delta: -1 });

    if (statType === 'goal') {
        currentGame.opponentStats['shot']++;
        undoActions.push({ type: 'opponentStat', statType: 'shot', delta: -1 });

        // Opponent's score depends on tracking team
        if (currentGame.trackingTeam === 'home') {
            currentGame.awayScore++;
            document.getElementById('away-score').textContent = currentGame.awayScore;
            undoActions.push({ type: 'score', team: 'away', delta: -1 });
        } else {
            currentGame.homeScore++;
            document.getElementById('home-score').textContent = currentGame.homeScore;
            undoActions.push({ type: 'score', team: 'home', delta: -1 });
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
    const overlays = document.querySelectorAll('div[style*="z-index: 1000"]');
    overlays.forEach(o => {
        if (o.textContent.includes('Was there an assist?')) o.remove();
    });

    // Reverse each action
    for (const action of last.actions) {
        if (action.type === 'playerStat') {
            currentGame.stats[action.playerId][action.statType] += action.delta;
        } else if (action.type === 'opponentStat') {
            currentGame.opponentStats[action.statType] += action.delta;
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
            if (confirm('You have a game in progress. Continue?')) {
                currentGame = JSON.parse(saved);
                loadGameScreen();
                showScreen('game-screen');
            }
        }
    });
});
