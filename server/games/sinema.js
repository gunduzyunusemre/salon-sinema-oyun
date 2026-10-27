/*
 * 🎬 Sinema — 3B sinema salonu.
 * Herkesin bir karakteri var; kamerası açık olanın yüzü karakterin yüzüne geçer.
 * Yayıncı bir sekme paylaşır, görüntü perdede oynar. Koltuğa tıklayınca oturulur.
 *
 * Yüz: herkes kendi kamerasında yüzünün 71 noktasını bulur (MediaPipe FaceLandmarker)
 * ve sadece bu noktaları gönderir. İzleyenler zaten gelen kamera görüntüsünü bu
 * noktalardan kurulan üçgen ağıyla karakterin başına büker (warp). Görüntü ayrıca
 * gönderilmez. Noktalar bulunamazsa yüz kutusuyla kırpılır, o da yoksa ortadan.
 */
(function(){
'use strict';
const A=window.App;
const isTouch=matchMedia('(hover: none)').matches;
const MP_VER='0.10.14';
const MP_CDN='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@'+MP_VER;
const MP_MODEL='https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const MP_LM_MODEL='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/* ---------- Yüz ağı ----------
   MediaPipe yüz noktalarından seçilenler ve her birinin "ortalama yüz" üzerindeki
   yeri (göz bebekleri arası = 1 birim, y aşağı doğru). Bu şablon üçgen ağını bir
   kez kurmak ve baş çevrildiğinde yüzü toparlamak için kullanılır. */
const FACE_OVAL=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const FACE_INNER={
  33:[-.75,0],133:[-.25,0],159:[-.5,-.09],145:[-.5,.08],362:[.25,0],263:[.75,0],386:[.5,-.09],374:[.5,.08], // gözler
  70:[-.85,-.3],105:[-.55,-.4],107:[-.2,-.33],300:[.85,-.3],334:[.55,-.4],336:[.2,-.33],                   // kaşlar
  151:[0,-.62],9:[0,-.25],168:[0,-.05],6:[0,.15],1:[0,.62],2:[0,.76],98:[-.2,.7],327:[.2,.7],             // alın, burun
  61:[-.4,1.05],291:[.4,1.05],0:[0,.93],37:[-.17,.95],267:[.17,.95],13:[0,1.02],14:[0,1.08],             // ağız
  17:[0,1.22],84:[-.17,1.19],314:[.17,1.19],199:[0,1.45],50:[-.68,.55],280:[.68,.55],                    // çene, yanaklar
};
const LM_IDX=[...FACE_OVAL,...Object.keys(FACE_INNER).map(Number)];   // gönderilen 71 nokta
const NO=FACE_OVAL.length,NL=LM_IDX.length,NV=NL+NO;                    // + dışta yumuşak kenar halkası
const RING=1.22;                                                        // kenar halkası yüz çevresinden ne kadar dışarıda
const FACE_S=0.13,FACE_EYE_Y=0.03,HEAD_R={x:0.21,y:0.248,z:0.215};      // yüzün baştaki ölçüsü (m)
const LM_EYES={r:[LM_IDX.indexOf(33),LM_IDX.indexOf(133)],l:[LM_IDX.indexOf(362),LM_IDX.indexOf(263)]};
const LM_SKIN=[LM_IDX.indexOf(50),LM_IDX.indexOf(280),LM_IDX.indexOf(151)];
const TEMPLATE=(()=>{
  const t=FACE_OVAL.map((_,k)=>{const a=2*Math.PI*k/NO;return[1.1*Math.sin(a),0.4-1.4*Math.cos(a)]});
  for(const k in FACE_INNER)t.push(FACE_INNER[k]);
  for(let k=0;k<NO;k++)t.push([t[k][0]*RING,0.4+(t[k][1]-0.4)*RING]);
  return t;
})();
let FACE_TRIS=null;
function delaunay(P){
  // Bowyer–Watson: küçük nokta kümesi için yeterince hızlı, bir kez çalışır
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;P.forEach(([x,y])=>{x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)});
  const d=Math.max(x1-x0,y1-y0)*20,mx=(x0+x1)/2,my=(y0+y1)/2,n=P.length;
  const pts=P.concat([[mx-d,my-d],[mx,my+d],[mx+d,my-d]]);
  const circ=(a,b,c)=>{
    const [ax,ay]=pts[a],[bx,by]=pts[b],[cx,cy]=pts[c],D=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));
    const ux=((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/D;
    const uy=((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/D;
    return{a,b,c,x:ux,y:uy,r:(ax-ux)**2+(ay-uy)**2};
  };
  let tris=[circ(n,n+1,n+2)];
  for(let i=0;i<n;i++){
    const [px,py]=pts[i],bad=[],keep=[];
    tris.forEach(t=>((px-t.x)**2+(py-t.y)**2<t.r?bad:keep).push(t));
    const edges=new Map();
    bad.forEach(t=>[[t.a,t.b],[t.b,t.c],[t.c,t.a]].forEach(([u,v])=>{const k=u<v?u+','+v:v+','+u;edges.set(k,edges.has(k)?null:[u,v])}));
    tris=keep;
    edges.forEach(e=>{if(e)tris.push(circ(e[0],e[1],i))});
  }
  return tris.filter(t=>t.a<n&&t.b<n&&t.c<n).flatMap(t=>[t.a,t.b,t.c]);
}
function faceTris(){return FACE_TRIS||(FACE_TRIS=delaunay(TEMPLATE))}

/* ---------- Salonun ölçüleri (sunucudaki koltuk sayısıyla aynı) ---------- */
const ROOM={x:7,front:-10,back:10,h:7};
const SCREEN={z:-9.5,cy:3.75,w:10.4,h:5.85};
const ROWS=3,ROW_Z0=-1.2,ROW_D=1.8,RISE=0.32;
const SX=[-5.1,-4.2,-3.3,-2.4,2.4,3.3,4.2,5.1];
const SEATS=ROWS*SX.length;
const BOUND={x:6.6,zMin:-6.4,zMax:9.4};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
function seatPos(i){const r=Math.floor(i/SX.length),c=i%SX.length;return{x:SX[c],z:ROW_Z0+r*ROW_D,y:r*RISE,row:r}}
function floorY(z){return clamp(Math.floor((z-(ROW_Z0-0.9))/ROW_D),0,ROWS)*RISE}
function blocked(x,z){
  if(Math.abs(x)>BOUND.x||z<BOUND.zMin||z>BOUND.zMax)return true;
  const ax=Math.abs(x);
  if(ax<1.95||ax>5.6)return false; // koridorlar
  for(let r=0;r<ROWS;r++){const z0=ROW_Z0+r*ROW_D;if(z>z0-0.45&&z<z0+0.42)return true}
  return false;
}
// Arka koridorda herkes ayrı bir yerde belirsin
function spawnX(pid){const ps=A.R?A.R.players.filter(p=>p.online):[];let i=ps.findIndex(p=>p.id===(pid||A.me));if(i<0)i=ps.length;return((i%8)-3.5)*1.1}
function angDiff(a,b){let d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d}

/* ---------- Durum ---------- */
let G=null;          // sunucudan: {presenter, share, seats:{pid:no}, pos:{pid:{x,z,r,w}}, face:{pid:[x,y,w,h]}}
let E=null;          // ekrandaki öğeler
let W=null;          // 3B dünya
const VOL={v:A.store.get('vol',1)};
let personTarget=null,camHintShown=false;
const amPresenter=()=>!!G&&G.presenter===A.me;
const canShare=()=>!!(navigator.mediaDevices&&navigator.mediaDevices.getDisplayMedia);
function el(tag,cls,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e}
function seatOfPid(pid){return G&&G.seats&&typeof G.seats[pid]==='number'?G.seats[pid]:-1}
function takenSeats(){const s=new Set();if(G&&G.seats)for(const k in G.seats)if(k!==A.me)s.add(G.seats[k]);return s}

let threeP=null;
function loadThree(){
  if(window.THREE)return Promise.resolve();
  if(threeP)return threeP;
  threeP=new Promise((res,rej)=>{const s=document.createElement('script');s.src='vendor/three.min.js';s.onload=res;s.onerror=()=>{threeP=null;rej(new Error('three'))};document.head.appendChild(s)});
  return threeP;
}

/* =====================================================================
   EKRAN
   ===================================================================== */
function mount(root,ctrl){
  root.innerHTML=
    '<div class="presbar hidden">'
    +'<button class="btn soft" type="button" data-a="switch">🔄 Başka sekme</button>'
    +'<div class="qseg" role="group" aria-label="Görüntü kalitesi"><button type="button" data-q="motion">🎬 Akıcı</button><button type="button" data-q="detail">🔤 Net</button></div>'
    +'<button class="btn bad" type="button" data-a="stop">⏹ Durdur</button>'
    +'</div>'
    +'<div class="cn-stage">'
    +'<canvas class="cn-canvas" tabindex="0" aria-label="Sinema salonu"></canvas>'
    +'<div class="cn-load">Salon hazırlanıyor…</div>'
    +'<div class="stagetop"><span class="livetag"></span><span class="stagectl">'
    +'<button type="button" class="cn-volbtn" aria-label="Perde sesi">🔊</button>'
    +'<input type="range" class="cn-vol" min="0" max="1" step="0.05" aria-label="Perde ses düzeyi">'
    +'<button type="button" class="cn-fs" aria-label="Tam ekran">⛶</button></span></div>'
    +'<div class="cn-hint"></div>'
    +'<div class="cn-joy" aria-hidden="true"><i></i></div>'
    +'<div class="cn-media"><video class="cn-sv" playsinline autoplay></video></div>'
    +'</div>';
  const q=s=>root.querySelector(s);
  E={root,bar:q('.presbar'),stage:q('.cn-stage'),canvas:q('.cn-canvas'),load:q('.cn-load'),live:q('.livetag'),
    vol:q('.cn-vol'),volBtn:q('.cn-volbtn'),fs:q('.cn-fs'),hint:q('.cn-hint'),joy:q('.cn-joy'),knob:q('.cn-joy i'),
    media:q('.cn-media'),sv:q('.cn-sv')};

  E.share=el('button','cbtn sunb','<span class="ci">🖥️</span><span class="cl">Paylaş</span>');E.share.type='button';
  E.share.addEventListener('click',()=>{
    if(amPresenter()){A.screen.stream?stopShare(false):startShare()}
    else A.send({t:'ask'});
  });
  E.seatBtn=el('button','cbtn','<span class="ci">💺</span><span class="cl">Otur</span>');E.seatBtn.type='button';
  E.seatBtn.addEventListener('click',toggleSeat);
  ctrl.append(E.share,E.seatBtn);

  q('[data-a=switch]').addEventListener('click',startShare);
  q('[data-a=stop]').addEventListener('click',()=>stopShare(false));
  root.querySelectorAll('.qseg button').forEach(b=>b.addEventListener('click',()=>{
    A.screen.setQuality(b.dataset.q);renderScreen();
    A.toast(b.dataset.q==='motion'?'Akıcı: film ve oyun için':'Net: yazı okumak için');
  }));
  E.vol.value=VOL.v;
  E.vol.addEventListener('input',()=>setVol(+E.vol.value));
  E.volBtn.addEventListener('click',()=>setVol(VOL.v>0?0:1));
  E.volBtn.textContent=VOL.v===0?'🔇':'🔊';
  E.fs.addEventListener('click',()=>{
    if(document.fullscreenElement)return document.exitFullscreen().catch(()=>{});
    if(E.stage.requestFullscreen)E.stage.requestFullscreen().catch(()=>{});
    else if(E.stage.webkitRequestFullscreen)E.stage.webkitRequestFullscreen();
  });

  // Yayıncı yapma / istek penceresi
  E.person=el('div','overlay hidden',
    '<div class="modal"><h2></h2><p></p><div class="mbtns">'
    +'<button class="btn sun" type="button" data-a="make">📺 Yayıncı yap</button>'
    +'<button class="btn soft" type="button" data-close>Kapat</button></div></div>');
  E.person.addEventListener('click',e=>{if(e.target===E.person||e.target.hasAttribute('data-close'))E.person.classList.add('hidden')});
  E.person.querySelector('[data-a=make]').addEventListener('click',()=>{if(personTarget)A.send({t:'present',pid:personTarget});E.person.classList.add('hidden')});
  document.body.appendChild(E.person);

  A.hooks.react.push(onReact);
  const myE=E;
  loadThree().then(()=>{if(E===myE)buildWorld()}).catch(e=>{console.error('Sinema '+(e&&e.stack||e));if(E===myE){E.load.classList.remove('hidden');E.load.textContent='3B salon yüklenemedi. Sayfayı yenileyip tekrar dene.'}});
  if(!A.cam.on&&!camHintShown){camHintShown=true;setTimeout(()=>{if(E&&!A.cam.on)A.toast('📷 Kameranı açarsan yüzün karakterine geçer')},1500)}
}

function unmount(){
  stopShare(true);
  FD.stop();
  destroyWorld();
  if(E){E.person.remove()}
  const i=A.hooks.react.indexOf(onReact);if(i>=0)A.hooks.react.splice(i,1);
  G=null;E=null;
}

function state(g){
  G=g||{presenter:null,share:null,seats:{},pos:{},face:{}};
  if(A.screen.stream&&!amPresenter())stopShare(true);
  syncWorld();renderScreen();renderButtons();
}

function renderButtons(){
  if(!E)return;
  const sh=E.share;
  if(amPresenter()){
    sh.className='cbtn '+(A.screen.stream?'badb':'sunb');
    sh.querySelector('.ci').textContent=A.screen.stream?'⏹':'🖥️';sh.querySelector('.cl').textContent=A.screen.stream?'Durdur':'Paylaş';
  }else{
    sh.className='cbtn';sh.querySelector('.ci').textContent='✋';sh.querySelector('.cl').textContent='Sıra iste';
  }
  const seated=W&&W.me.seat>=0;
  E.seatBtn.className='cbtn'+(seated?' on':'');
  E.seatBtn.querySelector('.ci').textContent=seated?'🚶':'💺';
  E.seatBtn.querySelector('.cl').textContent=seated?'Kalk':'Otur';
  E.bar.classList.toggle('hidden',!(amPresenter()&&A.screen.stream));
  E.root.querySelectorAll('.qseg button').forEach(x=>x.classList.toggle('on',x.dataset.q===A.screen.quality));
  renderHint();
}
function renderHint(){
  if(!E)return;
  let t;
  if(W&&W.me.seat>=0)t=isTouch?'Kalkmak için 🚶 Kalk\'a bas. Parmağınla etrafa bak.':'Kalkmak için E\'ye bas ya da yürümeye başla';
  else if(W&&W.me.pending>=0)t='Koltuğa geçiliyor…';
  else t=isTouch?'Soldaki çubukla yürü, boş bir koltuğa dokun':'WASD ile yürü, sürükleyerek bak, boş bir koltuğa tıkla';
  E.hint.textContent=t;
}

/* ---------- Perde ---------- */
function setVol(x){
  VOL.v=clamp(x,0,1);A.store.set('vol',VOL.v);
  if(!E)return;
  E.vol.value=VOL.v;
  if(!E.sv.muted)E.sv.volume=VOL.v;
  E.volBtn.textContent=VOL.v===0?'🔇':'🔊';
}
function renderScreen(){
  if(!E||!G)return;
  const live=!!G.share,mine=live&&G.share===A.cid,v=E.sv;
  const stream=!live?null:mine?A.screen.stream:A.screen.peer(G.share);
  if(v.srcObject!==stream)v.srcObject=stream;
  v.muted=!live||mine;
  if(!v.muted)v.volume=VOL.v;
  if(stream)v.play().catch(()=>{if(!v.muted){A.audio.needTap=true;A.toast('Sesi duymak için ekrana bir kez dokun')}});
  E.stage.classList.toggle('live',live);
  E.stage.classList.toggle('mine',mine);
  E.live.classList.toggle('idle',!live);
  E.live.textContent=live?A.nameOf(A.peerPid(G.share)||G.presenter)+' yayında':'Perde kapalı';
  if(W){W.screenLive=live&&!!stream;drawIdleScreen();applyScreenTex()}
}

/* =====================================================================
   SEKME PAYLAŞIMI (Sekme Partisi ile aynı akış)
   ===================================================================== */
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
    if(e&&e.name==='TypeError'){try{s=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false})}catch(_){}}
    if(!s){if(e&&e.name!=='NotAllowedError'&&e.name!=='AbortError')A.toast('Paylaşım başlatılamadı');return}
  }
  if(!G||!amPresenter()){s.getTracks().forEach(t=>t.stop());return}
  A.screen.set(s);
  const v=s.getVideoTracks()[0];
  if(v)v.onended=()=>{if(A.screen.stream===s)stopShare(false)};
  if(!s.getAudioTracks().length)A.toast('Sekme sesi gelmiyor. Seçerken "Sekme sesini de paylaş" açık olmalı.');
  A.send({t:'share',on:true});
  renderScreen();renderButtons();
}
function stopShare(silent){
  if(!A.screen.stream)return;
  A.screen.set(null);
  if(!silent)A.send({t:'share',on:false});
  renderScreen();renderButtons();
}
function tileClickable(){return !!G&&(A.amHost()||amPresenter())}
function tileClick(pid){
  if(!E||!tileClickable())return;
  personTarget=pid;
  E.person.querySelector('h2').textContent=A.nameOf(pid);
  E.person.querySelector('p').textContent=pid===G.presenter?'Şu an perdeyi bu kişi yönetiyor.':'Yayıncı yaparsan perde ona geçer, o kendi sekmesini seçer.';
  E.person.querySelector('[data-a=make]').classList.toggle('hidden',pid===G.presenter);
  E.person.querySelector('[data-close]').textContent='Kapat';
  E.person.classList.remove('hidden');
}
function onAsk(pid){
  if(!E)return;
  personTarget=pid;
  E.person.querySelector('h2').textContent='✋ '+A.nameOf(pid);
  E.person.querySelector('p').textContent=A.nameOf(pid)+' perdeye kendi sekmesini yansıtmak istiyor.';
  E.person.querySelector('[data-a=make]').classList.remove('hidden');
  E.person.querySelector('[data-close]').textContent='Şimdi değil';
  E.person.classList.remove('hidden');A.audio.ding();A.toast(A.nameOf(pid)+' paylaşmak istiyor');
}

/* =====================================================================
   YÜZ TESPİTİ — sadece kendi kameramda çalışır
   ===================================================================== */
const FD={
  det:null,kind:'',loading:null,failed:false,video:null,timer:null,box:null,lm:null,miss:0,sentAt:0,sent:undefined,busy:false,
  async load(){
    if(this.det||this.failed)return;
    if(this.loading)return this.loading;
    this.loading=(async()=>{
      try{
        const m=await import(MP_CDN+'/vision_bundle.mjs');
        const files=await m.FilesetResolver.forVisionTasks(MP_CDN+'/wasm');
        // Önce yüz noktaları (warp için), olmazsa yalnızca yüz kutusu
        const tryBoth=async make=>{try{return await make('GPU')}catch(e){return await make('CPU')}};
        try{
          this.det=await tryBoth(delegate=>m.FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:MP_LM_MODEL,delegate},runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:0.5,minTrackingConfidence:0.5}));
          this.kind='lm';return;
        }catch(e){console.warn('FaceLandmarker açılamadı, yüz kutusu kullanılacak',e)}
        this.det=await tryBoth(delegate=>m.FaceDetector.createFromOptions(files,{baseOptions:{modelAssetPath:MP_MODEL,delegate},runningMode:'VIDEO',minDetectionConfidence:0.5}));
        this.kind='mp';return;
      }catch(e){console.warn('MediaPipe yüklenemedi',e)}
      try{
        if('FaceDetector' in window){this.det=new window.FaceDetector({fastMode:true,maxDetectedFaces:1});this.kind='native';return}
      }catch(e){}
      this.failed=true; // yüz bulunamazsa görüntünün ortası kırpılır
    })();
    await this.loading;this.loading=null;
  },
  start(){
    if(this.timer||!A.cam.stream)return;
    if(!this.video){
      const v=this.video=document.createElement('video');v.muted=true;v.playsInline=true;v.setAttribute('playsinline','');
      v.style.cssText='position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none';
      document.body.appendChild(v);
    }
    if(this.video.srcObject!==A.cam.stream)this.video.srcObject=A.cam.stream;
    this.video.play().catch(()=>{});
    this.load();
    this.timer=setInterval(()=>this.step(),110);
  },
  stop(){
    clearInterval(this.timer);this.timer=null;this.box=null;this.lm=null;this.miss=0;
    if(this.video){this.video.srcObject=null}
    if(this.sent!==null&&this.sent!==undefined){A.send({t:'face'})}
    this.sent=undefined;
  },
  async step(){
    const v=this.video;
    if(!A.cam.stream){this.stop();return}
    if(v.srcObject!==A.cam.stream){v.srcObject=A.cam.stream;v.play().catch(()=>{})}
    if(!this.det||this.busy||v.readyState<2||!v.videoWidth)return;
    const vw=v.videoWidth,vh=v.videoHeight;
    let bb=null,lm=null;
    this.busy=true;
    try{
      if(this.kind==='lm'){
        const r=this.det.detectForVideo(v,performance.now());
        const f=r&&r.faceLandmarks&&r.faceLandmarks[0];
        if(f&&f.length>=468){lm=new Float32Array(NL*2);LM_IDX.forEach((k,i)=>{lm[i*2]=f[k].x;lm[i*2+1]=f[k].y})}
      }else if(this.kind==='mp'){
        const r=this.det.detectForVideo(v,performance.now());
        let best=null;
        (r&&r.detections||[]).forEach(d=>{const b=d.boundingBox;if(b&&(!best||b.width*b.height>best.width*best.height))best=b});
        if(best)bb=[best.originX/vw,best.originY/vh,best.width/vw,best.height/vh];
      }else if(this.kind==='native'){
        const fs=await this.det.detect(v);
        if(fs&&fs[0]){const b=fs[0].boundingBox;bb=[b.x/vw,b.y/vh,b.width/vw,b.height/vh]}
      }
    }catch(e){/* tek kare atlanabilir */}
    this.busy=false;
    if(lm){
      this.miss=0;
      // Titremeyi azalt: yeni noktaya yarı yarıya yaklaş
      if(this.lm)for(let i=0;i<lm.length;i++)this.lm[i]=lerp(this.lm[i],lm[i],0.6);else this.lm=lm;
    }else if(bb){
      bb=bb.map(x=>clamp(x,0,1));
      this.miss=0;
      this.box=this.box?this.box.map((x,i)=>lerp(x,bb[i],0.55)):bb;
    }else if(++this.miss>25){this.box=null;this.lm=null} // ~3 saniye yüz yoksa ortadan kırp
    this.publish();
  },
  publish(){
    const now=Date.now();
    if(now-this.sentAt<130)return;
    let msg;
    if(this.lm)msg={lm:Array.from(this.lm,x=>Math.round(clamp(x,-0.3,1.3)*1000))};
    else if(this.box)msg={b:this.box.map(x=>Math.round(x*1000)/1000)};
    else msg={};
    const key=msg.lm?'lm':msg.b?'b':'';
    const prev=this.sent,arr=msg.lm||msg.b;
    const changed=prev===undefined||(prev?prev.key:'')!==key||(arr&&prev.arr.some((x,i)=>Math.abs(x-arr[i])>(msg.lm?3:0.012)));
    if(!changed)return;
    this.sentAt=now;this.sent=key?{key,arr}:null;
    A.send({t:'face',...msg});
  },
};

/* =====================================================================
   3B DÜNYA
   ===================================================================== */
function buildWorld(){
  const T=window.THREE;
  let renderer;
  try{renderer=new T.WebGLRenderer({canvas:E.canvas,antialias:true,powerPreference:'high-performance'})}
  catch(e){E.load.textContent='Bu cihaz 3B görüntüyü (WebGL) desteklemiyor.';return}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.outputEncoding=T.sRGBEncoding;
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
  const scene=new T.Scene();
  scene.background=new T.Color(0x0b0816);
  scene.fog=new T.Fog(0x0b0816,14,34);
  const cam=new T.PerspectiveCamera(62,1,0.05,80);

  W={T,renderer,scene,cam,raf:0,last:0,seatMeshes:[],seatGroups:[],hoverSeat:-1,av:{},fx:[],
    me:{x:spawnX(),z:5.4,y:floorY(5.4),r:Math.PI,seat:-1,pending:-1,walk:0,sentAt:0,sent:null,moving:false},
    view:{yaw:0,pitch:-0.18,dist:4.2},keys:new Set(),joy:{x:0,y:0,id:null},drag:null,
    screenLive:false,house:1,glow:new T.Color(0x334477),sampleAt:0,faceAt:0,disposables:[]};
  const keep=o=>{W.disposables.push(o);return o};

  // Işıklar
  W.amb=new T.AmbientLight(0xbfb4ff,0.35);scene.add(W.amb);
  W.hemi=new T.HemisphereLight(0x9aa6ff,0x2a1020,0.35);scene.add(W.hemi);
  W.sconces=[];
  [[-6.9,-4],[-6.9,3],[6.9,-4],[6.9,3]].forEach(([x,z])=>{
    const l=new T.PointLight(0xffa860,0.9,7,2);l.position.set(x*0.94,3.4,z);scene.add(l);W.sconces.push(l);
    const m=new T.Mesh(keep(new T.ConeGeometry(0.22,0.5,16,1,true)),keep(new T.MeshBasicMaterial({color:0xffc488,side:T.DoubleSide})));
    m.position.set(x*0.985,3.3,z);m.rotation.z=Math.PI;scene.add(m);
  });
  W.spot=new T.SpotLight(0x8899ff,1.6,32,0.95,0.7,1.2);W.spot.position.set(0,SCREEN.cy,SCREEN.z+0.6);
  W.spot.target.position.set(0,0,6);scene.add(W.spot,W.spot.target);

  // Halı (desenli)
  const carpet=document.createElement('canvas');carpet.width=carpet.height=128;
  {const c=carpet.getContext('2d');c.fillStyle='#2b1640';c.fillRect(0,0,128,128);
   for(let i=0;i<8;i++)for(let j=0;j<8;j++){c.fillStyle=(i+j)%2?'#3a1d55':'#24123a';c.beginPath();c.arc(i*16+8,j*16+8,3,0,7);c.fill()}
   c.strokeStyle='rgba(255,190,90,.12)';c.lineWidth=2;for(let k=0;k<128;k+=32){c.beginPath();c.moveTo(k,0);c.lineTo(k+32,128);c.stroke()}}
  const carpetTex=keep(new T.CanvasTexture(carpet));carpetTex.wrapS=carpetTex.wrapT=T.RepeatWrapping;carpetTex.repeat.set(10,14);carpetTex.encoding=T.sRGBEncoding;
  const carpetMat=keep(new T.MeshStandardMaterial({map:carpetTex,roughness:1}));
  const floor=new T.Mesh(keep(new T.PlaneGeometry(ROOM.x*2,ROOM.back-ROOM.front)),carpetMat);
  floor.rotation.x=-Math.PI/2;floor.position.z=(ROOM.back+ROOM.front)/2;scene.add(floor);

  // Basamaklar ve kenar ışıkları
  const ledMat=keep(new T.MeshBasicMaterial({color:0xffb347}));
  for(let t=1;t<=ROWS;t++){
    const zs=ROW_Z0-0.9+t*ROW_D,d=ROOM.back-zs;
    const b=new T.Mesh(keep(new T.BoxGeometry(ROOM.x*2,RISE,d)),carpetMat);
    b.position.set(0,(t-0.5)*RISE,zs+d/2);scene.add(b);
    const led=new T.Mesh(keep(new T.BoxGeometry(ROOM.x*2-0.2,0.025,0.02)),ledMat);
    led.position.set(0,(t-1)*RISE+0.05,zs-0.012);scene.add(led);
  }

  // Duvarlar ve tavan
  const panel=document.createElement('canvas');panel.width=64;panel.height=256;
  {const c=panel.getContext('2d');const g=c.createLinearGradient(0,0,64,0);g.addColorStop(0,'#1a1230');g.addColorStop(.5,'#2a1d48');g.addColorStop(1,'#1a1230');c.fillStyle=g;c.fillRect(0,0,64,256);c.fillStyle='rgba(0,0,0,.35)';c.fillRect(0,0,3,256)}
  const panelTex=keep(new T.CanvasTexture(panel));panelTex.wrapS=T.RepeatWrapping;panelTex.repeat.set(12,1);panelTex.encoding=T.sRGBEncoding;
  const wallMat=keep(new T.MeshStandardMaterial({map:panelTex,roughness:.95}));
  const L=ROOM.back-ROOM.front;
  [[-ROOM.x,Math.PI/2],[ROOM.x,-Math.PI/2]].forEach(([x,ry])=>{const w=new T.Mesh(keep(new T.PlaneGeometry(L,ROOM.h)),wallMat);w.position.set(x,ROOM.h/2,(ROOM.back+ROOM.front)/2);w.rotation.y=ry;scene.add(w)});
  const backW=new T.Mesh(keep(new T.PlaneGeometry(ROOM.x*2,ROOM.h)),wallMat);backW.position.set(0,ROOM.h/2,ROOM.back);backW.rotation.y=Math.PI;scene.add(backW);
  const frontMat=keep(new T.MeshStandardMaterial({color:0x0c0916,roughness:1}));
  const frontW=new T.Mesh(keep(new T.PlaneGeometry(ROOM.x*2,ROOM.h)),frontMat);frontW.position.set(0,ROOM.h/2,ROOM.front);scene.add(frontW);
  const ceil=new T.Mesh(keep(new T.PlaneGeometry(ROOM.x*2,L)),keep(new T.MeshStandardMaterial({color:0x0d0a1a,roughness:1})));
  ceil.rotation.x=Math.PI/2;ceil.position.set(0,ROOM.h,(ROOM.back+ROOM.front)/2);scene.add(ceil);
  // Tavanda yıldızlar
  {const n=260,pos=new Float32Array(n*3);for(let i=0;i<n;i++){pos[i*3]=(Math.random()*2-1)*(ROOM.x-0.3);pos[i*3+1]=ROOM.h-0.02;pos[i*3+2]=lerp(ROOM.front+3,ROOM.back-0.3,Math.random())}
   const g=keep(new T.BufferGeometry());g.setAttribute('position',new T.BufferAttribute(pos,3));
   scene.add(new T.Points(g,keep(new T.PointsMaterial({color:0xffe6b0,size:0.045}))))}
  // Arkada makine dairesi penceresi
  W.booth=new T.Mesh(keep(new T.PlaneGeometry(1.4,0.6)),keep(new T.MeshBasicMaterial({color:0xfff1c8})));
  W.booth.position.set(0,5.4,ROOM.back-0.01);W.booth.rotation.y=Math.PI;scene.add(W.booth);
  // Çıkış tabelası
  {const c=document.createElement('canvas');c.width=256;c.height=96;const x=c.getContext('2d');x.fillStyle='#0b6b3a';x.fillRect(0,0,256,96);x.fillStyle='#d9ffe9';x.font='bold 54px system-ui,sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText('ÇIKIŞ',128,50);
   const tx=keep(new T.CanvasTexture(c));tx.encoding=T.sRGBEncoding;const s=new T.Mesh(keep(new T.PlaneGeometry(0.9,0.34)),keep(new T.MeshBasicMaterial({map:tx})));
   s.position.set(-ROOM.x+0.02,3,ROOM.back-1.4);s.rotation.y=Math.PI/2;scene.add(s)}

  // Sahne, perde çerçevesi, kadife perdeler
  const stage=new T.Mesh(keep(new T.BoxGeometry(ROOM.x*2,0.55,2.6)),keep(new T.MeshStandardMaterial({color:0x2a1a14,roughness:.7})));
  stage.position.set(0,0.275,ROOM.front+1.3);scene.add(stage);
  const screenFrame=new T.Mesh(keep(new T.BoxGeometry(SCREEN.w+0.5,SCREEN.h+0.5,0.1)),keep(new T.MeshStandardMaterial({color:0x050308,roughness:.8})));
  screenFrame.position.set(0,SCREEN.cy,SCREEN.z-0.07);scene.add(screenFrame);
  const cur=document.createElement('canvas');cur.width=256;cur.height=8;
  {const c=cur.getContext('2d');for(let i=0;i<256;i++){const s=0.55+0.45*Math.sin(i/256*Math.PI*14);c.fillStyle='rgb('+Math.round(120*s)+','+Math.round(14*s)+','+Math.round(30*s)+')';c.fillRect(i,0,1,8)}}
  const curTex=keep(new T.CanvasTexture(cur));curTex.encoding=T.sRGBEncoding;
  const curMat=keep(new T.MeshStandardMaterial({map:curTex,roughness:.85,side:T.DoubleSide}));
  [-1,1].forEach(sd=>{const c=new T.Mesh(keep(new T.PlaneGeometry(1.9,ROOM.h-0.4)),curMat);c.position.set(sd*(SCREEN.w/2+1.15),(ROOM.h-0.4)/2+0.2,SCREEN.z+0.25);c.rotation.y=-sd*0.25;scene.add(c)});
  const val=new T.Mesh(keep(new T.PlaneGeometry(ROOM.x*2,0.8)),curMat);val.position.set(0,ROOM.h-0.4,SCREEN.z+0.3);scene.add(val);

  // Perde
  W.idleCanvas=document.createElement('canvas');W.idleCanvas.width=1024;W.idleCanvas.height=576;
  W.idleTex=keep(new T.CanvasTexture(W.idleCanvas));W.idleTex.encoding=T.sRGBEncoding;
  W.vidTex=keep(new T.VideoTexture(E.sv));W.vidTex.encoding=T.sRGBEncoding;
  W.screenMat=keep(new T.MeshBasicMaterial({map:W.idleTex,toneMapped:false}));
  W.screen=new T.Mesh(keep(new T.PlaneGeometry(1,1)),W.screenMat);
  W.screen.position.set(0,SCREEN.cy,SCREEN.z);W.screen.scale.set(SCREEN.w,SCREEN.h,1);scene.add(W.screen);
  E.sv.addEventListener('resize',fitScreen);
  W.sampler=document.createElement('canvas');W.sampler.width=W.sampler.height=6;
  W.sctx=W.sampler.getContext('2d',{willReadFrequently:true});

  // Koltuklar
  const velvet=keep(new T.MeshStandardMaterial({color:0x8a1630,roughness:.85}));
  const armMat=keep(new T.MeshStandardMaterial({color:0x1a1018,roughness:.6}));
  const gCush=keep(new T.BoxGeometry(0.66,0.16,0.56)),gBack=keep(new T.BoxGeometry(0.66,0.78,0.14)),gArm=keep(new T.BoxGeometry(0.08,0.12,0.6)),gLeg=keep(new T.BoxGeometry(0.5,0.34,0.4));
  for(let i=0;i<SEATS;i++){
    const p=seatPos(i),grp=new T.Group();grp.position.set(p.x,p.y,p.z);
    const mat=velvet.clone();keep(mat);
    const cush=new T.Mesh(gCush,mat);cush.position.set(0,0.42,0);
    const back=new T.Mesh(gBack,mat);back.position.set(0,0.82,0.3);back.rotation.x=0.12;
    const base=new T.Mesh(gLeg,armMat);base.position.set(0,0.17,0.02);
    const a1=new T.Mesh(gArm,armMat);a1.position.set(-0.37,0.62,0.02);
    const a2=new T.Mesh(gArm,armMat);a2.position.set(0.37,0.62,0.02);
    grp.add(cush,back,base,a1,a2);
    [cush,back,base,a1,a2].forEach(m=>{m.userData.seat=i;W.seatMeshes.push(m)});
    grp.userData.mat=mat;W.seatGroups.push(grp);scene.add(grp);
  }

  W.ray=new T.Raycaster();
  bindInput();
  const ro=new ResizeObserver(resize);ro.observe(E.stage);W.ro=ro;resize();
  E.load.classList.add('hidden');
  syncWorld();renderScreen();renderButtons();
  sendPos(true);
  W.last=performance.now();
  W.raf=requestAnimationFrame(frame);
}

function destroyWorld(){
  if(!W)return;
  cancelAnimationFrame(W.raf);
  if(W.ro)W.ro.disconnect();
  unbindInput();
  for(const pid in W.av)removeAvatar(pid);
  W.fx.forEach(f=>{W.scene.remove(f.s);f.s.material.map.dispose();f.s.material.dispose()});
  W.disposables.forEach(o=>{try{o.dispose()}catch(e){}});
  try{W.renderer.dispose()}catch(e){}
  W=null;
}

function resize(){
  if(!W||!E)return;
  const w=E.stage.clientWidth||1,h=E.stage.clientHeight||1;
  W.renderer.setSize(w,h,false);W.cam.aspect=w/h;W.cam.updateProjectionMatrix();
}
function fitScreen(){
  if(!W)return;
  const v=E.sv;let w=SCREEN.w,h=SCREEN.h;
  if(W.screenLive&&v.videoWidth&&v.videoHeight){const a=v.videoWidth/v.videoHeight;if(a>w/h)h=w/a;else w=h*a}
  W.screen.scale.set(w,h,1);
}
function applyScreenTex(){
  if(!W)return;
  const want=W.screenLive?W.vidTex:W.idleTex;
  if(W.screenMat.map!==want){W.screenMat.map=want;W.screenMat.needsUpdate=true}
  fitScreen();
}
function drawIdleScreen(){
  if(!W||!G)return;
  const c=W.idleCanvas.getContext('2d'),w=1024,h=576;
  const g=c.createRadialGradient(w/2,h*.45,40,w/2,h/2,w*.7);g.addColorStop(0,'#2b2a5a');g.addColorStop(1,'#0d0b20');
  c.fillStyle=g;c.fillRect(0,0,w,h);
  c.fillStyle='rgba(255,255,255,.05)';for(let i=0;i<w;i+=4)c.fillRect(i,0,1,h);
  c.textAlign='center';c.textBaseline='middle';c.fillStyle='#fff3d6';
  c.font='800 84px "Baloo 2",system-ui,sans-serif';c.fillText('🎬',w/2,h*.3);
  c.font='700 46px "Baloo 2",system-ui,sans-serif';
  c.fillText(amPresenter()?'Sıra sende: bir sekme paylaş':A.nameOf(G.presenter)+' bir sekme paylaşınca',w/2,h*.55);
  c.fillStyle='#b9b2e8';c.font='600 32px "Baloo 2",system-ui,sans-serif';
  c.fillText(amPresenter()?'Alttaki 🖥️ Paylaş düğmesine bas, Chrome sekmesini seç':'film burada oynar. Bu arada bir koltuk kap.',w/2,h*.68);
  W.idleTex.needsUpdate=true;
}

/* ---------- Karakterler ---------- */
function makeAvatar(pid){
  const T=W.T,p=A.findP(pid),color=new T.Color(p?p.color:'#5b4dff');
  const g=new T.Group();
  const skin=new T.MeshStandardMaterial({color:0xe9b996,roughness:.7});
  const cloth=new T.MeshStandardMaterial({color,roughness:.75});
  const pants=new T.MeshStandardMaterial({color:0x26283a,roughness:.9});
  const dark=new T.MeshStandardMaterial({color:0x151018,roughness:.6});
  const hairM=new T.MeshStandardMaterial({color:color.clone().multiplyScalar(.35),roughness:.9});
  const geos=[];const G_=x=>{geos.push(x);return x};
  const torso=new T.Mesh(G_(new T.CapsuleGeometry(0.22,0.36,6,14)),cloth);torso.position.y=1.12;
  const legs=[],shins=[],arms=[];
  [-1,1].forEach(sd=>{
    const hip=new T.Group();hip.position.set(sd*0.11,0.84,0);
    const th=new T.Mesh(G_(new T.CylinderGeometry(0.09,0.08,0.42,10)),pants);th.position.y=-0.21;
    const knee=new T.Group();knee.position.y=-0.42;
    const sh=new T.Mesh(G_(new T.CylinderGeometry(0.075,0.065,0.38,10)),pants);sh.position.y=-0.19;
    const shoe=new T.Mesh(G_(new T.BoxGeometry(0.13,0.07,0.24)),dark);shoe.position.set(0,-0.39,0.05);
    knee.add(sh,shoe);hip.add(th,knee);g.add(hip);legs.push(hip);shins.push(knee);
    const sho=new T.Group();sho.position.set(sd*0.29,1.42,0);
    const arm=new T.Mesh(G_(new T.CylinderGeometry(0.065,0.055,0.56,10)),cloth);arm.position.y=-0.28;
    const hand=new T.Mesh(G_(new T.SphereGeometry(0.065,10,8)),skin);hand.position.y=-0.58;
    sho.add(arm,hand);sho.rotation.z=sd*0.08;g.add(sho);arms.push(sho);
  });
  const head=new T.Group();head.position.y=1.74;
  const shape=new T.Group();shape.scale.set(1,HEAD_R.y/0.21,HEAD_R.z/0.21); // hafif oval baş, yüze daha iyi oturur
  const skull=new T.Mesh(G_(new T.SphereGeometry(0.21,24,18)),skin);
  // Yüz: başın önündeki kavisli parça, kameradan kırpılan görüntü buraya kaplanır
  const fc=document.createElement('canvas');fc.width=fc.height=160;
  const ftex=new T.CanvasTexture(fc);ftex.encoding=T.sRGBEncoding;
  const faceMat=new T.MeshBasicMaterial({map:ftex,transparent:true,depthWrite:false,toneMapped:false,color:0xf2f2f2});
  const face=new T.Mesh(G_(new T.SphereGeometry(0.2135,28,20,Math.PI/2-1.12,2.24,0.5,1.55)),faceMat);
  const hair1=new T.Mesh(G_(new T.SphereGeometry(0.222,22,12,0,Math.PI*2,0,0.62)),hairM);
  const hair2=new T.Mesh(G_(new T.SphereGeometry(0.222,22,14,Math.PI/2+1.05,Math.PI*2-2.1,0,1.95)),hairM);
  shape.add(skull,face,hair1,hair2);
  // Bükülen yüz: noktaları her karede kameradaki yüze göre güncellenen üçgen ağı
  const wg=new T.BufferGeometry();
  wg.setAttribute('position',new T.BufferAttribute(new Float32Array(NV*3),3).setUsage(T.DynamicDrawUsage));
  wg.setAttribute('uv',new T.BufferAttribute(new Float32Array(NV*2),2).setUsage(T.DynamicDrawUsage));
  const col=new Float32Array(NV*4);for(let i=0;i<NV;i++){col.set([1,1,1,i<NO?0.9:i<NL?1:0],i*4)} // dış halka saydam: kenar yumuşak
  wg.setAttribute('color',new T.BufferAttribute(col,4));
  wg.setIndex(faceTris());G_(wg);
  const warpMat=new T.MeshBasicMaterial({vertexColors:true,transparent:true,depthWrite:false,toneMapped:false,side:T.DoubleSide,color:0xe8e8e8});
  const warp=new T.Mesh(wg,warpMat);warp.visible=false;warp.frustumCulled=false;warp.renderOrder=2;
  head.add(shape,warp);g.add(torso,head);
  const ring=new T.Mesh(G_(new T.RingGeometry(0.36,0.46,32)),new T.MeshBasicMaterial({color,transparent:true,opacity:.85,side:T.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=0.03;ring.visible=false;g.add(ring);
  const tag=makeLabel(pid);tag.position.y=2.16;g.add(tag);
  W.scene.add(g);
  const P=A.R&&A.R.players.find(x=>x.id===pid);
  const av={pid,g,legs,shins,arms,head,ring,tag,mats:[skin,cloth,pants,dark,hairM,faceMat,warpMat,ring.material],geos,
    face:{canvas:fc,ctx:fc.getContext('2d'),tex:ftex,mode:'',video:null,stream:null,crop:null,
      cap:face,warp,warpMat,vtex:null,skin,skin0:skin.color.clone(),skinAt:0,uv:null,pos:null},
    cur:{x:0,z:0,y:0,r:Math.PI},tgt:null,walkT:Math.random()*6,speed:0,seated:-1,name:P?P.name:'',color:P?P.color:''};
  drawCartoon(av.face);
  return av;
}
function makeLabel(pid){
  const T=W.T,c=document.createElement('canvas');c.width=256;c.height=64;
  const tex=new T.CanvasTexture(c);tex.encoding=T.sRGBEncoding;
  const s=new T.Sprite(new T.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
  s.scale.set(0.9,0.225,1);s.userData={c,tex};paintLabel(s,pid,false);return s;
}
function paintLabel(s,pid,speaking){
  const c=s.userData.c,x=c.getContext('2d'),p=A.findP(pid);
  const name=(p?p.name:'?')+(pid===A.R.host?' 👑':'');
  x.clearRect(0,0,256,64);x.font='700 30px "Baloo 2",system-ui,sans-serif';
  const tw=Math.min(236,x.measureText(name).width+44),l=(256-tw)/2;
  x.fillStyle=speaking?(p?p.color:'#5b4dff'):'rgba(10,8,24,.72)';
  x.beginPath();x.moveTo(l+16,8);x.arcTo(l+tw,8,l+tw,56,16);x.arcTo(l+tw,56,l,56,16);x.arcTo(l,56,l,8,16);x.arcTo(l,8,l+tw,8,16);x.fill();
  x.fillStyle=p?p.color:'#5b4dff';x.beginPath();x.arc(l+18,32,7,0,7);x.fill();
  if(speaking){x.fillStyle='#fff';x.beginPath();x.arc(l+18,32,4,0,7);x.fill()}
  x.fillStyle='#fff';x.textBaseline='middle';x.fillText(name,l+32,34,tw-40);
  s.userData.tex.needsUpdate=true;
}
function removeAvatar(pid){
  const av=W.av[pid];if(!av)return;
  W.scene.remove(av.g);
  av.geos.forEach(g=>g.dispose());av.mats.forEach(m=>m.dispose());
  av.face.tex.dispose();av.tag.material.map.dispose();av.tag.material.dispose();
  if(av.face.vtex)av.face.vtex.dispose();
  if(av.face.video){av.face.video.srcObject=null;av.face.video.remove()}
  delete W.av[pid];
}

/* Kameradan kırpılan yüz ya da çizgi yüz */
function drawCartoon(F){
  const c=F.ctx,S=F.canvas.width;
  c.clearRect(0,0,S,S);
  c.fillStyle='#2a1a22';
  [[.36,.43],[.64,.43]].forEach(([x,y])=>{c.beginPath();c.ellipse(S*x,S*y,S*.045,S*.06,0,0,7);c.fill()});
  c.fillStyle='rgba(255,255,255,.9)';
  [[.375,.41],[.655,.41]].forEach(([x,y])=>{c.beginPath();c.arc(S*x,S*y,S*.015,0,7);c.fill()});
  c.fillStyle='rgba(255,110,120,.35)';
  [[.27,.56],[.73,.56]].forEach(([x,y])=>{c.beginPath();c.ellipse(S*x,S*y,S*.06,S*.035,0,0,7);c.fill()});
  c.strokeStyle='#2a1a22';c.lineWidth=S*.03;c.lineCap='round';
  c.beginPath();c.arc(S*.5,S*.55,S*.1,0.2*Math.PI,0.8*Math.PI);c.stroke();
  F.tex.needsUpdate=true;F.mode='cartoon';
  showWarp(F,false);
}
function drawCamFace(F,video,box){
  const vw=video.videoWidth,vh=video.videoHeight,c=F.ctx,S=F.canvas.width;
  let cx,cy,s;
  if(box){cx=(box[0]+box[2]/2)*vw;cy=(box[1]+box[3]*0.44)*vh;s=Math.max(box[2]*vw,box[3]*vh)*1.6}
  else{s=Math.min(vw,vh)*0.7;cx=vw/2;cy=vh*0.45}
  const want=[cx,cy,s];
  F.crop=F.crop?F.crop.map((v,i)=>lerp(v,want[i],0.35)):want;
  [cx,cy,s]=F.crop;
  s=Math.min(s,vw,vh);
  const sx=clamp(cx-s/2,0,vw-s),sy=clamp(cy-s/2,0,vh-s);
  c.clearRect(0,0,S,S);
  c.save();c.beginPath();c.arc(S/2,S/2,S*.5,0,7);c.clip();
  try{c.drawImage(video,sx,sy,s,s,0,0,S,S)}catch(e){}
  c.restore();
  // Kenarları yumuşat ki başın derisine karışsın
  const g=c.createRadialGradient(S/2,S/2,S*.33,S/2,S/2,S*.5);g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(1,'rgba(0,0,0,0)');
  c.globalCompositeOperation='destination-in';c.fillStyle=g;c.fillRect(0,0,S,S);c.globalCompositeOperation='source-over';
  F.tex.needsUpdate=true;F.mode='cam';
  showWarp(F,false);
}
function camStreamOf(pid){
  if(pid===A.me)return A.cam.on?A.cam.stream:null;
  const R=A.R;if(!R)return null;
  const info=R.peers.filter(x=>x.pid===pid&&x.cam).pop();
  return info?A.cam.peer(info.cid):null;
}
function syncFaceSource(av){
  const st=camStreamOf(av.pid),F=av.face;
  if(st===F.stream)return;
  F.stream=st;F.crop=null;
  if(!st){if(F.video)F.video.srcObject=null;drawCartoon(F);return}
  if(!F.video){
    const v=document.createElement('video');v.muted=true;v.autoplay=true;v.playsInline=true;v.setAttribute('playsinline','');E.media.appendChild(v);F.video=v;
    F.vtex=new W.T.VideoTexture(v);F.vtex.encoding=W.T.sRGBEncoding;F.warpMat.map=F.vtex;F.warpMat.needsUpdate=true;
  }
  F.video.srcObject=st;F.video.play().catch(()=>{});
}
function showWarp(F,on){
  F.warp.visible=on;F.cap.visible=!on;
  if(!on&&F.uv){F.uv=null;F.pos=null;F.skin.color.copy(F.skin0)}
}
function faceLm(pid){
  if(pid===A.me)return FD.lm;
  const f=G&&G.face&&G.face[pid];
  return f&&f.lm?f.lm.map(v=>v/1000):null;
}
/* Kameradaki yüz noktalarını karakterin başına bük.
   uv: noktaların kamera görüntüsündeki yeri (dokudan nereyi alacağız).
   pos: aynı noktaların baştaki yeri. Gözler hizalanıp ölçeklenir (baş eğilse de
   yüz düz durur), şablonla biraz karıştırılır, sonra oval başın yüzeyine sarılır. */
function drawWarpFace(F,video,lm,now){
  const vw=video.videoWidth,vh=video.videoHeight;
  const px=i=>lm[i*2]*vw,py=i=>lm[i*2+1]*vh;
  const rx=(px(LM_EYES.r[0])+px(LM_EYES.r[1]))/2,ry=(py(LM_EYES.r[0])+py(LM_EYES.r[1]))/2;
  const lx=(px(LM_EYES.l[0])+px(LM_EYES.l[1]))/2,ly=(py(LM_EYES.l[0])+py(LM_EYES.l[1]))/2;
  const cx=(rx+lx)/2,cy=(ry+ly)/2,dx=lx-rx,dy=ly-ry,dist=Math.hypot(dx,dy);
  if(dist<4){showWarp(F,false);return false}
  const co=dx/dist,si=dy/dist;
  const uvT=new Float32Array(NV*2),dT=new Float32Array(NV*2);
  for(let i=0;i<NL;i++){
    const x=px(i)-cx,y=py(i)-cy;
    const ax=(x*co+y*si)/dist,ay=(-x*si+y*co)/dist;
    dT[i*2]=lerp(TEMPLATE[i][0],ax,0.72);dT[i*2+1]=lerp(TEMPLATE[i][1],ay,0.72);
    uvT[i*2]=lm[i*2];uvT[i*2+1]=1-lm[i*2+1];
  }
  // Dış halka: başta yüz çevresinin biraz dışına uzanır ve saydamlaşır (kenar yumuşar).
  // Doku ise yüzün içinden alınır; böylece kenarda arka plan ya da saç görünmez.
  let ux=0,uy=0,dxm=0,dym=0;
  for(let k=0;k<NO;k++){ux+=uvT[k*2];uy+=uvT[k*2+1];dxm+=dT[k*2];dym+=dT[k*2+1]}
  ux/=NO;uy/=NO;dxm/=NO;dym/=NO;
  for(let k=0;k<NO;k++){
    const o=(NL+k)*2,ox=uvT[k*2]-ux,oy=uvT[k*2+1]-uy;
    uvT[k*2]=ux+ox*0.95;uvT[k*2+1]=uy+oy*0.95;       // çene/şakak çizgisinde arka planı alma
    uvT[o]=ux+ox*0.86;uvT[o+1]=uy+oy*0.86;
    dT[o]=dxm+(dT[k*2]-dxm)*RING;dT[o+1]=dym+(dT[k*2+1]-dym)*RING;
  }
  if(!F.uv){F.uv=uvT;F.pos=dT}
  else for(let i=0;i<NV*2;i++){F.uv[i]=lerp(F.uv[i],uvT[i],0.6);F.pos[i]=lerp(F.pos[i],dT[i],0.6)}
  const g=F.warp.geometry,P=g.attributes.position.array,U=g.attributes.uv.array;
  for(let i=0;i<NV;i++){
    const X=F.pos[i*2]*FACE_S,Y=FACE_EYE_Y-F.pos[i*2+1]*FACE_S;
    const q=1-(X/HEAD_R.x)**2-(Y/HEAD_R.y)**2;
    P[i*3]=X;P[i*3+1]=Y;P[i*3+2]=HEAD_R.z*Math.sqrt(Math.max(q,0.003))+0.005;
    U[i*2]=F.uv[i*2];U[i*2+1]=F.uv[i*2+1];
  }
  g.attributes.position.needsUpdate=true;g.attributes.uv.needsUpdate=true;
  showWarp(F,true);F.mode='warp';
  // Başın derisini kişinin ten rengine boya ki yüzün kenarı belli olmasın
  if(now-F.skinAt>700){
    F.skinAt=now;
    try{
      const c=W.sctx;let r=0,gg=0,b=0;
      LM_SKIN.forEach(i=>{c.drawImage(video,px(i)-5,py(i)-5,10,10,0,0,1,1);const d=c.getImageData(0,0,1,1).data;r+=d[0];gg+=d[1];b+=d[2]});
      F.skin.color.setRGB(r/3/255*0.95,gg/3/255*0.95,b/3/255*0.95).convertSRGBToLinear();
    }catch(e){}
  }
  return true;
}
function updateFaces(){
  const now=performance.now();
  for(const pid in W.av){
    const av=W.av[pid],F=av.face,v=F.video;
    if(F.stream&&v&&v.readyState>=2&&v.videoWidth){
      const lm=faceLm(pid);
      if(lm&&lm.length===NL*2&&drawWarpFace(F,v,lm,now))continue;
      const f=pid===A.me?null:G&&G.face&&G.face[pid];
      const box=pid===A.me?FD.box:(f&&f.b)||null;
      drawCamFace(F,v,box);
    }else if(F.mode!=='cartoon')drawCartoon(F);
  }
}

function syncWorld(){
  if(!W||!A.R||!G)return;
  const online=A.R.players.filter(p=>p.online);
  const ids=new Set(online.map(p=>p.id));
  for(const pid in W.av)if(!ids.has(pid))removeAvatar(pid);
  online.forEach((p,idx)=>{
    let av=W.av[p.id];
    if(!av){
      av=W.av[p.id]=makeAvatar(p.id);
      if(p.id===A.me){av.cur={x:W.me.x,z:W.me.z,y:W.me.y,r:W.me.r}}
      else{const q=G.pos&&G.pos[p.id];const x=q?q.x:spawnX(p.id),z=q?q.z:5.4;av.cur={x,z,y:floorY(z),r:q?q.r:Math.PI};av.tgt=q?{...q}:null}
    }
    if(av.name!==p.name||av.color!==p.color){av.name=p.name;av.color=p.color;paintLabel(av.tag,p.id,A.audio.speaking.has(p.id))}
    if(p.id!==A.me&&G.pos&&G.pos[p.id]&&!av.tgt)av.tgt={...G.pos[p.id]};
    av.seated=seatOfPid(p.id);
    syncFaceSource(av);
  });
  // Kendi koltuğum
  const mine=seatOfPid(A.me);
  const justLeft=mine===W.me.leftSeat&&Date.now()-W.me.leftAt<1500; // kalktıktan hemen sonra gelen eski durum geri oturtmasın
  if(mine>=0&&mine!==W.me.seat&&!justLeft){sitAt(mine)}
  else if(mine<0&&W.me.seat>=0){standUp(false)}
  if(W.me.pending>=0&&mine===W.me.pending)W.me.pending=-1;
  if(A.cam.on)FD.start();else FD.stop();
  renderButtons();
}

/* ---------- Oturma ---------- */
function sitAt(i){
  const p=seatPos(i);
  W.me.seat=i;W.me.pending=-1;W.me.x=p.x;W.me.z=p.z;W.me.r=Math.PI;
  W.view.yaw=Math.atan2(p.x,p.z-SCREEN.z)*0.9; // perdenin ortasına dön
  W.view.pitch=Math.atan2(SCREEN.cy-(p.y+1.42),p.z-SCREEN.z)*0.8;
  renderButtons();
}
function standUp(send){
  if(W.me.seat<0)return;
  const p=seatPos(W.me.seat);
  W.me.leftSeat=W.me.seat;W.me.leftAt=Date.now();
  W.me.seat=-1;W.me.x=p.x;W.me.z=p.z+0.65;W.me.y=floorY(W.me.z);
  W.view.pitch=-0.18;
  if(send)A.send({t:'stand'});
  sendPos(true);renderButtons();
}
function requestSeat(i){
  if(i<0||takenSeats().has(i)){A.toast('Bu koltuk dolu');return}
  W.me.pending=i;A.send({t:'sit',seat:i});A.vib(10);renderHint();
  setTimeout(()=>{if(W&&W.me.pending===i){W.me.pending=-1;renderHint()}},2500);
}
function nearestFreeSeat(maxD){
  const taken=takenSeats();let best=-1,bd=maxD||1e9;
  for(let i=0;i<SEATS;i++){if(taken.has(i))continue;const p=seatPos(i);const d=Math.hypot(p.x-W.me.x,p.z-W.me.z);if(d<bd){bd=d;best=i}}
  return best;
}
function toggleSeat(){
  if(!W)return;
  if(W.me.seat>=0){standUp(true);return}
  const s=nearestFreeSeat(); // en yakın boş koltuk
  if(s<0){A.toast('Boş koltuk kalmadı');return}
  requestSeat(s);
}

/* ---------- Girdi ---------- */
const H={};
function typing(e){const t=e.target;return t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable)}
function bindInput(){
  const cv=E.canvas;
  H.kd=e=>{
    if(!W||typing(e)||e.ctrlKey||e.metaKey||e.altKey)return;
    const k=e.key.toLowerCase();
    if(k==='e'){toggleSeat();e.preventDefault();return}
    if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','shift'].includes(k)){
      W.keys.add(k);
      if(k.startsWith('arrow')&&document.activeElement===cv)e.preventDefault();
    }
  };
  H.ku=e=>{if(W)W.keys.delete(e.key.toLowerCase())};
  H.blur=()=>{if(W)W.keys.clear()};
  window.addEventListener('keydown',H.kd);window.addEventListener('keyup',H.ku);window.addEventListener('blur',H.blur);

  H.pd=e=>{
    if(!W)return;
    cv.focus({preventScroll:true});
    W.drag={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false,touch:e.pointerType!=='mouse'};
    try{cv.setPointerCapture(e.pointerId)}catch(_){}
  };
  H.pm=e=>{
    if(!W)return;
    const d=W.drag;
    if(d&&d.id===e.pointerId){
      const dx=e.clientX-d.x,dy=e.clientY-d.y;
      if(!d.moved&&Math.hypot(dx,dy)>6){d.moved=true;E.stage.classList.add('dragging')}
      if(d.moved){
        const k=d.touch?0.0065:0.0045;
        W.view.yaw-=dx*k;W.view.pitch=clamp(W.view.pitch-dy*k,-0.7,0.55);
        d.x=e.clientX;d.y=e.clientY;
      }
    }else if(e.pointerType==='mouse'){hover(e)}
  };
  H.pu=e=>{
    if(!W)return;
    const d=W.drag;
    if(d&&d.id===e.pointerId){if(!d.moved)clickAt(e);W.drag=null;E.stage.classList.remove('dragging')}
  };
  H.wh=e=>{if(!W||W.me.seat>=0)return;e.preventDefault();W.view.dist=clamp(W.view.dist+e.deltaY*0.004,2,7.5)};
  cv.addEventListener('pointerdown',H.pd);cv.addEventListener('pointermove',H.pm);
  cv.addEventListener('pointerup',H.pu);cv.addEventListener('pointercancel',H.pu);
  cv.addEventListener('wheel',H.wh,{passive:false});

  // Dokunmatik çubuk
  const J=E.joy;
  const jmove=e=>{
    const r=J.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,max=r.width/2-14;
    let x=e.clientX-cx,y=e.clientY-cy;const l=Math.hypot(x,y);if(l>max){x*=max/l;y*=max/l}
    W.joy.x=x/max;W.joy.y=y/max;E.knob.style.transform='translate('+x+'px,'+y+'px)';
  };
  H.jd=e=>{if(!W)return;W.joy.id=e.pointerId;try{J.setPointerCapture(e.pointerId)}catch(_){}jmove(e);e.preventDefault()};
  H.jm=e=>{if(W&&W.joy.id===e.pointerId)jmove(e)};
  H.ju=e=>{if(W&&W.joy.id===e.pointerId){W.joy={x:0,y:0,id:null};E.knob.style.transform=''}};
  J.addEventListener('pointerdown',H.jd);J.addEventListener('pointermove',H.jm);
  J.addEventListener('pointerup',H.ju);J.addEventListener('pointercancel',H.ju);
}
function unbindInput(){
  window.removeEventListener('keydown',H.kd);window.removeEventListener('keyup',H.ku);window.removeEventListener('blur',H.blur);
}
function pickSeat(e){
  const r=E.canvas.getBoundingClientRect();
  W.ray.setFromCamera({x:((e.clientX-r.left)/r.width)*2-1,y:-((e.clientY-r.top)/r.height)*2+1},W.cam);
  const hit=W.ray.intersectObjects(W.seatMeshes,false)[0];
  return hit&&hit.distance<14?hit.object.userData.seat:-1;
}
function hover(e){
  const s=pickSeat(e);
  if(s===W.hoverSeat)return;
  if(W.hoverSeat>=0)W.seatGroups[W.hoverSeat].userData.mat.emissive.setHex(0);
  W.hoverSeat=s;
  const free=s>=0&&!takenSeats().has(s)&&s!==W.me.seat;
  if(s>=0&&free)W.seatGroups[s].userData.mat.emissive.setHex(0x3a2a08);
  E.stage.classList.toggle('pick',free);
}
function clickAt(e){
  const s=pickSeat(e);
  if(s<0||s===W.me.seat)return;
  if(takenSeats().has(s)){A.toast('Bu koltuk dolu');return}
  requestSeat(s);
}

/* ---------- Her kare ---------- */
function frame(t){
  if(!W)return;
  W.raf=requestAnimationFrame(frame);
  const dt=Math.min(0.05,(t-W.last)/1000);W.last=t;
  updateMe(dt);
  for(const pid in W.av)updateAvatar(W.av[pid],dt,pid===A.me);
  updateCamera(dt);
  if(t-W.faceAt>66){W.faceAt=t;updateFaces()}
  updateLights(dt,t);
  updateFx(dt);
  W.renderer.render(W.scene,W.cam);
}
function inputVec(){
  const k=W.keys;let x=0,z=0;
  if(k.has('w')||k.has('arrowup'))z+=1;
  if(k.has('s')||k.has('arrowdown'))z-=1;
  if(k.has('a')||k.has('arrowleft'))x-=1;
  if(k.has('d')||k.has('arrowright'))x+=1;
  x+=W.joy.x;z-=W.joy.y;
  const l=Math.hypot(x,z);if(l>1){x/=l;z/=l}
  return{x,z,l:Math.min(1,l),run:k.has('shift')};
}
function updateMe(dt){
  const M=W.me,inp=inputVec();
  if(M.seat>=0){
    if(inp.l>0.3){standUp(true)}else{M.moving=false;return}
  }
  if(inp.l>0.05){
    const yaw=W.view.yaw,fw={x:-Math.sin(yaw),z:-Math.cos(yaw)},rt={x:Math.cos(yaw),z:-Math.sin(yaw)};
    const dx=fw.x*inp.z+rt.x*inp.x,dz=fw.z*inp.z+rt.z*inp.x,l=Math.hypot(dx,dz)||1;
    const sp=(inp.run?4.4:2.6)*inp.l;
    let nx=M.x+dx/l*sp*dt,nz=M.z+dz/l*sp*dt;
    if(blocked(nx,M.z))nx=M.x;
    if(blocked(nx,nz))nz=M.z;
    M.x=nx;M.z=nz;
    M.r+=angDiff(M.r,Math.atan2(dx,dz))*Math.min(1,dt*12);
    M.moving=true;
  }else M.moving=false;
  M.y=lerp(M.y,floorY(M.z),Math.min(1,dt*14));
  sendPos(false);
}
function sendPos(force){
  if(!W||W.me.seat>=0)return;
  const M=W.me,now=Date.now(),s=M.sent;
  const changed=!s||Math.abs(s.x-M.x)>0.01||Math.abs(s.z-M.z)>0.01||Math.abs(angDiff(s.r,M.r))>0.03||s.w!==(M.moving?1:0);
  if(!force&&(!changed||now-M.sentAt<80))return;
  M.sentAt=now;
  const r=Math.atan2(Math.sin(M.r),Math.cos(M.r));
  M.sent={x:M.x,z:M.z,r,w:M.moving?1:0};
  A.send({t:'pos',x:Math.round(M.x*100)/100,z:Math.round(M.z*100)/100,r:Math.round(r*100)/100,w:M.moving?1:0});
}
function updateAvatar(av,dt,me){
  let x,z,y,r,walking=false,seat=me?W.me.seat:av.seated;
  if(seat>=0){
    const p=seatPos(seat);x=p.x;z=p.z+0.02;y=p.y;r=Math.PI;
    av.cur.x=x;av.cur.z=z;av.cur.y=y;av.cur.r=r;
  }else if(me){
    x=av.cur.x=W.me.x;z=av.cur.z=W.me.z;y=av.cur.y=W.me.y;r=av.cur.r=W.me.r;walking=W.me.moving;
  }else{
    const t=av.tgt;
    if(t){
      const k=Math.min(1,dt*10);
      const px=av.cur.x,pz=av.cur.z;
      av.cur.x=lerp(av.cur.x,t.x,k);av.cur.z=lerp(av.cur.z,t.z,k);
      av.cur.r+=angDiff(av.cur.r,t.r)*k;
      av.speed=Math.hypot(av.cur.x-px,av.cur.z-pz)/Math.max(dt,1e-3);
      walking=!!t.w||av.speed>0.4;
    }
    av.cur.y=lerp(av.cur.y,floorY(av.cur.z),Math.min(1,dt*14));
    x=av.cur.x;z=av.cur.z;y=av.cur.y;r=av.cur.r;
  }
  const sit=seat>=0;
  av.g.position.set(x,y+(sit?-0.36:0),z);
  av.g.rotation.y=r;
  av.g.visible=!(me&&sit); // otururken birinci şahıs bakış: kendi kafam görüşü kapatmasın
  if(sit){
    av.legs.forEach(l=>{l.rotation.x=-Math.PI/2});
    av.shins.forEach(s=>{s.rotation.x=Math.PI/2});
    av.arms.forEach(a=>{a.rotation.x=-0.55});
  }else{
    if(walking)av.walkT+=dt*9;
    const amp=walking?0.55:0,s=Math.sin(av.walkT);
    av.legs[0].rotation.x=lerp(av.legs[0].rotation.x,s*amp,0.3);
    av.legs[1].rotation.x=lerp(av.legs[1].rotation.x,-s*amp,0.3);
    av.shins[0].rotation.x=lerp(av.shins[0].rotation.x,walking?Math.max(0,-s)*0.7:0,0.3);
    av.shins[1].rotation.x=lerp(av.shins[1].rotation.x,walking?Math.max(0,s)*0.7:0,0.3);
    av.arms[0].rotation.x=lerp(av.arms[0].rotation.x,-s*amp*0.8,0.3);
    av.arms[1].rotation.x=lerp(av.arms[1].rotation.x,s*amp*0.8,0.3);
  }
  const sp=A.audio.speaking.has(av.pid);
  av.ring.visible=sp&&!sit;
  if(sp)av.ring.material.opacity=0.55+0.35*Math.sin(performance.now()/120);
  av.head.position.y=1.74+(sp?Math.sin(performance.now()/90)*0.008:0);
}
function updateCamera(dt){
  const C=W.cam,V=W.view,M=W.me;
  const cp=Math.cos(V.pitch),f={x:-Math.sin(V.yaw)*cp,y:Math.sin(V.pitch),z:-Math.cos(V.yaw)*cp};
  if(M.seat>=0){
    const p=seatPos(M.seat),ex=p.x,ey=p.y+1.38,ez=p.z-0.08;
    C.position.set(ex,ey,ez);
    C.lookAt(ex+f.x,ey+f.y,ez+f.z);
    return;
  }
  const tx=M.x,ty=M.y+1.55,tz=M.z;
  let cx=tx-f.x*V.dist,cy=ty-f.y*V.dist+0.25,cz=tz-f.z*V.dist;
  cx=clamp(cx,-ROOM.x+0.3,ROOM.x-0.3);cz=clamp(cz,ROOM.front+3,ROOM.back-0.3);
  cy=clamp(cy,floorY(cz)+0.4,ROOM.h-0.3);
  const k=Math.min(1,dt*10);
  C.position.set(lerp(C.position.x,cx,k),lerp(C.position.y,cy,k),lerp(C.position.z,cz,k));
  if(C.position.lengthSq()===0||!W.camInit){C.position.set(cx,cy,cz);W.camInit=true}
  C.lookAt(tx+f.x*2,ty+f.y*2,tz+f.z*2);
}
function updateLights(dt,t){
  const target=W.screenLive?0.25:1;
  W.house=lerp(W.house,target,Math.min(1,dt*1.5));
  W.amb.intensity=0.12+0.25*W.house;W.hemi.intensity=0.1+0.28*W.house;
  W.sconces.forEach(l=>{l.intensity=0.25+0.7*W.house});
  if(W.screenLive&&t-W.sampleAt>200){
    W.sampleAt=t;
    try{
      W.sctx.drawImage(E.sv,0,0,6,6);const d=W.sctx.getImageData(0,0,6,6).data;let r=0,g=0,b=0;
      for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2]}
      const n=d.length/4;W.glow.setRGB(r/n/255,g/n/255,b/n/255);
    }catch(e){}
  }else if(!W.screenLive)W.glow.setHex(0x3b4a8a);
  W.spot.color.lerp(W.glow,Math.min(1,dt*6));
  W.spot.intensity=W.screenLive?2.4:1.2;
  W.booth.material.color.setScalar(W.screenLive?0.85+0.15*Math.sin(t/37)*Math.sin(t/91):0.5);
}

/* ---------- Tepkiler: karakterin başının üstünde ---------- */
function onReact(make,pid,e){
  if(!W||!e||!W.av[pid])return;
  const T=W.T,c=document.createElement('canvas');c.width=c.height=96;
  const x=c.getContext('2d');x.font='72px system-ui,"Apple Color Emoji","Segoe UI Emoji",sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(e,48,54);
  const tex=new T.CanvasTexture(c);tex.encoding=T.sRGBEncoding;
  const s=new T.Sprite(new T.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
  const g=W.av[pid].g;s.position.set(g.position.x+(Math.random()-.5)*0.3,g.position.y+2.5,g.position.z);s.scale.set(0.5,0.5,1);
  W.scene.add(s);W.fx.push({s,life:2.2,max:2.2});
}
function updateFx(dt){
  for(let i=W.fx.length-1;i>=0;i--){
    const f=W.fx[i];f.life-=dt;f.s.position.y+=dt*0.6;f.s.material.opacity=Math.min(1,f.life/0.6);
    if(f.life<=0){W.scene.remove(f.s);f.s.material.map.dispose();f.s.material.dispose();W.fx.splice(i,1)}
  }
}

/* ---------- Kayıt ---------- */
if(window.__salon)window.__salon.sinema=()=>({W,G,FD,TEMPLATE}); // hata ayıklama için
A.register({
  id:'sinema',title:'Sinema',icon:'🎬',color:'#e0a100',css:'cn',maxPlayers:8,
  blurb:'3B bir sinema salonu. Karakterinle dolaş, koltuğuna otur, biri sekmesini perdeye yansıtsın.',
  mount,unmount,state,tileClick,tileClickable,
  badge(pid){return G&&pid===G.presenter?'📺 ':''},
  line(){if(!G)return'';return A.nameOf(G.presenter)+(G.share?' perdede':' perdeyi yönetiyor')},
  msg(m){
    switch(m.t){
      case 'pos':{
        if(!G||m.pid===A.me)break;
        G.pos=G.pos||{};G.pos[m.pid]={x:m.x,z:m.z,r:m.r,w:m.w};
        if(W&&W.av[m.pid])W.av[m.pid].tgt={x:m.x,z:m.z,r:m.r,w:m.w};
        break;
      }
      case 'face':{
        if(!G)break;G.face=G.face||{};
        if(m.lm)G.face[m.pid]={lm:m.lm};else if(m.b)G.face[m.pid]={b:m.b};else delete G.face[m.pid];
        break;
      }
      case 'ask':onAsk(m.pid);break;
    }
  },
  menu(){
    if(amPresenter()&&!A.amHost()&&A.R)return[{label:'📺 Perdeyi kurucuya ver',onClick:()=>A.send({t:'present',pid:A.R.host})}];
    return[];
  },
  reconnect(){
    if(A.screen.stream)A.send({t:'share',on:true});
    FD.sent=undefined;
    if(W){W.me.sent=null;if(W.me.seat>=0)A.send({t:'sit',seat:W.me.seat});else sendPos(true)}
  },
  media(){syncWorld();renderScreen()},
  speaking(sp){if(!W)return;for(const pid in W.av)paintLabel(W.av[pid].tag,pid,sp.has(pid))},
  tap(){if(E&&E.sv.srcObject)E.sv.play().catch(()=>{})},
});
})();
