const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();

// ---- iCal CORS Proxy ----
exports.icalProxy = onRequest({
    cors: ["https://laxtracular.com", "http://localhost:8080"],
    region: "us-west1"
}, async (req, res) => {
    const url = req.query.url;
    if (!url) { res.status(400).send("Missing ?url= parameter"); return; }
    if (!url.includes("teamlinkt.com") || !url.endsWith(".ics")) {
        res.status(403).send("Only teamlinkt.com .ics URLs allowed"); return;
    }
    try {
        const response = await fetch(url);
        if (!response.ok) { res.status(response.status).send("Upstream error: " + response.statusText); return; }
        const body = await response.text();
        res.set("Content-Type", "text/calendar; charset=utf-8");
        res.send(body);
    } catch (err) {
        res.status(500).send("Fetch failed: " + err.message);
    }
});

// ---- Game Summary Page ----
exports.gameSummary = onRequest({
    region: "us-west1"
}, async (req, res) => {
    const teamCode = req.query.team;
    const gameId = req.query.game;

    if (!teamCode || !gameId) {
        res.status(400).send("Missing ?team= and ?game= parameters");
        return;
    }

    try {
        // Fetch game data and roster from Firestore
        const dataRef = db.collection("teams").doc(teamCode).collection("data");
        const [gamesDoc, rosterDoc, teamDoc] = await Promise.all([
            dataRef.doc("games").get(),
            dataRef.doc("roster").get(),
            db.collection("teams").doc(teamCode).get()
        ]);

        const games = gamesDoc.exists ? gamesDoc.data().items || [] : [];
        const roster = rosterDoc.exists ? rosterDoc.data().items || [] : [];
        const teamMeta = teamDoc.exists ? teamDoc.data() : {};
        const teamName = teamMeta.teamName || "Home";

        const game = games.find(g => g.id === gameId);
        if (!game) {
            res.status(404).send("Game not found");
            return;
        }

        if (game.status !== "completed") {
            res.status(403).send("Game summary is only available for completed games");
            return;
        }

        const html = renderSummaryPage(game, roster, teamName);
        res.set("Content-Type", "text/html; charset=utf-8");
        res.set("Cache-Control", "public, max-age=3600");
        res.send(html);
    } catch (err) {
        console.error("gameSummary error:", err);
        res.status(500).send("Error generating summary");
    }
});

// ---- Send Summary Email ----
exports.sendSummary = onRequest({
    cors: ["https://laxtracular.com"],
    region: "us-west1"
}, async (req, res) => {
    if (req.method !== "POST") { res.status(405).send("POST only"); return; }

    const { teamCode, gameId, emails } = req.body;
    if (!teamCode || !gameId || !emails || !emails.length) {
        res.status(400).json({ error: "Missing teamCode, gameId, or emails" });
        return;
    }

    try {
        // Fetch game to build subject line
        const gamesDoc = await db.collection("teams").doc(teamCode).collection("data").doc("games").get();
        const games = gamesDoc.exists ? gamesDoc.data().items || [] : [];
        const game = games.find(g => g.id === gameId);
        if (!game || game.status !== "completed") {
            res.status(404).json({ error: "Completed game not found" });
            return;
        }

        const teamDoc = await db.collection("teams").doc(teamCode).get();
        const teamName = teamDoc.exists ? teamDoc.data().teamName || "Team" : "Team";

        const result = game.homeScore > game.awayScore ? "W" : game.homeScore < game.awayScore ? "L" : "T";
        const summaryUrl = `https://us-west1-lax-keeper.cloudfunctions.net/gameSummary?team=${teamCode}&game=${encodeURIComponent(gameId)}`;

        // Write to Firestore mail collection (uses Firebase Trigger Email extension)
        const subject = `${teamName} ${result} ${game.homeScore}-${game.awayScore} vs ${game.opponent} — Game Summary`;
        const gameDate = game.completedAt ? new Date(game.completedAt) : new Date();
        const dateStr = gameDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

        const emailHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #1e293b; margin-bottom: 4px;">${esc(teamName)} vs ${esc(game.opponent)}</h2>
                <p style="color: #64748b; margin-top: 0;">${dateStr}</p>
                <div style="background: ${result === 'W' ? '#10b981' : result === 'L' ? '#ef4444' : '#94a3b8'}; color: white; padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0;">
                    <div style="font-size: 3rem; font-weight: 800;">${game.homeScore} - ${game.awayScore}</div>
                    <div style="font-size: 1.2rem; opacity: 0.9;">${result === 'W' ? 'WIN' : result === 'L' ? 'LOSS' : 'TIE'}</div>
                </div>
                <div style="text-align: center; margin: 24px 0;">
                    <a href="${summaryUrl}" style="display: inline-block; background: #3b82f6; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 1.1rem;">View Full Box Score</a>
                </div>
                <p style="color: #94a3b8; font-size: 0.85rem; text-align: center;">Powered by <a href="https://laxtracular.com" style="color: #3b82f6;">LaxKeeper</a></p>
            </div>`;

        // Write email docs for each recipient
        const batch = db.batch();
        for (const email of emails) {
            const ref = db.collection("mail").doc();
            batch.set(ref, {
                to: email.trim(),
                message: { subject, html: emailHtml }
            });
        }
        await batch.commit();

        res.json({ success: true, sent: emails.length, summaryUrl });
    } catch (err) {
        console.error("sendSummary error:", err);
        res.status(500).json({ error: "Failed to send: " + err.message });
    }
});

// ---- HTML Rendering Helpers ----
function esc(str) {
    if (typeof str !== "string") return str;
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getStatCount(val) {
    if (Array.isArray(val)) return val.length;
    if (typeof val === "number") return val;
    return 0;
}

function getPenaltyMinutes(val) {
    if (!Array.isArray(val)) return 0;
    return val.reduce((sum, entry) => sum + (entry.duration || 0), 0);
}

function formatPIM(totalSeconds) {
    if (totalSeconds === 0) return "0:00";
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function renderSummaryPage(game, roster, teamName) {
    const gameType = game.gameType || "boys";
    const homeLabel = game.trackingTeam === "home" ? teamName : game.opponent;
    const awayLabel = game.trackingTeam === "home" ? game.opponent : teamName;
    const result = game.homeScore > game.awayScore ? "W" : game.homeScore < game.awayScore ? "L" : "T";
    const resultColor = result === "W" ? "#10b981" : result === "L" ? "#ef4444" : "#94a3b8";
    const gameDate = game.completedAt ? new Date(game.completedAt) : new Date();
    const dateStr = gameDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

    const boxScore = renderBoxScore(game, homeLabel, awayLabel);
    const playerStats = renderPlayerStats(game, roster, gameType);
    const teamStats = renderTeamStats(game);
    const shotChart = renderShotChart(game, roster);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(teamName)} vs ${esc(game.opponent)} — Game Summary</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 1rem; }
        .container { max-width: 900px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 2rem; }
        .header h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
        .header .date { color: #64748b; font-size: 0.9rem; }
        .score-card { background: linear-gradient(135deg, #1e293b, #334155); border-radius: 16px; padding: 2rem; text-align: center; margin-bottom: 2rem; }
        .score { font-size: 4rem; font-weight: 800; letter-spacing: 0.05em; }
        .result { font-size: 1.3rem; font-weight: 700; margin-top: 0.25rem; }
        .teams { display: flex; justify-content: space-between; padding: 0 2rem; margin-top: 0.5rem; color: #94a3b8; }
        .section { background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; }
        .section h3 { color: #f8fafc; margin-bottom: 1rem; font-size: 1.1rem; }
        table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        th { background: #334155; color: #94a3b8; padding: 0.5rem; text-align: center; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
        th:first-child { text-align: left; }
        td { padding: 0.5rem; text-align: center; border-bottom: 1px solid #334155; }
        td:first-child { text-align: left; font-weight: 500; white-space: nowrap; }
        .leader { color: #10b981; font-weight: 700; }
        .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
        .stat-item { background: #334155; border-radius: 8px; padding: 0.75rem; }
        .stat-item strong { display: block; color: #94a3b8; font-size: 0.75rem; text-transform: uppercase; margin-bottom: 0.25rem; }
        .stat-item span { font-size: 1.1rem; font-weight: 600; }
        .footer { text-align: center; color: #475569; font-size: 0.8rem; margin-top: 2rem; padding: 1rem; }
        .footer a { color: #3b82f6; text-decoration: none; }
        .overflow-x { overflow-x: auto; }
        @media print {
            body { background: white; color: #1e293b; padding: 0; }
            .score-card { background: #f1f5f9; }
            .section { background: #f8fafc; border: 1px solid #e2e8f0; }
            th { background: #e2e8f0; color: #475569; }
            td { border-color: #e2e8f0; }
            .leader { color: #059669; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${esc(teamName)} vs ${esc(game.opponent)}</h1>
            <div class="date">${dateStr}${game.location ? " · " + esc(game.location) : ""}</div>
        </div>

        <div class="score-card">
            <div class="score" style="color: ${resultColor}">${game.homeScore} - ${game.awayScore}</div>
            <div class="result" style="color: ${resultColor}">${result === "W" ? "WIN" : result === "L" ? "LOSS" : "TIE"}</div>
            <div class="teams"><span>${esc(homeLabel)}</span><span>${esc(awayLabel)}</span></div>
        </div>

        ${boxScore}
        ${playerStats}
        ${teamStats}
        ${shotChart}

        <div class="footer">
            Powered by <a href="https://laxtracular.com">LaxKeeper</a>
        </div>
    </div>
</body>
</html>`;
}

function renderBoxScore(game, homeLabel, awayLabel) {
    if (!game.periodScores) return "";
    const ps = game.periodScores;
    const numPeriods = ps.home.length;
    const pLabel = game.format === "quarters" ? "Q" : "H";

    let html = '<div class="section"><h3>Box Score</h3><div class="overflow-x"><table>';
    html += "<thead><tr><th></th>";
    for (let i = 0; i < numPeriods; i++) html += `<th>${pLabel}${i + 1}</th>`;
    html += "<th style='border-left:2px solid #475569;'>Final</th></tr></thead><tbody>";

    [["home", homeLabel, game.homeScore], ["away", awayLabel, game.awayScore]].forEach(([side, label, total]) => {
        html += `<tr><td>${esc(label)}</td>`;
        for (let i = 0; i < numPeriods; i++) html += `<td>${ps[side][i]}</td>`;
        html += `<td style="font-weight:700;border-left:2px solid #475569;">${total}</td></tr>`;
    });

    html += "</tbody></table></div></div>";
    return html;
}

function renderPlayerStats(game, roster, gameType) {
    const rosterById = {};
    roster.forEach(p => { rosterById[p.id] = p; });
    const allPlayers = [...roster];
    if (game.stats) {
        Object.keys(game.stats).forEach(pid => {
            if (!rosterById[pid] && pid !== "opponent") {
                allPlayers.push({ id: pid, number: "?", name: "Unknown", position: "" });
            }
        });
    }

    const rows = [];
    allPlayers.sort((a, b) => Number(a.number) - Number(b.number)).forEach(player => {
        const stats = game.stats && game.stats[player.id];
        if (!stats) return;
        const totalStats = Object.values(stats).reduce((a, b) => a + getStatCount(b), 0);
        if (totalStats === 0) return;
        const goals = getStatCount(stats.goal);
        const assists = getStatCount(stats.assist);
        const shots = getStatCount(stats.shot);
        const fow = getStatCount(stats["faceoff-won"]);
        const fol = getStatCount(stats["faceoff-lost"]);
        rows.push({
            player, goals, assists, points: goals + assists, shots,
            shotPct: shots > 0 ? Math.round(goals / shots * 100) : -1,
            gb: getStatCount(stats["ground-ball"]), fow, fol,
            foPct: (fow + fol) > 0 ? Math.round(fow / (fow + fol) * 100) : -1,
            to: getStatCount(stats.turnover), ta: getStatCount(stats["caused-turnover"]),
            sv: getStatCount(stats.save), pen: getStatCount(stats.penalty),
            pim: getPenaltyMinutes(stats.penalty)
        });
    });

    // Find column leaders
    const colKeys = ["goals", "assists", "points", "shots", "shotPct", "gb", "fow", "fol", "foPct", "ta", "sv"];
    const maxVals = {};
    colKeys.forEach(k => {
        const vals = rows.map(r => r[k]).filter(v => v > 0);
        maxVals[k] = vals.length > 0 ? Math.max(...vals) : -1;
    });
    const ldr = (val, key) => val > 0 && val === maxVals[key] ? ' class="leader"' : "";

    const foW = gameType === "girls" ? "DC Wins" : "FO Wins";
    const foL = gameType === "girls" ? "DC Losses" : "FO Losses";
    const foPctLabel = gameType === "girls" ? "DC%" : "FO%";

    let html = '<div class="section"><h3>Player Statistics</h3><div class="overflow-x"><table>';
    html += `<thead><tr><th>Player</th><th>G</th><th>A</th><th>Pts</th><th>Sh</th><th>Sh%</th><th>GB</th><th>${foW}</th><th>${foL}</th><th>${foPctLabel}</th><th>TO</th><th>TA</th><th>Sv</th><th>Pen</th><th>PIM</th></tr></thead><tbody>`;

    rows.forEach(r => {
        html += `<tr><td>#${esc(String(r.player.number))} ${esc(r.player.name)}</td>`;
        html += `<td${ldr(r.goals, "goals")}>${r.goals}</td>`;
        html += `<td${ldr(r.assists, "assists")}>${r.assists}</td>`;
        html += `<td style="font-weight:600"${ldr(r.points, "points")}>${r.points}</td>`;
        html += `<td${ldr(r.shots, "shots")}>${r.shots}</td>`;
        html += `<td${ldr(r.shotPct, "shotPct")}>${r.shotPct >= 0 ? r.shotPct + "%" : "-"}</td>`;
        html += `<td${ldr(r.gb, "gb")}>${r.gb}</td>`;
        html += `<td${ldr(r.fow, "fow")}>${r.fow}</td>`;
        html += `<td${ldr(r.fol, "fol")}>${r.fol}</td>`;
        html += `<td${ldr(r.foPct, "foPct")}>${r.foPct >= 0 ? r.foPct + "%" : "-"}</td>`;
        html += `<td>${r.to}</td>`;
        html += `<td${ldr(r.ta, "ta")}>${r.ta}</td>`;
        html += `<td${ldr(r.sv, "sv")}>${r.sv}</td>`;
        html += `<td>${r.pen}</td>`;
        html += `<td>${r.pim > 0 ? formatPIM(r.pim) : "-"}</td></tr>`;
    });

    if (rows.length === 0) {
        html += '<tr><td colspan="15" style="text-align:center;color:#64748b;padding:1rem;">No stats recorded</td></tr>';
    }
    html += "</tbody></table></div></div>";
    return html;
}

function renderTeamStats(game) {
    const liveClears = game.clears || [];
    const ts = game.teamStats || {};
    const trackSide = game.trackingTeam || "home";

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

    if (!hasClears && !hasEMO && !hasPK) return "";

    const pct = (num, den) => den > 0 ? Math.round(num / den * 100) + "%" : "-";
    const clrTotal = clrSuccess + clrFail;
    const oppClrTotal = oppClrSuccess + oppClrFail;
    const pkSuccessful = (ts.pkOpportunities || 0) - (ts.pkGoalsAgainst || 0);

    let html = '<div class="section"><h3>Team Stats</h3><div class="stat-grid">';
    if (hasClears) {
        html += `<div class="stat-item"><strong>Clearing</strong><span>${clrSuccess}/${clrTotal} (${pct(clrSuccess, clrTotal)})</span></div>`;
        html += `<div class="stat-item"><strong>Opp Clearing</strong><span>${oppClrSuccess}/${oppClrTotal} (${pct(oppClrSuccess, oppClrTotal)})</span></div>`;
    }
    if (hasEMO) {
        html += `<div class="stat-item"><strong>Man-Up (EMO)</strong><span>${ts.emoGoals || 0}/${ts.emoOpportunities || 0} (${pct(ts.emoGoals || 0, ts.emoOpportunities || 0)})</span></div>`;
    }
    if (hasPK) {
        html += `<div class="stat-item"><strong>Penalty Kill</strong><span>${pkSuccessful >= 0 ? pkSuccessful : 0}/${ts.pkOpportunities || 0} (${pct(pkSuccessful >= 0 ? pkSuccessful : 0, ts.pkOpportunities || 0)})</span></div>`;
    }
    html += "</div></div>";
    return html;
}

function renderShotChart(game, roster) {
    if (!game.stats) return "";

    const shots = [];
    const rosterById = {};
    roster.forEach(p => { rosterById[p.id] = p; });

    Object.keys(game.stats).forEach(playerId => {
        const ps = game.stats[playerId];
        if (!ps || !ps.shot || !Array.isArray(ps.shot)) return;
        const player = rosterById[playerId];
        const goalTimestamps = ps.goal && Array.isArray(ps.goal) ? ps.goal : [];

        ps.shot.forEach(shotTs => {
            if (shotTs && typeof shotTs.x === "number" && typeof shotTs.y === "number") {
                const isGoal = goalTimestamps.some(gTs =>
                    gTs.period === shotTs.period && gTs.timeRemaining === shotTs.timeRemaining
                );
                shots.push({ x: shotTs.x, y: shotTs.y, isGoal });
            }
        });
    });

    if (shots.length === 0) return "";

    let dots = "";
    shots.forEach(s => {
        const cx = s.x * 300;
        const cy = s.y * 250;
        const color = s.isGoal ? "#10b981" : "#ef4444";
        const opacity = s.isGoal ? 0.8 : 0.6;
        dots += `<circle cx="${cx}" cy="${cy}" r="8" fill="${color}" fill-opacity="${opacity}" stroke="white" stroke-width="1.5"/>`;
    });

    const goalCount = shots.filter(s => s.isGoal).length;
    const missCount = shots.filter(s => !s.isGoal).length;

    return `<div class="section"><h3>Shot Chart</h3>
        <div style="text-align:center;">
            <svg viewBox="0 0 300 250" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:400px;border-radius:8px;">
                <rect width="300" height="250" fill="#2d5a27" rx="8"/>
                <line x1="20" y1="30" x2="280" y2="30" stroke="rgba(255,255,255,0.85)" stroke-width="2"/>
                <line x1="20" y1="30" x2="20" y2="250" stroke="rgba(255,255,255,0.85)" stroke-width="2"/>
                <line x1="280" y1="30" x2="280" y2="250" stroke="rgba(255,255,255,0.85)" stroke-width="2"/>
                <line x1="20" y1="220" x2="280" y2="220" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-dasharray="6,4"/>
                <rect x="138" y="18" width="24" height="12" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="2" rx="2"/>
                <circle cx="150" cy="30" r="27" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="2"/>
                <line x1="100" y1="30" x2="200" y2="30" stroke="rgba(255,255,255,0.85)" stroke-width="2.5"/>
                ${dots}
            </svg>
            <div style="display:flex;gap:1rem;justify-content:center;margin-top:0.75rem;font-size:0.85rem;color:#94a3b8;">
                <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#10b981;margin-right:4px;"></span>Goals (${goalCount})</span>
                <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;margin-right:4px;"></span>Missed (${missCount})</span>
            </div>
        </div>
    </div>`;
}
