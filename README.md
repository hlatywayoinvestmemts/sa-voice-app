# SA Voice App

A neutral working title. Phase 1 is a free, static, accessible recording prototype, not a finished transcription product. English and Afrikaans are the only language choices. No backend, accounts, paid services, API keys or external dependencies are used.

## Files
- index.html: the single page, styles, labels, transcript editor and visual AI panel.
- app.js: microphone permission, format selection, recording, duration, playback, download and the transcription stub. Comments explain the steps.
- manifest.webmanifest: the installed app name, launch path, theme and icon.
- sw.js: the service worker that caches only the static app shell for offline opening.
- icon.svg: an original neutral microphone glyph, not a brand logo.
- README.md: this guide.

## Open it locally
Download this repository with Code > Download ZIP and extract it. For a quick look, open index.html, but recording and service workers need a secure context: use HTTPS or localhost.

For development, open the folder in a local web server, for example VS Code Live Server. If Python is already installed, run `python -m http.server 8000` in this folder and visit http://localhost:8000. No build command or package installation is required. Use the GitHub Pages HTTPS address on your phone; an ordinary local-network HTTP address will not permit microphone access.

## Record a thought
1. Choose English or Afrikaans. This is a future transcription setting, not automatic translation or a change of interface language.
2. Press Record and allow microphone access. Keyboard users can Tab to the button and press Enter or Space.
3. Press Stop, or wait for the 60-second limit. Hiding the app stops it early because mobile browsers can suspend timers. Operating system interruptions can also end a recording.
4. Listen with the audio controls or download the recording. Recording creates a Blob (an audio file in memory). A new recording replaces the previous audio.
5. Type or edit in the transcript box. No automatic text appears yet.

Audio and text are not uploaded or saved between sessions. Download anything needed before leaving. The app releases microphone tracks after stopping. If permission is denied, enable it in browser site settings. If no microphone is found, connect one. Unsupported browsers still allow text editing. Browser timers are best-effort: test the duration limit on real devices, especially when the operating system suspends the browser.

## Where transcription will connect
Find transcribe(audioBlob, languageCode) in app.js. It deliberately does nothing except explain the next step. Later, a Cloudflare Worker will receive consented audio, call Groq's Whisper API with a server-side secret, and return text. NEVER add API keys to frontend files or this public repository. Add validation, duration and size checks on the server, rate limits, privacy controls and useful error messages before launch. The AI chat panel is visual only.

## Install and offline use
Visit the HTTPS site in a supported browser. The manifest and service worker prepare the app for installation and offline shell loading after a successful online visit. Use the browser's install menu; on iOS use Share > Add to Home Screen. Install prompts and SVG icon support vary by browser. There is no forced install prompt. Offline recording still needs browser microphone support and permission; offline transcription is not included. For a production release, add tested 192px and 512px PNG icons and an Apple touch icon for wider platform support.

## How updates arrive
For EVERY release, change VERSION in sw.js (for example v1.0.0 to v1.0.1), commit the changed files to main and wait for GitHub Pages to deploy. The app checks the service worker on launch. The new worker downloads the complete versioned shell; a failed download leaves the previous version available. It waits while existing app windows are open, so it will not interrupt recording or unsaved typing. Close all app windows after a new version has downloaded, then open again to use it. Old shell caches are removed on activation. A launch without internet cannot discover an update; it will arrive after an online launch and subsequent reopen. Users do not need to manually install releases. Only the static shell is cached, never recordings, transcript text or future API responses.

## Learn from this
- MediaDevices.getUserMedia asks for microphone permission and provides audio tracks.
- MediaRecorder turns those tracks into chunks. isTypeSupported checks WebM first, then MP4/AAC for browsers such as Safari; the browser default is the final fallback.
- Blob combines chunks into one audio file; URL.createObjectURL lets the audio player use it without uploading.
- Service Worker handles shell caching, versioning and offline loading on HTTPS or localhost.
- The web app manifest describes how an installed web app opens and looks.
- Labels, semantic HTML, aria-live, visible keyboard focus, high contrast and reduced-motion CSS support accessibility.

## Before calling this production ready
Test actual microphone capture, permission denial, 60-second stopping, downloads and installation on Android Chrome, iPhone Safari and desktop browsers. Test screen-reader announcements, keyboard use, 200–400% zoom, offline reload and an update from one VERSION to another. Then build and secure the Worker, connect transcription with consent, and only later implement AI chat. The product name remains undecided.
