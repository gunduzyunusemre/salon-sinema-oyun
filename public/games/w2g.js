/*
 * 📺 Sekme Partisi — yayıncı bir tarayıcı sekmesini paylaşır, herkes izler,
 * imleçle gösterir, sohbete link bırakır.
 */
(function(){
'use strict';
const A=window.App;
const isTouch=matchMedia('(hover: none)').matches;
const ARROW='<svg viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="currentColor" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

let G=null;        // sunucudan gelen etkinlik durumu: {presenter, share}
let E=null;        // ekrandaki öğeler
const PTR={};      // diğerlerinin imleçleri
let SURF=[];       // imleç çizilen yüzeyler (ana sahne + yüzen panel)
const VOL={v:A.store.get('vol',1)};
let personTarget=null;

const amPresenter=()=>!!G&&G.presenter===A.me;
const canShare=()=>!!(navigator.mediaDevices&&navigator.mediaDevices.getDisplayMedia);

function el(tag,cls,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e}

function mount(root,ctrl){
  root.innerHTML=
    '<div class="presbar hidden">'
    +'<button class="btn soft" type="button" data-a="switch">🔄 Başka sekme</button>'
    +'<div class="qseg" role="group" aria-label="Görüntü kalitesi"><button type="button" data-q="motion">🎬 Akıcı</button><button type="button" data-q="detail">🔤 Net</button></div>'
    +'<button class="btn soft" type="button" data-a="pip">🪟 Yüzen panel</button>'
    +'<button class="btn bad" type="button" data-a="stop">⏹ Durdur</button>'
    +'</div>'
    +'<div class="wg-stage">'
    +'<video class="wg-screen" playsinline autoplay></video>'
    +'<div class="layer wg-ptr"></div>'
    +'<div class="wg-idle"><div class="idlecard"></div></div>'
    +'<div class="stagetop"><span class="livetag"></span><span class="stagectl">'
    +'<button type="button" class="wg-volbtn" aria-label="Sekme sesi">🔊</button>'
    +'<input type="range" class="wg-vol" min="0" max="1" step="0.05" aria-label="Sekme ses düzeyi">'
    +'<button type="button" class="wg-fs" aria-label="Tam ekran">⛶</button></span></div>'
    +'<div class="ptrhint"></div>'
    +'</div>';
  const q=s=>root.querySelector(s);
  E={root,bar:q('.presbar'),stage:q('.wg-stage'),video:q('.wg-screen'),ptr:q('.wg-ptr'),idle:q('.idlecard'),live:q('.livetag'),
    vol:q('.wg-vol'),volBtn:q('.wg-volbtn'),fs:q('.wg-fs'),hint:q('.ptrhint')};
  SURF=[{box:E.stage,video:E.video,layer:E.ptr,els:{}}];

  // Alt çubuktaki paylaş / sıra iste düğmesi
  E.share=el('button','cbtn sunb','<span class="ci">🖥️</span><span class="cl">Paylaş</span>');E.share.type='button';
  E.share.addEventListener('click',()=>{
    if(amPresenter()){A.screen.stream?stopShare(false):startShare()}
    else A.send({t:'ask'});
  });
  ctrl.appendChild(E.share);

  q('[data-a=switch]').addEventListener('click',startShare);
  q('[data-a=stop]').addEventListener('click',()=>stopShare(false));
  const pipBtn=q('[data-a=pip]');
  pipBtn.addEventListener('click',openPip);
  if(!('documentPictureInPicture' in window))pipBtn.classList.add('hidden');
  root.querySelectorAll('.qseg button').forEach(b=>b.addEventListener('click',()=>{
    A.screen.setQuality(b.dataset.q);renderStage();
    A.toast(b.dataset.q==='motion'?'Akıcı: video ve oyun için':'Net: yazı ve sayfa okumak için');
  }));

  E.vol.value=VOL.v;
  E.vol.addEventListener('input',()=>setVol(+E.vol.value));
  E.volBtn.addEventListener('click',()=>setVol(VOL.v>0?0:1));
  E.volBtn.textContent=VOL.v===0?'🔇':'🔊';
  E.fs.addEventListener('click',()=>{
    if(document.fullscreenElement)return document.exitFullscreen().catch(()=>{});
    if(E.stage.requestFullscreen)E.stage.requestFullscreen().catch(()=>{});
    else if(E.stage.webkitRequestFullscreen)E.stage.webkitRequestFullscreen();
    else if(E.video.webkitEnterFullscreen)E.video.webkitEnterFullscreen();
  });

  // Kendi imlecimi gönder
  let lastPtr=0,ptrOut=true;
  E.stage.addEventListener('pointermove',ev=>{
    if(!G||!G.share||ev.pointerType!=='mouse')return;
    const now=Date.now();if(now-lastPtr<50)return;lastPtr=now;
    const p=normPos(ev);
    if(p){A.send({t:'ptr',x:p.x,y:p.y});ptrOut=false}
    else if(!ptrOut){A.send({t:'ptr',x:null,y:null});ptrOut=true}
  });
  E.stage.addEventListener('pointerleave',()=>{if(!ptrOut){A.send({t:'ptr',x:null,y:null});ptrOut=true}});
  E.stage.addEventListener('click',ev=>{
    if(!G||!G.share||ev.target.closest('.stagetop'))return;
    const p=normPos(ev);if(p){A.send({t:'ping',x:p.x,y:p.y});A.vib(8)}
    E.stage.classList.add('touched');clearTimeout(E.stage._t);E.stage._t=setTimeout(()=>E.stage.classList.remove('touched'),3000);
  });
  E.video.addEventListener('resize',placeAll);
  if(window.ResizeObserver){E.ro=new ResizeObserver(placeAll);E.ro.observe(E.stage)}
  E.hintT=setTimeout(()=>{if(E)E.hint.style.opacity=0},12000);

  // Kişi / istek penceresi
  E.person=el('div','overlay hidden',
    '<div class="modal"><h2></h2><p></p><div class="mbtns">'
    +'<button class="btn sun" type="button" data-a="make">📺 Yayıncı yap</button>'
    +'<button class="btn soft" type="button" data-close>Kapat</button></div></div>');
  E.person.addEventListener('click',e=>{if(e.target===E.person||e.target.hasAttribute('data-close'))E.person.classList.add('hidden')});
  E.person.querySelector('[data-a=make]').addEventListener('click',()=>{if(personTarget)A.send({t:'present',pid:personTarget});E.person.classList.add('hidden')});
  document.body.appendChild(E.person);

  A.hooks.toast.push(pipToast);A.hooks.react.push(pipReact);A.hooks.theme.push(pipTheme);A.chat.hooks.push(renderPipFeed);
}

function unmount(){
  stopShare(true);closePip();
  if(E){clearTimeout(E.hintT);if(E.ro)E.ro.disconnect();E.person.remove()}
  const rm=(arr,f)=>{const i=arr.indexOf(f);if(i>=0)arr.splice(i,1)};
  rm(A.hooks.toast,pipToast);rm(A.hooks.react,pipReact);rm(A.hooks.theme,pipTheme);rm(A.chat.hooks,renderPipFeed);
  for(const k in PTR)delete PTR[k];
  G=null;E=null;SURF=[];lastPresenter=null;
}

let lastPresenter=null;
function state(g){
  G=g||{presenter:null,share:null};
  if(A.screen.stream&&!amPresenter())stopShare(true);
  if(lastPresenter!==G.presenter){lastPresenter=G.presenter;A.chat.render()}
  renderStage();renderShareBtn();renderPipPeople();
}

function renderShareBtn(){
  if(!E)return;
  const sh=E.share;
  if(amPresenter()){
    sh.className='cbtn '+(A.screen.stream?'badb':'sunb');
    sh.querySelector('.ci').textContent=A.screen.stream?'⏹':'🖥️';sh.querySelector('.cl').textContent=A.screen.stream?'Durdur':'Paylaş';
  }else{
    sh.className='cbtn';sh.querySelector('.ci').textContent='✋';sh.querySelector('.cl').textContent='Sıra iste';
  }
  renderPipBtns();
}

function setSrc(v,stream,muted){
  if(v.srcObject!==stream)v.srcObject=stream;
  v.muted=muted;
  if(!muted)v.volume=VOL.v;
  if(stream)v.play().catch(()=>{if(!muted){A.audio.needTap=true;A.toast('Sesi duymak için ekrana bir kez dokun')}});
}
function renderStage(){
  if(!E||!G)return;
  const live=!!G.share,v=E.video;
  E.stage.classList.toggle('live',live);
  E.stage.classList.toggle('mine',live&&G.share===A.cid);
  if(live){
    if(G.share===A.cid)setSrc(v,A.screen.stream,true);
    else setSrc(v,A.screen.peer(G.share),false);
    E.live.textContent=A.nameOf(A.peerPid(G.share)||G.presenter)+' yayında';
  }else{
    setSrc(v,null,true);
    for(const k in PTR)hidePtr(k);
  }
  // Boş sahne: kimin ne yapacağını söyle
  const c=E.idle;c.textContent='';
  const h=document.createElement('h3'),p=document.createElement('p');
  if(amPresenter()){
    h.textContent='Sıra sende: bir sekme paylaş';
    p.textContent=canShare()?'Açılan pencerede "Chrome sekmesi"ni seç, istediğin sekmeye tıkla. "Sekme sesini de paylaş" açık kalsın.':'Bu cihazdan sekme paylaşılamıyor. Bilgisayardan katıl ya da yayını başka birine ver (kutucuğuna dokun).';
    c.append(h,p);
    if(canShare()){const btn=document.createElement('button');btn.className='btn sun';btn.type='button';btn.textContent='🖥️ Sekme paylaş';btn.onclick=()=>startShare();c.appendChild(btn)}
  }else{
    h.textContent=A.nameOf(G.presenter)+' bir sekme paylaşınca burada görünecek';
    p.textContent='Bu arada sohbet edebilir, link önerebilirsin. Kendi sekmeni göstermek istersen ✋ düğmesine bas.';
    c.append(h,p);
  }
  E.bar.classList.toggle('hidden',!(amPresenter()&&A.screen.stream));
  E.root.querySelectorAll('.qseg button').forEach(x=>x.classList.toggle('on',x.dataset.q===A.screen.quality));
  E.hint.textContent=isTouch?'Dokunduğun yerde herkeste işaret çıkar':'Fareyle göster, tıklayınca herkeste işaret çıkar';
  if(PIP.win)setSrc(pipEls.video,A.screen.stream,true);
}
function setVol(x){
  VOL.v=Math.max(0,Math.min(1,x));A.store.set('vol',VOL.v);
  if(!E)return;
  E.vol.value=VOL.v;
  if(!E.video.muted)E.video.volume=VOL.v;
  E.volBtn.textContent=VOL.v===0?'🔇':'🔊';
}

/* ---------- Sekme paylaşımı ---------- */
async function startShare(){
  if(!G||!amPresenter())return;
  if(!A.secure){A.toast('Bunun için sayfa https ile açılmalı');return}
  if(!canShare()){A.toast('Bu cihazdan sekme paylaşılamıyor. Bilgisayardan Chrome ya da Edge kullan.');return}
  A.audio.ctx();
  const opts={
    video:{displaySurface:'browser',frameRate:{ideal:30,max:30},width:{max:1920},height:{max:1080}},
    audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,suppressLocalAudioPlayback:false},
    selfBrowserSurface:'exclude',surfaceSwitching:'include',systemAudio:'include',preferCurrentTab:false,
  };
  let s;
  try{s=await navigator.mediaDevices.getDisplayMedia(opts)}
  catch(e){
    if(e&&e.name==='TypeError'){try{s=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false})}catch(_){}} // bazı tarayıcılar sesi desteklemez
    if(!s){if(e&&e.name!=='NotAllowedError'&&e.name!=='AbortError')A.toast('Paylaşım başlatılamadı');return}
  }
  if(!G||!amPresenter()){s.getTracks().forEach(t=>t.stop());return}
  A.screen.set(s);
  const v=s.getVideoTracks()[0];
  if(v)v.onended=()=>{if(A.screen.stream===s)stopShare(false)};
  if(!s.getAudioTracks().length)A.toast('Sekme sesi gelmiyor. Seçerken "Sekme sesini de paylaş" açık olmalı.');
  A.send({t:'share',on:true});
  renderStage();renderShareBtn();
}
function stopShare(silent){
  if(!A.screen.stream)return;
  A.screen.set(null);
  if(!silent)A.send({t:'share',on:false});
  closePip();
  renderStage();renderShareBtn();
}

/* ---------- Yayıncı değiştirme ---------- */
function tileClickable(){return !!G&&(A.amHost()||amPresenter())}
function tileClick(pid){
  if(!E||!tileClickable())return;
  personTarget=pid;
  E.person.querySelector('h2').textContent=A.nameOf(pid);
  E.person.querySelector('p').textContent=pid===G.presenter?'Şu an yayıncı bu kişi.':'Yayıncı yaparsan paylaşım ona geçer, o kendi sekmesini seçer.';
  E.person.querySelector('[data-a=make]').classList.toggle('hidden',pid===G.presenter);
  E.person.querySelector('[data-close]').textContent='Kapat';
  E.person.classList.remove('hidden');
}
function onAsk(pid){
  if(!E)return;
  personTarget=pid;
  E.person.querySelector('h2').textContent='✋ '+A.nameOf(pid);
  E.person.querySelector('p').textContent=A.nameOf(pid)+' kendi sekmesini paylaşmak istiyor.';
  E.person.querySelector('[data-a=make]').classList.remove('hidden');
  E.person.querySelector('[data-close]').textContent='Şimdi değil';
  E.person.classList.remove('hidden');A.audio.ding();A.toast(A.nameOf(pid)+' paylaşmak istiyor');
}

/* ---------- İmleçler ve işaretler ----------
   Konumlar paylaşılan sekmenin kendisine göre (0–1) gönderilir; ekranlar
   farklı boyutta olsa da herkes aynı noktayı görür. */
function contentRect(video,box){
  const bw=box.clientWidth,bh=box.clientHeight,vw=video.videoWidth,vh=video.videoHeight;
  if(!vw||!vh)return{l:0,t:0,w:bw,h:bh};
  const s=Math.min(bw/vw,bh/vh),w=vw*s,h=vh*s;
  return{l:(bw-w)/2,t:(bh-h)/2,w,h};
}
function placePtr(S,pid){
  const p=PTR[pid];let e=S.els[pid];
  if(!p||p.x===null||!G||!G.share){if(e)e.style.display='none';return}
  if(!e){
    e=el('div','ptr',ARROW);
    e.appendChild(document.createElement('span'));S.layer.appendChild(e);S.els[pid]=e;
  }
  e.style.display='';e.style.setProperty('--pc',A.colorOf(pid));e.style.color=A.colorOf(pid);
  e.querySelector('span').textContent=A.nameOf(pid);
  const r=contentRect(S.video,S.box);
  e.style.transform='translate('+(r.l+p.x*r.w-3)+'px,'+(r.t+p.y*r.h-2)+'px)';
  e.classList.toggle('idle',Date.now()-p.at>6000);
}
function placeAll(){for(const pid in PTR)SURF.forEach(S=>placePtr(S,pid))}
function hidePtr(pid){SURF.forEach(S=>{const e=S.els[pid];if(e)e.style.display='none'})}
function onPtr(pid,x,y){
  if(pid===A.me)return;
  const old=PTR[pid];if(old)clearTimeout(old.t);
  PTR[pid]={x:typeof x==='number'?x:null,y:typeof y==='number'?y:null,at:Date.now()};
  SURF.forEach(S=>placePtr(S,pid));
  PTR[pid].t=setTimeout(()=>SURF.forEach(S=>placePtr(S,pid)),6200);
}
function onPing(pid,x,y){
  SURF.forEach(S=>{
    if(!G||!G.share)return;
    const r=contentRect(S.video,S.box);
    const f=el('div','pingfx');f.style.setProperty('--pc',A.colorOf(pid));
    f.style.left=(r.l+x*r.w)+'px';f.style.top=(r.t+y*r.h)+'px';
    S.layer.appendChild(f);setTimeout(()=>f.remove(),1500);
  });
  if(pid!==A.me&&amPresenter()&&(document.hidden||PIP.win))A.audio.ding();
}
function normPos(ev){
  const S=SURF[0],box=S.box.getBoundingClientRect(),r=contentRect(S.video,S.box);
  const x=(ev.clientX-box.left-r.l)/r.w,y=(ev.clientY-box.top-r.t)/r.h;
  if(x<0||y<0||x>1||y>1)return null;
  return{x,y};
}

/* ---------- Sohbetteki linkler ---------- */
function linkAction(m,url){
  if(m.opened){const tg=el('span','tag');tg.textContent='✓ yayıncı açtı';return tg}
  if(!amPresenter())return null;
  const b=el('button','btn sun');b.type='button';b.textContent='↗ Yeni sekmede aç';
  b.addEventListener('click',()=>{
    window.open(url,'_blank','noopener');A.send({t:'opened',id:m.id});
    A.toast(A.screen.stream?'Açılan sekmede üstteki "Bunun yerine bu sekmeyi paylaş"a bas':'Açtın. Şimdi paylaşmak için 🖥️ Paylaş\'a bas');
  });
  return b;
}
function onChat(m){
  if(m.sys||m.pid===A.me||!amPresenter())return;
  if(/https?:\/\/|www\./i.test(m.text)){A.audio.ding();if(document.hidden||PIP.win)A.toast(A.nameOf(m.pid)+' bir link önerdi')}
}

/* =====================================================================
   YÜZEN PANEL — yayıncı başka sekmedeyken imleçleri, sohbeti ve kişileri
   her zaman üstte duran küçük bir pencerede görür (Chrome / Edge masaüstü).
   ===================================================================== */
const PIP={win:null};
let pipEls=null,PIP_SURF=null;
function buildPip(){
  const root=el('div','wg-pip',
    '<div class="pipstage"><video playsinline autoplay muted></video><div class="layer pip-ptr"></div><div class="layer pip-react"></div></div>'
    +'<div class="pippeople"></div><div class="piptoast"></div><div class="pipfeed"></div>'
    +'<div class="pipbtns"><button class="btn soft" type="button" data-a="mic">🎤</button><button class="btn soft" type="button" data-a="cam">📷</button><button class="btn bad" type="button" data-a="stop">⏹ Durdur</button></div>');
  const q=s=>root.querySelector(s);
  pipEls={root,stage:q('.pipstage'),video:q('video'),ptr:q('.pip-ptr'),react:q('.pip-react'),people:q('.pippeople'),feed:q('.pipfeed'),toast:q('.piptoast'),
    mic:q('[data-a=mic]'),cam:q('[data-a=cam]'),stop:q('[data-a=stop]'),tT:null};
  pipEls.mic.addEventListener('click',async()=>{await A.mic.toggle();renderPipBtns();renderPipPeople()});
  pipEls.cam.addEventListener('click',async()=>{await A.cam.toggle();renderPipBtns()});
  pipEls.stop.addEventListener('click',()=>stopShare(false));
  PIP_SURF={box:pipEls.stage,video:pipEls.video,layer:pipEls.ptr,els:{}};
}
async function openPip(){
  if(!('documentPictureInPicture' in window)){A.toast('Yüzen panel için masaüstünde Chrome ya da Edge gerekir');return}
  if(PIP.win){try{PIP.win.focus()}catch(e){}return}
  let w;
  try{w=await documentPictureInPicture.requestWindow({width:380,height:600})}catch(e){A.toast('Yüzen panel açılamadı');return}
  if(!pipEls)buildPip();
  document.querySelectorAll('style,link[rel=stylesheet]').forEach(n=>w.document.head.appendChild(n.cloneNode(true)));
  w.document.title='Salon · Sekme Partisi';
  w.document.body.className='pipbody';
  PIP.win=w;pipTheme();
  w.document.body.appendChild(pipEls.root);
  SURF.push(PIP_SURF);
  setSrc(pipEls.video,A.screen.stream,true);
  pipEls.video.addEventListener('resize',placeAll);
  w.addEventListener('resize',placeAll);
  w.addEventListener('pagehide',()=>{
    const i=SURF.indexOf(PIP_SURF);if(i>=0)SURF.splice(i,1);
    PIP_SURF.layer.textContent='';PIP_SURF.els={};
    pipEls.root.remove();pipEls.video.srcObject=null;PIP.win=null;
  });
  renderPipPeople();renderPipFeed();renderPipBtns();placeAll();
}
function closePip(){if(PIP.win){try{PIP.win.close()}catch(e){}}}
function pipTheme(){
  if(!PIP.win)return;
  const d=PIP.win.document.documentElement,t=A.theme;
  if(t==='auto')delete d.dataset.theme;else d.dataset.theme=t;
}
function pipToast(t){
  if(!PIP.win||!pipEls)return;
  pipEls.toast.textContent=t;clearTimeout(pipEls.tT);pipEls.tT=setTimeout(()=>{pipEls.toast.textContent=''},5000);
}
function pipReact(make){if(PIP.win&&pipEls)make(pipEls.react)}
function renderPipBtns(){
  if(!PIP.win||!pipEls)return;
  pipEls.mic.textContent=A.mic.live?'🎙️ Açık':'🔇 Kapalı';pipEls.mic.classList.toggle('on',A.mic.live);
  pipEls.cam.textContent=A.cam.on?'📹 Açık':'📷 Kapalı';pipEls.cam.classList.toggle('on',A.cam.on);
}
function renderPipPeople(){
  if(!PIP.win||!pipEls||!A.R)return;
  const box=pipEls.people;box.textContent='';
  A.R.players.filter(p=>p.online).forEach(p=>{
    const me=p.id===A.me;
    const info=me?{mic:A.mic.live}:(A.R.peers.filter(x=>x.pid===p.id).pop()||{});
    const c=el('span','pchip'+(A.audio.speaking.has(p.id)?' speaking':''));c.style.setProperty('--pc',p.color);
    c.append(document.createElement('i'),p.name+(info.mic?' 🎙️':' 🔇'));box.appendChild(c);
  });
}
function renderPipFeed(){
  if(!PIP.win||!pipEls)return;
  const box=pipEls.feed;box.textContent='';
  A.chat.list.slice(-8).forEach(m=>box.appendChild(A.chat.renderMsg(m)));
  box.scrollTop=box.scrollHeight;
}

/* ---------- Kayıt ---------- */
A.register({
  id:'w2g',title:'Sekme Partisi',icon:'📺',color:'#2fa4ff',maxPlayers:6,
  blurb:'Biri tarayıcı sekmesini paylaşır, herkes aynı anda izler ve imleçle gösterir.',
  mount,unmount,state,tileClick,tileClickable,linkAction,chat:onChat,
  badge(pid){return G&&pid===G.presenter?'📺 ':''},
  line(){if(!G)return'';return A.nameOf(G.presenter)+(G.share?' yayında':' yayıncı')},
  msg(m){
    switch(m.t){
      case 'ptr':onPtr(m.pid,m.x,m.y);break;
      case 'ping':onPing(m.pid,m.x,m.y);break;
      case 'ask':onAsk(m.pid);break;
      case 'opened':{const x=A.chat.list.find(c=>c.id===m.id);if(x){x.opened=true;A.chat.render()}break}
    }
  },
  menu(){
    if(amPresenter()&&!A.amHost()&&A.R)return[{label:'📺 Yayını kurucuya ver',onClick:()=>A.send({t:'present',pid:A.R.host})}];
    return[];
  },
  reconnect(){if(A.screen.stream)A.send({t:'share',on:true})},
  media(){renderStage();renderPipBtns();renderPipPeople()},
  speaking(){renderPipPeople()},
  tap(){if(E&&E.video.srcObject)E.video.play().catch(()=>{})},
});
})();
