/* ==========================================================================
   NEON SHADOW ASSISTANT (NIZHAL THUNAI) - PWA CORE APPLICATION ENGINE
   ========================================================================== */

// Global App State
const GEMINI_API_KEY = "AQ.Ab8RN6LZSsh8H2acLhGQBmY2WSo88fJq0E6rfnFDZBrJapJLtA";
const state = {
    isUnlocked: false,
    isAuthenticated: false,
    userPin: localStorage.getItem('nizhal_pin') || '1234',
    currentOverlayPin: '',
    currentView: 'view-chat',
    chatMode: 'insta', // 'insta' or 'anime'
    animeProjectId: localStorage.getItem('nizhal_anime_project_id') || 'main-anime-project',
    sessionId: sessionStorage.getItem('nizhal_session_id') || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    activeLanguage: 'English',
    languageMode: 'auto', // 'auto' | 'Tamil Script' | 'Tanglish' | 'English'
    voiceSpeechEnabled: false,
    coachModeEnabled: false,
    voiceConversationMode: false,
    voiceConversationSpeechWasEnabled: false,
    voiceConversationWaitingForReply: false,
    isRecordingMic: false,
    attachedMedia: null,
    
    // Data Collections (Synced with Firebase / LocalStorage)
    notes: [],
    tasks: [],
    drafts: [],
    contentIdeas: [],
    ideaMode: 'insta',
    ideaMedia: null,
    chatHistory: { insta: [], anime: [] },
    
    // Cloud Storage State (Supabase)
    supabaseClient: null,
    usingSupabase: false,
    
    // PWA Prompt
    deferredPwaPrompt: null
};

// Preset Prompt Suggestions
const PROMPT_PRESETS = {
    insta: [
        { label: '🎬 Viral Reel Hook', text: 'Give me 3 viral opening hooks for a tech review Reel.' },
        { label: '🔥 Trending Transition Idea', text: 'Suggest a smooth video transition concept for outfit change.' },
        { label: '✍️ 30-Sec Script', text: 'Write a 30-second script explaining AI in simple terms.' },
        { label: '🏷️ Hashtag & Caption Generator', text: 'Generate high-reach captions and 15 hashtags for storytelling.' }
    ],
    anime: [
        { label: '⚔️ Shonen Plot Twist', text: 'Create a shocking plot twist for episode 12 of a Shonen anime.' },
        { label: '🌀 Unique Power System', text: 'Design a magic/power system based on shadow manipulation and neon light.' },
        { label: '👤 Main Villain Backstory', text: 'Write a tragic backstory for a tragic anti-hero antagonist.' },
        { label: '🏔️ Fantasy World-Building', text: 'Describe a cyberpunk anime city built inside a giant floating monolith.' }
    ]
};
const MOBILE_FORMATTING_INSTRUCTION = ` Keep the reply SHORT and scannable on a phone screen - a few punchy lines per section, no long paragraphs. No filler preamble like 'Here are your options' and no closing summary. Just the content, cleanly formatted with clear line breaks between sections.`;

// ==========================================================================
// 1. INITIALIZATION & LIFECYCLE
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    sessionStorage.setItem('nizhal_session_id', state.sessionId);
    initSupabaseIfConfigured();
    loadStoredData();
    initPwaServiceWorker();
    initWebSpeechRecognition();
    initFirebaseAuth();
    setupReminderNotificationChecker();
    setupToolsMenu();
    renderPromptSuggestions();
    renderChatHistoryUI();
    updateApiKeyBadge();
    
    lockApp();
});

function initFirebaseAuth() {
    const status = document.getElementById('firebaseAuthStatus');
    if (!window.NIZHAL_FIREBASE_CONFIG || typeof firebase === 'undefined') {
        if (status) status.innerText = 'Firebase Auth is not configured yet.';
        return;
    }

    try {
        document.getElementById('pinLockOverlay')?.classList.add('firebase-auth-configured');
        if (!firebase.apps.length) firebase.initializeApp(window.NIZHAL_FIREBASE_CONFIG);
        firebase.auth().onAuthStateChanged(user => {
            state.isAuthenticated = Boolean(user);
            if (user) {
                unlockApp();
                if (status) status.innerText = `Signed in as ${user.email || user.displayName || 'Nizhal Thunai user'}`;
            } else {
                lockApp();
            }
        });

        const emailForm = document.getElementById('firebaseEmailAuthForm');
        if (emailForm) {
            emailForm.addEventListener('submit', async event => {
                event.preventDefault();
                const email = document.getElementById('firebaseEmailInput').value.trim();
                const password = document.getElementById('firebasePasswordInput').value;
                if (!email || !password) return;
                if (status) status.innerText = 'Signing in...';
                try {
                    await firebase.auth().signInWithEmailAndPassword(email, password);
                } catch (error) {
                    if (error.code === 'auth/user-not-found') {
                        try {
                            await firebase.auth().createUserWithEmailAndPassword(email, password);
                        } catch (createError) {
                            if (status) status.innerText = createError.message;
                        }
                    } else if (status) {
                        status.innerText = error.message;
                    }
                }
            });
        }

        const googleButton = document.getElementById('firebaseGoogleAuthBtn');
        if (googleButton) {
            googleButton.addEventListener('click', async () => {
                if (status) status.innerText = 'Opening Google sign-in...';
                try {
                    await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
                } catch (error) {
                    if (status) status.innerText = error.message;
                }
            });
        }
    } catch (error) {
        console.error('[Firebase Auth Init]', error);
        if (status) status.innerText = 'Firebase Auth could not be initialized.';
    }
}

// Service Worker Registration
function initPwaServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('[PWA] Service Worker registered:', reg.scope);
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                console.log('[PWA] New version available! Reloading for update...');
                                window.location.reload();
                            }
                        });
                    }
                });
            })
            .catch(err => console.log('[PWA] Service Worker registration failed:', err));

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                refreshing = true;
                window.location.reload();
            }
        });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        state.deferredPwaPrompt = e;
        const pwaBanner = document.getElementById('pwaBanner');
        if (pwaBanner) pwaBanner.style.display = 'flex';
    });

    const installBtn = document.getElementById('pwaInstallBtn');
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (state.deferredPwaPrompt) {
                state.deferredPwaPrompt.prompt();
                const { outcome } = await state.deferredPwaPrompt.userChoice;
                console.log('[PWA] User choice outcome:', outcome);
                state.deferredPwaPrompt = null;
                dismissPwaBanner();
            }
        });
    }
}

function dismissPwaBanner() {
    const banner = document.getElementById('pwaBanner');
    if (banner) banner.style.display = 'none';
}

// Navigation View Switcher
function switchView(viewId) {
    if (!state.isUnlocked && viewId !== 'view-settings') {
        lockApp();
        return;
    }

    document.querySelectorAll('.screen-view').forEach(view => {
        view.classList.remove('active');
    });

    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.classList.add('active');
        state.currentView = viewId;
    }

    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-view') === viewId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Refresh view specific UI
    if (viewId === 'view-tasks') renderTasksUI();
    if (viewId === 'view-notes') renderNotesUI();
    if (viewId === 'view-drafts') renderDraftsUI();
    if (viewId === 'view-ideas') renderIdeasHistoryUI();
    if (viewId === 'view-settings') updateApiKeyBadge();
}

// ==========================================================================
// 2. PIN AUTHENTICATION ENGINE
// ==========================================================================
function lockApp() {
    state.isUnlocked = false;
    state.isAuthenticated = false;
    sessionStorage.setItem('nizhal_unlocked', 'false');
    const overlay = document.getElementById('pinLockOverlay');
    if (overlay) overlay.classList.remove('unlocked');
    overlayClearPin();
}

function unlockApp() {
    state.isUnlocked = true;
    sessionStorage.setItem('nizhal_unlocked', 'true');
    const overlay = document.getElementById('pinLockOverlay');
    if (overlay) overlay.classList.add('unlocked');
}

function overlayPressPin(digit) {
    if (state.currentOverlayPin.length < 4) {
        state.currentOverlayPin += digit;
        renderOverlayPinDots();

        if (state.currentOverlayPin.length === 4) {
            setTimeout(verifyOverlayPin, 180);
        }
    }
}

function overlayClearPin() {
    state.currentOverlayPin = '';
    renderOverlayPinDots();
}

function renderOverlayPinDots() {
    const dots = document.querySelectorAll('#overlayPinDots .dot');
    dots.forEach((dot, idx) => {
        if (idx < state.currentOverlayPin.length) {
            dot.classList.add('filled');
        } else {
            dot.classList.remove('filled');
        }
    });
}

function verifyOverlayPin() {
    const lockIcon = document.getElementById('pinLockIcon');
    if (state.currentOverlayPin === state.userPin) {
        if (lockIcon) lockIcon.className = 'fa-solid fa-lock-open text-green';
        setTimeout(() => {
            unlockApp();
        }, 200);
    } else {
        if (lockIcon) lockIcon.className = 'fa-solid fa-triangle-exclamation text-pink';
        alert('❌ Incorrect PIN! Try default "1234" or your configured PIN.');
        overlayClearPin();
        setTimeout(() => {
            if (lockIcon) lockIcon.className = 'fa-solid fa-lock';
        }, 1000);
    }
}

function overlayTriggerBiometric() {
    state.currentOverlayPin = state.userPin;
    renderOverlayPinDots();
    setTimeout(verifyOverlayPin, 200);
}

function openChangePinModal() {
    const newPin = prompt('Enter your new 4-digit security PIN:', '1234');
    if (newPin && newPin.length === 4 && !isNaN(newPin)) {
        state.userPin = newPin;
        localStorage.setItem('nizhal_pin', newPin);
        saveDataToStorage('settings', { pin: newPin });
        alert('✅ Passcode PIN updated successfully!');
    } else if (newPin) {
        alert('❌ Invalid PIN. Please provide exactly 4 numeric digits.');
    }
}

function resetPinToDefault() {
    state.userPin = '1234';
    localStorage.setItem('nizhal_pin', '1234');
    alert('🔄 PIN reset to default: 1234');
}

// ==========================================================================
// 3. LANGUAGE DETECTION ENGINE (Tamil, English, Tanglish)
// ==========================================================================
function handleTypingLanguageDetection() {
    const input = document.getElementById('chatInput');
    const text = input ? input.value : '';
    const sendButton = document.querySelector('.btn-send');
    if (sendButton) sendButton.classList.toggle('send-btn-active', text.trim().length > 0);

    if (state.languageMode !== 'auto') return; // Manual language locked, skip auto-detect

    const lang = detectLanguage(text);
    
    state.activeLanguage = lang;
    const langText = document.getElementById('langText');
    if (langText) {
        langText.innerText = `Detected Language: ${lang.toUpperCase()}`;
    }
}

function setLanguageMode(mode) {
    state.languageMode = mode;

    document.querySelectorAll('.lang-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === mode);
    });

    const langText = document.getElementById('langText');

    if (mode === 'auto') {
        handleTypingLanguageDetection();
        // Force re-run even if a value was typed before switching back to auto
        const input = document.getElementById('chatInput');
        const text = input ? input.value : '';
        const lang = detectLanguage(text);
        state.activeLanguage = lang;
        if (langText) langText.innerText = `Detected Language: ${lang.toUpperCase()}`;
    } else {
        state.activeLanguage = mode;
        if (langText) langText.innerText = `Manual Language: ${mode.toUpperCase()}`;
    }
}

function detectLanguage(text) {
    if (!text || text.trim().length === 0) return 'English';

    const tamilRegex = /[\u0B80-\u0BFF]/;
    if (tamilRegex.test(text)) {
        return 'Tamil Script';
    }

    // Large Tanglish word list (exact word match, so it won't false-positive on
    // English words like "data" or "when" the way substring matching would)
    const tanglishKeywords = [
        'bro', 'da', 'di', 'machan', 'macha', 'mapla', 'anna', 'akka', 'thambi',
        'na', 'ta', 'ra', 'enna', 'ena', 'yena', 'epdi', 'eppadi', 'yepadi', 'evlo', 'evalo',
        'pannu', 'panra', 'panren', 'pannuven', 'panniten', 'pannitu', 'pannanum',
        'pannalam', 'pannuvom', 'pannunga', 'panniya', 'panna',
        'semma', 'romba', 'nalla', 'nallla', 'super', 'kalakku',
        'vanakkam', 'vanakam', 'kudu', 'kudunga', 'venum', 'vendam', 'venaam',
        'poidu', 'poitu', 'po', 'vandhu', 'vanthu', 'seri', 'sari',
        'illa', 'ille', 'illai', 'varum', 'varuthu', 'varudhu', 'vandhuduchu',
        'iruku', 'irukku', 'irundhu', 'irunthu', 'irukka', 'irukkanum',
        'solli', 'sollu', 'sollunga', 'sollren', 'solranga', 'sonna', 'sonan',
        'paaru', 'paru', 'paakalam', 'paakanum',
        'kavithai', 'kadhai', 'kathai', 'velai', 'vela',
        'nu', 'ippo', 'appo', 'ipo', 'apo', 'inaiku', 'innaiku', 'naaliku', 'nalaiku',
        'unga', 'enga', 'avanga', 'ivanga', 'namma', 'nama',
        'edhavadhu', 'edhachum', 'yedhavadhu', 'onnume', 'ondrum',
        'thevai', 'thevaiya', 'mudiyum', 'mudiyathu', 'mudichu',
        'kekku', 'ketta', 'kettu', 'kekkanum',
        'atha', 'adha', 'ithu', 'idhu', 'athu', 'kitta', 'kita', 'oru'
    ];

    const words = text.toLowerCase().split(/\s+/);
    let tanglishCount = 0;
    words.forEach(w => {
        if (tanglishKeywords.includes(w.replace(/[^a-z]/g, ''))) {
            tanglishCount++;
        }
    });

    if (tanglishCount > 0) {
        return 'Tanglish';
    }

    return 'English';
}

// ==========================================================================
// 4. HOME CHAT & AI RESPONSE ENGINE
// ==========================================================================
function setChatMode(mode) {
    state.chatMode = mode;
    document.getElementById('modePillInsta').classList.toggle('active', mode === 'insta');
    document.getElementById('modePillAnime').classList.toggle('active', mode === 'anime');

    const title = document.getElementById('currentModeDisplayTitle');
    const icon = document.getElementById('assistantAvatarIcon');

    if (mode === 'insta') {
        if (title) title.innerText = '🎥 Insta Video Ideas Assistant';
        if (icon) icon.className = 'fa-solid fa-video';
    } else {
        if (title) title.innerText = '⚔️ Anime Storytelling Assistant';
        if (icon) icon.className = 'fa-solid fa-dragon';
    }

    renderChatHistoryUI();
}

// Types text into an element one character at a time (cancels any in-progress typing on the same element)
function typewriterEffect(element, text, speed = 28) {
    if (element._typewriterTimer) {
        clearInterval(element._typewriterTimer);
    }
    element.innerText = '';
    element.classList.add('typewriter-caret');
    let i = 0;
    element._typewriterTimer = setInterval(() => {
        i++;
        element.innerText = text.slice(0, i);
        if (i >= text.length) {
            clearInterval(element._typewriterTimer);
            element._typewriterTimer = null;
            element.classList.remove('typewriter-caret');
        }
    }, speed);
}

function renderPromptSuggestions() {
    const box = document.getElementById('promptSuggestionsBox');
    if (!box) return;

    const list = PROMPT_PRESETS[state.chatMode] || [];
    box.innerHTML = list.map(item => `
        <button class="chip" onclick="sendQuickPrompt('${escapeHtml(item.text)}')">${item.label}</button>
    `).join('');
}

function sendQuickPrompt(promptText) {
    const input = document.getElementById('chatInput');
    if (input) {
        input.value = promptText;
        handleTypingLanguageDetection();
        sendChatMessage();
    }
}

function handleChatEnter(e) {
    if (e.key === 'Enter') sendChatMessage();
}

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input ? input.value.trim() : '';

    if (!text && !state.attachedMedia) return;

    const chatList = document.getElementById('chatMessageList');
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let mediaHtml = '';
    if (state.attachedMedia) {
        mediaHtml = `
            <div class="msg-media-preview mt-2">
                <img src="${state.attachedMedia.url}" class="preview-thumbnail" style="max-height: 140px; border-radius: 8px;">
                <div class="text-dim mt-1"><i class="fa-solid fa-file"></i> ${escapeHtml(state.attachedMedia.name)}</div>
            </div>
        `;
    }

    const userMsgHtml = `
        <div class="message msg-user">
            <div class="msg-avatar"><i class="fa-solid fa-user"></i></div>
            <div class="msg-body glass-card">
                <div class="msg-sender">You (${state.activeLanguage}) <span class="time">${timeNow}</span></div>
                <p>${escapeHtml(text)}</p>
                ${mediaHtml}
            </div>
        </div>
    `;
    chatList.insertAdjacentHTML('beforeend', userMsgHtml);

    const userMsgObj = { sender: 'user', text, media: state.attachedMedia, lang: state.activeLanguage, time: timeNow };
    state.chatHistory[state.chatMode].push(userMsgObj);

    if (input) {
        input.value = '';
        const sendButton = document.querySelector('.btn-send');
        if (sendButton) sendButton.classList.remove('send-btn-active');
    }
    const currentMedia = state.attachedMedia;
    removeMediaAttachment();
    chatList.scrollTop = chatList.scrollHeight;

    setTimeout(() => {
        generateAiResponse(text, currentMedia);
    }, 650);
}

async function generateAiResponse(query, media) {
    const chatList = document.getElementById('chatMessageList');
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const lang = state.activeLanguage;

    const langInstruction = lang === 'Tamil Script' 
        ? 'Reply fully in polished, clear Tamil script - correct grammar, natural flow, not overly formal or robotic.' 
        : lang === 'Tanglish' 
        ? 'Reply in Tanglish (Tamil+English mixed) - but keep it clean, articulate, and easy to follow. Sound like a sharp, well-spoken friend, not sloppy or overly slang-heavy. Do not just mirror or copy the exact casual words/spelling the user used - express the same idea in a smoother, more polished way while staying warm and natural.' 
        : 'Reply in clear, natural, articulate English.';

    const modeInstruction = state.chatMode === 'insta' 
        ? 'You are helping create Instagram Reel ideas, hooks, captions, and scripts. When you give a full script/idea (not for quick one-line questions), include a short timestamped "BGM & Sound Effects" note suggesting the mood of background music and where sound effects should hit, without naming exact copyrighted songs. For any comedy, meme, or reaction-related request or content with comedic/meme/reaction value, end your reply with a line in this exact format: "Meme template ku: https://searchmemes.in/q/KEYWORD" picking the single most fitting generic keyword (e.g. character name, actor name, or emotion/reaction word like "vadivelu", "goundamani", "shock", "cheems", "santhanam"), not an obscure exact phrase.' 
        : 'You are helping create anime story ideas, plot twists, power systems, and world-building.';

    let systemPrompt = `You are Nizhal Thunai, an elite Creative Director & JARVIS-like co-creator for Tamil content creators and storytellers.
You communicate in sharp, witty, street-smart Tanglish (Tamil + English mixed).

CORE MISSION:
Never act like a passive or generic answer-bot. Never dump a generic full script immediately when given a raw idea. 
YOUR PRIMARY JOB IS TO TRIGGER AND EXPAND THE USER'S CREATIVITY FIRST.

1. WHEN THE USER GIVES A RAW CONTENT IDEA OR THEME (Reel / Comedy / Story):
- Do NOT generate a final script right away.
- Acknowledge their idea with witty energy and cinema/meme references.
- Ask 2-3 sharp, directional questions to narrow their vision:
  a) Vibe / Emotion: (e.g., "Relatable daily-life frustration-ah illa pure absurd comedy-ah?")
  b) Character Dynamic: (e.g., "Single-person POV rant-ah illa Call & Counter two-person fight-ah?")
  c) The Hook Dilemma: Provide 2 completely contrasting opening hook angles and ask: "Indha rendu hook-la unaku edhu reach aagum nu thonudhu?"

2. WHEN THE USER PROVIDES OR FINALIZES A VOICE-OVER (VO) / SCRIPT:
- Break it down into a production-ready Shot-by-Shot Visual & Audio Breakdown:
  * [Timestamp]: e.g., 00:00 - 00:03
  * [Voice-Over Line]: Exact dialogue in natural Tanglish
  * [Visual / Camera Action]: Camera angle, facial expression, body movement
  * [B-Roll / Meme Clip Reference]: Suggested Tamil movie scene reaction or meme template
  * [Audio & SFX Cue]: Whoosh, bass punch, silence drop, comedic sound effect
- Whenever recommending meme templates or reactions, ALWAYS include:
  "Meme template ku: [https://searchmemes.in/q/KEYWORD](https://searchmemes.in/q/KEYWORD)" (using single keywords like 'vadivelu', 'goundamani', 'santhanam', 'shock', 'vijaykanth').

3. TONE & GUARDRAILS:
- Keep answers punchy, high-energy, and interactive.
- STRICTLY BAN boring AI clichés: Avoid phrases like "In today's fast-paced world", "Ever wondered", "Get ready to dive in".
- Sound like a sharp director friend who wants the video to go viral. ${langInstruction}${MOBILE_FORMATTING_INSTRUCTION}`;

    if (state.coachModeEnabled) {
        systemPrompt += `\n\nIMPORTANT - COACH MODE IS ON: Do not give a complete, ready-to-use finished idea or script. Instead, act like a creative coach: ask 1-2 sharp, specific questions to help the user think through their own idea, or give a partial direction/framework with a blank for them to fill in themselves. Build on whatever they say next. Keep it short - a question or a partial nudge, not a lecture. The goal is to trigger their own thinking, not do the creative work for them.`;
    }

    // Build conversation history so the AI remembers earlier turns in this chat mode
    // (Gemini expects alternating user/model turns; we skip the message we just added below)
    const historyForApi = state.chatHistory[state.chatMode]
        .slice(0, -1) // exclude the current message (added separately below)
        .slice(-16) // last ~8 exchanges, keeps payload small
        .map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));

    // Show a bouncing-dots "typing" indicator while waiting for the AI reply
    const typingId = 'typing-' + Date.now();
    const typingHtml = `
        <div class="message msg-ai" id="${typingId}">
            <div class="msg-avatar"><i class="fa-solid fa-user-ninja"></i></div>
            <div class="msg-body glass-card typing-indicator">
                <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
            </div>
        </div>
    `;
    chatList.insertAdjacentHTML('beforeend', typingHtml);
    chatList.scrollTop = chatList.scrollHeight;

    const userParts = [{ text: query || 'Analyze the attached media and give creative suggestions.' }];
    if (media && media.url && media.url.startsWith('data:image')) {
        userParts.push({ inlineData: { mimeType: media.type, data: media.url.split(',')[1] } });
    } else if (media) {
        userParts.push({ text: `[Attached media file: ${media.name}, type: ${media.type}]` });
    }

    const requestBody = {
        contents: [
            ...historyForApi,
            { role: 'user', parts: userParts }
        ],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature: 0.9
        },
        tools: [
            {
                functionDeclarations: [
                    {
                        name: 'create_task',
                        description: 'Creates a task or reminder note when the user explicitly asks to remember, note down, or be reminded of something.',
                        parameters: {
                            type: 'OBJECT',
                            properties: {
                                title: { type: 'STRING', description: 'Short task title' },
                                details: { type: 'STRING', description: 'Extra context or details' },
                                due: { type: 'STRING', description: 'Natural language due date/time if mentioned' }
                            },
                            required: ['title']
                        }
                    }
                ]
            }
        ]
    };

    const res = await callGeminiApi(requestBody);
    let reply = res.text || '';

    // Check if model invoked Function Calling to auto-create a task
    if (res.functionCall && res.functionCall.name === 'create_task') {
        const args = res.functionCall.args || res.functionCall.parameters || {};
        const title = args.title || 'New Task';
        const details = args.details || '';
        const due = args.due || '';

        const newTask = {
            id: Date.now(),
            title: title,
            name: title,
            details: details,
            due: due || null,
            dueDate: due || null,
            createdAt: new Date().toISOString(),
            completed: false,
            done: false
        };

        state.tasks.unshift(newTask);
        saveDataToStorage('tasks', state.tasks);

        if (state.currentView === 'view-tasks') {
            renderTasksUI();
        }

        let taskNotice = `✅ Task added: "${title}"`;
        if (due) taskNotice += ` (Due: ${due})`;
        if (details) taskNotice += `\nDetails: ${details}`;

        reply = reply ? `${taskNotice}\n\n${reply}` : taskNotice;
    }

    if (!reply) {
        reply = 'Done!';
    }

    // Remove the typing indicator now that we have a reply
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();

    const aiMsgHtml = `
        <div class="message msg-ai">
            <div class="msg-avatar"><i class="fa-solid fa-user-ninja"></i></div>
            <div class="msg-body glass-card">
                <div class="msg-sender">Nizhal Thunai (${lang}) <span class="time">${timeNow}</span></div>
                <p>${linkify(reply).replace(/\n/g, '<br>')}</p>
            </div>
        </div>
    `;
    const previousAiMessages = chatList.querySelectorAll('.msg-ai');
    const previousAiMessage = previousAiMessages[previousAiMessages.length - 1];
    if (previousAiMessage) previousAiMessage.classList.add('msg-settled');
    chatList.insertAdjacentHTML('beforeend', aiMsgHtml);

    const aiMsgObj = { sender: 'ai', text: reply, lang, time: timeNow };
    state.chatHistory[state.chatMode].push(aiMsgObj);
    chatList.scrollTop = chatList.scrollHeight;

    if (state.voiceSpeechEnabled) {
        const onSpeechComplete = state.voiceConversationMode
            ? () => {
                if (!state.voiceConversationMode || !state.voiceConversationWaitingForReply) return;
                state.voiceSpeechEnabled = state.voiceConversationSpeechWasEnabled;
                startVoiceConversationListening();
            }
            : null;

        if (onSpeechComplete) {
            if (state.voiceConversationMode) updateVoiceConversationIndicator('speaking');
        }

        speakWithGeminiTTS(reply)
            .then(() => {
                if (onSpeechComplete) onSpeechComplete();
            })
            .catch(error => {
                console.warn('[Gemini TTS] Falling back to browser speech:', error);
                if ('speechSynthesis' in window) {
                    const utterance = new SpeechSynthesisUtterance(reply);
                    if (onSpeechComplete) {
                        let completed = false;
                        const completeOnce = () => {
                            if (completed) return;
                            completed = true;
                            onSpeechComplete();
                        };
                        utterance.onend = completeOnce;
                        utterance.onerror = completeOnce;
                    }
                    window.speechSynthesis.speak(utterance);
                } else if (onSpeechComplete) {
                    onSpeechComplete();
                }
            });
    }
}

function clearChatHistory() {
    if (confirm('Clear chat messages for this mode?')) {
        state.chatHistory[state.chatMode] = [];
        setChatMode(state.chatMode);
    }
}

function toggleVoiceSpeech() {
    state.voiceSpeechEnabled = !state.voiceSpeechEnabled;
    const icon = document.getElementById('speechToggleIcon');
    if (icon) {
        icon.className = state.voiceSpeechEnabled ? 'fa-solid fa-volume-high text-neon' : 'fa-solid fa-volume-xmark text-dim';
    }
}


function toggleCoachMode() {
    state.coachModeEnabled = !state.coachModeEnabled;
    const icon = document.getElementById('coachModeToggleIcon');
    if (icon) {
        icon.className = state.coachModeEnabled ? 'fa-solid fa-lightbulb text-neon' : 'fa-solid fa-lightbulb text-dim';
    }
}
// ==========================================================================
// 5. WEB SPEECH API & MEDIA UPLOAD HANDLING
// ==========================================================================
let speechRecognitionInstance = null;
let voiceConversationTranscriptSent = false;
let voiceConversationResumeScheduled = false;

function setupToolsMenu() {
    document.addEventListener('click', event => {
        if (!event.target.closest('.tools-menu-container')) closeToolsMenu();
    });
    updateToolsMenuState();
}

function updateToolsMenuState() {
    const coachItem = document.querySelector('.tools-menu-item[onclick="selectToolsMenuItem(\'coach\')"]');
    const coachCheck = document.getElementById('toolsCoachCheck');

    if (coachItem) coachItem.classList.toggle('active', state.coachModeEnabled);
    if (coachCheck) coachCheck.hidden = !state.coachModeEnabled;
}

function closeToolsMenu() {
    const menu = document.getElementById('toolsMenu');
    const trigger = document.querySelector('.tools-menu-container > .icon-btn-upload');
    if (menu) {
        menu.classList.remove('open');
        menu.setAttribute('aria-hidden', 'true');
    }
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function toggleToolsMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('toolsMenu');
    const trigger = document.querySelector('.tools-menu-container > .icon-btn-upload');
    if (!menu) return;

    const isOpen = menu.classList.toggle('open');
    menu.setAttribute('aria-hidden', String(!isOpen));
    if (trigger) trigger.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) updateToolsMenuState();
}

function selectToolsMenuItem(action) {
    closeToolsMenu();
    if (action === 'attach') {
        const input = document.getElementById('mediaUploadInput');
        if (input) input.click();
    } else if (action === 'coach') {
        toggleCoachMode();
        updateToolsMenuState();
    }
}

function updateVoiceConversationIndicator(status) {
    const micBtn = document.getElementById('micBtn');
    if (!micBtn) return;

    micBtn.classList.toggle('voice-conversation-active', status !== 'off');
    micBtn.classList.toggle('voice-conversation-speaking', status === 'speaking');
    if (status === 'listening') {
        micBtn.title = 'Voice Conversation Mode - Listening (tap to stop)';
        micBtn.setAttribute('aria-label', 'Voice Conversation Mode listening, tap to stop');
    } else if (status === 'speaking') {
        micBtn.title = 'Voice Conversation Mode - Speaking (tap to stop)';
        micBtn.setAttribute('aria-label', 'Voice Conversation Mode speaking, tap to stop');
    } else {
        micBtn.title = 'Speak to input text';
        micBtn.removeAttribute('aria-label');
    }
}

function startVoiceConversationListening() {
    if (!state.voiceConversationMode || !speechRecognitionInstance) return;
    if (voiceConversationResumeScheduled) return;

    voiceConversationResumeScheduled = true;
    voiceConversationTranscriptSent = false;
    state.voiceConversationWaitingForReply = false;
    state.isRecordingMic = true;
    updateVoiceConversationIndicator('listening');
    try {
        speechRecognitionInstance.start();
        voiceConversationResumeScheduled = false;
    } catch (error) {
        console.log('[WebSpeech] Could not restart conversation:', error);
        voiceConversationResumeScheduled = false;
        state.isRecordingMic = false;
        state.voiceConversationMode = false;
        state.voiceSpeechEnabled = state.voiceConversationSpeechWasEnabled;
        updateVoiceConversationIndicator('off');
    }
}

function initWebSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        speechRecognitionInstance = new SpeechRecognition();
        speechRecognitionInstance.continuous = false;
        speechRecognitionInstance.interimResults = true;

        speechRecognitionInstance.onresult = (event) => {
            let transcript = '';
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                transcript += result[0].transcript;
                if (result.isFinal) finalTranscript += result[0].transcript;
            }
            const input = document.getElementById('chatInput');
            if (input) {
                input.value = transcript;
                handleTypingLanguageDetection();
                if (state.voiceConversationMode && finalTranscript.trim() && !voiceConversationTranscriptSent) {
                    voiceConversationTranscriptSent = true;
                    state.voiceConversationWaitingForReply = true;
                    state.voiceConversationSpeechWasEnabled = state.voiceSpeechEnabled;
                    state.voiceSpeechEnabled = true;
                    input.value = finalTranscript.trim();
                    handleTypingLanguageDetection();
                    sendChatMessage();
                }
            }
        };

        speechRecognitionInstance.onend = () => {
            state.isRecordingMic = false;
            const micBtn = document.getElementById('micBtn');
            if (micBtn) micBtn.classList.remove('recording');
            if (state.voiceConversationMode && !state.voiceConversationWaitingForReply) {
                setTimeout(startVoiceConversationListening, 250);
            }
        };

        speechRecognitionInstance.onerror = (err) => {
            console.log('[WebSpeech] Recognition error:', err);
            state.isRecordingMic = false;
            const micBtn = document.getElementById('micBtn');
            if (micBtn) micBtn.classList.remove('recording');
            if (state.voiceConversationMode && err.error !== 'aborted') {
                voiceConversationTranscriptSent = false;
            }
        };

    }
}

function toggleVoiceRecording() {
    const micBtn = document.getElementById('micBtn');
    if (!speechRecognitionInstance) {
        alert('Web Speech API is not supported in this browser. You can type directly.');
        return;
    }

    if (state.voiceConversationMode) {
        state.voiceConversationMode = false;
        state.voiceConversationWaitingForReply = false;
        state.voiceSpeechEnabled = state.voiceConversationSpeechWasEnabled;
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        if (state.isRecordingMic) speechRecognitionInstance.stop();
        state.isRecordingMic = false;
        if (micBtn) micBtn.classList.remove('recording');
        updateVoiceConversationIndicator('off');
    } else if (state.isRecordingMic) {
        speechRecognitionInstance.stop();
        state.isRecordingMic = false;
        if (micBtn) micBtn.classList.remove('recording');
    } else {
        state.voiceConversationMode = true;
        state.voiceConversationSpeechWasEnabled = state.voiceSpeechEnabled;
        startVoiceConversationListening();
    }
}

function handleMediaUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        state.attachedMedia = {
            name: file.name,
            type: file.type,
            url: e.target.result
        };

        const container = document.getElementById('mediaPreviewContainer');
        const elem = document.getElementById('mediaPreviewElement');
        const filenameLabel = document.getElementById('mediaFilename');

        if (filenameLabel) filenameLabel.innerText = file.name;
        if (elem) {
            if (file.type.startsWith('image/')) {
                elem.innerHTML = `<img src="${e.target.result}" class="preview-thumbnail">`;
            } else {
                elem.innerHTML = `<video src="${e.target.result}" class="preview-thumbnail"></video>`;
            }
        }
        if (container) container.style.display = 'flex';
    };
    reader.readAsDataURL(file);
}

function removeMediaAttachment() {
    state.attachedMedia = null;
    const container = document.getElementById('mediaPreviewContainer');
    const input = document.getElementById('mediaUploadInput');
    if (container) container.style.display = 'none';
    if (input) input.value = '';
}

// ==========================================================================
// 6. NOTES & REMINDERS ENGINE
// ==========================================================================
function renderNotesUI(filterCategory = 'all') {
    const grid = document.getElementById('notesGrid');
    if (!grid) return;

    let filtered = state.notes;
    if (filterCategory !== 'all') {
        filtered = state.notes.filter(n => n.category === filterCategory);
    }

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="text-dim text-center py-4">No notes found in this category. Click "New Note" to create one.</div>';
        return;
    }

    grid.innerHTML = filtered.map(note => `
        <div class="note-card glass-card">
            <div class="note-card-header">
                <span class="badge ${getCategoryBadgeClass(note.category)}">
                    ${note.reminderTime ? '<i class="fa-solid fa-bell bell-active"></i>' : '<i class="fa-solid fa-bookmark"></i>'}
                    ${note.category.toUpperCase()}
                </span>
                <button class="btn-icon-sm text-pink" onclick="deleteNote(${note.id})"><i class="fa-solid fa-trash-can"></i></button>
            </div>
            <h3 class="note-title">${escapeHtml(note.title)}</h3>
            <p class="note-body">${escapeHtml(note.body)}</p>
            <div class="note-footer">
                <span class="time"><i class="fa-regular fa-clock"></i> ${note.time}</span>
                ${note.reminderTime ? `<span class="text-yellow"><i class="fa-solid fa-bell"></i> ${new Date(note.reminderTime).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</span>` : ''}
            </div>
        </div>
    `).join('');
}

function getCategoryBadgeClass(category) {
    if (category === 'reminders') return 'badge-pink';
    if (category === 'ideas') return 'badge-cyan';
    return 'badge-purple';
}

function openAddNoteModal() {
    const modal = document.getElementById('addNoteModal');
    if (modal) modal.classList.add('active');
}

function closeAddNoteModal() {
    const modal = document.getElementById('addNoteModal');
    if (modal) modal.classList.remove('active');
}

function saveNewNote() {
    const title = document.getElementById('modalNoteTitle').value.trim();
    const category = document.getElementById('modalNoteCategory').value;
    const reminderTime = document.getElementById('modalNoteReminderTime').value;
    const body = document.getElementById('modalNoteBody').value.trim();

    if (!title || !body) {
        alert('Please fill in both the title and content body.');
        return;
    }

    const newNote = {
        id: Date.now(),
        title,
        category,
        reminderTime: reminderTime || null,
        body,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    state.notes.unshift(newNote);
    saveDataToStorage('notes', state.notes);
    closeAddNoteModal();
    renderNotesUI();

    if (reminderTime && 'Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
}

function deleteNote(id) {
    state.notes = state.notes.filter(n => n.id !== id);
    saveDataToStorage('notes', state.notes);
    renderNotesUI();
}

function filterNotes(category) {
    document.querySelectorAll('.filter-bar .filter-chip').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    renderNotesUI(category);
}

function getWelcomeText(mode) {
    return mode === 'insta'
        ? 'Hey! Insta ku videos plan pannalama? Idea sollu, naan help pannuren.'
        : 'Hey! Anime idea venuma? Sollu, naan ready.';
}

function renderChatHistoryUI() {
    const chatList = document.getElementById('chatMessageList');
    if (!chatList) return;

    const currentModeHistory = state.chatHistory[state.chatMode] || [];
    chatList.innerHTML = '';

    if (currentModeHistory.length === 0) {
        // No messages yet in this mode - show the animated welcome bubble
        const welcomeHtml = `
            <div class="message msg-ai">
                <div class="msg-avatar"><i class="fa-solid fa-user-ninja"></i></div>
                <div class="msg-body glass-card">
                    <div class="msg-sender">Nizhal Thunai</div>
                    <p id="welcomeMessageText"></p>
                    <div class="prompt-suggestions" id="promptSuggestionsBox"></div>
                </div>
            </div>
        `;
        chatList.insertAdjacentHTML('beforeend', welcomeHtml);
        const welcome = document.getElementById('welcomeMessageText');
        if (welcome) typewriterEffect(welcome, getWelcomeText(state.chatMode));
        renderPromptSuggestions();
        return;
    }

    currentModeHistory.forEach(msg => {
        if (msg.sender === 'user') {
            const userMsgHtml = `
                <div class="message msg-user">
                    <div class="msg-avatar"><i class="fa-solid fa-user"></i></div>
                    <div class="msg-body glass-card">
                        <div class="msg-sender">You (${msg.lang}) <span class="time">${msg.time}</span></div>
                        <p>${escapeHtml(msg.text)}</p>
                    </div>
                </div>
            `;
            chatList.insertAdjacentHTML('beforeend', userMsgHtml);
        } else {
            const aiMsgHtml = `
                <div class="message msg-ai">
                    <div class="msg-avatar"><i class="fa-solid fa-user-ninja"></i></div>
                    <div class="msg-body glass-card">
                        <div class="msg-sender">Nizhal Thunai (${msg.lang}) <span class="time">${msg.time}</span></div>
                        <p>${linkify(msg.text).replace(/\n/g, '<br>')}</p>
                    </div>
                </div>
            `;
            chatList.insertAdjacentHTML('beforeend', aiMsgHtml);
        }
    });
    chatList.scrollTop = chatList.scrollHeight;
}

function setupReminderNotificationChecker() {
    setInterval(() => {
        const now = new Date().getTime();
        state.notes.forEach(note => {
            if (note.reminderTime && !note.notified) {
                const remTime = new Date(note.reminderTime).getTime();
                if (now >= remTime) {
                    note.notified = true;
                    saveDataToStorage('notes', state.notes);
                    triggerBrowserNotification('⏰ Reminder Alert: ' + note.title, note.body);
                }
            }
        });
    }, 15000);
}

function triggerBrowserNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: 'https://www.gstatic.com/labs-code/stitch/favicon-192x192.png' });
    } else {
        alert(`${title}\n${body}`);
    }
}

// ==========================================================================
// 7. TASKS MANAGER ENGINE
// ==========================================================================
function renderTasksUI() {
    const activeList = document.getElementById('activeTaskList');
    const completedList = document.getElementById('completedTaskList');
    if (!activeList || !completedList) return;

    const activeTasks = state.tasks.filter(t => !(t.completed || t.done));
    const completedTasks = state.tasks.filter(t => (t.completed || t.done));

    activeList.innerHTML = activeTasks.length > 0 ? activeTasks.map(task => renderTaskItemHtml(task)).join('') : '<div class="text-dim">No pending active tasks.</div>';
    completedList.innerHTML = completedTasks.length > 0 ? completedTasks.map(task => renderTaskItemHtml(task)).join('') : '<div class="text-dim">No completed tasks yet.</div>';

    const total = state.tasks.length;
    const completedCount = completedTasks.length;
    const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;

    document.getElementById('completedTaskCount').innerText = completedCount;
    document.getElementById('totalTaskCount').innerText = total;
    document.getElementById('taskPercentDisplay').innerText = `${percent}%`;
    document.getElementById('taskProgressBarFill').style.width = `${percent}%`;
}

function renderTaskItemHtml(task) {
    const titleText = task.title || task.name || 'Untitled Task';
    const dueText = task.due || task.dueDate || 'No due date';
    const isDone = Boolean(task.done || task.completed);
    const detailsText = task.details ? `<div class="text-dim mt-1" style="font-size:0.85rem;"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(task.details)}</div>` : '';
    return `
        <div class="task-item glass-card ${isDone ? 'completed' : ''}">
            <label class="custom-checkbox">
                <input type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleTaskCompletion(${task.id})">
                <span class="checkmark"></span>
            </label>
            <div class="task-content">
                <span class="task-name">${escapeHtml(titleText)}</span>
                <span class="task-meta"><i class="fa-regular fa-calendar"></i> Due: ${escapeHtml(dueText)}</span>
                ${detailsText}
            </div>
            <button class="btn-icon-sm text-pink" onclick="deleteTask(${task.id})"><i class="fa-solid fa-trash-can"></i></button>
        </div>
    `;
}

function handleTaskEnter(e) {
    if (e.key === 'Enter') addNewTask();
}

function focusNewTaskInput() {
    const input = document.getElementById('newTaskInput');
    if (input) input.focus();
}

function addNewTask() {
    const input = document.getElementById('newTaskInput');
    const dateInput = document.getElementById('newTaskDueDate');
    const name = input ? input.value.trim() : '';
    const dueDate = dateInput ? dateInput.value : '';

    if (!name) return;

    const newTask = {
        id: Date.now(),
        title: name,
        name: name,
        details: '',
        due: dueDate || null,
        dueDate: dueDate || null,
        createdAt: new Date().toISOString(),
        completed: false,
        done: false
    };

    state.tasks.unshift(newTask);
    saveDataToStorage('tasks', state.tasks);
    input.value = '';
    if (dateInput) dateInput.value = '';
    renderTasksUI();
}

function toggleTaskCompletion(id) {
    const task = state.tasks.find(t => t.id === id);
    if (task) {
        const nextState = !(task.completed || task.done);
        task.completed = nextState;
        task.done = nextState;
        saveDataToStorage('tasks', state.tasks);
        renderTasksUI();
    }
}

function deleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    saveDataToStorage('tasks', state.tasks);
    renderTasksUI();
}

// ==========================================================================
// 8. STORY DRAFTS STUDIO
// ==========================================================================
let currentDraftId = null;

function renderDraftsUI() {
    const container = document.getElementById('draftsListContainer');
    if (!container) return;

    if (state.drafts.length === 0) {
        createNewDraft();
        return;
    }

    container.innerHTML = state.drafts.map(draft => `
        <div class="draft-item-card ${draft.id === currentDraftId ? 'active' : ''}" onclick="selectDraft(${draft.id})">
            <div class="draft-item-title">${escapeHtml(draft.title || 'Untitled Draft')}</div>
            <div class="draft-item-preview">${escapeHtml(draft.body ? draft.body.substring(0, 40) + '...' : 'Empty content')}</div>
        </div>
    `).join('');
}

function selectDraft(id) {
    currentDraftId = id;
    const draft = state.drafts.find(d => d.id === id);
    if (draft) {
        document.getElementById('draftTitleInput').value = draft.title;
        document.getElementById('draftBodyInput').value = draft.body;
        updateWordCount();
    }
    renderDraftsUI();
}

function createNewDraft() {
    const newDraft = {
        id: Date.now(),
        title: 'Untitled Anime Arc',
        body: '',
        updatedAt: new Date().toISOString()
    };
    state.drafts.unshift(newDraft);
    currentDraftId = newDraft.id;
    saveDataToStorage('drafts', state.drafts);
    selectDraft(newDraft.id);
}

function handleDraftBodyInput() {
    updateWordCount();
    autoSaveCurrentDraft();
}

function updateWordCount() {
    const body = document.getElementById('draftBodyInput').value;
    const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;
    const badge = document.getElementById('wordCountBadge');
    if (badge) badge.innerText = `${wordCount} Words`;
}

function autoSaveCurrentDraft() {
    if (!currentDraftId) return;
    const title = document.getElementById('draftTitleInput').value.trim();
    const body = document.getElementById('draftBodyInput').value;

    const draft = state.drafts.find(d => d.id === currentDraftId);
    if (draft) {
        draft.title = title;
        draft.body = body;
        draft.updatedAt = new Date().toISOString();
        saveDataToStorage('drafts', state.drafts);

        const status = document.getElementById('autoSaveStatus');
        if (status) {
            status.innerHTML = '<i class="fa-solid fa-check"></i> Saved';
        }
    }
}

function saveCurrentDraft() {
    autoSaveCurrentDraft();
    alert('✅ Story Draft saved successfully!');
}

function aiExtendStory(mode) {
    const textarea = document.getElementById('draftBodyInput');
    const currentText = textarea.value;
    const lang = detectLanguage(currentText);

    let addition = '';

    if (mode === 'cliffhanger') {
        if (lang === 'Tamil Script') {
            addition = '\n\n[AI தொடர்ச்சி]: திடீரென்று வான்வெளியில் பிரம்மாண்ட ஒளிரும் நிழல் கதவு திறந்தது...';
        } else if (lang === 'Tanglish') {
            addition = '\n\n[AI Addition]: Thideerunu vanathula oru giant glowing Shadow Gate open aachu bro!';
        } else {
            addition = '\n\n[AI Cliffhanger]: Suddenly, the sky fractured into glowing neon veins as the Monolith core activated...';
        }
    } else if (mode === 'extend') {
        addition = '\n\n[AI Extended Scene]: The neon rain trickled down the obsidian glass towers. "We don\'t have much time," whispered the shadow guardian.';
    } else {
        addition = '\n\n[AI Plot Twist]: Revealing the ancient seal, he realized that his own shadow was the original key to the monolith all along!';
    }

    textarea.value += addition;
    handleDraftBodyInput();
}

// ==========================================================================
// 8.5 CONTENT IDEAS STUDIO (Insta Reel / Anime / Comedy Call & Counter)
// ==========================================================================
function setIdeaMode(mode) {
    state.ideaMode = mode;
    document.getElementById('ideaPillInsta').classList.toggle('active', mode === 'insta');
    document.getElementById('ideaPillAnime').classList.toggle('active', mode === 'anime');
    document.getElementById('ideaPillComedy').classList.toggle('active', mode === 'comedy');
    document.getElementById('ideaPillDialogueId').classList.toggle('active', mode === 'dialogueid');

    const contextInput = document.getElementById('ideaContextInput');
    if (contextInput) {
        if (mode === 'comedy') {
            contextInput.placeholder = 'Enna topic la comedy venum sollu... e.g. "college friends fight", "amma vs son", "auto driver"...';
        } else if (mode === 'anime') {
            contextInput.placeholder = "Describe the anime moment/topic... e.g. 'power awakening scene', 'villain reveal'...";
        } else if (mode === 'dialogueid') {
            contextInput.placeholder = "Type the dialogue/line you remember (from movie, anime, TV show, or YouTube video)... AI will try to identify the source (won't reproduce full script).";
        } else {
            contextInput.placeholder = "Describe the video topic... e.g. 'morning routine', 'phone review'...";
        }
    }
}

function handleIdeaMediaUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        state.ideaMedia = {
            name: file.name,
            type: file.type,
            url: e.target.result
        };

        const container = document.getElementById('ideaMediaPreviewContainer');
        const elem = document.getElementById('ideaMediaPreviewElement');
        const filenameLabel = document.getElementById('ideaMediaFilename');

        if (filenameLabel) filenameLabel.innerText = file.name;
        if (elem) {
            if (file.type.startsWith('image/')) {
                elem.innerHTML = `<img src="${e.target.result}" class="preview-thumbnail">`;
            } else {
                elem.innerHTML = `<video src="${e.target.result}" class="preview-thumbnail"></video>`;
            }
        }
        if (container) container.style.display = 'flex';
    };
    reader.readAsDataURL(file);
}

function removeIdeaMedia() {
    state.ideaMedia = null;
    const container = document.getElementById('ideaMediaPreviewContainer');
    const input = document.getElementById('ideaMediaUploadInput');
    if (container) container.style.display = 'none';
    if (input) input.value = '';
}

async function generateContentIdea() {
    const contextInput = document.getElementById('ideaContextInput');
    const context = contextInput ? contextInput.value.trim() : '';
    const btn = document.getElementById('generateIdeaBtn');

    if (!context && !state.ideaMedia) {
        alert('Oru topic type pannu illa media upload pannu, apram Generate pannu!');
        return;
    }

    let systemPrompt = '';
    if (state.ideaMode === 'comedy') {
        systemPrompt = 'You are Nizhal Thunai, a witty Tamil comedy dialogue writer for Instagram Reels. Generate a short "Call & Counter" comedy dialogue - Character A says a normal or formal opening line, and Character B replies with an unexpected, witty, casual counter-line that flips the tone for comedic effect. Example style - Character A: "Vanakkam da mapla" then Character B: "Comedy dai machan, even da counter dialogue!". Generate 2 to 3 such Call and Counter exchanges based on the topic given, clearly labeled Character A: and Character B: for each exchange. Whenever the content has comedic/meme/reaction value, end your reply with a line in this exact format: "Meme template ku: https://searchmemes.in/q/KEYWORD" picking the single most fitting generic keyword (e.g. actor name, character name, or reaction word like "vadivelu", "goundamani", "santhanam", "shock", "cheems"), not an obscure exact phrase. Reply in Tanglish (Tamil+English mixed, casual, punchy) unless the topic is written in pure English.';
    } else if (state.ideaMode === 'anime') {
        systemPrompt = 'You are Nizhal Thunai, helping create original anime story ideas, plot twists, power systems, and world-building for a Tamil-set anime project. Keep it vivid, cinematic, and concise. Reply in Tanglish (Tamil+English mixed, casual) unless the topic is written in pure English.';
    } else if (state.ideaMode === 'dialogueid') {
        systemPrompt = 'You are Nizhal Thunai, a pop-culture and content expert covering Tamil and Hollywood movies, anime, TV shows, and YouTube videos/vlogs. The user will give you a partial or paraphrased dialogue or line they remember from ANY of these sources. Based on your own knowledge (you do not have live internet access), try to identify: 1) The likely source (movie name, anime title, TV show, or type of YouTube content), 2) The character or person who might have said it, 3) The likely context of that scene or moment. Consider all possible source types, not just movies. Do NOT reproduce the exact dialogue lines verbatim - only describe the scene and give the source name and context in your own words. Be honest about your confidence level - if you are not sure, say so clearly and give your best guess rather than stating it as fact, since you cannot browse the web to verify. After your identification, ALWAYS end your reply with a short section titled "Where to find it" that gives: a ready-to-use YouTube search phrase (e.g. "YouTube-la search pannu: Vanakkam Da Mappalei movie scene"), and a ready-to-use Instagram search hashtag or term (e.g. "Insta-la search pannu: #vanakkamdamappalei"). Whenever the content has comedic/meme/reaction value, end your reply with a line in this exact format: "Meme template ku: https://searchmemes.in/q/KEYWORD" picking the single most fitting generic keyword (e.g. actor name, character name, or reaction word like "vadivelu", "goundamani", "shock", "cheems"), not an obscure exact phrase. Reply in Tanglish (Tamil+English mixed, casual) unless the topic is written in pure English.';
    } else {
        systemPrompt = 'You are Nizhal Thunai, an expert Instagram Reels content strategist and audio/BGM director. Generate a viral Reel concept with a Hook (0-3 seconds), Value (3-12 seconds), and Call To Action (12-15 seconds), clearly labeled. After the script, ALWAYS add a section titled "BGM & Sound Effects Guide" that gives a timestamped breakdown of what audio to use at each moment - e.g. "0:00-0:03 - upbeat trending BGM starts, builds curiosity", "0:04 - short whoosh/transition sound effect", "0:12 - beat drop or bass hit to emphasize the twist/punchline", "0:13-0:15 - BGM fades slightly for the CTA voiceover to be clear". Suggest the general mood/genre of BGM (e.g. "trending upbeat pop", "suspenseful build-up", "comedic bell/boing sound") rather than exact copyrighted song names. By default, end your entire reply with a line in this exact format: "Meme template ku: https://searchmemes.in/q/KEYWORD" picking the single most fitting generic keyword (e.g. character name, actor name, or emotion/reaction word like "vadivelu", "goundamani", "shock", "cheems", "santhanam", etc.), not an obscure exact phrase. Reply in Tanglish (Tamil+English mixed, casual) unless the topic is written in pure English.';
    }

    systemPrompt += MOBILE_FORMATTING_INSTRUCTION;

    btn.disabled = true;
    const originalBtnHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';

    const parts = [];
    if (context) parts.push({ text: context });
    if (state.ideaMedia && state.ideaMedia.url.startsWith('data:image')) {
        const base64Data = state.ideaMedia.url.split(',')[1];
        parts.push({ inlineData: { mimeType: state.ideaMedia.type, data: base64Data } });
    } else if (state.ideaMedia) {
        parts.push({ text: `[Attached media file: ${state.ideaMedia.name}, type: ${state.ideaMedia.type}]` });
    }
    if (parts.length === 0) parts.push({ text: 'Give me a creative idea.' });

    const ideaTemp = state.ideaMode === 'dialogueid' ? 0.6 : 0.9;
    const requestBody = {
        contents: [{ parts }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature: ideaTemp
        }
    };

    const res = await callGeminiApi(requestBody);
    const reply = res.text;

    btn.disabled = false;
    btn.innerHTML = originalBtnHtml;

    const newIdea = {
        id: Date.now(),
        mode: state.ideaMode,
        context: context || `Media: ${state.ideaMedia ? state.ideaMedia.name : 'N/A'}`,
        result: reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    state.contentIdeas.unshift(newIdea);
    saveDataToStorage('ideas', state.contentIdeas);
    renderIdeasHistoryUI();

    if (contextInput) contextInput.value = '';
    removeIdeaMedia();
}

function renderIdeasHistoryUI() {
    const grid = document.getElementById('ideasHistoryGrid');
    if (!grid) return;

    if (state.contentIdeas.length === 0) {
        grid.innerHTML = '<div class="text-dim text-center py-4">No ideas generated yet. Try generating one above!</div>';
        return;
    }

    const modeIcon = { insta: 'fa-video', anime: 'fa-dragon', comedy: 'fa-face-laugh-squint', dialogueid: 'fa-magnifying-glass' };
    const modeLabel = { insta: 'Insta Reel', anime: 'Anime Idea', comedy: 'Comedy Dialogue', dialogueid: 'Dialogue ID' };

    grid.innerHTML = state.contentIdeas.map(idea => `
        <div class="note-card glass-card">
            <div class="note-card-header">
                <span class="badge badge-cyan"><i class="fa-solid ${modeIcon[idea.mode] || 'fa-lightbulb'}"></i> ${modeLabel[idea.mode] || 'Idea'}</span>
                <button class="btn-icon-sm text-pink" onclick="deleteContentIdea(${idea.id})"><i class="fa-solid fa-trash-can"></i></button>
            </div>
            <h3 class="note-title">${escapeHtml(idea.context)}</h3>
            <p class="note-body">${linkify(idea.result).replace(/\n/g, '<br>')}</p>
            <div class="note-footer">
                <span class="time"><i class="fa-regular fa-clock"></i> ${idea.time}</span>
            </div>
        </div>
    `).join('');
}

function deleteContentIdea(id) {
    state.contentIdeas = state.contentIdeas.filter(i => i.id !== id);
    saveDataToStorage('ideas', state.contentIdeas);
    renderIdeasHistoryUI();
}

// ==========================================================================
// 9. DATA STORAGE (FIREBASE FIRESTORE + LOCALSTORAGE FALLBACK)
// ==========================================================================
function loadStoredData() {
    state.notes = JSON.parse(localStorage.getItem('nizhal_notes')) || [
        { id: 1, title: 'Reels Hook Reference', category: 'ideas', body: '3 viral opening hooks for tech & AI reviews.', time: 'Today' },
        { id: 2, title: 'Anime Power System Note', category: 'reference', body: 'Shadow Core resonance rules and energy caps.', time: 'Yesterday' }
    ];

    state.tasks = JSON.parse(localStorage.getItem('nizhal_tasks')) || [
        { id: 1, name: 'Record 30-sec Insta Reel on AI Voice', dueDate: '2026-07-28', completed: false },
        { id: 2, name: 'Outline Episode 1 of Anime Story Draft', dueDate: '2026-07-30', completed: true }
    ];

    state.drafts = JSON.parse(localStorage.getItem('nizhal_drafts')) || [
        { id: 1, title: 'Chapter 1: The Shadow Monolith', body: 'The sky over Sector 7 burned in electric cyan...', updatedAt: new Date().toISOString() }
    ];

    state.contentIdeas = JSON.parse(localStorage.getItem('nizhal_ideas')) || [];

    localStorage.removeItem('nizhal_chat');
    state.chatHistory = { insta: [], anime: [] };
}

async function saveDataToStorage(key, data) {
    localStorage.setItem(`nizhal_${key}`, JSON.stringify(data));

    if (state.usingSupabase && state.supabaseClient) {
        try {
            await state.supabaseClient
                .from('nizhal_data')
                .upsert({ id: key, data, updated_at: new Date().toISOString() });
        } catch (e) {
            console.log('[Supabase Sync Error]', e);
        }
    }
}

async function initSupabaseIfConfigured() {
    const configStr = localStorage.getItem('nizhal_supabase_config');
    if (configStr) {
        try {
            const config = JSON.parse(configStr);
            if (config.url && config.anonKey && typeof supabase !== 'undefined') {
                state.supabaseClient = supabase.createClient(config.url, config.anonKey);
                state.usingSupabase = true;

                const badge = document.getElementById('storageStatusText');
                const badgeFull = document.getElementById('firebaseConnectedStatus');
                if (badge) badge.innerText = 'Supabase Connected';
                if (badgeFull) {
                    badgeFull.className = 'badge badge-cyan';
                    badgeFull.innerText = 'Active Engine: Supabase Connected';
                }

                syncFromCloud();
            }
        } catch (e) {
            console.log('[Supabase Init Error]', e);
        }
    }
}

async function syncFromCloud() {
    if (!state.usingSupabase || !state.supabaseClient) return;
    try {
        const { data: rows, error } = await state.supabaseClient.from('nizhal_data').select('*');
        if (error) {
            console.log('[Supabase Sync Error]', error);
            return;
        }
        if (!rows) return;

        rows.forEach(row => {
            if (row.id === 'notes' && row.data) state.notes = row.data;
            if (row.id === 'tasks' && row.data) state.tasks = row.data;
            if (row.id === 'drafts' && row.data) state.drafts = row.data;
            if (row.id === 'ideas' && row.data) state.contentIdeas = row.data;
            if (row.id === 'chat' && row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
                state.chatHistory = { insta: row.data.insta || [], anime: row.data.anime || [] };
            }
        });

        // Refresh UI now that cloud data has arrived
        renderNotesUI();
        renderTasksUI();
        renderDraftsUI();
        renderIdeasHistoryUI();
        renderChatHistoryUI();
    } catch (e) {
        console.log('[Supabase Sync Error]', e);
    }
}

function openFirebaseModal() {
    const modal = document.getElementById('firebaseConfigModal');
    if (modal) modal.classList.add('active');
}

function closeFirebaseModal() {
    const modal = document.getElementById('firebaseConfigModal');
    if (modal) modal.classList.remove('active');
}

function saveFirebaseConfig() {
    const urlInput = document.getElementById('supabaseUrlInput');
    const keyInput = document.getElementById('supabaseKeyInput');
    const url = urlInput ? urlInput.value.trim() : '';
    const anonKey = keyInput ? keyInput.value.trim() : '';

    if (!url || !anonKey) {
        alert('Please enter both the Supabase Project URL and Anon Key.');
        return;
    }

    try {
        localStorage.setItem('nizhal_supabase_config', JSON.stringify({ url, anonKey }));
        alert('✅ Supabase config saved! Reloading application to connect...');
        location.reload();
    } catch (e) {
        alert('❌ Something went wrong saving the config.');
    }
}

function getGeminiApiKey() {
    return localStorage.getItem('nizhal_gemini_api_key') || GEMINI_API_KEY;
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function pcmToWavBlob(pcmBytes, sampleRate = 24000, channels = 1) {
    const wav = new ArrayBuffer(44 + pcmBytes.byteLength);
    const view = new DataView(wav);
    const writeString = (offset, value) => {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    const byteRate = sampleRate * channels * 2;
    const blockAlign = channels * 2;

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + pcmBytes.byteLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, pcmBytes.byteLength, true);
    new Uint8Array(wav, 44).set(pcmBytes);

    return new Blob([wav], { type: 'audio/wav' });
}

async function speakWithGeminiTTS(text) {
    const key = getGeminiApiKey();
    if (!key || !text || typeof fetch !== 'function' || typeof Audio !== 'function') {
        throw new Error('Gemini TTS is unavailable in this browser.');
    }

    const model = 'gemini-2.5-flash-preview-tts';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: `Read this naturally and warmly in the language it is written in:\n${text}` }] }],
            generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' }
                    }
                }
            }
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error?.message || `Gemini TTS request failed (${response.status})`);
    }

    const audioPart = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data);
    if (!audioPart) throw new Error('Gemini TTS returned no audio.');

    const inlineData = audioPart.inlineData;
    const mimeType = inlineData.mimeType || 'audio/L16;rate=24000';
    const audioBytes = base64ToBytes(inlineData.data);
    let audioBlob;
    if (/audio\/L16/i.test(mimeType) || /audio\/pcm/i.test(mimeType)) {
        const rateMatch = mimeType.match(/rate=(\d+)/i);
        const channelsMatch = mimeType.match(/channels=(\d+)/i);
        audioBlob = pcmToWavBlob(audioBytes, rateMatch ? Number(rateMatch[1]) : 24000, channelsMatch ? Number(channelsMatch[1]) : 1);
    } else if (/^audio\//i.test(mimeType)) {
        audioBlob = new Blob([audioBytes], { type: mimeType });
    } else {
        throw new Error(`Unsupported Gemini TTS audio format: ${mimeType}`);
    }

    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    try {
        await new Promise((resolve, reject) => {
            audio.onended = resolve;
            audio.onerror = () => reject(new Error('Gemini TTS audio could not be played.'));
            audio.play().catch(reject);
        });
    } finally {
        URL.revokeObjectURL(audioUrl);
    }
}

async function callGeminiApi(requestBody, maxRetries = 3) {
    const key = getGeminiApiKey();
    const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
    let modelIndex = 0;
    let transientRetryCount = 0;

    for (let attempt = 0; attempt <= maxRetries || transientRetryCount < 2 || modelIndex < models.length - 1; attempt++) {
        const model = models[modelIndex] || models[models.length - 1];
        try {
            // Clone requestBody to avoid mutating original object across retries
            const payload = JSON.parse(JSON.stringify(requestBody));
            payload.generationConfig = payload.generationConfig || {};
            if (payload.generationConfig.temperature === undefined) payload.generationConfig.temperature = 0.9;

            // Default Thinking Mode: include thinkingConfig for models supporting thinking ('gemini-2.5-flash' or 'gemini-flash-latest')
            const supportsThinking = (model === 'gemini-2.5-flash' || model === 'gemini-flash-latest');
            if (supportsThinking) {
                if (!payload.generationConfig.thinkingConfig) {
                    payload.generationConfig.thinkingConfig = { thinkingLevel: 'high' };
                }
            }

            const headers = {
                'Content-Type': 'application/json'
            };

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

            let response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });
            let data = await response.json();

            // If API returns an error specifically about thinkingConfig / thinkingLevel not supported, retry once without it
            if (!response.ok && data.error?.message && (
                data.error.message.includes('thinkingConfig') ||
                data.error.message.includes('thinkingLevel') ||
                data.error.message.includes('thinking')
            )) {
                console.warn(`[Gemini API] thinkingConfig not supported for model '${model}'. Retrying without thinkingConfig...`);
                if (payload.generationConfig) {
                    delete payload.generationConfig.thinkingConfig;
                }
                response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                });
                data = await response.json();
            }

            if (response.ok && data.candidates?.[0]?.content?.parts) {
                const parts = data.candidates[0].content.parts;
                const funcCallPart = parts.find(p => p.functionCall);
                const text = parts.map(p => p.text).filter(Boolean).join('\n');
                if (funcCallPart || text) {
                    return {
                        success: true,
                        text: text,
                        functionCall: funcCallPart ? funcCallPart.functionCall : null,
                        rawParts: parts
                    };
                }
            }

            // 404 Not Found / Deprecated model: immediately fall back to the next supported model without retrying the broken name
            if (response.status === 404 || data.error?.code === 404 || (data.error?.message && data.error.message.toLowerCase().includes('not found'))) {
                console.warn(`[Gemini API] Model '${model}' returned 404 Not Found. Falling back to next model...`);
                if (modelIndex < models.length - 1) {
                    modelIndex++;
                    transientRetryCount = 0;
                    continue;
                }
            }

            // 503 Overloaded or 429 Rate Limit: retry the same model twice before fallback
            if (response.status === 503 || response.status === 429 || data.error?.code === 503 || data.error?.code === 429) {
                const status = response.status || data.error?.code;
                if (transientRetryCount < 2) {
                    const delay = transientRetryCount === 0 ? 1500 : 3000;
                    transientRetryCount++;
                    console.warn(`[Gemini API] Received ${status} for model '${model}'. Retrying same model in ${delay}ms...`, data);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                if (modelIndex < models.length - 1) {
                    modelIndex++;
                    transientRetryCount = 0;
                    continue;
                }
                if (status === 503) {
                    return { success: false, text: '⚠️ Google Gemini server temporary-ah overloaded-ah irukku (503). Oru 1-2 minutes wait pannitu thirumba try pannunga bro!' };
                }
                if (status === 429) {
                    return { success: false, text: '⚠️ Gemini API Free Daily Quota / Rate limit reach aayiduchu (429). aistudio.google.com-la pudhu API key create panni Settings-la podunga!' };
                }
            }

            if (data.error?.message) {
                return { success: false, text: `⚠️ Gemini Error (${data.error.code || response.status}): ${data.error.message}` };
            }
        } catch (err) {
            console.error('[Gemini API network error]', err);
            if (modelIndex < models.length - 1) {
                modelIndex++;
            }
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 1200));
                continue;
            }
        }
    }

    return { success: false, text: 'Network error bro, check your internet connection and try again!' };
}

function openApiKeyModal() {
    const currentKey = localStorage.getItem('nizhal_gemini_api_key') || '';
    const newKey = prompt('Enter your Google Gemini API Key (from aistudio.google.com):', currentKey);
    if (newKey !== null) {
        const trimmed = newKey.trim();
        if (trimmed) {
            localStorage.setItem('nizhal_gemini_api_key', trimmed);
            alert('✅ Gemini API Key updated successfully!');
            updateApiKeyBadge();
        } else {
            localStorage.removeItem('nizhal_gemini_api_key');
            alert('🔄 Reset to default Gemini API Key.');
            updateApiKeyBadge();
        }
    }
}

function saveGeminiKeyFromInput() {
    const input = document.getElementById('geminiKeyInput');
    const status = document.getElementById('geminiKeyStatus');
    const trimmed = input ? input.value.trim() : '';

    if (trimmed) {
        localStorage.setItem('nizhal_gemini_api_key', trimmed);
        if (status) status.innerText = 'Gemini API key saved successfully.';
    } else {
        localStorage.removeItem('nizhal_gemini_api_key');
        if (status) status.innerText = 'Gemini API key removed.';
    }

    updateApiKeyBadge();
}

function resetApiKeyToDefault() {
    localStorage.removeItem('nizhal_gemini_api_key');
    alert('🔄 Reset to default Gemini API Key.');
    updateApiKeyBadge();
}

function updateApiKeyBadge() {
    const badge = document.getElementById('apiKeyStatusBadge');
    const input = document.getElementById('geminiKeyInput');
    const custom = localStorage.getItem('nizhal_gemini_api_key');

    if (input) input.value = custom || '';
    if (badge) {
        if (custom) {
            badge.className = 'badge badge-green';
            badge.innerText = 'Active: Custom User Key';
        } else if (GEMINI_API_KEY) {
            badge.className = 'badge badge-purple';
            badge.innerText = 'Active: Default Key';
        } else {
            badge.className = 'badge badge-purple';
            badge.innerText = 'No API key set - add one in Settings';
        }
    }
}

function linkify(text) {
    if (!text) return '';
    const urlRegex = /(https:\/\/[^\s<]+)/g;
    return text.replace(urlRegex, url => {
        let cleanUrl = url;
        let trailing = '';
        const match = url.match(/[.,!?;:)]+$/);
        if (match) {
            trailing = match[0];
            cleanUrl = url.slice(0, -trailing.length);
        }
        return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="inline-link">${cleanUrl}</a>${trailing}`;
    });
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
}

async function signOutUser() {
    if (typeof firebase !== 'undefined' && firebase.apps.length && state.isAuthenticated) {
        await firebase.auth().signOut();
    } else {
        lockApp();
    }
}