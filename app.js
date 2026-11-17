'use strict';
// This prototype stays on the device. There are no transcription network calls.
const recordButton = document.querySelector('#record');
const language = document.querySelector('#language');
const status = document.querySelector('#status');
const duration = document.querySelector('#duration');
const audio = document.querySelector('#audio');
const download = document.querySelector('#download');
const playback = document.querySelector('#playback');
const MAX_MS = 60 * 1000;
let recorder = null;
let stream = null;
let chunks = [];
let timer = null;
let deadline = null;
let startedAt = 0;
let audioURL = null;
let busy = false;
let recordedLanguage = 'en';
// The completed Blob is held only in memory until another recording or page exit.
let recordedAudio = null;
function announce(message) { status.textContent = message; }
function stopTracks() {
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
}
function clearTimers() { clearInterval(timer); clearTimeout(deadline); }
function showDuration() {
  const seconds = Math.min(60, Math.floor((performance.now() - startedAt) / 1000));
  duration.textContent = '00:' + String(seconds).padStart(2, '0');
  if (seconds === 60) duration.textContent = '01:00';
}
// Different browsers support different recording formats. Never assume WebM.
function chooseMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/aac'];
  if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return types.find(type => MediaRecorder.isTypeSupported(type)) || '';
}
function resetControls() {
  busy = false;
  recordButton.disabled = false;
  recordButton.textContent = 'Record';
  recordButton.setAttribute('aria-pressed', 'false');
  language.disabled = false;
}
function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  clearTimers();
  showDuration();
  recordButton.disabled = true;
  announce('Finishing your recording…');
  recorder.stop();
  // Release the microphone immediately, not only after Blob processing.
  stopTracks();
}
async function startRecording() {
  busy = true;
  recordButton.disabled = true;
  language.disabled = true;
  announce('Waiting for microphone permission…');
  try {
    // Request browser speech cleanup and 128 kbps encoding; device/browser support varies.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mimeType = chooseMimeType();
    const options = { audioBitsPerSecond: 128000 };
    if (mimeType) options.mimeType = mimeType;
    recorder = new MediaRecorder(stream, options);
    chunks = [];
    recordedLanguage = language.value;
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      clearTimers();
      stopTracks();
      resetControls();
      // The recorder tells us the real format; do not relabel one format as another.
      recordedAudio = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || '' });
      if (!recordedAudio.size) {
        announce('No audio was captured. Please try recording again.');
        return;
      }
      if (audioURL) URL.revokeObjectURL(audioURL);
      audioURL = URL.createObjectURL(recordedAudio);
      audio.src = audioURL;
      download.href = audioURL;
      const type = recordedAudio.type;
      const extension = type.includes('mp4') ? 'm4a' : type.includes('aac') ? 'aac' : type.includes('webm') ? 'webm' : type.includes('ogg') ? 'ogg' : 'audio';
      download.download = 'voice-recording.' + extension;
      playback.hidden = false;
      transcribe(recordedAudio, recordedLanguage);
    }, { once: true });
    recorder.addEventListener('error', () => {
      clearTimers();
      stopTracks();
      resetControls();
      announce('Recording encountered an error. Please try again.');
    });
    recorder.start(1000);
    startedAt = performance.now();
    duration.textContent = '00:00';
    timer = setInterval(showDuration, 200);
    // A timeout enforces the limit; duration is measured from a monotonic clock.
    deadline = setTimeout(stopRecording, MAX_MS);
    recordButton.disabled = false;
    recordButton.textContent = 'Stop';
    recordButton.setAttribute('aria-pressed', 'true');
    announce('Recording. Press Stop when finished, or recording stops after 60 seconds.');
  } catch (error) {
    clearTimers();
    stopTracks();
    resetControls();
    if (error.name === 'NotAllowedError') announce('Microphone permission was denied. Allow microphone access in your browser settings, then try again.');
    else if (error.name === 'NotFoundError') announce('No microphone was found. Connect one and try again.');
    else announce('The microphone could not start. Check that it is available and try again.');
  }
}
// TRANSCRIPTION STUB: this function intentionally makes no network requests.
async function transcribe(audioBlob, languageCode) {
  // TODO: send audioBlob and languageCode to our future Cloudflare Worker.
  // TODO: the Worker will keep a Groq API key in its server-side secrets.
  // TODO: the Worker will send the audio to Groq's Whisper API and return text.
  // TODO: add consent, file-size limits, validation, rate limits and error handling.
  // TODO: put returned text in the transcript without overwriting the user's edits.
  // NEVER put an API key in this file, HTML, the manifest, or a public repository.
  void audioBlob;
  void languageCode;
  announce('Recording ready to play or download. Transcription is not connected yet. You can type in the transcript box.');
}
const canRecord = window.isSecureContext && navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== 'undefined';
if (!canRecord) {
  recordButton.disabled = true;
  announce('Recording needs a supported browser and HTTPS or localhost. You can still type in the transcript box.');
}
recordButton.addEventListener('click', () => {
  if (recorder?.state === 'recording') stopRecording();
  else if (!busy && canRecord) startRecording();
});
// Stop if the app is hidden: mobile browsers can suspend timers in the background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && recorder?.state === 'recording') stopRecording();
});
window.addEventListener('pagehide', () => {
  clearTimers();
  if (recorder?.state === 'recording') recorder.stop();
  stopTracks();
  if (audioURL) URL.revokeObjectURL(audioURL);
});
// Check for a new shell on every launch. New code takes over on the next launch,
// not by reloading a page while someone is recording or typing.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(registration => registration.update())
      .catch(() => { /* Recording still works if offline setup is unavailable. */ });
  });
}


// Local preferences are optional: recording still works if storage is blocked.
const textSize = document.querySelector('#text-size');
const skin = document.querySelector('#skin');
const settingsStatus = document.querySelector('#settings-status');
function applyPreferences(save = false) {
  document.documentElement.dataset.textSize = textSize.value;
  document.documentElement.dataset.skin = skin.value;
  document.querySelector('meta[name="theme-color"]').content = {celestial:'#030711',emerald:'#102c25',contrast:'#000000'}[skin.value];
  if (save) {
    try {
      localStorage.setItem('sa-voice-text-size', textSize.value);
      localStorage.setItem('sa-voice-skin', skin.value);
      settingsStatus.textContent = 'Settings saved in this browser.';
    } catch { settingsStatus.textContent = 'Settings applied for this visit. Browser storage is unavailable.'; }
  }
}
try {
  const size = localStorage.getItem('sa-voice-text-size');
  const theme = localStorage.getItem('sa-voice-skin');
  if (['large', 'standard'].includes(size)) textSize.value = size;
  if (['celestial', 'emerald', 'contrast'].includes(theme)) skin.value = theme;
} catch { /* Use accessible defaults when storage is unavailable. */ }
applyPreferences();
textSize.addEventListener('change', () => applyPreferences(true));
skin.addEventListener('change', () => applyPreferences(true));
