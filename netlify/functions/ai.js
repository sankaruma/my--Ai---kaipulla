const MODEL_CACHE_TTL = 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 30;
let geminiModelCache = { models: [], fetchedAt: 0 };
const ipHits = new Map();

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body, status = 200) {
    return {
        statusCode: status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

function modelId(name) {
    return String(name || '').replace(/^models\//, '');
}

function sortModels(models) {
    return models.sort((a, b) => {
        const aVersion = Number((a.match(/gemini-(\d+(?:\.\d+)?)/i) || [0, '0'])[1]);
        const bVersion = Number((b.match(/gemini-(\d+(?:\.\d+)?)/i) || [0, '0'])[1]);
        if (aVersion !== bVersion) return bVersion - aVersion;
        const aPreview = /preview|experimental|exp/i.test(a);
        const bPreview = /preview|experimental|exp/i.test(b);
        if (aPreview !== bPreview) return aPreview ? 1 : -1;
        return a.localeCompare(b);
    });
}

async function getGeminiModels() {
    if (geminiModelCache.models.length && Date.now() - geminiModelCache.fetchedAt < MODEL_CACHE_TTL) {
        return geminiModelCache.models;
    }

    const fallback = ['gemini-flash-latest'];
    try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
            headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY }
        });
        const data = await response.json();
        if (!response.ok) throw new Error(`Gemini model listing failed (${response.status})`);
        const excluded = /image|audio|tts|live|embedding|thinking/i;
        const models = (data.models || [])
            .filter(model => model && model.name && model.supportedGenerationMethods?.includes('generateContent'))
            .map(model => modelId(model.name))
            .filter(name => /flash/i.test(name) && !excluded.test(name));
        geminiModelCache = { models: sortModels(models), fetchedAt: Date.now() };
        return geminiModelCache.models.length ? geminiModelCache.models : fallback;
    } catch (error) {
        console.warn('[AI Proxy] Gemini discovery failed:', error.message);
        return fallback;
    }
}

function withTimeout(promise, ms = 15000) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('provider_timeout')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function textMessages(messages, systemInstruction) {
    const result = [];
    if (systemInstruction) result.push({ role: 'system', content: systemInstruction });
    for (const message of Array.isArray(messages) ? messages : []) {
        const content = Array.isArray(message.content)
            ? message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
            : message.content || '';
        result.push({ role: message.role === 'model' ? 'assistant' : message.role, content });
    }
    return result;
}

function geminiContents(messages) {
    return (Array.isArray(messages) ? messages : []).map(message => ({
        role: message.role === 'assistant' ? 'model' : message.role,
        parts: Array.isArray(message.content)
            ? message.content.map(part => part.type === 'image_url'
                ? { inlineData: { mimeType: part.image_url.url.match(/^data:([^;]+);/)?.[1] || 'image/jpeg', data: part.image_url.url.split(',')[1] } }
                : { text: part.text || '' })
            : [{ text: message.content || '' }]
    }));
}

async function providerFetch(url, apiKey, body) {
    const response = await withTimeout(fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body)
    }));
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(`provider_${response.status}`), { status: response.status });
    return data;
}

async function callGemini(input) {
    if (!process.env.GEMINI_API_KEY) throw Object.assign(new Error('missing_gemini_key'), { detail: 'missing_gemini_key: GEMINI_API_KEY is not set in Netlify environment variables' });
    let lastDetail = 'gemini_no_models_available';
    const models = await getGeminiModels();
    const contents = geminiContents(input.messages);
    for (const model of models) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        try {
            const response = await withTimeout(fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': process.env.GEMINI_API_KEY
                },
                body: JSON.stringify({
                    contents,
                    systemInstruction: input.systemInstruction ? { parts: [{ text: input.systemInstruction }] } : undefined,
                    generationConfig: input.generationConfig,
                    tools: input.tools
                })
            }));
            const data = await response.json();
            if (!response.ok) {
                lastDetail = `gemini_${response.status} (model: ${model}): ${data?.error?.message || 'unknown error'}`;
                if (response.status === 404) continue;
                throw Object.assign(new Error(`gemini_${response.status}`), { status: response.status, detail: lastDetail });
            }
            const parts = data.candidates?.[0]?.content?.parts || [];
            const functionCall = parts.find(part => part.functionCall)?.functionCall || null;
            const text = parts.map(part => part.text).filter(Boolean).join('\n');
            if (text || functionCall) return { text, functionCall, provider: 'gemini', model };
            lastDetail = `gemini_empty_response (model: ${model})`;
        } catch (error) {
            if (error.status === 404) continue;
            lastDetail = error.detail || `gemini_error (model: ${model}): ${error.message}`;
            console.warn('[AI Proxy] Gemini model failed:', model, error.message);
        }
    }
    throw Object.assign(new Error('gemini_failed'), { detail: lastDetail });
}

async function callOpenAIProvider(name, url, apiKey, model, input) {
    if (!apiKey) throw new Error(`missing_${name}_key`);
    const response = await providerFetch(url, apiKey, {
        model,
        messages: textMessages(input.messages, input.systemInstruction),
        temperature: input.generationConfig?.temperature,
        max_tokens: input.generationConfig?.maxOutputTokens
    });
    const text = response.choices?.[0]?.message?.content;
    if (!text) throw new Error(`${name}_empty_response`);
    return { text, provider: name, model };
}

async function callCloudflare(input) {
    if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('missing_cloudflare_config');
    const model = '@cf/meta/llama-3.1-8b-instruct';
    const prompt = textMessages(input.messages, input.systemInstruction)
        .map(message => `${message.role}: ${message.content}`).join('\n');
    const response = await providerFetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/ai/run/${model}`,
        process.env.CLOUDFLARE_API_TOKEN,
        { prompt }
    );
    const text = response.result?.response;
    if (!text) throw new Error('cloudflare_empty_response');
    return { text, provider: 'cloudflare', model };
}

function clientIp(event) {
    return event.headers?.['x-nf-client-connection-ip'] || event.headers?.['client-ip'] || 'unknown';
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return jsonResponse({}, 204);
    if (event.httpMethod !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
    const serverToken = process.env.APP_TOKEN;
    const clientToken = event.headers?.['x-app-token'];
    if (!serverToken) {
        return jsonResponse({ error: 'bad_app_token', reason: 'server_token_not_set' }, 401);
    }
    if (!clientToken) {
        return jsonResponse({ error: 'bad_app_token', reason: 'client_token_missing' }, 401);
    }
    if (clientToken !== serverToken) {
        return jsonResponse({ error: 'bad_app_token', reason: 'token_mismatch' }, 401);
    }

    const now = Date.now();
    const ip = clientIp(event);
    const recentHits = (ipHits.get(ip) || []).filter(time => now - time < RATE_WINDOW_MS);
    if (recentHits.length >= RATE_LIMIT) return jsonResponse({ error: 'rate_limited' }, 429);
    recentHits.push(now);
    ipHits.set(ip, recentHits);

    let input;
    try {
        input = JSON.parse(event.body || '{}');
    } catch (error) {
        return jsonResponse({ error: 'invalid_json' }, 400);
    }

    const hasImage = JSON.stringify(input.messages || []).includes('image_url');
    const providers = [
        () => callGemini(input),
        ...(hasImage ? [] : [
            () => callOpenAIProvider('groq', 'https://api.groq.com/openai/v1/chat/completions', process.env.GROQ_API_KEY, 'llama-3.3-70b-versatile', input),
            () => callOpenAIProvider('cerebras', 'https://api.cerebras.ai/v1/chat/completions', process.env.CEREBRAS_API_KEY, 'qwen-3.8-27b', input),
            () => callOpenAIProvider('mistral', 'https://api.mistral.ai/v1/chat/completions', process.env.MISTRAL_API_KEY, 'mistral-small-latest', input),
            () => callCloudflare(input)
        ])
    ];

    const providerErrors = [];
    for (const provider of providers) {
        try {
            return jsonResponse(await provider());
        } catch (error) {
            console.warn('[AI Proxy] Provider failed:', error.message);
            providerErrors.push(error.detail || error.message);
        }
    }
    return jsonResponse({ error: 'all_providers_failed', details: providerErrors }, 502);
};
