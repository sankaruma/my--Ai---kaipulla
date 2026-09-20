# 🤖 Neon Shadow Assistant (Nizhal Thunai - My AI Kaipulla)

A Cyberpunk / Neon themed Progressive Web App (PWA) AI Assistant built with Vanilla HTML5, CSS3, and JavaScript. Powered by Google Gemini AI and YouTube Data API with security PIN lock, voice synthesis, speech recognition, and productivity management tools.

---

## ✨ Features

- 💬 **Intelligent Chat & Modes**:
  - **Insta Reel Creator Mode**: AI prompts and hooks for social media content creation.
  - **Anime World-Building Mode**: Deep world-building, Shonen plot twists, character backstories, and magic system generation.
- 🎙️ **Voice Recognition & Speech Synthesis**: Real-time microphone input and voice responses.
- 🌐 **Multi-Language Support**: English, Tamil Script, Tanglish (Tamil written in English script), and Auto-detect.
- 🔒 **PIN Lock Security System**: 4-digit PIN security lock with auto-lock timers and biometric scanner fallback.
- 📝 **Glassmorphic Notes & Reminders**: Category tags, search, and notification reminders.
- ✅ **Task Management**: Cyberpunk task manager with completion progress tracking.
- 📱 **Progressive Web App (PWA)**: Offline caching with Service Workers (`sw.js`) and installable app manifest.
- ☁️ **Cloud Functions & Hosting**: Firebase configuration for serverless Gemini & YouTube proxy functions.

---

## 🚀 Getting Started

### Netlify AI proxy environment variables

Set these in the Netlify dashboard; never put provider keys in browser code: `APP_TOKEN`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID`. Enter the same `APP_TOKEN` once in the app Settings. Missing provider keys are skipped.

### 1. Run Locally

Open `index.html` directly in any modern browser, or run a local web server:

```powershell
# Using Python
python -m http.server 8080

# Or using Node.js
npx -y http-server . -p 8080
```

### 2. Phase 1 Netlify + Firebase Auth setup

1. In Firebase Console, enable Email/Password and/or Google sign-in, then add your Netlify domain under Authentication > Settings > Authorized domains.
2. Set `window.NIZHAL_FIREBASE_CONFIG` in `index.html` to your Firebase web app configuration. This config is public; do not put a Claude key there.
3. In Netlify, set `CLAUDE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, and `YOUTUBE_API_KEY` environment variables. The service-account variable must contain the complete Firebase Admin service-account JSON on one line. Optionally set `BING_SEARCH_API_KEY` for additional general web results and `CLAUDE_MODEL` to override the default Claude model.
4. Deploy the repository with Netlify. `netlify.toml` publishes the project root and discovers `netlify/functions/chat.js`.

The main chat keeps conversation history only in the current browser session and sends requests to `/.netlify/functions/chat`. Notes, tasks, drafts, and Content Ideas are outside the Phase 1 Claude chat loop.

### 3. Deploy to Netlify

```bash
netlify deploy --prod
```

---

## 🛠️ Tech Stack

- **Frontend**: HTML5, CSS3 (Custom Glassmorphism Design System), JavaScript (ES6+)
- **Typography**: Outfit, JetBrains Mono (Google Fonts)
- **APIs**: Claude API via Netlify Function
- **Backend / Cloud**: Netlify Functions, Firebase Authentication

---

## 📄 License

MIT License.
