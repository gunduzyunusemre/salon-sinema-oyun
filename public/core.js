/*
 * Salon — istemci çekirdeği
 * Bağlantı, oda durumu, mikrofon/kamera/ekran ağı (WebRTC), kişi kutucukları,
 * sohbet, tepkiler ve etkinlik değiştirme burada. Etkinlikler games/*.js
 * dosyalarında App.register(...) ile eklenir.
 */
(function(){
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store={get(k,d){try{const v=localStorage.getItem('salon-'+k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem('salon-'+k,JSON.stringify(v))}catch(e){}}};
const vib=p=>{try{navigator.vibrate&&navigator.vibrate(p)}catch(e){}};
const LETTER_COLORS=['#ff4d6d','#ffbf1f','#5b4dff','#19b394','#2fa4ff','#ff8a3d'];
const REACTIONS=['😂','😮','🔥','👏','❤️','👀'];
const MOBILE=matchMedia('(max-width: 899px)');

const GAMES={},ORDER=[];
let ACT=null; // şu an ekranda olan etkinlik modülünün kimliği
function callAct(fn,...a){const g=ACT&&GAMES[ACT];if(g&&typeof g[fn]==='function'){try{return g[fn](...a)}catch(e){console.error(ACT+'.'+fn,e)}}return undefined}

let toastT;
const toastHooks=[];
function toast(t){
  const el=$('#toast');el.textContent=t;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),2600);
  toastHooks.forEach(f=>{try{f(t)}catch(e){}});
}
function banner(t,color){const b=$('#banner');b.textContent='';const s=document.createElement('span');s.style.setProperty('--pc',color||'#5b4dff');s.textContent=t;b.appendChild(s);setTimeout(()=>{if(b.contains(s))s.remove()},1500)}
function show(sel){document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));$(sel).classList.remove('hidden')}
function openM(sel){$(sel).classList.remove('hidden')}
function closeM(sel){$(sel).classList.add('hidden')}
document.querySelectorAll('.overlay').forEach(o=>{
  o.addEventListener('click',e=>{if(e.target===o||e.target.hasAttribute('data-close'))o.classList.add('hidden')});
});
function codeTiles(el,code){
  el.textContent='';
  [...code].forEach((ch,i)=>{const s=document.createElement('span');s.textContent=ch;s.style.background=LETTER_COLORS[i%LETTER_COLORS.length];if(i%LETTER_COLORS.length===1)s.style.color='#1d1846';el.appendChild(s)});
}

/* ---------- Tema ---------- */
const THEMES={auto:'🌓 Tema: otomatik',light:'☀️ Tema: açık',dark:'🌙 Tema: koyu'};
let theme=store.get('theme','auto');
const themeHooks=[];
function applyTheme(){
  if(theme==='auto')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;
  $('#mTheme').textContent=THEMES[theme];
  themeHooks.forEach(f=>{try{f(theme)}catch(e){}});
}
$('#mTheme').addEventListener('click',()=>{theme=theme==='auto'?'light':theme==='light'?'dark':'auto';store.set('theme',theme);applyTheme()});

/* =====================================================================
   SUNUCU BAĞLANTISI
   ===================================================================== */
const NET={ws:null,id:null,cid:null,code:null,connected:false,want:false,connecting:null,retry:0,retryT:null,creating:false,offset:0};
let R=null; // oda durumu (sunucudan)
function rid(){const ch='abcdefghijklmnopqrstuvwxyz0123456789';let s='';for(let i=0;i<20;i++)s+=ch[Math.floor(Math.random()*ch.length)];return s}
NET.id=store.get('id',null);
if(typeof NET.id!=='string'||!/^[a-z0-9]{20}$/.test(NET.id)){NET.id=rid();store.set('id',NET.id)}
function myName(){return($('#nameIn').value.trim()||'Misafir').slice(0,14)}
$('#nameIn').value=store.get('name','')||'';
$('#nameIn').addEventListener('input',()=>store.set('name',$('#nameIn').value));
$('#codeIn').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4)});
function setHash(code){try{history.replaceState(null,'',code?'#'+code:location.pathname+location.search)}catch(e){}}
function connStatus(){$('#conn').classList.toggle('hidden',!NET.want||NET.connected)}
function send(o){if(NET.ws&&NET.ws.readyState===1){NET.ws.send(JSON.stringify(o));return true}return false}
function connect(){
  if(location.protocol==='file:'||!location.host)return Promise.reject(new Error('nohost'));
  NET.want=true;
  if(NET.ws&&NET.ws.readyState===1)return Promise.resolve();
  if(NET.connecting)return NET.connecting;
  NET.connecting=new Promise((res,rej)=>{
    let ws;
    try{ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws')}catch(e){NET.connecting=null;return rej(e)}
    NET.ws=ws;let opened=false;
    const timer=setTimeout(()=>{if(!opened)try{ws.close()}catch(e){}},9000);
    ws.onopen=()=>{
      opened=true;clearTimeout(timer);NET.connected=true;NET.retry=0;NET.connecting=null;
      send({t:'hello',id:NET.id,name:myName()});
      if(NET.code){
        send({t:'join',code:NET.code,name:myName()});
        sendMedia();
        callAct('reconnect'); // kısa kopmadan sonra etkinlik kaldığı yerden sürsün
      }
      connStatus();res();
    };
    ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch(_){return}onMsg(m)};
    ws.onclose=()=>{
      clearTimeout(timer);
      if(NET.ws===ws){NET.ws=null;NET.connected=false;NET.cid=null;closeAllPCs()}
      if(!opened){NET.connecting=null;rej(new Error('closed'))}
      connStatus();if(NET.want)scheduleReconnect();
    };
  });
  return NET.connecting;
}
function scheduleReconnect(){
  clearTimeout(NET.retryT);
  const d=Math.min(8000,600*Math.pow(1.6,NET.retry++));
  NET.retryT=setTimeout(()=>{if(NET.want&&!NET.connected)connect().catch(()=>{})},d);
}
// Ücretsiz bulut sunucuları boşta kalınca uyur: arada bir sinyal gönder
setInterval(()=>{if(NET.connected)send({t:'alive'})},4*60*1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&NET.want&&!NET.connected){NET.retry=0;connect().catch(()=>{})}});

function onMsg(m){
  switch(m.t){
    case 'welcome':NET.cid=m.cid;break;
    case 'state':onState(m);break;
    case 'history':CHAT.list=Array.isArray(m.list)?m.list:[];renderChat();break;
    case 'chat':onChat(m.m);break;
    case 'rtc':onRtc(m.from,m.data);break;
    case 'react':onReact(m.pid,m.e);break;
    case 'notice':toast(m.msg);break;
    case 'error':
      toast(m.msg||'Bir hata oluştu');
      NET.creating=false;$('#createBtn').disabled=false;$('#joinBtn').disabled=false;
      if(m.code==='noroom'||m.code==='full')leaveRoom(true);
      callAct('error',m);
      break;
    default:callAct('msg',m); // etkinliğe özel mesajlar
  }
}

/* =====================================================================
   GİRİŞ
   ===================================================================== */
const secureOk=()=>window.isSecureContext;
function netReady(){
  if(location.protocol==='file:'||!location.host){$('#netMsg').textContent='Sayfayı sunucunun verdiği adresten aç (örnek: http://localhost:3000).';return false}
  return true;
}
$('#createBtn').addEventListener('click',()=>{
  if(!netReady())return;
  if(!$('#nameIn').value.trim()){$('#nameIn').focus();toast('Önce adını yaz');return}
  $('#createBtn').disabled=true;NET.creating=true;NET.code=null;
  ensureAudio();
  connect().then(()=>send({t:'create',name:myName()})).catch(()=>{toast('Sunucuya bağlanılamadı');$('#createBtn').disabled=false;NET.creating=false});
});
function doJoin(){
  if(!netReady())return;
  const code=$('#codeIn').value.trim().toUpperCase();
  if(code.length!==4){$('#codeIn').focus();toast('4 harfli salon kodunu yaz');return}
  if(!$('#nameIn').value.trim()){$('#nameIn').focus();toast('Önce adını yaz');return}
  $('#joinBtn').disabled=true;NET.code=code;
  ensureAudio();
  // Bağlantı yeni açılıyorsa katılma mesajını açılış anında kendisi gönderir
  if(NET.connected)send({t:'join',code,name:myName()});
  else connect().catch(()=>{toast('Sunucuya bağlanılamadı');$('#joinBtn').disabled=false});
}
$('#joinBtn').addEventListener('click',doJoin);
$('#codeIn').addEventListener('keydown',e=>{if(e.key==='Enter')doJoin()});
$('#nameIn').addEventListener('keydown',e=>{if(e.key==='Enter'){if($('#codeIn').value.length===4)doJoin();else $('#createBtn').click()}});
$('#showCreate').addEventListener('click',()=>{$('#createBox').classList.remove('hidden');$('#showCreate').classList.add('hidden');$('#invited').classList.add('hidden');$('#joinBtn').classList.replace('sun','soft')});
function initHome(){
  const h=(location.hash||'').replace('#','').toUpperCase();
  if(/^[A-Z0-9]{4}$/.test(h)){
    $('#codeIn').value=h;
    const inv=$('#invited');inv.textContent='🎉 '+h+' salonuna davet edildin. Adını yaz ve Katıl\'a bas.';inv.classList.remove('hidden');
    $('#createBox').classList.add('hidden');$('#showCreate').classList.remove('hidden');
    $('#joinBtn').classList.replace('soft','sun');
    setTimeout(()=>$('#nameIn').focus(),200);
  }
  if(!secureOk()&&location.hostname!=='localhost')$('#netMsg').textContent='Mikrofon, kamera ve sekme paylaşımı için sayfa https ile açılmalı. Render adresini ya da tünel bağlantısını kullan.';
}

function leaveRoom(silent){
  if(!silent)send({t:'leave'});
  unmountAct();
  setScreen(null);stopCam();stopMic();closeAllPCs();
  R=null;NET.code=null;CHAT.list=[];CHAT.unread=0;renderUnread();setHash('');
  for(const k in TILES){TILES[k].el.remove();delete TILES[k]}
  $('#createBtn').disabled=false;$('#joinBtn').disabled=false;NET.creating=false;
  document.querySelectorAll('.overlay').forEach(o=>o.classList.add('hidden'));
  show('#home');
}
$('#mLeave').addEventListener('click',()=>leaveRoom(false));

/* =====================================================================
   ODA DURUMU
   ===================================================================== */
const findP=id=>R&&R.players.find(p=>p.id===id);
const nameOf=id=>{const p=findP(id);return p?p.name:'?'};
const colorOf=id=>{const p=findP(id);return p?p.color:'#5b4dff'};
const amHost=()=>!!R&&R.host===NET.id;
const onlineCount=()=>R?R.players.filter(p=>p.online).length:0;
function peerPid(cid){const x=R&&R.peers.find(p=>p.cid===cid);return x?x.pid:null}

function onState(s){
  const first=!R||R.code!==s.code;
  R=s;NET.offset=(+s.now||Date.now())-Date.now();
  if(first){
    NET.code=s.code;setHash(s.code);show('#room');
    $('#createBtn').disabled=false;$('#joinBtn').disabled=false;
    codeTiles($('#miniCode'),s.code);codeTiles($('#bigCode'),s.code);
    $('#inviteLink').value=location.origin+location.pathname+'#'+s.code;
    if(NET.creating){NET.creating=false;openM('#inviteM')}
  }
  if(s.activity!==ACT){unmountAct();if(s.activity)mountAct(s.activity)}
  syncPeers();
  if(ACT)callAct('state',s.game,s); // önce etkinlik güncellensin, rozetler ve üst satır ona göre çizilsin
  renderRoom();
}

function mountAct(id){
  const g=GAMES[id];if(!g)return;
  ACT=id;
  const root=$('#actRoot');root.textContent='';root.className='g-'+(g.css||id);
  try{g.mount(root,$('#actCtrl'))}catch(e){console.error(e)}
  closeM('#setupM');
}
function unmountAct(){
  if(!ACT)return;
  const had=GAMES[ACT]&&GAMES[ACT].linkAction;
  callAct('unmount');
  ACT=null;
  $('#actRoot').textContent='';$('#actRoot').className='';$('#actCtrl').textContent='';
  if(had)renderChat(); // etkinliğe özel link düğmeleri kalksın
}

function renderRoom(){
  if(!R)return;
  const g=ACT&&GAMES[ACT];
  const al=$('#actLine');al.textContent='';
  if(g){const b=document.createElement('b');b.textContent=g.icon+' '+g.title;al.append(b);const extra=callAct('line');if(extra)al.append(' · '+extra)}
  else{const b=document.createElement('b');b.textContent='🛋️ Salon';al.append(b,' · '+onlineCount()+' kişi')}
  $('#room').classList.toggle('busy',!!ACT);
  $('#lounge').classList.toggle('hidden',!!ACT);
  renderTiles();renderLounge();renderCtrl();
}

/* ---------- Salon: etkinlik seçimi ---------- */
function renderLounge(){
  if(ACT||!R)return;
  const host=amHost(),n=onlineCount();
  $('#loungeSub').textContent=host?'Bir etkinlik seç, herkesin ekranında birlikte açılır.':nameOf(R.host)+' bir etkinlik seçince herkesin ekranında açılır.';
  const grid=$('#actGrid');grid.textContent='';
  ORDER.forEach(id=>{
    const g=GAMES[id];
    const b=document.createElement('button');b.type='button';b.className='actcard';b.style.setProperty('--ac',g.color||'#5b4dff');
    const ai=document.createElement('span');ai.className='ai';ai.textContent=g.icon;
    const txt=document.createElement('span');txt.className='txt';
    const t=document.createElement('b');t.textContent=g.title;
    const d=document.createElement('small');d.textContent=g.blurb||'';
    txt.append(t,d);
    let need='',warn=false;
    if(g.minPlayers&&n<g.minPlayers){need='En az '+g.minPlayers+' kişi lazım';warn=true}
    else if(g.maxPlayers&&n>g.maxPlayers){need='En fazla '+g.maxPlayers+' kişi';warn=true}
    else if(g.minPlayers)need=g.minPlayers+'+ kişi';
    else if(g.maxPlayers)need='En fazla '+g.maxPlayers+' kişi';
    if(need){const nd=document.createElement('span');nd.className='need'+(warn?' warn':'');nd.textContent=need;txt.appendChild(nd)}
    b.append(ai,txt);
    if(host&&!warn){const go=document.createElement('span');go.className='go';go.textContent=g.setup?'Ayarla ve başlat':'Başlat';b.appendChild(go)}
    b.disabled=!host||warn;
    b.setAttribute('aria-label',g.title+(need?', '+need:''));
    b.addEventListener('click',()=>pickActivity(id));
    grid.appendChild(b);
  });
  $('#loungeNote').textContent=n<2?'Davet et düğmesiyle arkadaşlarını çağır.':'';
}
let setupFn=null,setupId=null;
function pickActivity(id){
  if(!amHost())return;
  const g=GAMES[id];
  if(!g.setup){send({t:'activity',id,opts:{}});return}
  setupId=id;
  $('#setupTitle').textContent=g.icon+' '+g.title;
  const body=$('#setupBody');body.textContent='';
  setupFn=g.setup(body);
  $('#setupGo').disabled=false;$('#setupGo').textContent='Başlat';
  openM('#setupM');
}
$('#setupGo').addEventListener('click',async()=>{
  if(!setupFn||!setupId)return;
  const btn=$('#setupGo');btn.disabled=true;btn.textContent='Başlatılıyor…';
  try{
    const opts=await setupFn();
    if(!opts)return;
    if(!send({t:'activity',id:setupId,opts}))toast('Bağlantı yok, tekrar dene');
  }catch(e){console.error(e);toast('Başlatılamadı')}
  finally{setTimeout(()=>{btn.disabled=false;btn.textContent='Başlat'},900)}
});
function endActivity(){if(amHost())send({t:'activity',id:null})}

/* ---------- Menü, davet ---------- */
$('#codeChip').addEventListener('click',()=>openM('#inviteM'));
$('#mInvite').addEventListener('click',()=>{closeM('#menuM');openM('#inviteM')});
$('#menuBtn').addEventListener('click',()=>{
  const box=$('#mGame');box.textContent='';
  const items=callAct('menu')||[];
  items.forEach(it=>{
    const b=document.createElement('button');b.type='button';b.className='btn '+(it.cls||'soft');b.textContent=it.label;
    b.addEventListener('click',()=>{closeM('#menuM');it.onClick()});box.appendChild(b);
  });
  box.classList.toggle('hidden',!items.length);
  $('#mLounge').classList.toggle('hidden',!(ACT&&amHost()));
  openM('#menuM');
});
$('#mLounge').addEventListener('click',()=>{closeM('#menuM');endActivity()});
$('#copyBtn').addEventListener('click',async()=>{
  const v=$('#inviteLink').value;
  try{await navigator.clipboard.writeText(v);toast('Bağlantı kopyalandı')}
  catch(e){const i=$('#inviteLink');i.focus();i.select();try{document.execCommand('copy');toast('Bağlantı kopyalandı')}catch(_){toast('Bağlantıyı elle kopyala')}}
});
$('#nativeShare').classList.toggle('hidden',!navigator.share);
$('#nativeShare').addEventListener('click',()=>{
  if(!navigator.share||!R)return;
  navigator.share({title:'Salon',text:'Salonuma katıl! Kod: '+R.code,url:$('#inviteLink').value}).catch(()=>{});
});

/* ---------- Kişi kutucukları ---------- */
const TILES={};
function renderTiles(){
  if(!R)return;
  const online=R.players.filter(p=>p.online);
  const ids=new Set(online.map(p=>p.id));
  for(const k in TILES)if(!ids.has(k)){TILES[k].el.remove();delete TILES[k]}
  const home=ACT?$('#strip'):$('#loungeTiles');
  online.forEach(p=>{
    let T=TILES[p.id];
    if(!T){
      const el=document.createElement('div');el.className='tile';
      const v=document.createElement('video');v.autoplay=true;v.muted=true;v.playsInline=true;v.setAttribute('playsinline','');
      const av=document.createElement('div');av.className='av';const i=document.createElement('i');av.appendChild(i);
      const nm=document.createElement('div');nm.className='nm';const sp=document.createElement('span');const em=document.createElement('em');nm.append(sp,em);
      el.append(v,av,nm);
      el.addEventListener('click',()=>{if(p.id!==NET.id)callAct('tileClick',p.id)});
      T=TILES[p.id]={el,v,i,sp,em};
    }
    if(T.el.parentNode!==home)home.appendChild(T.el);
    const me=p.id===NET.id;
    const info=me?{mic:micLive(),cam:!!LOC.cam}:(R.peers.filter(x=>x.pid===p.id).pop()||{mic:false,cam:false});
    T.el.style.setProperty('--pc',p.color);
    T.i.textContent=(p.name[0]||'?').toLocaleUpperCase('tr-TR');
    const badge=callAct('badge',p.id)||'';
    T.sp.textContent=(p.id===R.host?'👑 ':'')+badge+p.name+(me?' (sen)':'');
    T.el.title=p.name;
    T.em.textContent=info.mic?'🎙️':'🔇';
    let stream=null;
    if(me)stream=LOC.cam?LOC.camStream:null;
    else if(info.cam&&info.cid&&PCS[info.cid])stream=PCS[info.cid].cam;
    if(T.v.srcObject!==stream)T.v.srcObject=stream;
    if(stream)T.v.play().catch(()=>{});
    T.el.classList.toggle('camon',!!stream);
    T.el.classList.toggle('mirror',me);
    T.el.classList.toggle('clickable',!me&&!!callAct('tileClickable',p.id));
    T.el.classList.toggle('speaking',AUD.speaking.has(p.id));
  });
}
function playAll(){for(const k in TILES){const v=TILES[k].v;if(v.srcObject)v.play().catch(()=>{})}}

/* =====================================================================
   YEREL MEDYA: mikrofon, kamera, ekran paylaşımı
   Her bağlantıda 4 sabit kanal var: 0 mikrofon, 1 kamera, 2 ekran görüntüsü,
   3 ekran sesi. Açıp kapatmak sadece kanaldaki parçayı değiştirir, bağlantı
   yeniden kurulmaz.
   ===================================================================== */
const LOC={mic:null,micStream:null,micOn:false,held:false,cam:null,camStream:null,scr:null,quality:store.get('quality','motion')};
const KINDS=['audio','video','video','audio'];
const micLive=()=>!!LOC.mic&&LOC.micOn;
function slotTrack(i){
  if(i===0)return LOC.mic;
  if(i===1)return LOC.cam;
  if(i===2)return LOC.scr?LOC.scr.getVideoTracks()[0]||null:null;
  if(i===3)return LOC.scr?LOC.scr.getAudioTracks()[0]||null:null;
  return null;
}
function replaceSlot(i){
  for(const cid in PCS){
    const tr=PCS[cid].pc.getTransceivers()[i];
    if(tr&&tr.sender)tr.sender.replaceTrack(slotTrack(i)).catch(e=>console.warn('replace',e));
  }
  if(i===2||i===1)setTimeout(applyQuality,300);
}
function sendMedia(){send({t:'media',mic:micLive(),cam:!!LOC.cam})}
function needSecure(){if(!secureOk()){toast('Bunun için sayfa https ile açılmalı');return true}if(!navigator.mediaDevices){toast('Bu tarayıcı desteklemiyor');return true}return false}
function applyMicEnabled(){if(LOC.mic)LOC.mic.enabled=LOC.micOn&&!LOC.held}

async function toggleMic(){
  ensureAudio();
  if(!LOC.mic){
    if(needSecure())return;
    try{
      const s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      LOC.micStream=s;LOC.mic=s.getAudioTracks()[0];LOC.micOn=true;applyMicEnabled();addMeter(s);replaceSlot(0);
    }catch(e){toast('Mikrofon izni verilmedi');return}
  }else{
    LOC.micOn=!LOC.micOn;applyMicEnabled();
  }
  vib(10);sendMedia();renderRoom();callAct('media');
}
function stopMic(){if(LOC.micStream)LOC.micStream.getTracks().forEach(t=>t.stop());LOC.mic=null;LOC.micStream=null;LOC.micOn=false;AUD.meter=null}
// Etkinlik bir süreliğine sohbet mikrofonunu susturabilir (Tersine'de kelime kaydı sırasında)
function holdMic(on){LOC.held=!!on;applyMicEnabled()}
async function toggleCam(){
  if(LOC.cam){stopCam();replaceSlot(1);sendMedia();renderRoom();callAct('media');return}
  if(needSecure())return;
  try{
    const s=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30},facingMode:'user'},audio:false});
    LOC.camStream=s;LOC.cam=s.getVideoTracks()[0];replaceSlot(1);
  }catch(e){toast('Kamera izni verilmedi');return}
  vib(10);sendMedia();renderRoom();callAct('media');
}
function stopCam(){if(LOC.camStream)LOC.camStream.getTracks().forEach(t=>t.stop());LOC.cam=null;LOC.camStream=null}
// Ekran paylaşımı akışını kanallara koy (null = durdur)
function setScreen(stream){
  const old=LOC.scr;
  if(old===stream)return;
  LOC.scr=stream||null;
  if(old&&old!==stream)old.getTracks().forEach(t=>{t.onended=null;t.stop()});
  replaceSlot(2);replaceSlot(3);applyQuality();
}
function applyQuality(){
  const motion=LOC.quality==='motion';
  const v=LOC.scr&&LOC.scr.getVideoTracks()[0];
  if(v&&'contentHint' in v)v.contentHint=motion?'motion':'detail';
  const many=Object.keys(PCS).length>4; // kalabalıkta kamera daha az yükleme kullansın
  for(const cid in PCS){
    const trs=PCS[cid].pc.getTransceivers();
    setEnc(trs[2]&&trs[2].sender,motion?2500000:1500000,motion?30:12,motion?'maintain-framerate':'maintain-resolution');
    setEnc(trs[1]&&trs[1].sender,many?250000:400000,many?15:24,null);
  }
}
function setEnc(sender,br,fps,pref){
  if(!sender||!sender.getParameters)return;
  try{
    const p=sender.getParameters();
    if(!p.encodings||!p.encodings.length)return;
    p.encodings[0].maxBitrate=br;p.encodings[0].maxFramerate=fps;
    if(pref)p.degradationPreference=pref;
    sender.setParameters(p).catch(()=>{if(pref){delete p.degradationPreference;sender.setParameters(p).catch(()=>{})}});
  }catch(e){}
}
function renderCtrl(){
  const mic=$('#micBtn'),cam=$('#camBtn');
  const live=micLive();
  mic.className='cbtn '+(live?'on':'off');mic.querySelector('.ci').textContent=live?'🎙️':'🔇';
  mic.querySelector('.cl').textContent=live?'Açık':'Mikrofon';
  mic.setAttribute('aria-label',live?'Mikrofonu kapat':'Mikrofonu aç');
  cam.className='cbtn '+(LOC.cam?'on':'off');cam.querySelector('.ci').textContent=LOC.cam?'📹':'📷';
  cam.querySelector('.cl').textContent=LOC.cam?'Açık':'Kamera';
  cam.setAttribute('aria-label',LOC.cam?'Kamerayı kapat':'Kamerayı aç');
}
$('#micBtn').addEventListener('click',toggleMic);
$('#camBtn').addEventListener('click',toggleCam);

/* =====================================================================
   EŞLER ARASI BAĞLANTI (WebRTC) — herkes herkese doğrudan bağlanır
   ===================================================================== */
const PCS={};
let ICE=null;
const DEF_ICE={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
fetch('ice',{cache:'no-store'}).then(r=>r.json()).then(j=>{ICE=j}).catch(()=>{});
function syncPeers(){
  if(!R||!NET.cid||!window.RTCPeerConnection)return;
  const others=R.peers.filter(p=>p.cid!==NET.cid);
  const ids=new Set(others.map(p=>p.cid));
  for(const cid in PCS)if(!ids.has(cid))closePC(cid);
  others.forEach(p=>{
    if(PCS[p.cid]){PCS[p.cid].pid=p.pid;return}
    const offerer=NET.cid<p.cid; // aynı anda iki teklif olmasın diye kuralla tek taraf başlatır
    makePC(p.cid,p.pid,offerer);
    if(offerer)makeOffer(p.cid,false);
  });
}
function makePC(cid,pid,offerer){
  const pc=new RTCPeerConnection(ICE||DEF_ICE);
  const P={pc,cid,pid,pending:[],mic:new MediaStream(),cam:new MediaStream(),scr:new MediaStream(),audio:null,micRecv:null};
  PCS[cid]=P;
  if(offerer)KINDS.forEach((k,i)=>{const tr=pc.addTransceiver(k,{direction:'sendrecv'});const t=slotTrack(i);if(t)tr.sender.replaceTrack(t).catch(()=>{})});
  pc.onicecandidate=e=>{if(e.candidate)send({t:'rtc',to:cid,data:{ice:e.candidate.toJSON?e.candidate.toJSON():e.candidate}})};
  pc.ontrack=e=>{
    const i=pc.getTransceivers().indexOf(e.transceiver);
    const st=[P.mic,P.cam,P.scr,P.scr][i];if(!st)return;
    st.getTracks().filter(t=>t.kind===e.track.kind).forEach(t=>st.removeTrack(t));
    st.addTrack(e.track);
    e.track.onunmute=()=>{if(R){renderRoom();callAct('media')}};
    if(i===0){
      P.micRecv=e.receiver;
      if(!P.audio){const a=document.createElement('audio');a.autoplay=true;a.setAttribute('playsinline','');$('#voiceAudio').appendChild(a);P.audio=a}
      P.audio.srcObject=P.mic;
      P.audio.play().catch(()=>{AUD.needTap=true;toast('Sesleri duymak için ekrana bir kez dokun')});
    }
    if(R){renderRoom();callAct('media')}
  };
  pc.onconnectionstatechange=()=>{
    if(pc.connectionState==='connected')applyQuality();
    if(pc.connectionState==='failed'&&NET.cid<cid){try{pc.restartIce()}catch(e){}makeOffer(cid,true)}
  };
  return P;
}
async function makeOffer(cid,restart){
  const P=PCS[cid];if(!P)return;
  try{const o=await P.pc.createOffer(restart?{iceRestart:true}:undefined);await P.pc.setLocalDescription(o);send({t:'rtc',to:cid,data:{sdp:P.pc.localDescription}})}
  catch(e){console.warn('offer',e)}
}
async function flushIce(P){const q=P.pending;P.pending=[];for(const c of q){try{await P.pc.addIceCandidate(c)}catch(e){}}}
async function onRtc(from,data){
  if(!R||!data||typeof from!=='string'||!window.RTCPeerConnection)return;
  let P=PCS[from];
  try{
    if(data.sdp&&data.sdp.type==='offer'){
      if(!P)P=makePC(from,peerPid(from),false);
      await P.pc.setRemoteDescription(data.sdp);
      // Teklifle gelen 4 kanala kendi parçalarımızı yerleştir
      P.pc.getTransceivers().forEach((tr,i)=>{
        if(i>3)return;
        try{tr.direction='sendrecv'}catch(e){}
        const t=slotTrack(i);if(t&&tr.sender.track!==t)tr.sender.replaceTrack(t).catch(()=>{});
      });
      const a=await P.pc.createAnswer();await P.pc.setLocalDescription(a);
      send({t:'rtc',to:from,data:{sdp:P.pc.localDescription}});flushIce(P);
    }else if(data.sdp&&data.sdp.type==='answer'&&P){
      await P.pc.setRemoteDescription(data.sdp);flushIce(P);
    }else if(data.ice&&P){
      if(P.pc.remoteDescription)await P.pc.addIceCandidate(data.ice);else P.pending.push(data.ice);
    }
  }catch(e){console.warn('rtc',e)}
}
function closePC(cid){
  const P=PCS[cid];if(!P)return;
  try{P.pc.close()}catch(e){}
  if(P.audio){P.audio.srcObject=null;P.audio.remove()}
  delete PCS[cid];
}
function closeAllPCs(){for(const cid in PCS)closePC(cid)}

/* =====================================================================
   SES: konuşanı gösterme, bildirim sesi
   ===================================================================== */
const AUD={ctx:null,meter:null,speaking:new Set(),needTap:false};
function ensureAudio(){try{AUD.ctx=AUD.ctx||new(window.AudioContext||window.webkitAudioContext)();if(AUD.ctx.state==='suspended')AUD.ctx.resume().catch(()=>{})}catch(e){AUD.ctx=null}return AUD.ctx}
function addMeter(stream){
  if(!AUD.ctx)return;
  try{const src=AUD.ctx.createMediaStreamSource(stream),an=AUD.ctx.createAnalyser();an.fftSize=512;src.connect(an);AUD.meter={an,buf:new Float32Array(an.fftSize)}}catch(e){}
}
function ding(){
  if(!AUD.ctx)return;
  try{const o=AUD.ctx.createOscillator(),g=AUD.ctx.createGain();o.frequency.value=880;g.gain.setValueAtTime(.08,AUD.ctx.currentTime);g.gain.exponentialRampToValueAtTime(.0001,AUD.ctx.currentTime+.35);o.connect(g).connect(AUD.ctx.destination);o.start();o.stop(AUD.ctx.currentTime+.36)}catch(e){}
}
const loudAt={};
setInterval(()=>{
  if(!R)return;
  const now=Date.now();
  const m=AUD.meter;
  if(m&&LOC.mic&&LOC.micOn&&!LOC.held){m.an.getFloatTimeDomainData(m.buf);let s=0;for(let i=0;i<m.buf.length;i++)s+=m.buf[i]*m.buf[i];if(Math.sqrt(s/m.buf.length)>0.025)loudAt[NET.id]=now}
  for(const k in PCS){
    const P=PCS[k];if(!P.pid||!P.micRecv||!P.micRecv.getSynchronizationSources)continue;
    const src=P.micRecv.getSynchronizationSources()[0];
    if(src&&typeof src.audioLevel==='number'&&src.audioLevel>0.03)loudAt[P.pid]=now;
  }
  const sp=new Set();for(const id in loudAt)if(now-loudAt[id]<450)sp.add(id);
  if(sp.size!==AUD.speaking.size||[...sp].some(x=>!AUD.speaking.has(x))){
    AUD.speaking=sp;
    for(const k in TILES)TILES[k].el.classList.toggle('speaking',sp.has(k));
    callAct('speaking',sp);
  }
},120);
document.addEventListener('pointerdown',()=>{
  if(AUD.ctx&&AUD.ctx.state==='suspended')AUD.ctx.resume().catch(()=>{});
  if(AUD.needTap){AUD.needTap=false;for(const k in PCS){const a=PCS[k].audio;if(a)a.play().catch(()=>{})}playAll();callAct('tap')}
},true);

/* =====================================================================
   TEPKİLER — her etkinlikte ekranda uçuşur
   ===================================================================== */
const reactHooks=[];
function onReact(pid,e){
  const make=layer=>{
    const el=document.createElement('div');el.className='rx';el.style.setProperty('--pc',colorOf(pid));
    el.style.left=(8+Math.random()*80)+'%';
    const b=document.createElement('b');b.textContent=e;const s=document.createElement('small');s.textContent=nameOf(pid);
    el.append(b,s);layer.appendChild(el);setTimeout(()=>el.remove(),2500);
  };
  make($('#reactLayer'));
  reactHooks.forEach(f=>{try{f(make,pid,e)}catch(_){}});
}
const pop=$('#reactPop');
REACTIONS.forEach(e=>{const b=document.createElement('button');b.type='button';b.textContent=e;b.addEventListener('click',()=>{send({t:'react',e});pop.classList.add('hidden');vib(8)});pop.appendChild(b)});
$('#reactBtn').addEventListener('click',ev=>{ev.stopPropagation();pop.classList.toggle('hidden')});
document.addEventListener('click',ev=>{if(!pop.classList.contains('hidden')&&!ev.target.closest('#reactPop'))pop.classList.add('hidden')});

/* =====================================================================
   SOHBET — her etkinlikte açık
   ===================================================================== */
const CHAT={list:[],unread:0};
const URL_RE=/(\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+)/gi;
function cleanUrl(raw){
  let u=raw.replace(/[.,!?;:)\]}]+$/,'');
  if(/^www\./i.test(u))u='https://'+u;
  try{const x=new URL(u);if(x.protocol==='http:'||x.protocol==='https:')return x.href}catch(e){}
  return null;
}
function firstUrl(text){const m=String(text).match(URL_RE);return m?cleanUrl(m[0]):null}
function textWithLinks(parent,text){
  let last=0;String(text).replace(URL_RE,(m,_1,idx)=>{
    if(idx>last)parent.appendChild(document.createTextNode(text.slice(last,idx)));
    const u=cleanUrl(m);
    if(u){const a=document.createElement('a');a.href=u;a.target='_blank';a.rel='noopener noreferrer';a.textContent=m;parent.appendChild(a)}
    else parent.appendChild(document.createTextNode(m));
    last=idx+m.length;return m;
  });
  if(last<text.length)parent.appendChild(document.createTextNode(text.slice(last)));
}
function fmtTime(ts){try{return new Date(ts).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}catch(e){return''}}
function renderMsg(m){
  const d=document.createElement('div');d.className='msg'+(m.sys?' sys':'');
  if(m.sys){d.textContent=m.text;return d}
  d.style.setProperty('--pc',colorOf(m.pid));
  const h=document.createElement('div');h.className='mh';
  const i=document.createElement('i');const n=document.createElement('span');n.textContent=nameOf(m.pid);
  const t=document.createElement('time');t.textContent=fmtTime(m.ts);h.append(i,n,t);
  const body=document.createElement('div');textWithLinks(body,m.text);
  d.append(h,body);
  const url=firstUrl(m.text);
  if(url){
    // Etkinlik linke bir düğme ekleyebilir (Sekme Partisi: "Yeni sekmede aç")
    const extra=callAct('linkAction',m,url);
    if(extra){const lk=document.createElement('div');lk.className='lk';lk.appendChild(extra);d.appendChild(lk)}
  }
  return d;
}
const chatHooks=[];
function renderChat(){
  const box=$('#msgs');const atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<60;
  box.textContent='';
  if(!CHAT.list.length){const e=document.createElement('div');e.className='msg sys';e.textContent='Mesajlar burada görünür. Link de paylaşabilirsin.';box.appendChild(e)}
  CHAT.list.forEach(m=>box.appendChild(renderMsg(m)));
  if(atBottom)box.scrollTop=box.scrollHeight;
  chatHooks.forEach(f=>{try{f()}catch(e){}});
}
function onChat(m){
  if(!m)return;
  CHAT.list.push(m);if(CHAT.list.length>80)CHAT.list.shift();
  const box=$('#msgs');const atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<60;
  if(CHAT.list.length===1)box.textContent='';
  box.appendChild(renderMsg(m));
  if(atBottom||m.pid===NET.id)box.scrollTop=box.scrollHeight;
  chatHooks.forEach(f=>{try{f()}catch(e){}});
  if(!m.sys&&m.pid!==NET.id){
    const chatHidden=MOBILE.matches&&!$('#chat').classList.contains('open');
    if(chatHidden){CHAT.unread++;renderUnread();toast(nameOf(m.pid)+': '+m.text.slice(0,60))}
  }
  callAct('chat',m);
}
function renderUnread(){const u=$('#unread');u.textContent=CHAT.unread>9?'9+':CHAT.unread;u.classList.toggle('hidden',!CHAT.unread)}
function sendChat(){
  const i=$('#chatIn'),t=i.value.trim();if(!t)return;
  if(send({t:'chat',text:t}))i.value='';else toast('Bağlantı yok, tekrar dene');
}
$('#chatSend').addEventListener('click',sendChat);
$('#chatIn').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sendChat()}});
$('#chatBtn').addEventListener('click',()=>{$('#chat').classList.add('open');CHAT.unread=0;renderUnread();const b=$('#msgs');b.scrollTop=b.scrollHeight});
$('#chatClose').addEventListener('click',()=>$('#chat').classList.remove('open'));

/* =====================================================================
   ETKİNLİKLERE AÇILAN ARAYÜZ
   Bir etkinlik modülü şunları tanımlayabilir:
     id, title, icon, blurb, color, minPlayers, maxPlayers
     setup(body)        → kurucu için ayar formu; seçenekleri döndüren fonksiyon verir
     mount(root, ctrl)  → etkinlik ekranını kur (ctrl: alt çubuğa düğme eklemek için)
     unmount()          → temizle
     state(game, R)     → her durum güncellemesi
     msg(m)             → etkinliğe özel sunucu mesajları
     menu()             → menüye eklenecek düğmeler [{label, onClick, cls}]
     badge(pid), tileClick(pid), tileClickable(pid), linkAction(m, url), line()
     reconnect(), media(), speaking(set), chat(m), error(m), tap()
   ===================================================================== */
window.App={
  $,esc,store,vib,toast,banner,show,openM,closeM,send,
  get R(){return R},get me(){return NET.id},get cid(){return NET.cid},get code(){return NET.code},
  get offset(){return NET.offset},get secure(){return secureOk()},
  findP,nameOf,colorOf,amHost,onlineCount,peerPid,endActivity,renderRoom,
  register(g){GAMES[g.id]=g;ORDER.push(g.id)},
  audio:{ctx:ensureAudio,ding,get speaking(){return AUD.speaking},set needTap(v){AUD.needTap=!!v}},
  mic:{
    track(){return LOC.mic&&LOC.mic.readyState==='live'?LOC.mic:null},
    hold:holdMic,toggle:toggleMic,get live(){return micLive()},
  },
  cam:{
    toggle:toggleCam,get on(){return !!LOC.cam},
    get stream(){return LOC.camStream},
    peer(cid){return PCS[cid]?PCS[cid].cam:null},
  },
  screen:{
    set:setScreen,get stream(){return LOC.scr},
    peer(cid){return PCS[cid]?PCS[cid].scr:null},
    get quality(){return LOC.quality},
    setQuality(q){LOC.quality=q;store.set('quality',q);applyQuality()},
  },
  chat:{get list(){return CHAT.list},renderMsg,render:renderChat,hooks:chatHooks},
  hooks:{toast:toastHooks,react:reactHooks,theme:themeHooks},
  get theme(){return theme},
  boot(){applyTheme();initHome()},
};
window.__salon={NET,PCS,LOC,get R(){return R}}; // hata ayıklama için
})();
