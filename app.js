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
let leavingPage = false;
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
      if (leavingPage) { chunks=[]; recordedAudio=null; return; }
      resetControls();
      // The recorder tells us the real format; do not relabel one format as another.
      recordedAudio = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || '' });
      chunks = [];
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
window.addEventListener('pageshow', () => { leavingPage = false; });
window.addEventListener('pagehide', () => {
  leavingPage = true;
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
function addMessage(who,text){const p=document.createElement('p');p.style.whiteSpace='pre-wrap';p.textContent=who+': '+text;const log=document.querySelector('#messages');log.append(p);while(log.children.length>24)log.firstElementChild.remove();}
document.querySelector('#chat-form').addEventListener('submit',async e=>{e.preventDefault();if(send.disabled)return;const message=msg.value.trim();if(!message)return;send.disabled=true;cs.textContent='Assistant is typing…';addMessage('You',message);msg.value='';try{if(await routeCommand(message))return;const text=await requestAI('/chat',{message,history});lastAnswer=text;addMessage('Assistant',text);history.push({role:'user',content:message},{role:'assistant',content:text});if(history.length>8)history.splice(0,history.length-8);cs.textContent='Reply ready.';}catch(e){cs.textContent=e.message||'Could not send. Check your connection.';}finally{send.disabled=false;}});
let photo=null;const ps=document.querySelector('#photo-status');for(const id of ['camera','gallery'])document.getElementById(id).addEventListener('change',e=>{photo=e.target.files[0]||null;ps.textContent=photo?'Photo selected. Press Describe a photo to send it.':'';});
async function compressPhoto(file){if(file.size>25*1024*1024)throw Error('Choose a photo smaller than 25 MB.');const image=await createImageBitmap(file),scale=Math.min(1,1024/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.close();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8));if(!blob)throw Error('Try a JPEG or PNG photo.');return blob;}
document.querySelector('#describe').addEventListener('click',async e=>{if(e.target.disabled)return;if(!photo){ps.textContent='Take a picture or choose one first.';return;}e.target.disabled=true;ps.textContent='Describing…';try{const blob=await compressPhoto(photo),f=new FormData();f.append('file',blob,'photo.jpg');const text=await requestAI('/describe',f);document.querySelector('#description').textContent=text;lastAnswer=text;ps.textContent='Description ready. Uploaded '+Math.ceil(blob.size/1024)+' KB. Mobile data charges may apply.';}catch(e){ps.textContent=e.message||'Could not describe this photo. Try JPEG or PNG.';}finally{e.target.disabled=false;}});
announce('Ready. Stopping a recording sends the audio to Groq for transcription.');

// Free search and a no-key video player. Conversations stay in memory only.
let lastAnswer='';
const tools=document.createElement('section');tools.setAttribute('aria-label','Search and video tools');document.querySelector('main').append(tools);
function el(tag,text,parent=tools){const n=document.createElement(tag);if(text)n.textContent=text;parent.append(n);return n;}
function button(text,fn,parent=tools){const b=el('button',text,parent);b.type='button';b.addEventListener('click',fn);return b;}
function link(text,url,parent=tools){const a=el('a',text,parent);a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.style.display='block';return a;}
el('h2','Search, listen and watch');el('p','Type search for a topic, play gospel music, or play a video about farming in chat. Search uses Wikipedia. Video discovery opens YouTube; paste a video link here to play it.');
const results=el('div');results.setAttribute('aria-live','polite');
button('Read latest answer aloud',()=>{if(!window.speechSynthesis){cs.textContent='Speech output is unavailable in this browser.';return;}speechSynthesis.cancel();if(lastAnswer){const u=new SpeechSynthesisUtterance(lastAnswer);u.lang='en-ZA';speechSynthesis.speak(u);}else cs.textContent='Search or ask a question first.';});
button('Stop reading',()=>window.speechSynthesis?.cancel());
button('Use transcript in chat',()=>{msg.value=document.querySelector('#transcript').value;msg.focus();});
let searchBusy=false;
async function wiki(params){const c=new AbortController(),t=setTimeout(()=>c.abort(),12000);try{const r=await fetch('https://en.wikipedia.org/w/api.php?origin=*&format=json&'+new URLSearchParams(params),{signal:c.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)throw Error('Wikipedia is unavailable.');const reader=r.body.getReader();let size=0,parts=[];while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>262144){await reader.cancel();throw Error('Article is too large. Open its source link.');}parts.push(part.value);}const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}const d=JSON.parse(new TextDecoder().decode(bytes));if(d.error)throw Error('Wikipedia could not answer.');return d;}finally{clearTimeout(t);}}
async function searchWeb(q){if(searchBusy)return;searchBusy=true;results.replaceChildren();cs.textContent='Searching Wikipedia…';for(const [name,url] of [['DuckDuckGo','https://duckduckgo.com/?q='],['Bing','https://www.bing.com/search?q='],['Google','https://www.google.com/search?q='],['Yahoo','https://search.yahoo.com/search?p=']])link('Search '+name+' for '+q,url+encodeURIComponent(q),results);try{const d=await wiki({action:'query',generator:'search',gsrsearch:q,gsrlimit:'1',prop:'extracts',explaintext:'1',exintro:'1',exchars:'1200'});const p=Object.values(d.query?.pages||{})[0];if(!p)throw Error('No Wikipedia answer. Try a search link.');lastAnswer='Wikipedia — '+p.title+'. '+(p.extract||'No summary is available.');addMessage('Wikipedia',lastAnswer);link('Source: Wikipedia — '+p.title,'https://en.wikipedia.org/?curid='+p.pageid,results);button('Read more from this Wikipedia article',async()=>{cs.textContent='Loading article text…';try{const more=await wiki({action:'query',pageids:String(p.pageid),prop:'extracts',explaintext:'1',exlimit:'1'});lastAnswer='Wikipedia — '+p.title+'. '+(more.query.pages[p.pageid].extract||'No article text.').slice(0,6000);addMessage('Wikipedia',lastAnswer);cs.textContent='Article text ready. Use Read latest answer aloud.';}catch{cs.textContent='Article could not load. Open its source link.';}},results);cs.textContent='Wikipedia answer ready. Check the named source; it may be incomplete.';}catch(e){cs.textContent=e.name==='AbortError'?'Search timed out. Use a search link.':e.message;}finally{searchBusy=false;}}
el('h3','YouTube player');el('p','YouTube may show ads. Some videos cannot be embedded. Backgrounding the app or locking the screen can pause playback. Opening a player contacts YouTube.');
const label=el('label','YouTube video link');const videoInput=el('input');videoInput.type='url';videoInput.id='youtube-link';label.htmlFor=videoInput.id;videoInput.placeholder='https://www.youtube.com/watch?v=…';videoInput.style.width='100%';
let frame=null,currentVideo=null;
function videoId(value){try{const u=new URL(value);if(u.protocol!=='https:')return null;const h=u.hostname.toLowerCase();let id;if(h==='youtu.be')id=u.pathname.split('/')[1];else if(['youtube.com','www.youtube.com','m.youtube.com'].includes(h))id=u.searchParams.get('v')||(['shorts','embed'].includes(u.pathname.split('/')[1])?u.pathname.split('/')[2]:null);return /^[A-Za-z0-9_-]{11}$/.test(id||'')?id:null;}catch{return null;}}
function pauseMedia(){window.speechSynthesis?.cancel();audio.pause();if(frame)frame.contentWindow?.postMessage(JSON.stringify({event:'command',func:'pauseVideo',args:[]}),'https://www.youtube-nocookie.com');}
function playVideo(id){if(!/^[A-Za-z0-9_-]{11}$/.test(id))return;pauseMedia();currentVideo=id;if(frame)frame.remove();frame=el('iframe');frame.title='YouTube video player';frame.src='https://www.youtube-nocookie.com/embed/'+id+'?enablejsapi=1&playsinline=1&origin='+encodeURIComponent(location.origin);frame.allow='encrypted-media; picture-in-picture; fullscreen';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';frame.style.cssText='width:100%;max-width:720px;aspect-ratio:16/9;border:0';fallback.href='https://www.youtube.com/watch?v='+id;cs.textContent='Player ready. Press Play inside it. If unavailable, use Open video on YouTube.';}
button('Load YouTube video',()=>{const id=videoId(videoInput.value.trim());if(id)playVideo(id);else cs.textContent='Paste a valid HTTPS YouTube video link.';});
const fallback=link('Open video on YouTube','https://www.youtube.com/');
let favourites=[];try{const saved=JSON.parse(localStorage.getItem('puiso-video-favourites')||'[]');if(Array.isArray(saved))favourites=saved.filter(v=>v&&/^[A-Za-z0-9_-]{11}$/.test(v.id)&&typeof v.name==='string').slice(0,24);}catch{}
const favLabel=el('label','Favourite name');const favName=el('input');favName.id='video-favourite-name';favLabel.htmlFor=favName.id;favName.maxLength=100;
const favList=el('div');favList.setAttribute('aria-label','Favourite videos');
function saveFavourites(){try{localStorage.setItem('puiso-video-favourites',JSON.stringify(favourites));cs.textContent='Favourites saved on this device only.';}catch{cs.textContent='Favourites work for this visit only. Storage is unavailable.';}renderFavourites();}
function renderFavourites(){favList.replaceChildren();for(const v of favourites){const row=el('div',null,favList);button('Play '+v.name,()=>playVideo(v.id),row);button('Remove '+v.name,()=>{favourites=favourites.filter(x=>x.id!==v.id);saveFavourites();},row);}}
button('Save current video as favourite',()=>{if(!currentVideo){cs.textContent='Load a video first.';return;}const name=favName.value.trim();if(!name){cs.textContent='Give the favourite a name first.';favName.focus();return;}favourites=favourites.filter(v=>v.id!==currentVideo);favourites.unshift({id:currentVideo,name:name.slice(0,100)});favourites=favourites.slice(0,24);saveFavourites();});renderFavourites();
recordButton.addEventListener('click',pauseMedia,true);document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseMedia();});window.addEventListener('pagehide',pauseMedia);
async function routeCommand(text){const q=/^(?:search(?: the web)?(?: for)?|look up)\s+(.+)/i.exec(text);if(q){await searchWeb(q[1].slice(0,200));return true;}if(/^play\s+/i.test(text)){const id=videoId(text.slice(5).trim());if(id)playVideo(id);else{results.replaceChildren();link('Find '+text.slice(5)+' on YouTube','https://www.youtube.com/results?search_query='+encodeURIComponent(text.slice(5).slice(0,200)),results);cs.textContent='Open YouTube search, choose a video, then paste its link into the player. Automatic video discovery is not connected.';}return true;}return false;}

// Design preview only: no account or payment integration.
const settings=el('section');settings.setAttribute('aria-labelledby','optional-settings-title');
el('h2','Optional account and plans',settings).id='optional-settings-title';
el('p','Design preview only. All existing features remain free. No account is required. No payments can be made here.',settings);
el('h3','Optional account and two-factor verification',settings);
el('p','Not configured. A future optional account would use email and password with an authenticator app, a manual setup key alternative to QR codes, and recovery instructions. Anonymous use would remain available. This preview provides no login or two-factor protection.',settings);
for(const name of ['Create optional account — not available','Sign in — not available','Set up two-factor verification — not available'])button(name,()=>{},settings).disabled=true;
el('h3','Free — R0',settings);el('p','Voice, chat, photo descriptions, search, YouTube links and player, favourites, read aloud, large text and high-contrast access remain free. AI and third-party limits still apply.',settings);
el('h3','Cosmetic Plus — proposed R29 per month',settings);el('p','Future lightweight theme library and editor only. No extra AI quota, accuracy guarantee or background YouTube playback. Not available to purchase.',settings);button('Subscribe — payments not connected',()=>{},settings).disabled=true;
el('h3','Optional skins',settings);el('p','Proposed CSS skin: R19 once. Proposed personalised selfie skin: R39 once, with the photo kept on the device only. Future designs, not delivered products. No selfie is collected by this preview. Free accessible high-contrast choices must remain available. Preview before purchase.',settings);
button('Buy CSS skin — not available',()=>{},settings).disabled=true;button('Buy selfie skin — not available',()=>{},settings).disabled=true;
el('p','Suggested gateway: Paystack hosted card checkout, subject to merchant verification. Payments stay disabled until the owner has a verified business account, approved terms and cancellation/refund rules, and secure server-side verified payments and entitlements. This preview never asks for a card.',settings);
