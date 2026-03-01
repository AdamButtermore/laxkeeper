# LaxKeeper - Lacrosse Stats Tracker

A mobile-friendly web app for tracking lacrosse game stats in real-time. Built for coaches, parents, and team managers who want a simple way to record stats on the sideline and review them later.

## Features

- **Google Sign-In** — sign in with your Google account to persist your data across devices
- **Multi-Team Support** — belong to multiple teams and switch between them instantly
- **Live Game Tracking** — real-time scoreboard, game clock, and period management
- **Full Stat Entry** — faceoffs, ground balls, shots, goals, assists, turnovers, takeaways, saves, and penalties
- **Voice Input** — hands-free stat recording via microphone (on supported browsers)
- **Roster Management** — add players with name, number, and position
- **Game Scheduling** — schedule upcoming games with opponent, date/time, location, and format
- **Season Summary** — aggregated player stats and per-game averages across all completed games
- **Cloud Sync** — multiple devices see the same roster and game data in real-time
- **Export/Import** — backup and restore all data as JSON
- **Edit Stats** — correct any stat or score on completed games after the fact
- **Penalty Tracking** — timed penalties that count down with the game clock
- **Works Offline** — all data is stored locally; no internet required after initial load

## Getting Started

### Host It (Recommended)

1. Push this repo to GitHub
2. Go to **Settings > Pages** and enable GitHub Pages from the `master` branch
3. Visit `https://<your-username>.github.io/laxkeeper` on your phone
4. Tap **Share > Add to Home Screen** for an app-like experience

### Or Just Open It

Open `index.html` directly in any browser. Everything works locally — no server needed.

### Firebase Setup

Before the app works, you need a Firebase project with:

1. **Authentication > Sign-in method > Google** enabled
2. **Authentication > Settings > Authorized domains** — add your GitHub Pages domain
3. **Firestore Database** created with security rules allowing authenticated users to read/write their own data and team data

## How to Use

### 1. Sign In

When you first open the app, you'll see a Google sign-in screen. Tap **Sign in with Google** to authenticate. Your account is used to persist your teams and data across devices.

### 2. Set Your Team Name

Go to **Settings** (gear icon on the home screen) and enter your team name. This name appears on the scoreboard during games.

### 3. Build Your Roster

1. Tap **Manage Roster** from the home screen
2. Enter a player's **name**, **jersey number**, and **position** (Attack, Midfield, Defense, or Goalie)
3. Tap **Add Player**
4. Repeat for each player — the roster is saved automatically
5. To remove a player, tap the red **Delete** button next to their name

### 4. Schedule a Game

1. Tap **Schedule Game**
2. Fill in the **opponent name**, **date**, **time**, and **location**
3. Choose the game format:
   - **Quarters** — 4 periods (standard regulation)
   - **Halves** — 2 periods (common for youth/tournament games)
4. Set the **period duration** in minutes (default: 12)
5. Tap **Schedule Game** — it appears in the list below

### 5. Start a Live Game

1. Tap **Start Game** from the home screen
2. Select a scheduled game from the list
3. Choose which team you are tracking stats for (your team or the opponent)
4. You're now on the live game screen with:
   - **Scoreboard** — home and away scores with +/- buttons
   - **Game Clock** — tap START/PAUSE on the left side, or use the center controls
   - **Period Display** — shows current quarter/half
   - **Voice Input** — tap the microphone button on the right (if supported by your browser)

### 6. Record Stats

1. Tap a **stat button** (Goal, Shot, Ground Ball, etc.)
2. Tap the **player** who earned the stat — or tap the **Opponent Team** button if it was the other team
3. For **goals**: the score auto-increments and you're prompted to select an assist (or "No Assist")
4. For **penalties**: after selecting the player, choose the penalty duration (30s, 1min, 2min, or 3min) — the penalty timer counts down with the game clock
5. Tap **Back to Stats** to return to the stat selection

### 7. Use Voice Input

If your browser supports speech recognition (Chrome, Edge):

1. Tap the **VOICE** button on the right side of the scoreboard
2. Speak naturally: *"Number 12 goal"*, *"Ground ball 7"*, *"Face off win 22"*
3. The app parses your speech and records the stat
4. An **UNDO** toast appears briefly if you need to reverse the last voice entry

### 8. Manage the Clock

- **Start/Pause** — large button on the left side of the scoreboard, or center controls
- **Reset** — resets the clock to the beginning of the current period (with confirmation)
- **Next Period** — advances to the next quarter/half (with confirmation to prevent accidental advances)
- When the clock hits 0:00, it pauses automatically and alerts you

### 9. End a Game

Scroll to the bottom of the live game screen and tap **End Game**. You'll be asked to confirm. The game is saved to history with all stats.

### 10. Review Game History

1. Tap **Game History** from the home screen
2. Each completed game shows the opponent, score, result (W/L/T), and date
3. Tap **View Stats** to see the full player stat table for that game
4. Tap **Edit Stats** to correct any stats or the score after the fact
5. Tap **Delete Game** to permanently remove a game (requires 3 confirmations — this cannot be undone)

### 11. View Season Summary

Tap **Season Summary** for:
- **Season overview** — total games played
- **Individual player stats** — cumulative totals for every stat category
- **Per-game averages** — goals/game, assists/game, points/game, etc.

Players are sorted by total points (goals + assists).

## Teams & Cloud Sync

LaxKeeper supports multiple teams and real-time cloud sync via Firebase. You can belong to several teams at once and switch between them.

### How It Works

- Every user signs in with **Google** — your identity persists across devices
- Each team gets a unique **6-character team code**
- You can belong to **multiple teams** simultaneously
- The **active team** determines which roster, games, and settings you see
- Changes sync in real-time — update a stat on one phone, it appears on the other within seconds
- The **current live game state** is device-local only (not synced) to avoid conflicts during active stat entry

### Create a Team

1. Go to **Settings > My Teams**
2. Tap **Create Team**
3. A 6-character code is generated (e.g., `K4MN7X`)
4. Your local data is pushed to the cloud
5. Share this code with anyone who should have access

### Join a Team

1. Go to **Settings > My Teams**
2. Enter the **6-character team code** you received
3. Tap **Join Team**
4. You'll be asked to confirm — joining switches you to the team's cloud data
5. The team is added to your team list

### Switch Teams

Your team list in Settings shows all teams you belong to. The active team is highlighted in green. Tap any team to switch — the roster, games, and settings will update to that team's data. The active team name is also shown on the home screen header.

### Leave a Team

1. Go to **Settings > My Teams**
2. Tap **Leave** next to the team you want to leave
3. Your data stays on the device but stops syncing
4. If you leave the active team, you'll be switched to another team (or shown an empty state if no teams remain)

### Copy / Share a Team Code

Tap **Copy** next to any team in your team list to copy its code to your clipboard. Share via text, email, etc.

### Account

Your Google account info (name, email, avatar) is shown in **Settings > Account**. Tap **Sign Out** to return to the sign-in screen. Signing back in restores all your teams and data.

### Sync Details

| What Syncs | What Doesn't |
|---|---|
| Roster (players) | Current live game state |
| Completed games & stats | Clock position during a game |
| Team name / settings | Device-specific preferences |
| Team membership list | |

## Data Backup

Your data is stored locally in the browser's `localStorage`. To back up:

1. Go to **Settings**
2. Tap **Export Data** — downloads a `.json` file with your full roster, games, and settings
3. To restore, tap **Import Data** and select a previously exported file
4. Importing **replaces** all current data

### Danger Zone

In Settings, the **Clear All Data** button wipes everything (roster, games, settings). It requires two confirmations.

## Tips

- **Add to Home Screen** — on iPhone: tap Share > Add to Home Screen. On Android: tap the browser menu > Add to Home Screen. This gives you an app-like icon and full-screen experience.
- **Landscape Mode** — the scoreboard and stat buttons work well in landscape orientation on phones
- **Backup After Games** — export your data after each game day as a safety net
- **Multiple Scorekeepers** — use Cloud Sync so two people can enter stats simultaneously from different devices
- **Battery** — keep your phone charged during games; the clock runs in JavaScript and will pause if the screen locks

## Browser Compatibility

| Browser | Status |
|---|---|
| Chrome (Android) | Full support including voice input |
| Safari (iOS) | Full support (voice input may be limited) |
| Edge | Full support including voice input |
| Firefox | Full support (no voice input) |

## Files

| File | Description |
|---|---|
| `index.html` | App structure and screens |
| `styles.css` | Mobile-first dark theme styling |
| `app.js` | Core app logic — roster, games, stats, clock, voice, auth UI |
| `firebase-config.js` | Firebase project config, Google auth, user profile sync |
| `firebase-sync.js` | Cloud sync layer — multi-team management, Firestore read/write, real-time listeners |

## Tech Stack

- **HTML / CSS / JavaScript** — no build step, no framework
- **Firebase Auth** (Google sign-in) + **Firestore** for cloud sync
- **Web Speech API** for voice input
- **localStorage** for offline-first data persistence
