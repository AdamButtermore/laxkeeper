# LaxKeeper - Lacrosse Stats Tracker

A mobile-friendly web app for tracking lacrosse game stats in real-time.

## Features

- ⏱️ Game clock with pause/resume
- 🎯 Live score tracking
- 📊 Real-time stat tracking (faceoffs, ground balls, shots, goals, assists, turnovers, caused turnovers, saves)
- 📱 Mobile-optimized touch interface
- 👥 Roster management
- 📅 Game scheduling
- ⚙️ Configurable game format (quarters/halves, custom period duration)
- 💾 Local storage (data persists on your device)
- 📥 Export/Import data for backup

## How to Use on Your Phone

### Option 1: Open Directly (Simplest)
1. Open the `index.html` file in your phone's browser
2. The app will work immediately!

### Option 2: Host on GitHub Pages (Recommended)
1. Create a free GitHub account at [github.com](https://github.com)
2. Create a new repository called `laxkeeper`
3. Upload all three files (`index.html`, `styles.css`, `app.js`)
4. Go to Settings → Pages → Enable GitHub Pages
5. Visit the URL provided (e.g., `https://yourusername.github.io/laxkeeper`)
6. On your phone, open that URL and "Add to Home Screen" for easy access

### Option 3: Use Netlify (Easy Drag & Drop)
1. Go to [netlify.com](https://netlify.com)
2. Drag and drop the `laxkeeper` folder
3. Get your free URL
4. Access from your phone

## Quick Start Guide

### 1. Add Your Roster
- Tap "Manage Roster"
- Add players with name, number, and position
- Players are saved automatically

### 2. Schedule a Game
- Tap "Schedule Game"
- Enter opponent name, date/time, and location
- Choose quarters (4) or halves (2)
- Set period duration in minutes

### 3. Start a Game
- Tap "Start Game"
- Select the game you want to play
- Use the scoreboard to track score
- Start/pause the game clock
- Tap player numbers to record stats

### 4. Track Stats During Game
- Tap a player's number
- Select the stat to record (goal, assist, shot, etc.)
- Stats are saved in real-time
- Tap "Back to Players" to select a different player

### 5. View Game History
- Tap "Game History" from home screen
- See all completed games
- View detailed stats for each game

## Stat Types

- **Faceoff Won/Lost**: Track faceoff results
- **Ground Ball**: Loose ball pickups
- **Shot**: Any shot attempt
- **Goal**: Successful score (auto-increments home score)
- **Assist**: Pass leading to goal
- **Turnover**: Lost possession
- **Caused Turnover**: Forced opponent turnover
- **Save**: Goalie saves

## Data Backup

Your data is stored locally on your device. To backup:

1. Go to Settings
2. Tap "Export Data"
3. Save the JSON file to a safe location
4. To restore, use "Import Data"

## Tips

- **Add to Home Screen**: On iPhone, tap Share → Add to Home Screen for app-like experience
- **Landscape Mode**: Works great in landscape for easier stat entry
- **Backup Regularly**: Export your data after each game
- **Battery**: Keep your phone charged during games!

## Browser Compatibility

Works on:
- ✅ iOS Safari (iPhone/iPad)
- ✅ Chrome (Android)
- ✅ Firefox Mobile
- ✅ Any modern mobile browser

## Files

- `index.html` - Main app structure
- `styles.css` - Mobile-friendly styling
- `app.js` - App logic and data management

## Support

All data is stored locally on your device using browser localStorage. No internet connection required after initial load.

---

Built with HTML, CSS, and JavaScript - no dependencies!
