/* ==========================================================================
   NIZHAL THUNAI - BACKEND PROXY (Firebase Cloud Functions)
   Keeps GEMINI_API_KEY and YOUTUBE_API_KEY server-side only.
   Client (app.js) calls these endpoints instead of calling Google APIs directly.
   ========================================================================== */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

// Secrets are set once via:
//   firebase functions:secrets:set GEMINI_API_KEY
//   firebase functions:secrets:set YOUTUBE_API_KEY
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const YOUTUBE_API_KEY = defineSecret('YOUTUBE_API_KEY');

// Simple CORS helper - allow requests from your hosted app only in production if you want to lock it down further
function setCors(res) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
}

// POST /geminiProxy  -> forwards { contents, systemInstruction, generationConfig } to Gemini
exports.geminiProxy = onRequest({ secrets: [GEMINI_API_KEY], cors: true, invoker: 'public', region: 'us-central1' }, async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const key = GEMINI_API_KEY.value();
        const model = req.query.model || req.body.model || 'gemini-3.6-flash';
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            }
        );
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        console.error('[geminiProxy] error', err);
        res.status(500).json({ error: 'Proxy request failed' });
    }
});

// GET /youtubeProxy?q=search+text -> forwards to YouTube Data API v3 search
exports.youtubeProxy = onRequest({ secrets: [YOUTUBE_API_KEY], cors: true, invoker: 'public', region: 'us-central1' }, async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Missing q param' });

    try {
        const key = YOUTUBE_API_KEY.value();
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(query)}&key=${key}`;
        const response = await fetch(url);
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        console.error('[youtubeProxy] error', err);
        res.status(500).json({ error: 'Proxy request failed' });
    }
});
