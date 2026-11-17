'use strict';
// Audio is sent to Groq through our secure Worker.
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

// Public API address, not a secret. All real keys stay in Cloudflare.
const WORKER_URL="https://sa-voice-api.hlatywayoamogelang.workers.dev";
async function requestAI(path,body){if(!navigator.onLine)throw Error('You are offline. Reconnect and try again.');const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),65000);try{const r=await fetch(WORKER_URL+path,{signal:controller.signal,method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(r.status===429?'Free quota reached. Please try again later.':d.error||'Server error. Please try again later.');if(typeof d.text!=='string'||!d.text.trim())throw Error('No result was returned. Please try again.');return d.text;}catch(e){if(e.name==='AbortError')throw Error('The request took too long. Please try again.');if(e instanceof TypeError)throw Error('Could not connect. Check your connection and try again.');throw e;}finally{clearTimeout(timer);}}
// Reject silence locally before any upload. This is a loudness check, not speech recognition.
async function hasAudibleSpeech(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw Error('Audio checking is unavailable in this browser. Try a newer browser.');
  const context = new AudioContextClass();
  let timeout;
  try {
    const decoded = await Promise.race([
      blob.arrayBuffer().then(data => context.decodeAudioData(data)),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Audio checking took too long. Try recording again.')), 8000); })
    ]);
    if (decoded.duration < 0.35) return false;
    const windowSize = Math.max(1, Math.floor(decoded.sampleRate * 0.02));
    let audibleSeconds = 0;
    for (let start = 0; start < decoded.length; start += windowSize) {
      let sum = 0, peak = 0, count = 0;
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const samples = decoded.getChannelData(channel);
        for (let i = start; i < Math.min(start + windowSize, samples.length); i++) {
          const value = samples[i]; sum += value * value; peak = Math.max(peak, Math.abs(value)); count++;
        }
      }
      if (count && Math.sqrt(sum / count) >= 0.004 && peak >= 0.015) audibleSeconds += Math.min(windowSize, decoded.length - start) / decoded.sampleRate;
    }
    return audibleSeconds >= 0.12;
  } catch (error) {
    if (error.message?.includes('took too long')) throw error;
    throw Error('Could not check this recording. Try recording again in a supported browser.');
  } finally {
    clearTimeout(timeout);
    await context.close().catch(() => {});
  }
}
async function transcribe(blob,code){const field=document.querySelector('#transcript'),before=field.value;recordButton.disabled=true;announce('Checking recording…');try{if(!await hasAudibleSpeech(blob)){announce('No speech detected. Try recording again.');return;}announce('Transcribing… Audio is sent to Groq.');const f=new FormData();f.append('file',blob,download.download||'recording.webm');f.append('language',code);const text=await requestAI('/transcribe',f);field.value=field.value===before?text:field.value+'\n'+text;announce('Transcription ready. You can edit it.');}catch(e){announce(e.message||'Could not transcribe. Check your connection.');}finally{if(!busy)recordButton.disabled=false;}}
const languages={"en":"english","zh":"chinese","de":"german","es":"spanish","ru":"russian","ko":"korean","fr":"french","ja":"japanese","pt":"portuguese","tr":"turkish","pl":"polish","ca":"catalan","nl":"dutch","ar":"arabic","sv":"swedish","it":"italian","id":"indonesian","hi":"hindi","fi":"finnish","vi":"vietnamese","he":"hebrew","uk":"ukrainian","el":"greek","ms":"malay","cs":"czech","ro":"romanian","da":"danish","hu":"hungarian","ta":"tamil","no":"norwegian","th":"thai","ur":"urdu","hr":"croatian","bg":"bulgarian","lt":"lithuanian","la":"latin","mi":"maori","ml":"malayalam","cy":"welsh","sk":"slovak","te":"telugu","fa":"persian","lv":"latvian","bn":"bengali","sr":"serbian","az":"azerbaijani","sl":"slovenian","kn":"kannada","et":"estonian","mk":"macedonian","br":"breton","eu":"basque","is":"icelandic","hy":"armenian","ne":"nepali","mn":"mongolian","bs":"bosnian","kk":"kazakh","sq":"albanian","sw":"swahili","gl":"galician","mr":"marathi","pa":"punjabi","si":"sinhala","km":"khmer","sn":"shona","yo":"yoruba","so":"somali","af":"afrikaans","oc":"occitan","ka":"georgian","be":"belarusian","tg":"tajik","sd":"sindhi","gu":"gujarati","am":"amharic","yi":"yiddish","lo":"lao","uz":"uzbek","fo":"faroese","ht":"haitian creole","ps":"pashto","tk":"turkmen","nn":"nynorsk","mt":"maltese","sa":"sanskrit","lb":"luxembourgish","my":"myanmar","bo":"tibetan","tl":"tagalog","mg":"malagasy","as":"assamese","tt":"tatar","haw":"hawaiian","ln":"lingala","ha":"hausa","ba":"bashkir","jw":"javanese","su":"sundanese","yue":"cantonese"};
language.replaceChildren(...Object.entries(languages).sort((a,b)=>a[1].localeCompare(b[1])).map(([code,name])=>{const o=document.createElement('option');o.value=code;o.textContent=name[0].toUpperCase()+name.slice(1);return o;}));language.value='en';
const panel=document.querySelector('aside');panel.innerHTML=`<h2>AI assistant</h2><p>Submitted audio, messages and photos go to Groq for processing through our secure server. We do not save this content. Do not submit private information. AI may be wrong.</p><section aria-labelledby="chat-title"><h3 id="chat-title">Chat</h3><div id="messages" role="log" aria-live="polite"></div><form id="chat-form"><label for="chat-input">Your message</label><textarea id="chat-input" maxlength="4000" required rows="3"></textarea><button id="send" type="submit">Send message</button></form><p id="chat-status" role="status" aria-live="polite"></p></section><section aria-labelledby="photo-title"><h3 id="photo-title">Describe a photo</h3><p>Descriptions may be wrong. Never rely on this for navigation, medicine or identifying people.</p><label for="camera">Take a picture</label><input type="file" id="camera" accept="image/*" capture="environment"><label for="gallery">Choose from gallery</label><input type="file" id="gallery" accept="image/*"><button type="button" id="describe">Describe a photo</button><p id="photo-status" role="status" aria-live="polite"></p><div id="description" role="region" aria-label="Photo description" tabindex="0" style="white-space:pre-wrap"></div></section><section><h3>Search the web</h3><p>Not connected: free access to Groq web search has not been confirmed. Chat does not browse the web.</p></section>`;
const history=[],msg=document.querySelector('#chat-input'),send=document.querySelector('#send'),cs=document.querySelector('#chat-status');
function addMessage(who,text){const p=document.createElement('p');p.style.whiteSpace='pre-wrap';p.textContent=who+': '+text;document.querySelector('#messages').append(p);}
document.querySelector('#chat-form').addEventListener('submit',async e=>{e.preventDefault();if(send.disabled)return;const message=msg.value.trim();if(!message)return;send.disabled=true;cs.textContent='Assistant is typing…';addMessage('You',message);msg.value='';try{const text=await requestAI('/chat',{message,history});addMessage('Assistant',text);history.push({role:'user',content:message},{role:'assistant',content:text});if(history.length>8)history.splice(0,history.length-8);cs.textContent='Reply ready.';}catch(e){cs.textContent=e.message||'Could not send. Check your connection.';}finally{send.disabled=false;}});
let photo=null;const ps=document.querySelector('#photo-status');for(const id of ['camera','gallery'])document.getElementById(id).addEventListener('change',e=>{photo=e.target.files[0]||null;ps.textContent=photo?'Photo selected. Press Describe a photo to send it.':'';});
async function compressPhoto(file){if(file.size>25*1024*1024)throw Error('Choose a photo smaller than 25 MB.');const image=await createImageBitmap(file),scale=Math.min(1,1024/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.close();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8));if(!blob)throw Error('Try a JPEG or PNG photo.');return blob;}
document.querySelector('#describe').addEventListener('click',async e=>{if(e.target.disabled)return;if(!photo){ps.textContent='Take a picture or choose one first.';return;}e.target.disabled=true;ps.textContent='Describing…';try{const blob=await compressPhoto(photo),f=new FormData();f.append('file',blob,'photo.jpg');const text=await requestAI('/describe',f);document.querySelector('#description').textContent=text;ps.textContent='Description ready. Uploaded '+Math.ceil(blob.size/1024)+' KB. Mobile data charges may apply.';}catch(e){ps.textContent=e.message||'Could not describe this photo. Try JPEG or PNG.';}finally{e.target.disabled=false;}});
announce('Ready. Stopping a recording sends the audio to Groq for transcription.');
