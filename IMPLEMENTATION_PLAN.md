# LaxKeeper Cloud Migration - Implementation Plan

## Overview
Transform LaxKeeper from a local-storage single-user app to a cloud-based multi-user platform using Firebase.

**Timeline**: 3-4 weeks
**Difficulty**: Intermediate
**Cost**: Free tier (up to 50K daily users)

---

## Phase 1: Firebase Setup & Authentication (Week 1)

### 1.1 Firebase Project Setup (1-2 hours)
- [ ] Create Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
- [ ] Enable Authentication, Firestore Database, and Hosting
- [ ] Get Firebase config credentials
- [ ] Add Firebase SDK to project

**Files to create/modify:**
- `firebase-config.js` - Firebase initialization
- `index.html` - Add Firebase SDK scripts

**Code Example:**
```html
<!-- Add before closing </body> in index.html -->
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js"></script>
<script src="firebase-config.js"></script>
```

### 1.2 Authentication System (6-8 hours)
- [ ] Create login/signup screens
- [ ] Implement email/password authentication
- [ ] Add "Forgot Password" flow
- [ ] Add Google Sign-In (optional)
- [ ] Create user profile management

**New Files:**
- `auth.html` - Login/signup page
- `auth.js` - Authentication logic
- `auth.css` - Auth page styling

**User Flow:**
1. User visits app → Check if logged in
2. If not logged in → Show auth screen
3. After login → Redirect to home screen
4. Store user info in memory

**Database Schema (Firestore):**
```
users/
  {userId}/
    email: string
    displayName: string
    createdAt: timestamp
    teams: array of team IDs
```

### 1.3 Protected Routes (2 hours)
- [ ] Add auth state listener
- [ ] Redirect unauthenticated users to login
- [ ] Show user profile in settings
- [ ] Add logout functionality

---

## Phase 2: Data Migration to Firestore (Week 1-2)

### 2.1 Database Schema Design (2-3 hours)

**Firestore Structure:**
```
users/
  {userId}/
    email: string
    displayName: string
    createdAt: timestamp

teams/
  {teamId}/
    name: string
    ownerId: string (userId)
    members: map {
      {userId}: {role: 'owner'|'coach'|'viewer', addedAt: timestamp}
    }
    createdAt: timestamp

rosters/
  {rosterId}/
    teamId: string
    players: map {
      {playerId}: {
        name: string
        number: string
        position: string
        createdAt: timestamp
      }
    }

games/
  {gameId}/
    teamId: string
    opponent: string
    datetime: timestamp
    location: string
    format: 'quarters'|'halves'
    periodDuration: number
    status: 'scheduled'|'in-progress'|'completed'
    trackingTeam: 'home'|'away'
    trackingTeamName: string
    homeScore: number
    awayScore: number
    currentPeriod: number
    timeRemaining: number
    stats: map {
      {playerId}: {
        'faceoff-won': number
        'faceoff-lost': number
        'ground-ball': number
        ... etc
      }
    }
    opponentStats: map { ... }
    createdAt: timestamp
    startedAt: timestamp (optional)
    completedAt: timestamp (optional)
```

### 2.2 Firestore Security Rules (1-2 hours)
- [ ] Write security rules for data access
- [ ] Users can only access their teams
- [ ] Team members can read/write based on role

**File to create:**
- `firestore.rules`

**Rules Example:**
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own profile
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
    }

    // Team access based on membership
    match /teams/{teamId} {
      allow read: if request.auth.uid in resource.data.members.keys();
      allow write: if request.auth.uid == resource.data.ownerId;
    }

    // Roster access for team members
    match /rosters/{rosterId} {
      allow read, write: if request.auth.uid in get(/databases/$(database)/documents/teams/$(resource.data.teamId)).data.members.keys();
    }

    // Game access for team members
    match /games/{gameId} {
      allow read, write: if request.auth.uid in get(/databases/$(database)/documents/teams/$(resource.data.teamId)).data.members.keys();
    }
  }
}
```

### 2.3 Replace LocalStorage Functions (8-10 hours)

**Migrate each storage function:**

#### Before (localStorage):
```javascript
function getRoster() {
    const data = localStorage.getItem(STORAGE_KEYS.ROSTER);
    return data ? JSON.parse(data) : [];
}

function saveRoster(roster) {
    localStorage.setItem(STORAGE_KEYS.ROSTER, JSON.stringify(roster));
}
```

#### After (Firestore):
```javascript
async function getRoster() {
    const user = firebase.auth().currentUser;
    if (!user) return [];

    const teamId = await getCurrentTeamId(user.uid);
    const rosterDoc = await firebase.firestore()
        .collection('rosters')
        .where('teamId', '==', teamId)
        .get();

    if (rosterDoc.empty) return [];

    const players = rosterDoc.docs[0].data().players;
    return Object.entries(players).map(([id, player]) => ({
        id,
        ...player
    }));
}

async function saveRoster(roster) {
    const user = firebase.auth().currentUser;
    if (!user) return;

    const teamId = await getCurrentTeamId(user.uid);
    const players = {};
    roster.forEach(player => {
        players[player.id] = {
            name: player.name,
            number: player.number,
            position: player.position
        };
    });

    await firebase.firestore()
        .collection('rosters')
        .doc(teamId)
        .set({ teamId, players }, { merge: true });
}
```

**Functions to migrate:**
- [ ] `getRoster()` / `saveRoster()`
- [ ] `getGames()` / `saveGames()`
- [ ] `saveCurrentGame()` / load current game
- [ ] Team name storage
- [ ] All CRUD operations

**New File:**
- `firebase-data.js` - All Firestore data operations

---

## Phase 3: Team Management (Week 2)

### 3.1 Team Creation & Selection (4-6 hours)
- [ ] Create team on first login (auto-setup)
- [ ] Team switcher if user has multiple teams
- [ ] Create new team interface
- [ ] Current team stored in user session

**New UI Components:**
- Team selector dropdown in header
- "Create Team" button
- Team settings page

### 3.2 Team Invitations (6-8 hours)
- [ ] Generate invite codes/links
- [ ] Accept invitation flow
- [ ] Remove team members (owner only)
- [ ] Change member roles

**Database Updates:**
```
invitations/
  {inviteId}/
    teamId: string
    code: string (6-digit)
    createdBy: userId
    expiresAt: timestamp
    maxUses: number
    usedBy: array of userIds
```

**New Features:**
- Invite code generation
- Invite acceptance page
- Team members list
- Role management UI

---

## Phase 4: Real-Time Sync (Week 2-3)

### 4.1 Real-Time Game Updates (6-8 hours)
- [ ] Add Firestore real-time listeners
- [ ] Sync game state across devices
- [ ] Handle concurrent stat updates
- [ ] Show "live" indicator when game is active

**Implementation:**
```javascript
function subscribeToLiveGame(gameId) {
    return firebase.firestore()
        .collection('games')
        .doc(gameId)
        .onSnapshot(doc => {
            if (doc.exists) {
                currentGame = doc.data();
                updateGameUI();
            }
        });
}
```

### 4.2 Conflict Resolution (4 hours)
- [ ] Handle simultaneous stat entries
- [ ] Use Firestore transactions for critical updates
- [ ] Show notification when data updated by another user

**Example:**
```javascript
async function recordStatSafe(playerId, statType) {
    const gameRef = firebase.firestore().collection('games').doc(currentGame.id);

    await firebase.firestore().runTransaction(async (transaction) => {
        const doc = await transaction.get(gameRef);
        const currentStats = doc.data().stats[playerId];
        currentStats[statType]++;

        transaction.update(gameRef, {
            [`stats.${playerId}.${statType}`]: currentStats[statType]
        });
    });
}
```

### 4.3 Offline Support (4-6 hours)
- [ ] Enable Firestore offline persistence
- [ ] Queue operations when offline
- [ ] Show offline indicator
- [ ] Sync when back online

**Code:**
```javascript
firebase.firestore().enablePersistence()
    .catch(err => console.error('Offline persistence error:', err));
```

---

## Phase 5: Enhanced Features (Week 3-4)

### 5.1 Season & Archive Management (4 hours)
- [ ] Create seasons
- [ ] Archive old games
- [ ] Season statistics aggregation
- [ ] Export season data

### 5.2 Advanced Stats Dashboard (6 hours)
- [ ] Player season stats
- [ ] Team performance charts
- [ ] Shooting percentage
- [ ] Trends over time

**New Library:**
- Add Chart.js for visualizations

### 5.3 Parent/Player Portal (6-8 hours)
- [ ] Read-only player view
- [ ] Share game links with parents
- [ ] Public game pages (optional)
- [ ] Email notifications

### 5.4 Mobile App Enhancements (4 hours)
- [ ] Add to home screen prompt
- [ ] Push notifications (optional)
- [ ] Better offline UX
- [ ] App manifest for PWA

**File to create:**
- `manifest.json` - PWA configuration

---

## Phase 6: Testing & Deployment (Week 4)

### 6.1 Testing (6-8 hours)
- [ ] Test multi-user scenarios
- [ ] Test offline functionality
- [ ] Test on different devices
- [ ] Load testing with sample data
- [ ] Security rules testing

### 6.2 Data Migration Tool (4 hours)
- [ ] Create script to migrate existing localStorage data
- [ ] One-click import for current users
- [ ] Backup before migration

**New File:**
- `migrate-to-cloud.js`

### 6.3 Deployment (2-4 hours)
- [ ] Set up Firebase Hosting
- [ ] Configure custom domain (optional)
- [ ] Set up SSL certificate (automatic with Firebase)
- [ ] Deploy to production

**Commands:**
```bash
firebase deploy --only hosting
firebase deploy --only firestore:rules
```

### 6.4 Documentation (2-3 hours)
- [ ] Update README with cloud features
- [ ] Create user guide
- [ ] Document team setup process
- [ ] API documentation (if needed)

---

## Migration Strategy for Existing Users

### Option A: Automatic Migration
1. User opens app with existing localStorage data
2. Prompt: "Upgrade to cloud sync?"
3. Create account
4. Automatically upload all local data to Firestore
5. Keep local backup for 30 days

### Option B: Manual Export/Import
1. Add "Export Data" to current version
2. Users export JSON
3. Update app to cloud version
4. Add "Import Data" button in new version
5. Users import their backup

---

## Cost Estimation

### Firebase Free Tier Limits:
- **Firestore**: 1GB storage, 50K reads/day, 20K writes/day
- **Authentication**: Unlimited
- **Hosting**: 10GB storage, 360MB/day transfer

### Estimated Usage (100 active teams):
- **Storage**: ~50MB
- **Daily reads**: ~5,000 (well under limit)
- **Daily writes**: ~1,000 (well under limit)

**Result**: Free tier sufficient for 500+ teams

### Paid Tier (if needed):
- **Blaze Plan**: Pay as you go
- Estimated cost for 500 teams: $10-25/month

---

## Risk Mitigation

### Technical Risks:
1. **Data loss**: Implement backup system, export feature
2. **Offline issues**: Robust offline mode with queue
3. **Security**: Comprehensive security rules, regular audits
4. **Performance**: Optimize queries, add indexes

### User Experience Risks:
1. **Learning curve**: In-app tutorials, documentation
2. **Migration friction**: Simple one-click migration
3. **Internet requirement**: Strong offline support

---

## Post-Launch Roadmap

### Phase 7: Advanced Features (Future)
- [ ] Video clip integration
- [ ] Play-by-play timeline
- [ ] SMS notifications
- [ ] Integration with league management systems
- [ ] Mobile native app (React Native)
- [ ] Apple Watch companion app

---

## Development Checklist

### Before Starting:
- [ ] Set up Firebase account
- [ ] Install Firebase CLI: `npm install -g firebase-tools`
- [ ] Create development branch in git
- [ ] Set up local Firebase emulator for testing

### During Development:
- [ ] Test each feature in isolation
- [ ] Use Firebase emulator for local testing
- [ ] Commit frequently with clear messages
- [ ] Keep localStorage version as fallback

### Before Deployment:
- [ ] Complete security audit
- [ ] Load test with sample data
- [ ] Test on multiple devices/browsers
- [ ] Create rollback plan
- [ ] Prepare user communication

---

## Resources & Documentation

### Firebase Documentation:
- Authentication: https://firebase.google.com/docs/auth
- Firestore: https://firebase.google.com/docs/firestore
- Hosting: https://firebase.google.com/docs/hosting
- Security Rules: https://firebase.google.com/docs/firestore/security/get-started

### Learning Resources:
- Firebase Web Codelab: https://firebase.google.com/codelabs/firebase-web
- Firestore Data Modeling: https://firebase.google.com/docs/firestore/data-model
- Firebase + JavaScript Guide: https://firebase.google.com/docs/web/setup

---

## Success Metrics

### Phase 1 (Auth):
- [ ] Users can sign up and log in
- [ ] Auth state persists across sessions
- [ ] Password reset works

### Phase 2 (Data):
- [ ] All data loads from Firestore
- [ ] Data saves successfully
- [ ] No data loss

### Phase 3 (Teams):
- [ ] Users can create teams
- [ ] Invite system works
- [ ] Multiple members can access same team

### Phase 4 (Real-time):
- [ ] Live game updates sync across devices
- [ ] No conflicts when multiple users edit
- [ ] Offline mode works smoothly

### Final:
- [ ] 99.9% uptime
- [ ] <2 second load time
- [ ] Zero data loss incidents
- [ ] Positive user feedback

---

## Getting Started

### Immediate Next Steps:
1. Review this plan
2. Set up Firebase project (15 minutes)
3. Start with Phase 1.1 - Firebase Setup
4. Test authentication locally
5. Proceed phase by phase

**Estimated Total Time**: 80-100 hours over 3-4 weeks

**Ready to begin?** Start with Firebase project creation at https://console.firebase.google.com
