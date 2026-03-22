const { onRequest } = require("firebase-functions/v2/https");

// CORS proxy for iCal feeds — only allows fetching from teamlinkt.com
exports.icalProxy = onRequest({
    cors: ["https://laxtracular.com", "http://localhost:8080"],
    region: "us-west1"
}, async (req, res) => {
    const url = req.query.url;

    if (!url) {
        res.status(400).send("Missing ?url= parameter");
        return;
    }

    // Only allow fetching iCal feeds from teamlinkt
    if (!url.includes("teamlinkt.com") || !url.endsWith(".ics")) {
        res.status(403).send("Only teamlinkt.com .ics URLs allowed");
        return;
    }

    try {
        const response = await fetch(url);
        if (!response.ok) {
            res.status(response.status).send("Upstream error: " + response.statusText);
            return;
        }

        const body = await response.text();
        res.set("Content-Type", "text/calendar; charset=utf-8");
        res.send(body);
    } catch (err) {
        res.status(500).send("Fetch failed: " + err.message);
    }
});
