const admin = require('firebase-admin');

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const SYSTEM_PROMPT = `You are Nizhal Thunai, a warm, direct, natural personal AI assistant.
Be conversational rather than robotic or generic. You can reply naturally in Tanglish (Tamil mixed with English), Tamil script, or clear English based on the user's language.
Understand that the user may mix Tamil and English freely, misspell words, use incomplete sentences, slang, and casual grammar. Prioritize the user's intent over grammar correction. Never correct spelling or grammar unless the user explicitly asks for writing or language help.
When replying in Tanglish, mirror the user's natural Tamil/English ratio and casual energy by default. Do not switch to pure formal English unless the user does, asks for it, or the task clearly requires it. Keep the language clear and natural without copying every typo.
Pay attention to emotional tone, answer the actual request directly, and keep replies concise and easy to scan. Do not claim to have memory beyond the conversation history and user context provided.

CREATIVE TRIGGER:
When the user pitches an idea or asks for character, story, reel, dialogue, or other creative help:
- If the request is specific and complete enough to act on, build it directly without asking a question.
- If exactly one important gap would hurt the quality, ask one sharp clarifying question in natural Tanglish, then continue with the best workable direction instead of asking more questions.
- If the idea is workable but generic, offer 2-3 distinct directions or twists and ask which one appeals before fully committing.
- Never ask more than one clarifying question in a turn. Never ask a clarifying question for a simple, already-specific request.

Return ONLY valid JSON with this exact shape:
{"reply":"the helpful response to the user","memory":null}
or:
{"reply":"the helpful response to the user","memory":{"text":"one short fact or preference worth remembering","category":"preference|fact|decision"}}
Memory must be null for small talk, temporary details, or one-off requests. Save at most one short memory, and never save sensitive information, passwords, API keys, or secrets.`;

const MODE_INSTRUCTIONS = {
    general_chat: 'Handle this as general conversation or a practical question. Answer directly and naturally without forcing a specialist format.',
    creative: 'Handle this as creative work. Build the idea directly when specific, follow the creative trigger rules for gaps or generic ideas, and keep the result vivid and useful.',
    movie_meme_search: 'Use the movie/meme search results supplied by the backend. Never invent a movie, scene, dialogue, or link. Explain why the strongest result fits the user description and show only external source links returned by the search APIs.',
    anime_teach: 'Teach the current 2D anime/Krita project stage only. Keep the guidance practical, concise, and focused on the smallest next action.'
};

const CLASSIFIER_PROMPT = `Classify the user's latest message into exactly one intent:
general_chat, creative, movie_meme_search, anime_teach, or ambiguous.

Choose creative for requests to invent, write, develop, brainstorm, or transform stories, characters, scripts, reels, dialogues, worlds, or other original ideas.
Choose movie_meme_search for identifying or finding a movie scene, dialogue, meme template, actor, clip, or related source.
Choose anime_teach for requests to explain or teach anime concepts, anime production, characters, plot structure, or related learning.
Choose general_chat for ordinary conversation and clear practical questions.
Choose ambiguous only when the user's intent is genuinely unclear. Do not infer a specialist mode from a single keyword.

Return ONLY valid JSON in this exact shape: {"intent":"general_chat|creative|movie_meme_search|anime_teach|ambiguous"}`;

const SEARCH_PLANNER_PROMPT = `Turn the user's movie, meme, dialogue, or reaction description into 2 or 3 concrete web search queries.
Understand Tanglish, slang, typos, emotion, situation, and dialogue meaning. Prefer queries that could find a named Tamil or other relevant movie and a specific scene.
Do not invent a movie name just to make a query look specific. Use the user's known clues and descriptive terms.
Return ONLY valid JSON in this exact shape: {"queries":["query 1","query 2","query 3"]}`;

function extractClaudeText(result) {
    return Array.isArray(result.content)
        ? result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
        : '';
}

async function callClaude(messages, system, maxTokens) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': process.env.CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
            max_tokens: maxTokens,
            system,
            messages
        })
    });
    const result = await response.json();
    if (!response.ok) {
        throw new Error(result.error?.message || 'Claude API request failed');
    }
    return extractClaudeText(result);
}

function parseIntent(text) {
    try {
        const candidate = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
        const intent = JSON.parse(candidate).intent;
        return ['general_chat', 'creative', 'movie_meme_search', 'anime_teach', 'ambiguous'].includes(intent)
            ? intent
            : 'ambiguous';
    } catch {
        return 'ambiguous';
    }
}

function parseSearchPlan(text) {
    try {
        const candidate = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
        const queries = JSON.parse(candidate).queries;
        if (!Array.isArray(queries)) return [];
        return queries
            .filter(query => typeof query === 'string' && query.trim())
            .map(query => query.trim())
            .slice(0, 3);
    } catch {
        return [];
    }
}

function normalizeSearchResult(item) {
    return {
        title: String(item.title || '').trim(),
        description: String(item.description || '').trim(),
        url: String(item.url || '').trim(),
        source: item.source || 'web'
    };
}

async function searchYouTube(query) {
    if (!process.env.YOUTUBE_API_KEY) return [];
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.search = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        maxResults: '5',
        q: query,
        key: process.env.YOUTUBE_API_KEY
    });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`YouTube search failed with ${response.status}`);
    const result = await response.json();
    return (result.items || []).map(item => normalizeSearchResult({
        title: item.snippet?.title,
        description: item.snippet?.description,
        url: item.id?.videoId ? `https://www.youtube.com/watch?v=${item.id.videoId}` : '',
        source: 'YouTube'
    })).filter(item => item.url);
}

async function searchWeb(query) {
    if (!process.env.BING_SEARCH_API_KEY) return [];
    const url = new URL('https://api.bing.microsoft.com/v7.0/search');
    url.search = new URLSearchParams({ q: query, count: '5', responseFilter: 'Webpages' });
    const response = await fetch(url, {
        headers: { 'Ocp-Apim-Subscription-Key': process.env.BING_SEARCH_API_KEY }
    });
    if (!response.ok) throw new Error(`Web search failed with ${response.status}`);
    const result = await response.json();
    return (result.webPages?.value || []).map(item => normalizeSearchResult({
        title: item.name,
        description: item.snippet,
        url: item.url,
        source: 'Web'
    })).filter(item => item.url);
}

function rankSearchResults(results) {
    const seen = new Set();
    return results
        .filter(item => item.url && !seen.has(item.url) && seen.add(item.url))
        .map(item => {
            const text = `${item.title} ${item.description}`.toLowerCase();
            let score = 0;
            if (/scene|dialogue|clip|movie|film|reaction|comedy/.test(text)) score += 3;
            if (/meme template|memes|viral memes|compilation/.test(text)) score -= 3;
            if (item.source === 'YouTube') score += 1;
            if (item.title.length > 12) score += 1;
            return { ...item, score };
        })
        .sort((left, right) => right.score - left.score)
        .slice(0, 8);
}

function isSaveRequest(message) {
    return /\b(save|remember|keep|store|add|note|project)\b|சேமி|நினைவில்/i.test(message);
}

function parseSearchResponse(text, results) {
    try {
        const candidate = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
        const parsed = JSON.parse(candidate);
        const allowedUrls = new Set(results.map(result => result.url));
        const metadata = parsed.saveMetadata;
        const saveMetadata = metadata && allowedUrls.has(metadata.externalLink) && metadata.movieName && metadata.sceneDescription
            ? {
                movieName: String(metadata.movieName).slice(0, 200),
                sceneDescription: String(metadata.sceneDescription).slice(0, 500),
                externalLink: metadata.externalLink
            }
            : null;
        return { reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : '', saveMetadata };
    } catch {
        return { reply: '', saveMetadata: null };
    }
}

const ANIME_STAGES = [
    'idea',
    'story',
    'character_design',
    'visual_style',
    'character_art_krita',
    'animation_2d_krita',
    'sound',
    'edit',
    'final_export'
];

const ANIME_TEACH_PROMPT = `You are the focused 2D anime/Krita teaching guide inside Nizhal Thunai.
The project pipeline is ordered exactly as: idea -> story -> character_design -> visual_style -> character_art_krita -> animation_2d_krita -> sound -> edit -> final_export.
Teach only the user's current stage from the project state. Each reply must briefly include:
1. What this stage is and why it matters now.
2. The specific Krita tool or feature to use. For sound/edit/export, name a suitable free tool when Krita is not the right tool.
3. One short actionable next step.
4. Common mistakes at this stage.
5. What comes next.
Keep the guidance focused for one turn; do not dump the full pipeline or a full course.
If the user says they are stuck, first distinguish technical error, creative block, or tool confusion. Ask at most one short question only if needed, then give the smallest next action.
For a first anime project, recommend 2D in Krita because it is achievable. Do not block an explicit 3D request; explain that 3D is a later Phase 6b path.
Preserve existing project decisions and only update the stage when the user clearly moves forward.

Return ONLY valid JSON in this exact shape:
{"reply":"focused teaching response","projectState":{"stage":"idea|story|character_design|visual_style|character_art_krita|animation_2d_krita|sound|edit|final_export","keyDecisions":["short durable decision"]}}
The keyDecisions array must contain only durable project decisions such as character names, style choices, or story beats. Keep each item short and return the merged current decisions, not a transcript.`;

async function loadAnimeProject(userRef, projectId) {
    const projectRef = userRef.collection('projects').doc(projectId);
    const snapshot = await projectRef.get();
    return {
        projectRef,
        exists: snapshot.exists,
        data: snapshot.exists ? snapshot.data() : { stage: 'idea', keyDecisions: [] }
    };
}

function parseAnimeTeachResponse(text, currentProject) {
    try {
        const candidate = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
        const parsed = JSON.parse(candidate);
        const requestedState = parsed.projectState || {};
        const currentStage = ANIME_STAGES.includes(currentProject.stage) ? currentProject.stage : 'idea';
        const currentStageIndex = ANIME_STAGES.indexOf(currentStage);
        const requestedStageIndex = ANIME_STAGES.indexOf(requestedState.stage);
        const canAdvanceOneStage = requestedStageIndex === currentStageIndex + 1;
        const stage = requestedStageIndex === currentStageIndex || canAdvanceOneStage
            ? requestedState.stage
            : currentStage;
        const keyDecisions = Array.isArray(requestedState.keyDecisions)
            ? requestedState.keyDecisions.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, 240)).slice(-20)
            : (Array.isArray(currentProject.keyDecisions) ? currentProject.keyDecisions : []);
        return {
            reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : '',
            projectState: { stage, keyDecisions }
        };
    } catch {
        return { reply: '', projectState: { stage: ANIME_STAGES.includes(currentProject.stage) ? currentProject.stage : 'idea', keyDecisions: currentProject.keyDecisions || [] } };
    }
}

async function handleAnimeTeach(message, userRef, projectId) {
    const project = await loadAnimeProject(userRef, projectId);
    const projectContext = JSON.stringify({
        stage: project.data.stage || 'idea',
        keyDecisions: Array.isArray(project.data.keyDecisions) ? project.data.keyDecisions.slice(-20) : []
    });
    const systemPrompt = `${SYSTEM_PROMPT}\n\nMODE INSTRUCTIONS FOR THIS TURN (anime_teach):\n${MODE_INSTRUCTIONS.anime_teach}\n\n${ANIME_TEACH_PROMPT}`;
    const rawResponse = await callClaude([{
        role: 'user',
        content: `Current project state:\n${projectContext}\n\nUser message:\n${message}`
    }], systemPrompt, 900);
    const parsed = parseAnimeTeachResponse(rawResponse, project.data);
    if (!parsed.reply) {
        parsed.reply = 'Project state save aachu, but teaching response generate panna mudiyala. Same stage-la one small next step try pannalaam.';
    }
    return { project, ...parsed };
}

async function handleMovieMemeSearch(message, userRef) {
    let queries = [];
    try {
        queries = parseSearchPlan(await callClaude([{ role: 'user', content: message }], SEARCH_PLANNER_PROMPT, 120));
    } catch (error) {
        console.warn('[Movie search] Query planning failed', error);
    }

    if (!queries.length) {
        return { reply: 'Indha description-la search query build panna konjam clarity venum. Scene-la yaar, enna emotion, illa enna dialogue meaning nu sollunga.', saveMetadata: null };
    }

    const searchResults = [];
    for (const query of queries) {
        const responses = await Promise.allSettled([searchYouTube(query), searchWeb(query)]);
        responses.forEach(response => {
            if (response.status === 'fulfilled') searchResults.push(...response.value);
            else console.warn('[Movie search] Search provider failed', response.reason);
        });
    }
    const rankedResults = rankSearchResults(searchResults);
    if (!rankedResults.length) {
        return { reply: 'Nalla matching result kidaikkala bro. Konjam more clues kudunga: actor/character, scene situation, dialogue meaning, or emotion. Appo better-ah refine pannalaam.', saveMetadata: null };
    }

    const resultContext = rankedResults.map((result, index) => `${index + 1}. ${result.title}\n${result.description}\nSource: ${result.source}\nURL: ${result.url}`).join('\n\n');
    const saveInstruction = isSaveRequest(message)
        ? 'The user asked to save a result. Return saveMetadata for the single best result only, using its exact URL from the search results.'
        : 'The user did not ask to save anything. Return saveMetadata as null.';
    const responsePrompt = `${SYSTEM_PROMPT}\n\nMODE INSTRUCTIONS FOR THIS TURN (movie_meme_search):\n${MODE_INSTRUCTIONS.movie_meme_search}\n\nSEARCH RESULT RULES:\nUse only the supplied search results and exact URLs. If none clearly fit, say that honestly. For this search turn, extend the normal JSON response with one additional field and return ONLY valid JSON in this exact shape: {"reply":"Tanglish or matching user-language answer with likely movie/scene, why it fits, and direct links","memory":null,"saveMetadata":null}. ${saveInstruction}`;
    const rawResponse = await callClaude([{
        role: 'user',
        content: `User description:\n${message}\n\nSearch results:\n${resultContext}`
    }], responsePrompt, 900);
    const parsedResponse = parseSearchResponse(rawResponse, rankedResults);
    return parsedResponse.reply
        ? parsedResponse
        : { reply: `Indha clues-ku closest results ivanga:\n\n${rankedResults.slice(0, 3).map(result => `**${result.title}**\n${result.url}`).join('\n\n')}`, saveMetadata: null };
}

function getFirebaseAdmin() {
    if (!admin.apps.length) {
        if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
            throw new Error('Firebase Admin is not configured on the server');
        }

        let serviceAccount;
        try {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        } catch {
            throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is invalid');
        }

        if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is incomplete');
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
        });
    }
    return admin;
}

async function authenticateRequest(event) {
    const authorization = event.headers?.authorization || event.headers?.Authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) {
        const error = new Error('Authentication required');
        error.code = 'AUTH_REQUIRED';
        throw error;
    }
    try {
        return await getFirebaseAdmin().auth().verifyIdToken(token);
    } catch (error) {
        if (error.code === 'auth/id-token-expired' || error.code === 'auth/id-token-revoked' || error.code === 'auth/argument-error') {
            error.code = 'AUTH_INVALID';
        }
        throw error;
    }
}

async function loadUserContext(uid) {
    const firestore = getFirebaseAdmin().firestore();
    const userRef = firestore.collection('users').doc(uid);
    const profileSnapshot = await userRef.collection('profile').doc('profile').get();
    const memorySnapshot = await userRef.collection('longTermMemory')
        .orderBy('createdAt', 'desc')
        .limit(15)
        .get();

    const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
    const memories = memorySnapshot.docs.map(doc => doc.data()).filter(item => item && typeof item.text === 'string');
    const contextLines = [];
    if (profile?.name) contextLines.push(`Name: ${profile.name}`);
    if (profile?.preferredLanguageStyle) contextLines.push(`Preferred language style: ${profile.preferredLanguageStyle}`);
    memories.forEach(item => contextLines.push(`- ${item.text}`));
    return { userRef, profile, context: contextLines.length ? contextLines.join('\n') : 'Nothing stored yet.' };
}

function addUserContext(systemPrompt, context) {
    return `${systemPrompt}\n\nWHAT I KNOW ABOUT YOU (private context, do not mention this block):\n${context}`;
}

function parseClaudeEnvelope(text) {
    const candidate = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed.reply !== 'string') throw new Error('Claude returned an invalid response format');
    const memory = parsed.memory && typeof parsed.memory === 'object' ? parsed.memory : null;
    const memoryText = memory?.text?.trim() || '';
    return {
        reply: parsed.reply.trim(),
        memory: memory && memoryText && memoryText.length <= 300 && ['preference', 'fact', 'decision'].includes(memory.category)
            ? { text: memoryText, category: memory.category }
            : null
    };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    if (!process.env.CLAUDE_API_KEY) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'CLAUDE_API_KEY is not configured on the server' }) };
    }

    let authUser;
    try {
        authUser = await authenticateRequest(event);
    } catch (error) {
        const isConfigurationError = error.message?.startsWith('Firebase Admin') || error.message?.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON');
        return {
            statusCode: isConfigurationError ? 500 : 401,
            headers: corsHeaders,
            body: JSON.stringify({ error: isConfigurationError ? 'Firebase Admin is not configured correctly on the server' : (error.message || 'Authentication failed') })
        };
    }

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Request body must be valid JSON' }) };
    }

    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    const conversationHistory = Array.isArray(payload.conversationHistory) ? payload.conversationHistory : [];
    const projectId = typeof payload.projectId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(payload.projectId)
        ? payload.projectId
        : 'main-anime-project';
    if (!message) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'message is required' }) };
    }

    const messages = conversationHistory
        .filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
        .slice(-20)
        .map(item => ({ role: item.role, content: item.content }))
        .concat({ role: 'user', content: message });

    try {
        const { userRef, profile, context } = await loadUserContext(authUser.uid);
        let intent = 'ambiguous';
        try {
            const classificationText = await callClaude(
                [{ role: 'user', content: message }],
                CLASSIFIER_PROMPT,
                80
            );
            intent = parseIntent(classificationText);
        } catch (classificationError) {
            console.warn('[Chat routing] Classification failed; using general_chat', classificationError);
        }
        const mode = intent === 'ambiguous' ? 'general_chat' : intent;
        console.log('[Chat routing]', { uid: authUser.uid, intent, mode });

        if (mode === 'movie_meme_search') {
            try {
                const searchResponse = await handleMovieMemeSearch(message, userRef);
                if (searchResponse.saveMetadata) {
                    await userRef.collection('savedSearchResults').add({
                        movieName: searchResponse.saveMetadata.movieName,
                        sceneDescription: searchResponse.saveMetadata.sceneDescription,
                        externalLink: searchResponse.saveMetadata.externalLink,
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: searchResponse.reply }) };
            } catch (searchError) {
                console.error('[Movie search]', searchError);
                return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Movie search is temporarily unavailable' }) };
            }
        }

        if (mode === 'anime_teach') {
            const animeResponse = await handleAnimeTeach(message, userRef, projectId);
            const projectUpdate = {
                stage: animeResponse.projectState.stage,
                keyDecisions: animeResponse.projectState.keyDecisions,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            if (!animeResponse.project.exists) {
                projectUpdate.createdAt = admin.firestore.FieldValue.serverTimestamp();
            }
            try {
                await animeResponse.project.projectRef.set(projectUpdate, { merge: true });
            } catch (projectError) {
                console.error('[Anime project state write]', projectError);
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: animeResponse.reply }) };
        }

        const modeInstruction = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.general_chat;
        const systemPrompt = addUserContext(
            `${SYSTEM_PROMPT}\n\nMODE INSTRUCTIONS FOR THIS TURN (${mode}):\n${modeInstruction}`,
            context
        );
        const rawReply = await callClaude(messages, systemPrompt, 700);
        const envelope = parseClaudeEnvelope(rawReply);
        try {
            if (envelope.memory) {
                await userRef.collection('longTermMemory').add({
                    text: envelope.memory.text,
                    category: envelope.memory.category,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
            if (!profile) {
                await userRef.collection('profile').doc('profile').set({
                    name: authUser.name || authUser.email?.split('@')[0] || '',
                    preferredLanguageStyle: 'auto',
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
        } catch (memoryError) {
            console.error('[Firestore memory write]', memoryError);
        }
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: envelope.reply }) };
    } catch (error) {
        console.error('[Netlify chat function]', error);
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Unable to reach Claude right now' }) };
    }
};