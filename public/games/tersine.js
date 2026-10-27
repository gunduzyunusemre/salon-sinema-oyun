/*
 * 🔁 Tersine — kelime tersten çalınır, taklit edilir, taklit geri çevrilir.
 * Kelime mikrofonu salonun mikrofonundan bağımsız ikinci bir kanaldır: kayıt
 * sürerken salon mikrofonu susar, orijinal ses telefondan hiç çıkmaz.
 */
(function(){
'use strict';
const A=window.App;
const esc=A.esc;
const COLORS=['#ff4d6d','#ffbf1f','#5b4dff','#19b394','#ff8a3d','#2fa4ff','#c04bd6'];
const trUp=s=>String(s).toLocaleUpperCase('tr');

let G=null;      // sunucudan gelen oyun durumu
let E=null;      // ekrandaki öğeler
let L={no:-1,sending:false,ver:0,flipped:false};

/* ---------- Harf karoları: kelime tersten gelir, karolar dönerek düzelir ---------- */
function tilesHTML(word){
  return [...trUp(word)].map((ch,i)=>ch===' '?'<span class="sp"></span>'
    :'<span style="background:'+COLORS[i%COLORS.length]+';--rot:'+((i%2?1:-1)*(2+(i*7)%5))+'deg'+(COLORS[i%COLORS.length]==='#ffbf1f'?';color:#1d1846':'')+'">'+esc(ch)+'</span>').join('');
}
function flipTiles(el,word,delay){
  const letters=[...trUp(word)],rev=letters.slice().reverse();
  el.innerHTML=tilesHTML(rev.join(''));
  const spans=el.querySelectorAll('span');
  spans.forEach((s,i)=>{
    if(letters[i]===' ')return;
    setTimeout(()=>{s.classList.add('flip');setTimeout(()=>{s.textContent=letters[i]},250);setTimeout(()=>s.classList.remove('flip'),520)},delay+i*90);
  });
}

/* =====================================================================
   SES: kayıt, ters çevirme, wav, çalma
   ===================================================================== */
const MAXREC=5000,SR=22050;
const ctx=()=>A.audio.ctx();
// Kaydı sadeleştir: 22 kHz'e indir, baştaki/sondaki sessizliği kes, sesi yükselt
function processRec(chunks,sr){
  let len=0;chunks.forEach(c=>len+=c.length);if(!len)return null;
  const x=new Float32Array(len);let o=0;chunks.forEach(c=>{x.set(c,o);o+=c.length});
  const ratio=sr/SR,n=Math.floor(len/ratio),y=new Float32Array(n);
  for(let i=0;i<n;i++){const a=Math.floor(i*ratio),b=Math.max(a+1,Math.min(len,Math.floor((i+1)*ratio)));let s=0;for(let j=a;j<b;j++)s+=x[j];y[i]=s/(b-a)}
  let peak=0;for(let i=0;i<n;i++){const v=Math.abs(y[i]);if(v>peak)peak=v}
  if(peak<0.015)return null;
  const win=Math.round(SR*0.01),th=Math.max(0.006,peak*0.07);
  const rms=i=>{let s=0;const e=Math.min(n,i+win);for(let j=i;j<e;j++)s+=y[j]*y[j];return Math.sqrt(s/Math.max(1,e-i))};
  let st=0;while(st<n&&rms(st)<th)st+=win;
  let en=n;while(en>st&&rms(Math.max(0,en-win))<th)en-=win;
  const pad=Math.round(SR*0.09);st=Math.max(0,st-pad);en=Math.min(n,en+pad);
  if(en-st<SR*0.15)return null;
  const z=y.slice(st,en),g=Math.min(8,0.9/peak),f=Math.round(SR*0.012);
  for(let i=0;i<z.length;i++){let k=g;if(i<f)k*=i/f;else if(i>z.length-f)k*=(z.length-i)/f;z[i]*=k}
  return{pcm:z,sr:SR};
}
const reversePcm=p=>{const r=new Float32Array(p.length);for(let i=0;i<p.length;i++)r[i]=p[p.length-1-i];return r};
function toWav(pcm,sr){
  const b=new ArrayBuffer(44+pcm.length*2),v=new DataView(b);
  const w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
  w(0,'RIFF');v.setUint32(4,36+pcm.length*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,pcm.length*2,true);
  for(let i=0;i<pcm.length;i++){const s=Math.max(-1,Math.min(1,pcm[i]));v.setInt16(44+i*2,s<0?s*0x8000:s*0x7fff,true)}
  return b;
}
function wavDataUrl(pcm,sr){
  const u8=new Uint8Array(toWav(pcm,sr));let s='';
  for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));
  return'data:audio/wav;base64,'+btoa(s);
}
function parseWav(ab){
  const v=new DataView(ab);const sr=v.getUint32(24,true);let o=12;
  while(o+8<=ab.byteLength){const id=String.fromCharCode(v.getUint8(o),v.getUint8(o+1),v.getUint8(o+2),v.getUint8(o+3)),sz=v.getUint32(o+4,true);
    if(id==='data'){const n=Math.floor(Math.min(sz,ab.byteLength-o-8)/2),pcm=new Float32Array(n);for(let i=0;i<n;i++)pcm[i]=v.getInt16(o+8+i*2,true)/0x8000;return{pcm,sr}}
    o+=8+sz+(sz&1)}
  throw new Error('wav');
}

/* ---------- Ses kaynakları ----------
   l:ad  → bu telefondaki kayıt        L:ad → onun tersi
   r:id  → sunucudaki kayıt            R:id → onun tersi
   Söyleyenin sunucuya giden kaydı zaten TERS haldedir; orijinal = R:id (sadece tur sonunda gösterilir) */
let LOCAL={},CL={},RV={};
function pcmFor(key){
  const k=key[0],id=key.slice(2);
  let c=null;
  if(k==='l'||k==='L')c=LOCAL[id]||null;
  else{c=CL[id];if(!c){loadClip(id);return null}if(c==='loading'||c==='err')return null}
  if(!c)return null;
  if(k==='l'||k==='r')return c;
  const rk=k+id;if(!RV[rk]||RV[rk].src!==c)RV[rk]={src:c,v:{pcm:reversePcm(c.pcm),sr:c.sr}};
  return RV[rk].v;
}
async function loadClip(id){
  if(CL[id]&&CL[id]!=='err')return;CL[id]='loading';
  const cache=CL;
  try{const r=await fetch('room/'+A.code+'/a/'+id,{cache:'force-cache'});if(!r.ok)throw 0;cache[id]=parseWav(await r.arrayBuffer())}
  catch(e){cache[id]='err'}
  if(cache===CL)scheduleRender(true);
}

const PL={src:null,key:null,t0:0,dur:0,raf:0,queue:[]};
function stopPlay(){
  PL.queue=[];
  if(PL.src){const s=PL.src;PL.src=null;try{s.onended=null;s.stop()}catch(e){}markPlay(PL.key,false)}
}
function play(key,keepQueue){
  const p=pcmFor(key);if(!p){A.toast('Ses yükleniyor…');return}
  const c=ctx();if(!c){A.toast('Bu tarayıcı ses çalamıyor');return}
  const q=keepQueue?PL.queue:[];stopPlay();PL.queue=q;
  const b=c.createBuffer(1,p.pcm.length,p.sr);b.getChannelData(0).set(p.pcm);
  const s=c.createBufferSource();s.buffer=b;s.connect(c.destination);
  s.onended=()=>{if(PL.src!==s)return;PL.src=null;markPlay(key,false);if(PL.queue.length){const nx=PL.queue.shift();setTimeout(()=>play(nx,true),450)}};
  PL.src=s;PL.key=key;PL.t0=c.currentTime;PL.dur=b.duration;s.start();
  markPlay(key,true);
  cancelAnimationFrame(PL.raf);
  const step=()=>{if(PL.src!==s)return;const pr=Math.min(1,(c.currentTime-PL.t0)/PL.dur);document.querySelectorAll('[data-clip="'+key+'"]').forEach(el=>el.style.setProperty('--p',pr));PL.raf=requestAnimationFrame(step)};
  step();
}
function playChain(keys){const ks=keys.filter(k=>pcmFor(k));if(!ks.length)return;PL.queue=ks.slice(1);play(ks[0],true)}
function markPlay(key,on){document.querySelectorAll('[data-clip="'+key+'"]').forEach(el=>{el.classList.toggle('playing',on);if(!on)el.style.setProperty('--p',0)})}

function clipHTML(key,label,sub,tone){
  const ok=!!pcmFor(key);
  return'<button class="clip t-'+tone+(ok?'':' loading')+'" type="button" data-clip="'+key+'"><canvas width="240" height="38"></canvas><span class="cl"><b>▶ '+esc(label)+'</b>'+(sub?'<small>'+sub+'</small>':'')+'</span></button>';
}
function hydrateClips(root){
  root.querySelectorAll('[data-clip]').forEach(el=>{
    const key=el.dataset.clip,p=pcmFor(key),cv=el.querySelector('canvas');
    el.onclick=()=>{if(PL.key===key&&PL.src)stopPlay();else play(key)};
    if(!p||!cv)return;
    const dpr=window.devicePixelRatio||1;
    const w=cv.width=Math.max(120,Math.round(cv.clientWidth*dpr)),h=cv.height=Math.round(38*dpr);
    const g=cv.getContext('2d'),bars=40,step=p.pcm.length/bars,bw=w/bars;
    g.fillStyle=getComputedStyle(el).getPropertyValue('--tone')||'#5b4dff';
    let mx=0;const pk=[];for(let i=0;i<bars;i++){let m=0;const a=Math.floor(i*step),e=Math.floor((i+1)*step);for(let j=a;j<e;j+=4){const v=Math.abs(p.pcm[j]);if(v>m)m=v}pk.push(m);if(m>mx)mx=m}
    pk.forEach((m,i)=>{const bh=Math.max(2*dpr,(m/(mx||1))*h*.92);g.beginPath();if(g.roundRect)g.roundRect(i*bw+bw*.18,(h-bh)/2,bw*.64,bh,bw*.3);else g.rect(i*bw+bw*.18,(h-bh)/2,bw*.64,bh);g.fill()});
    if(PL.key===key&&PL.src)el.classList.add('playing');
  });
}

/* ---------- Kelime mikrofonu ----------
   Salon mikrofonundan bağımsız ikinci bir kanal. Kayıt sürerken salon mikrofonu
   susturulur, böylece söylenen kelime sohbete karışmaz. */
const REC={stream:null,node:null,proc:null,chunks:[],on:false,starting:false,cancel:false,t0:0,timer:null,lvl:0,onDone:null,btn:null,raf:0};
async function ensureWordMic(){
  if(REC.stream&&REC.stream.getAudioTracks().some(t=>t.readyState==='live')&&REC.proc)return;
  releaseWordMic();
  const c=ctx();if(!c)throw new Error('noctx');
  let s;
  const tr=A.mic.track();
  if(tr){s=new MediaStream([tr.clone()]);s.getAudioTracks().forEach(t=>t.enabled=true)}
  else s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  REC.stream=s;
  REC.node=c.createMediaStreamSource(s);
  REC.proc=c.createScriptProcessor(4096,1,1);
  REC.proc.onaudioprocess=e=>{
    const d=e.inputBuffer.getChannelData(0);
    if(REC.on)REC.chunks.push(new Float32Array(d));
    let q=0;for(let i=0;i<d.length;i+=8)q+=d[i]*d[i];REC.lvl=Math.sqrt(q/(d.length/8));
  };
  const mute=c.createGain();mute.gain.value=0;
  REC.node.connect(REC.proc);REC.proc.connect(mute);mute.connect(c.destination);
}
function releaseWordMic(){
  if(REC.on)recStop(true);
  try{REC.node&&REC.node.disconnect();REC.proc&&REC.proc.disconnect()}catch(e){}
  if(REC.stream)REC.stream.getTracks().forEach(t=>t.stop());
  REC.stream=REC.node=REC.proc=null;
}
async function recStart(btn,onDone){
  if(REC.on||REC.starting)return;
  if(!A.secure){A.toast('Mikrofon için sayfa https ile açılmalı');return}
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){A.toast('Bu tarayıcı mikrofonu desteklemiyor');return}
  stopPlay();
  REC.starting=true;REC.cancel=false;btn.classList.add('on');
  try{await ensureWordMic()}catch(e){REC.starting=false;btn.classList.remove('on');A.toast('Mikrofon izni gerekli');return}
  REC.starting=false;
  if(REC.cancel){btn.classList.remove('on');REC.cancel=false;A.toast('Konuşurken basılı tut');return}
  REC.chunks=[];REC.on=true;REC.t0=performance.now();REC.onDone=onDone;REC.btn=btn;
  A.mic.hold(true);A.send({t:'rec',on:true});
  A.vib(15);
  REC.timer=setTimeout(()=>recStop(),MAXREC);
  const loop=()=>{if(!REC.on)return;btn.style.setProperty('--lvl',Math.min(1,REC.lvl*7).toFixed(2));REC.raf=requestAnimationFrame(loop)};loop();
}
function recStop(silent){
  if(REC.starting){REC.cancel=true;return}
  if(!REC.on)return;
  REC.on=false;clearTimeout(REC.timer);cancelAnimationFrame(REC.raf);
  // Mikrofon kuyruğunda kalan son parçayı da yakalamak için kısa bekle, sonra sohbeti geri aç
  const btn=REC.btn,cb=REC.onDone,dur=performance.now()-REC.t0;
  btn.classList.remove('on');btn.style.setProperty('--lvl',0);
  setTimeout(()=>{
    A.mic.hold(false);A.send({t:'rec',on:false});
    if(silent)return;
    if(dur<350){A.toast('Konuşurken basılı tut');flushRender();return}
    const res=processRec(REC.chunks,ctx().sampleRate);REC.chunks=[];
    if(!res){A.toast('Ses alınamadı, biraz daha yüksek sesle söyle');flushRender();return}
    A.vib(10);cb(res);flushRender();
  },160);
}
function bindHold(btn,onDone){
  btn.addEventListener('pointerdown',e=>{if(e.button>0)return;e.preventDefault();try{btn.setPointerCapture(e.pointerId)}catch(_){}recStart(btn,onDone)});
  ['pointerup','pointercancel'].forEach(ev=>btn.addEventListener(ev,()=>recStop()));
  btn.addEventListener('contextmenu',e=>e.preventDefault());
  btn.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();recStart(btn,onDone)}});
  btn.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();recStop()}});
}

/* =====================================================================
   EKRAN
   ===================================================================== */
const players=()=>(A.R&&A.R.players)||[];
const scoreOf=id=>(G&&G.scores&&G.scores[id])||0;
// Sıralamaya oyunda olanlar girer (sonradan gelenler de sıraya eklenir)
const ranked=()=>{const ids=new Set((G&&G.order)||[]);return players().filter(p=>ids.has(p.id)).sort((a,b)=>scoreOf(b.id)-scoreOf(a.id))};

function mount(root){
  root.innerHTML='<div class="ts-top"></div><div class="gstatus"><span class="ts-turn"></span><span class="ts-right"></span></div>'
    +'<div class="ts-scroll"><div class="inner ts-panel"></div></div>';
  const q=s=>root.querySelector(s);
  E={root,top:q('.ts-top'),turn:q('.ts-turn'),right:q('.ts-right'),scroll:q('.ts-scroll'),panel:q('.ts-panel')};
  E.win=document.createElement('div');E.win.className='overlay hidden';
  E.win.innerHTML='<div class="modal"><h2></h2><div class="ts-winbody"></div><div class="mbtns">'
    +'<button class="btn sun" type="button" data-a="again">Tekrar oyna</button>'
    +'<button class="btn soft" type="button" data-a="lounge">🛋️ Salona dön</button>'
    +'<button class="btn soft" type="button" data-a="close">Kapat</button></div>'
    +'<p class="hint">Kurucu yeni oyunu başlatınca herkeste otomatik açılır.</p></div>';
  E.win.querySelector('[data-a=again]').addEventListener('click',()=>A.send({t:'rematch'}));
  E.win.querySelector('[data-a=lounge]').addEventListener('click',()=>A.endActivity());
  E.win.querySelector('[data-a=close]').addEventListener('click',()=>{E.win.classList.add('hidden');E.winClosed=true});
  document.body.appendChild(E.win);
  L={no:-1,sending:false,ver:0,flipped:false};LOCAL={};CL={};RV={};lastKey='';G=null;
}
function unmount(){
  stopPlay();releaseWordMic();A.mic.hold(false);
  if(E)E.win.remove();
  E=null;G=null;LOCAL={};CL={};RV={};
}

function state(g){
  const old=G;G=g;
  if(!E||!G)return;
  detectEvents(G.turn,old&&old.turn);
  renderTop();
  if(G.status==='done'){
    stopPlay();
    if(!old||old.status!=='done')E.winClosed=false;
    if(!E.winClosed)showWin();
    scheduleRender(true);return;
  }
  E.win.classList.add('hidden');
  scheduleRender();
}
function detectEvents(T,O){
  if(!T)return;
  const me=A.me,col=A.colorOf(me);
  if(!O||O.no!==T.no){ // yeni tur
    stopPlay();
    L={no:T.no,sending:false,ver:0,flipped:false};
    delete LOCAL.me;delete LOCAL.imit;
    if(T.speaker===me)A.banner('Sıra sende: söyle!',col);
    else if(T.listener===me)A.banner('Sıra sende: dinle!',col);
    return;
  }
  if(O.phase!==T.phase){
    L.sending=false;
    if(T.phase==='guess'&&T.listener===me){A.vib([20,40,20]);A.toast('Ters ses geldi, dinle!')}
    if(T.phase==='reveal'){
      if(T.result==='ok')A.banner(A.nameOf(T.listener)+' bildi! +'+T.pts,A.colorOf(T.listener));
      else if(T.result==='fail')A.banner('Bilemedi!','#ff4d6d');
      else A.banner('Tur geçildi','#625c8f');
    }
  }
  if(T.phase==='guess'&&T.guesses.length>O.guesses.length&&T.listener===me){
    const g=T.guesses[T.guesses.length-1];
    if(!g.ok){A.vib([30,40,30]);A.toast(g.close?'Çok yakın! Bir harf farkla olmadı':'Olmadı, '+(T.maxTries-T.tries)+' hakkın kaldı');L.shake=true}
  }
  if(T.imits.length>O.imits.length&&T.listener!==me&&T.imits.length){loadClip(T.imits[T.imits.length-1].id)}
}

let lastKey='',renderQueued=false,renderPending=false;
function scheduleRender(force){
  if(force)lastKey='';
  if(renderQueued)return;renderQueued=true;
  requestAnimationFrame(()=>{renderQueued=false;renderGame()});
}
function flushRender(){if(renderPending){renderPending=false;scheduleRender(true)}}

function renderTop(){
  if(!E||!G)return;
  const T=G.turn;
  E.top.innerHTML=ranked().map(p=>{
    const role=T&&(p.id===T.speaker?'🗣️':p.id===T.listener?'👂':'');
    return'<div class="chip'+(role?' role':'')+(p.online?'':' away')+(T&&T.rec===p.id?' recnow':'')+'" style="--pc:'+p.color+'"><span class="dot" style="background:'+p.color+'"></span>'+esc(p.name)+(role?'<span class="ri">'+role+'</span>':'')+'<b>'+scoreOf(p.id)+'</b></div>';
  }).join('');
  E.turn.innerHTML=T?'Tur <strong>'+(T.no+1)+'</strong> / '+G.total:(G.status==='done'?'Oyun bitti':'');
  E.right.textContent=T&&T.rec?'🔴 '+A.nameOf(T.rec)+' kayıtta':'';
}

function duoHTML(T){
  const w=(id,role,icon)=>'<div class="who"><span class="av" style="background:'+A.colorOf(id)+'">'+icon+'</span><span class="nm">'+esc(A.nameOf(id))+(id===A.me?' (sen)':'')+'</span><small>'+role+'</small></div>';
  return'<div class="duo">'+w(T.speaker,'söylüyor','🗣️')+'<span class="arr">→</span>'+w(T.listener,'tahmin ediyor','👂')+'</div>';
}

function renderGame(){
  if(!E||!G)return;
  if(REC.on||REC.starting){renderPending=true;return} // kayıt sürerken ekranı yeniden çizme
  const T=G.turn,panel=E.panel;
  if(!T){
    if(G.status==='done')panel.innerHTML='<section class="card wait"><div class="big">🏁</div><p>Oyun bitti</p><small>'+(A.amHost()?'Menüden tekrar oynatabilir ya da salona dönebilirsin.':'Kurucu yeni oyunu başlatabilir.')+'</small>'
      +'<button class="btn soft" type="button" data-a="results" style="margin-top:12px">Sonuçları göster</button></section>';
    else panel.innerHTML='';
    const rb=panel.querySelector('[data-a=results]');if(rb)rb.onclick=()=>{E.winClosed=false;showWin()};
    return;
  }
  const me=A.me,isSp=T.speaker===me,isLi=T.listener===me;
  const key=JSON.stringify([T.no,T.phase,T.word,T.rev,T.imits.map(x=>x.id),T.guesses.length,T.rec,L.ver,L.sending,isSp,isLi,A.R&&A.R.host,
    Object.keys(CL).filter(k=>CL[k]&&typeof CL[k]==='object').length,players().map(p=>p.name+p.online).join()]);
  if(key===lastKey)return;lastKey=key;
  // Tahmin kutusundaki yazı ve odak korunur
  const gi=panel.querySelector('#tsGuessIn'),gv=gi?gi.value:'',gf=gi&&document.activeElement===gi;
  const nm=id=>esc(A.nameOf(id));
  let h=duoHTML(T);

  if(T.phase==='pick'){
    if(isSp){
      h+='<section class="card"><h2>Gizli kelimeni seç</h2><p class="hint" style="margin:-4px 0 10px">Bunu sadece sen görüyorsun.</p><div class="opts">'
        +T.options.map(w=>'<button class="btn" type="button" data-pick="'+esc(w)+'">'+esc(w)+'</button>').join('')
        +'</div><div class="or" style="margin-top:14px">ya da</div><div class="invite" style="margin-top:0"><input type="text" id="tsOwnWord" maxlength="24" placeholder="Kendi kelimeni yaz" autocomplete="off"><button class="btn soft" id="tsOwnBtn" type="button">Seç</button></div></section>';
    }else h+=waitHTML('🤔',nm(T.speaker)+' kelime seçiyor',isLi?'Sonra ters halini sen dinleyeceksin.':'');
  }

  else if(T.phase==='record'){
    if(isSp){
      h+='<div class="secret">Kelimen: <b>'+esc(trUp(T.word))+'</b></div>'
        +'<section class="card"><div class="holdwrap"><button class="hold" id="tsSpHold" type="button" aria-label="Basılı tut ve kelimeyi söyle">🎙️</button>'
        +'<div class="holdlbl">Basılı tut, kelimeyi söyle<small>Kayıt sürerken salon mikrofonun kapanır. '+nm(T.listener)+' sadece tersini duyacak.</small></div></div>';
      if(LOCAL.me){
        h+='<div class="clips one">'+clipHTML('L:me','Tersi','karşı taraf bunu duyacak','vio')+'</div>'
          +'<button class="btn sun big" id="tsSendRev" type="button" style="margin-top:12px"'+(L.sending?' disabled':'')+'>'+(L.sending?'Gönderiliyor…':'Tersini gönder')+'</button>'
          +'<p class="hint center">Beğenmediysen yeniden basılı tutup tekrar kaydet.</p>';
      }
      h+='</section>';
    }else{
      h+=waitHTML('🤫',nm(T.speaker)+' kelimeyi kaydediyor',(T.rec===T.speaker?'<span class="live-rec">Kayıtta, salon mikrofonu kapalı</span>':'Orijinal kelimeyi kimse duymayacak.'));
    }
  }

  else if(T.phase==='guess'){
    const last=T.imits[T.imits.length-1];
    if(isLi){
      h+='<section class="card"><p class="steps">1. Ters sesi dinle</p><div class="clips one">'+clipHTML('r:'+T.rev,'Ters ses',nm(T.speaker)+' söyledi, tersine çevrildi','red')+'</div></section>'
        +'<section class="card"><p class="steps">2. Duyduğunu aynen taklit et</p><div class="holdwrap"><button class="hold mimic" id="tsLiHold" type="button" aria-label="Basılı tut ve taklit et">🦜</button>'
        +'<div class="holdlbl">Basılı tut, taklit et<small>Telefon taklidini tekrar ters çevirir</small></div></div>';
      if(LOCAL.imit)h+='<div class="clips">'+clipHTML('l:imit','Taklidin','tersten söylediğin','vio')+clipHTML('L:imit','Taklidin tersi','kelime bu mu?','ok')+'</div>';
      h+='</section><section class="card"><p class="steps">3. Tahmin et</p>'+blanksHTML(T.len)
        +'<div class="invite" style="margin-top:0"><input type="text" id="tsGuessIn" maxlength="30" placeholder="Kelime ne?" autocomplete="off" autocapitalize="none" spellcheck="false"><button class="btn sun" id="tsGuessBtn" type="button">Tahmin et</button></div>'
        +triesHTML(T)+guessesHTML(T)+'<div class="center" style="margin-top:6px"><button class="btn link" id="tsGiveUp" type="button">Pes et</button></div></section>';
    }else{
      if(isSp)h+='<div class="secret">Kelimen: <b>'+esc(trUp(T.word))+'</b> (sadece sen görüyorsun)</div>';
      h+='<section class="card"><h2>'+nm(T.listener)+' tahmin ediyor</h2>'+blanksHTML(T.len)
        +'<div class="clips one">'+clipHTML('r:'+T.rev,'Ters ses',nm(T.listener)+' bunu duyuyor','red')+'</div>';
      if(last)h+='<div class="clips">'+clipHTML('r:'+last.id,'Taklidi',nm(T.listener)+' söyledi','vio')+clipHTML('R:'+last.id,'Taklidin tersi','geri çevrilmiş hali','ok')+'</div>';
      else if(T.rec===T.listener)h+='<div class="center"><span class="live-rec">Taklit ediyor</span></div>';
      h+=triesHTML(T)+guessesHTML(T)+'</section>';
    }
  }

  else if(T.phase==='reveal'){
    const last=T.imits[T.imits.length-1];
    h+='<section class="card center"><div class="tiles" id="tsRevealTiles" style="margin:6px 0 4px"></div>'
      +'<div class="result">'+(T.result==='ok'?nm(T.listener)+' '+T.tries+'. denemede bildi!<small>'+nm(T.listener)+' +'+T.pts+', '+nm(T.speaker)+' +1</small>'
        :T.result==='fail'?'Bilemedi!<small>Bu turda puan yok</small>':'Tur geçildi')+'</div>'+guessesHTML(T)+'</section>';
    if(T.rev){
      const keys=['R:'+T.rev,'r:'+T.rev].concat(last?['r:'+last.id,'R:'+last.id]:[]);
      h+='<section class="card"><h2>Ses zinciri</h2><div class="chain">'+clipHTML('R:'+T.rev,'Orijinal',nm(T.speaker)+' söyledi','sun')+clipHTML('r:'+T.rev,'Ters ses','tersine çevrildi','red')
        +(last?clipHTML('r:'+last.id,'Taklit',nm(T.listener)+' söyledi','vio')+clipHTML('R:'+last.id,'Taklidin tersi','geri çevrildi','ok'):'')
        +'</div><button class="btn soft wide" id="tsPlayAll" type="button" style="margin-top:10px" data-keys="'+esc(keys.join(','))+'">▶ Hepsini sırayla çal</button></section>';
    }
    const can=A.amHost()||isSp||isLi,lastTurn=T.no+1>=G.total;
    if(can)h+='<button class="btn sun big" id="tsNextBtn" type="button">'+(lastTurn?'Sonuçları gör':'Sonraki tur')+'</button>';
    else h+='<p class="hint center">'+nm(T.speaker)+' ya da '+nm(T.listener)+' sonraki tura geçirecek.</p>';
  }

  const stg=E.scroll,st=stg.scrollTop,same=L.lastPhase===T.no+T.phase;L.lastPhase=T.no+T.phase;
  panel.innerHTML=h;
  stg.scrollTop=same?st:0;
  hydrateClips(panel);
  bindPanel();
  const ng=panel.querySelector('#tsGuessIn');
  if(ng){ng.value=gv;if(gf)ng.focus();if(L.shake){L.shake=false;ng.classList.add('shake');setTimeout(()=>ng.classList.remove('shake'),450)}}
  const rt=panel.querySelector('#tsRevealTiles');
  if(rt){if(!L.flipped){L.flipped=true;flipTiles(rt,T.word,250)}else rt.innerHTML=tilesHTML(T.word)}
}
function waitHTML(icon,text,sub){return'<section class="card wait"><div class="big">'+icon+'</div><p>'+text+'</p>'+(sub?'<small>'+sub+'</small>':'')+'</section>'}
function blanksHTML(len){if(!len)return'';const n=len.replace(/ /g,'').length;return'<div class="blanks" aria-label="'+n+' harf">'+[...len].map(c=>c===' '?'<i class="sp"></i>':'<i></i>').join('')+'</div><p class="hint center" style="margin:-4px 0 10px">'+n+' harf</p>'}
function triesHTML(T){let s='<div class="tries">';for(let i=0;i<T.maxTries;i++)s+='<span class="'+(i<T.tries?'used':'')+'"></span>';return s+' '+(T.maxTries-T.tries)+' hak kaldı</div>'}
function guessesHTML(T){if(!T.guesses.length)return'';return'<div class="glist">'+T.guesses.map(g=>'<span class="'+(g.ok?'ok':'no')+'">'+esc(g.text)+'</span>').join('')+'</div>'}

function bindPanel(){
  const P=E.panel,q=s=>P.querySelector(s);
  P.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{ctx();A.send({t:'pick',word:b.dataset.pick})});
  const own=q('#tsOwnBtn');
  if(own){const go=()=>{const w=q('#tsOwnWord').value.trim();if(w.length<2){A.toast('Bir kelime yaz');return}ctx();A.send({t:'pick',word:w})};own.onclick=go;q('#tsOwnWord').onkeydown=e=>{if(e.key==='Enter')go()}}
  const sh=q('#tsSpHold');
  if(sh)bindHold(sh,r=>{LOCAL.me=r;L.ver++;scheduleRender(true);setTimeout(()=>play('L:me'),200)});
  const sr=q('#tsSendRev');
  if(sr)sr.onclick=()=>{
    if(!LOCAL.me||L.sending)return;
    // Orijinal bu telefonda kalır, sunucuya SADECE ters hali gider
    const url=wavDataUrl(reversePcm(LOCAL.me.pcm),LOCAL.me.sr);
    if(A.send({t:'rev',audio:url})){L.sending=true;scheduleRender(true)}else A.toast('Bağlantı yok, yeniden bağlanılıyor');
  };
  const lh=q('#tsLiHold');
  if(lh)bindHold(lh,r=>{LOCAL.imit=r;L.ver++;A.send({t:'imit',audio:wavDataUrl(r.pcm,r.sr)});scheduleRender(true);setTimeout(()=>play('L:imit'),200)});
  const gb=q('#tsGuessBtn');
  if(gb){const go=()=>{const v=q('#tsGuessIn').value.trim();if(!v)return;A.send({t:'guess',text:v});q('#tsGuessIn').value=''};gb.onclick=go;q('#tsGuessIn').onkeydown=e=>{if(e.key==='Enter')go()}}
  const gu=q('#tsGiveUp');if(gu)gu.onclick=()=>{if(confirm('Pes edip kelimeyi açmak istiyor musun?'))A.send({t:'giveup'})};
  const nb=q('#tsNextBtn');if(nb)nb.onclick=()=>{nb.disabled=true;A.send({t:'next'})};
  const pa=q('#tsPlayAll');if(pa)pa.onclick=()=>{ctx();playChain(pa.dataset.keys.split(','))};
}

function showWin(){
  if(!E||!G)return;
  const list=ranked(),host=A.amHost();
  const top=list[0],tie=list[1]&&scoreOf(list[1].id)===scoreOf(top.id);
  E.win.querySelector('h2').textContent=!top?'Oyun bitti':tie?'Berabere!':(top.id===A.me?'Kazandın! 🎉':top.name+' kazandı!');
  E.win.querySelector('.ts-winbody').innerHTML=list.map((p,i)=>'<div class="rank"><span>'+(['🥇','🥈','🥉'][i]||(i+1)+'.')+' <span class="dot" style="background:'+p.color+'"></span>'+esc(p.name)+'</span><b>'+scoreOf(p.id)+'</b></div>').join('');
  E.win.querySelector('[data-a=again]').classList.toggle('hidden',!host);
  E.win.querySelector('[data-a=lounge]').classList.toggle('hidden',!host);
  E.win.querySelector('.hint').classList.toggle('hidden',host);
  E.win.classList.remove('hidden');
}

/* ---------- Kurucu ayarları ---------- */
function setup(body){
  const S=Object.assign({diff:'karisik',laps:1},A.store.get('tersine',{}));
  body.innerHTML='<div class="sub">Kelimeler</div><div class="seg" data-k="diff"></div>'
    +'<div class="sub">Herkes kaç kez söylesin?</div><div class="seg" data-k="laps"></div>'
    +'<p class="hint ts-setinfo"></p>'
    +'<div class="sub">Nasıl oynanır?</div><ol class="how">'
    +'<li><b>Söyleyen</b> gizli kelimeyi kelime mikrofonuna söyler. Telefon kaydı ters çevirir, orijinali kimseye gitmez.</li>'
    +'<li><b>Tahmin eden</b> ters sesi dinler ve duyduğu garip sesi taklit eder.</li>'
    +'<li>Telefon taklidi tekrar ters çevirir. Düzgün taklit ettiysen kelime ortaya çıkar.</li>'
    +'<li>3 tahmin hakkı var: 1. denemede 3, 2.\'de 2, 3.\'de 1 puan. Söyleyen de bilinen her kelimede 1 puan alır.</li></ol>';
  const opts={diff:[{v:'kolay',h:'Kolay<small>kısa</small>'},{v:'orta',h:'Orta<small>3 hece</small>'},{v:'zor',h:'Zor<small>uzun</small>'},{v:'karisik',h:'Karışık'}],
    laps:[{v:1,h:'1 kez'},{v:2,h:'2 kez'},{v:3,h:'3 kez'}]};
  const draw=()=>{
    body.querySelectorAll('.seg').forEach(el=>{
      const k=el.dataset.k;el.textContent='';
      opts[k].forEach(o=>{const b=document.createElement('button');b.type='button';b.innerHTML=o.h;if(S[k]===o.v)b.classList.add('on');b.onclick=()=>{S[k]=o.v;A.store.set('tersine',S);draw()};el.appendChild(b)});
    });
    const n=A.onlineCount();
    body.querySelector('.ts-setinfo').textContent=n<2?'Başlamak için en az 2 kişi lazım.':'Toplam '+(n*S.laps)+' tur. Herkes sırayla söyler ve tahmin eder.';
  };
  draw();
  return()=>{if(A.onlineCount()<2){A.toast('Başlamak için en az 2 kişi lazım');return null}A.audio.ctx();return{diff:S.diff,laps:S.laps}};
}

A.register({
  id:'tersine',title:'Tersine',icon:'🔁',color:'#c04bd6',minPlayers:2,css:'ts',
  blurb:'Kelime tersten çalınır. O garip sesi taklit et, telefon geri çevirsin, kelimeyi bul.',
  setup,mount,unmount,state,
  badge(pid){const T=G&&G.turn;if(!T)return'';return pid===T.speaker?'🗣️ ':pid===T.listener?'👂 ':''},
  line(){const T=G&&G.turn;return T?'Tur '+(T.no+1)+'/'+G.total:(G&&G.status==='done'?'Oyun bitti':'')},
  menu(){
    const T=G&&G.turn,items=[];
    if(A.amHost()&&T&&T.phase!=='reveal')items.push({label:'⏭ Bu turu geç',onClick:()=>A.send({t:'skip'})});
    if(A.amHost()&&G&&G.status==='done')items.push({label:'🔁 Tekrar oyna',cls:'sun',onClick:()=>A.send({t:'rematch'})});
    return items;
  },
  error(){if(L.sending){L.sending=false;scheduleRender(true)}},
});
})();
