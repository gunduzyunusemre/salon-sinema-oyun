/*
 * 🧩 Yapboz Düellosu — herkes aynı tahtada, aynı anda. Parçayı ilk doğru yere
 * koyan puanı alır. Sunucu hakemdir.
 */
(function(){
'use strict';
const A=window.App;
const esc=A.esc;
const COLORS=['#ff4d6d','#5b4dff','#19b394','#ff8a3d','#2fa4ff','#c04bd6'];
const M=0.26;
const TAB=[[0.40,0,0.42,0.04,0.39,0.09],[0.34,0.17,0.40,0.24,0.50,0.24],[0.60,0.24,0.66,0.17,0.61,0.09],[0.58,0.04,0.60,0,0.64,0]];
const fmt=t=>{t=Math.max(0,Math.floor(t));return Math.floor(t/60)+':'+String(t%60).padStart(2,'0')};
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const clampN=(v,d,lo=2,hi=20)=>{v=parseInt(v,10);return isNaN(v)?d:Math.min(hi,Math.max(lo,v))};

let SG=null;     // sunucudan gelen durum
let G=null;      // yerel tahta
let E=null;      // ekrandaki öğeler
let D=null,sel=null,tick=null,guideOn=true,building=null;
let HOLDS={};
const ghosts={};

/* ================= Örnek resim ================= */
function makeSample(){
  const W=1200,H=900,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');
  const R=rng((Math.random()*1e9)|0);
  const pals=[['#1d2b64','#f8a5c2','#fbd786'],['#0f2027','#ff7e5f','#feb47b'],['#355c7d','#c06c84','#f8b195'],['#134e5e','#71b280','#f9d976'],['#2b1055','#d53369','#daae51']];
  const p=pals[Math.floor(R()*pals.length)];
  let g=x.createLinearGradient(0,0,0,H*.66);g.addColorStop(0,p[0]);g.addColorStop(.6,p[1]);g.addColorStop(1,p[2]);x.fillStyle=g;x.fillRect(0,0,W,H);
  for(let i=0;i<90;i++){x.fillStyle='rgba(255,255,255,'+(R()*.8)+')';const s=1+R()*2;x.fillRect(R()*W,R()*H*.3,s,s)}
  const sx=W*(.25+R()*.5),sy=H*(.34+R()*.1),sr=60+R()*40;
  g=x.createRadialGradient(sx,sy,sr*.3,sx,sy,sr*3.2);g.addColorStop(0,'rgba(255,240,200,.85)');g.addColorStop(1,'rgba(255,240,200,0)');x.fillStyle=g;x.fillRect(0,0,W,H);
  x.fillStyle='#fff3c4';x.beginPath();x.arc(sx,sy,sr,0,7);x.fill();
  for(let i=0;i<6;i++){const cx=R()*W,cy=H*(.08+R()*.25),k=40+R()*50;x.fillStyle='rgba(255,255,255,'+(.35+R()*.3)+')';for(let j=0;j<5;j++){x.beginPath();x.ellipse(cx+(j-2)*k*.6,cy+(R()-.5)*k*.3,k*(.6+R()*.4),k*(.35+R()*.2),0,0,7);x.fill()}}
  [[H*.52,'#6c4f8f',170],[H*.59,'#3f5f8a',120],[H*.67,'#1f3b4d',80]].forEach(([b,col,amp])=>{x.fillStyle=col;x.beginPath();x.moveTo(0,H);for(let px=0;px<=W+50;px+=50){x.lineTo(px,b-R()*amp)}x.lineTo(W,H);x.closePath();x.fill()});
  g=x.createLinearGradient(0,H*.67,0,H);g.addColorStop(0,p[2]);g.addColorStop(.45,p[1]);g.addColorStop(1,p[0]);x.fillStyle=g;x.fillRect(0,H*.67,W,H*.33);
  for(let i=0;i<20;i++){const y=H*.69+i*13,w=(sr*2.2)*(1-i/24)*(.6+R()*.6);x.fillStyle='rgba(255,243,196,'+(.55-i*.02)+')';x.fillRect(sx-w/2+(R()-.5)*20,y,w,4)}
  x.fillStyle='#10261b';x.beginPath();x.moveTo(0,H);x.lineTo(0,H*.8);x.quadraticCurveTo(W*.18,H*.84,W*.32,H);x.closePath();x.fill();
  x.beginPath();x.moveTo(W,H);x.lineTo(W,H*.86);x.quadraticCurveTo(W*.85,H*.9,W*.75,H);x.closePath();x.fill();
  for(let i=0;i<7;i++){const tx=R()*W*.24,th=80+R()*120,tb=H*.83+tx*.25;x.beginPath();x.moveTo(tx-th*.22,tb);x.lineTo(tx,tb-th);x.lineTo(tx+th*.22,tb);x.fill()}
  const bc=[['#ff4d6d','#ffd23f'],['#5b4dff','#ffffff'],['#19b394','#ff8a3d'],['#2fa4ff','#ffbf1f']];
  for(let i=0;i<3;i++){const bx=W*(.12+i*.32+R()*.12),by=H*(.15+R()*.25),r=34+R()*30,[c1,c2]=bc[Math.floor(R()*bc.length)];
    x.save();x.beginPath();x.ellipse(bx,by,r,r*1.15,0,0,7);x.clip();for(let k=-5;k<5;k++){x.fillStyle=(k&1)?c1:c2;x.fillRect(bx+k*r/4,by-r*1.3,r/4,r*2.6)}
    g=x.createRadialGradient(bx-r*.4,by-r*.5,r*.1,bx,by,r*1.3);g.addColorStop(0,'rgba(255,255,255,.35)');g.addColorStop(1,'rgba(0,0,0,.25)');x.fillStyle=g;x.fillRect(bx-r*1.2,by-r*1.3,r*2.4,r*2.6);x.restore();
    x.strokeStyle='rgba(40,25,10,.6)';x.lineWidth=2;x.beginPath();x.moveTo(bx-r*.55,by+r*.95);x.lineTo(bx-r*.2,by+r*1.55);x.moveTo(bx+r*.55,by+r*.95);x.lineTo(bx+r*.2,by+r*1.55);x.stroke();
    x.fillStyle='#7a4a2a';x.fillRect(bx-r*.22,by+r*1.55,r*.44,r*.32)}
  x.strokeStyle='rgba(20,15,30,.7)';x.lineWidth=3;x.lineCap='round';
  for(let i=0;i<8;i++){const bx=W*(.4+R()*.5),by=H*(.1+R()*.3),s=8+R()*10;x.beginPath();x.moveTo(bx-s,by-s*.4);x.quadraticCurveTo(bx-s*.4,by-s*.6,bx,by);x.quadraticCurveTo(bx+s*.4,by-s*.6,bx+s,by-s*.4);x.stroke()}
  return c;
}
function toCanvas(img,max){const k=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*k));c.height=Math.max(1,Math.round(img.naturalHeight*k));c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c}
function loadImg(url){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url})}

/* ================= Kurucu ayarları ================= */
const DIFFS=[{v:12,h:'Kolay<small>~12</small>'},{v:24,h:'Orta<small>~24</small>'},{v:48,h:'Zor<small>~48</small>'},{v:96,h:'Uzman<small>~96</small>'},{v:'custom',h:'Özel<small>satır×sütun</small>'}];
function gridFor(n,a){let best=null;for(let c=2;c<=24;c++)for(let r=2;r<=24;r++){const s=Math.abs(Math.log(c*r/n))*2+Math.abs(Math.log((c/r)/a));if(!best||s<best.s)best={c,r,s}}return{cols:best.c,rows:best.r}}
function makeRoomImage(src,cols,rows){
  const asp=cols/rows;let sw=src.width,sh=src.height;if(sw/sh>asp)sw=sh*asp;else sh=sw/asp;
  let max=1400,q=.85,url='';
  for(let i=0;i<10;i++){
    const k=Math.min(1,max/Math.max(sw,sh));const c=document.createElement('canvas');c.width=Math.round(sw*k);c.height=Math.round(sh*k);
    c.getContext('2d').drawImage(src,(src.width-sw)/2,(src.height-sh)/2,sw,sh,0,0,c.width,c.height);
    url=c.toDataURL('image/jpeg',q);if(url.length<1200000)return url;
    if(q>.65)q-=.1;else max*=.8;
  }
  return null;
}
function setup(body){
  const S=Object.assign({diff:24,cols:6,rows:4},A.store.get('yapboz',{}));
  let src=null;
  body.innerHTML='<div class="sub">Resim</div><div class="imgpick"><div class="thumb"><img alt="Seçilen resim"></div><div class="imgbtns">'
    +'<label class="btn sun" tabindex="0">📷 Resim seç<input type="file" accept="image/*" hidden></label>'
    +'<button class="btn soft" type="button" data-a="sample">🎲 Örnek resim</button></div></div>'
    +'<div class="sub">Zorluk</div><div class="seg"></div>'
    +'<div class="row hidden"><label>Sütun<input type="number" data-k="cols" min="2" max="20" inputmode="numeric"></label><label>Satır<input type="number" data-k="rows" min="2" max="20" inputmode="numeric"></label></div>'
    +'<p class="hint yp-info"></p>'
    +'<p class="hint">Sıra yok: herkes aynı anda oynar, parçayı ilk oturtan puanı alır. Yanlış yere bırakan 1,5 saniye bekler.</p>';
  const q=s=>body.querySelector(s);
  const grid=()=>S.diff==='custom'?{cols:clampN(S.cols,6),rows:clampN(S.rows,4)}:gridFor(S.diff,src?src.width/src.height:4/3);
  const info=()=>{const g=grid();q('.yp-info').textContent=g.cols+' sütun × '+g.rows+' satır, toplam '+(g.cols*g.rows)+' parça';q('.row').classList.toggle('hidden',S.diff!=='custom')};
  const setSrc=c=>{src=c;q('.thumb img').src=c.toDataURL('image/jpeg',.8);info()};
  const save=()=>A.store.set('yapboz',{diff:S.diff,cols:S.cols,rows:S.rows});
  const seg=()=>{const el=q('.seg');el.textContent='';DIFFS.forEach(o=>{const b=document.createElement('button');b.type='button';b.innerHTML=o.h;if(S.diff===o.v)b.classList.add('on');b.onclick=()=>{S.diff=o.v;save();seg();info()};el.appendChild(b)})};
  q('input[type=file]').addEventListener('change',e=>{
    const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;
    const fr=new FileReader();
    fr.onload=()=>loadImg(fr.result).then(img=>setSrc(toCanvas(img,1600))).catch(()=>A.toast('Bu dosya açılamadı. JPG veya PNG bir resim dene.'));
    fr.onerror=()=>A.toast('Dosya okunamadı.');fr.readAsDataURL(f);
  });
  q('label.btn').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();q('input[type=file]').click()}});
  q('[data-a=sample]').addEventListener('click',()=>setSrc(makeSample()));
  ['cols','rows'].forEach(k=>{const i=q('[data-k='+k+']');i.value=S[k];i.addEventListener('input',()=>{S[k]=clampN(i.value,k==='cols'?6:4);save();info()})});
  seg();setSrc(makeSample());
  return()=>{
    if(!src){A.toast('Önce bir resim seç');return null}
    const g=grid(),img=makeRoomImage(src,g.cols,g.rows);
    if(!img){A.toast('Resim çok büyük, başka bir resim dene');return null}
    return{cols:g.cols,rows:g.rows,img};
  };
}

/* ================= Ekran ================= */
function mount(root){
  root.innerHTML='<div class="yp-top"><div class="yp-scores"></div>'
    +'<button class="icon" type="button" data-a="peek" aria-label="Resmi göster">👁</button>'
    +'<button class="icon" type="button" data-a="guide" aria-label="Silik rehberi aç/kapat">▦</button></div>'
    +'<div class="gstatus"><span class="yp-left"></span><span class="yp-right"></span></div>'
    +'<div class="yp-boardwrap"><div class="yp-board"><div class="yp-guide"></div></div></div>'
    +'<div class="yp-tray"><div class="trayhint">Parçayı yukarı sürükle ya da dokunup tahtadaki yerine dokun</div><div class="yp-trayinner"></div></div>';
  const q=s=>root.querySelector(s);
  E={root,scores:q('.yp-scores'),left:q('.yp-left'),right:q('.yp-right'),wrap:q('.yp-boardwrap'),board:q('.yp-board'),guide:q('.yp-guide'),tray:q('.yp-trayinner'),guideBtn:q('[data-a=guide]')};
  E.drag=document.createElement('div');E.drag.className='yp-drag';document.body.appendChild(E.drag);
  E.peek=document.createElement('div');E.peek.className='overlay hidden yp-peek';E.peek.innerHTML='<img alt="Tam resim">';
  E.peek.addEventListener('click',()=>E.peek.classList.add('hidden'));document.body.appendChild(E.peek);
  E.win=document.createElement('div');E.win.className='overlay hidden';
  E.win.innerHTML='<canvas class="yp-confetti"></canvas><div class="modal"><h2></h2><div class="yp-winbody"></div><div class="mbtns">'
    +'<button class="btn sun" type="button" data-a="again">Rövanş (yeni karışık)</button>'
    +'<button class="btn soft" type="button" data-a="lounge">🛋️ Salona dön</button>'
    +'<button class="btn soft" type="button" data-a="close">Kapat</button></div>'
    +'<p class="hint">Kurucu rövanşı başlatınca yeni oyun herkeste otomatik açılır.</p></div>';
  E.win.querySelector('[data-a=again]').addEventListener('click',()=>A.send({t:'rematch'}));
  E.win.querySelector('[data-a=lounge]').addEventListener('click',()=>A.endActivity());
  E.win.querySelector('[data-a=close]').addEventListener('click',()=>E.win.classList.add('hidden'));
  document.body.appendChild(E.win);
  q('[data-a=peek]').addEventListener('click',()=>{if(G&&G.imgURL)E.peek.classList.remove('hidden')});
  E.guideBtn.addEventListener('click',()=>{guideOn=!guideOn;E.board.classList.toggle('noguide',!guideOn);E.guideBtn.classList.toggle('off',!guideOn)});
  E.board.addEventListener('click',onBoardClick);
  root.addEventListener('contextmenu',e=>e.preventDefault());
  if(window.ResizeObserver){E.ro=new ResizeObserver(()=>layout());E.ro.observe(E.wrap)}
  SG=null;G=null;HOLDS={};
}
function unmount(){
  clearInterval(tick);clearBoard();
  if(E){if(E.ro)E.ro.disconnect();E.drag.remove();E.peek.remove();E.win.remove()}
  E=null;G=null;SG=null;HOLDS={};building=null;
}

const players=()=>(A.R&&A.R.players)||[];
const onlineCount=()=>players().filter(p=>p.online).length;
const missOf=id=>(SG&&SG.stats&&SG.stats[id]&&SG.stats[id].miss)|0;

function state(g){
  SG=g;if(!E||!SG)return;
  if(G&&G.ver===SG.ver){
    G.mistakes=Math.max(G.mistakes,missOf(A.me));
    applyState();return;
  }
  startBoard();
}
async function startBoard(){
  const s=SG,key=A.code+':'+s.ver;
  if(building===key)return;building=key;
  try{
    const img=await loadImg('room/'+A.code+'/image?v='+s.ver);
    if(!E||!SG||SG.ver!==s.ver)return;
    const cols=clampN(SG.cols,4,2,24),rows=clampN(SG.rows,3,2,24);
    clearInterval(tick);clearBoard();E.win.classList.add('hidden');
    G={ver:SG.ver,src:toCanvas(img,1600),seed:SG.seed|0,cols,rows,total:cols*rows,players:[],startedAt:SG.startedAt,
      placed:0,moves:0,mistakes:missOf(A.me),elapsed:0,over:false,frozenUntil:0,ready:false};
    const g=G;requestAnimationFrame(()=>requestAnimationFrame(()=>{if(G===g)build()}));
  }catch(e){console.warn(e);A.toast('Yapboz resmi yüklenemedi')}
  finally{if(building===key)building=null}
}
function clearBoard(){
  document.querySelectorAll('.yp-board .piece,.yp-board .flash,.yp-board .ghost,.yp-drag .piece').forEach(e=>e.remove());
  for(const k in ghosts)delete ghosts[k];
  if(E)E.tray.textContent='';D=null;sel=null;
}

/* ================= Parça çizimi ================= */
function edge(ctx,x0,y0,x1,y1,sign){
  if(sign){const dx=x1-x0,dy=y1-y0,nx=dy,ny=-dx;const P=(t,h)=>[x0+dx*t+nx*h*sign,y0+dy*t+ny*h*sign];
    ctx.lineTo(...P(.36,0));TAB.forEach(t=>{const a=P(t[0],t[1]),b=P(t[2],t[3]),e=P(t[4],t[5]);ctx.bezierCurveTo(a[0],a[1],b[0],b[1],e[0],e[1])})}
  ctx.lineTo(x1,y1);
}
function piecePath(ctx,r,c,s,m){
  ctx.beginPath();ctx.moveTo(m,m);
  edge(ctx,m,m,m+s,m,r===0?0:-G.H[r-1][c]);
  edge(ctx,m+s,m,m+s,m+s,c===G.cols-1?0:G.V[r][c]);
  edge(ctx,m+s,m+s,m,m+s,r===G.rows-1?0:G.H[r][c]);
  edge(ctx,m,m+s,m,m,c===0?0:-G.V[r][c-1]);
  ctx.closePath();
}
function drawPiece(ctx,r,c,s,m,img){
  const w=Math.max(1.2,s*.035);
  ctx.save();piecePath(ctx,r,c,s,m);ctx.clip();ctx.drawImage(img,m-c*s,m-r*s);
  ctx.save();ctx.translate(w*.6,w*.6);piecePath(ctx,r,c,s,m);ctx.restore();ctx.lineWidth=w;ctx.strokeStyle='rgba(255,255,255,.45)';ctx.stroke();
  ctx.save();ctx.translate(-w*.6,-w*.6);piecePath(ctx,r,c,s,m);ctx.restore();ctx.strokeStyle='rgba(0,0,0,.35)';ctx.stroke();
  piecePath(ctx,r,c,s,m);ctx.lineWidth=Math.max(1,s*.015);ctx.strokeStyle='rgba(0,0,0,.45)';ctx.stroke();
  ctx.restore();
}

function build(){
  if(!E||!G)return;
  const wrap=E.wrap,img=G.src;
  const cell=Math.max(10,Math.floor(Math.min((wrap.clientWidth-20)/G.cols,(wrap.clientHeight-20)/G.rows)));
  const dpr=Math.min(3,window.devicePixelRatio||1);
  let rc=Math.round(cell*dpr*1.15);rc=Math.min(rc,220,Math.floor(Math.sqrt(9e6/(G.total*2.3))));rc=Math.max(rc,40);G.rc=rc;
  const asp=G.cols/G.rows;let sw=img.width,sh=img.height;if(sw/sh>asp)sw=sh*asp;else sh=sw/asp;
  const sc=document.createElement('canvas');sc.width=rc*G.cols;sc.height=rc*G.rows;
  const sctx=sc.getContext('2d');sctx.imageSmoothingQuality='high';sctx.drawImage(img,(img.width-sw)/2,(img.height-sh)/2,sw,sh,0,0,sc.width,sc.height);
  G.imgURL=sc.toDataURL('image/jpeg',.85);
  E.guide.style.backgroundImage='url('+G.imgURL+')';E.peek.querySelector('img').src=G.imgURL;
  const R=rng(G.seed);
  G.H=Array.from({length:G.rows-1},()=>Array.from({length:G.cols},()=>R()<.5?1:-1));
  G.V=Array.from({length:G.rows},()=>Array.from({length:G.cols-1},()=>R()<.5?1:-1));
  const m=Math.round(rc*M),P=rc+2*m;G.ratio=P/rc;G.mr=m/rc;
  G.pieces=[];
  for(let r=0;r<G.rows;r++)for(let c=0;c<G.cols;c++){
    const cv=document.createElement('canvas');cv.width=cv.height=P;drawPiece(cv.getContext('2d'),r,c,rc,m,sc);
    const el=document.createElement('div');el.className='piece';el.appendChild(cv);
    const p={id:G.pieces.length,r,c,el,placed:false,owner:null};el._p=p;el.addEventListener('pointerdown',onDown);G.pieces.push(p);
  }
  // Karıştırma her cihazda farklı: herkes başka parçalarla başlar
  const order=G.pieces.slice(),SR=rng((Math.random()*2147483647)|0);
  for(let i=order.length-1;i>0;i--){const j=Math.floor(SR()*(i+1));[order[i],order[j]]=[order[j],order[i]]}
  order.forEach(p=>E.tray.appendChild(p.el));E.tray.scrollLeft=0;
  E.board.classList.toggle('noguide',!guideOn);E.guideBtn.classList.toggle('off',!guideOn);
  layout();startTicker();
  applyState();markHeld();renderGhosts();G.ready=true;
}
function layout(){
  if(!E||!G||!G.pieces)return;
  const wrap=E.wrap;
  const cell=Math.max(8,Math.floor(Math.min((wrap.clientWidth-20)/G.cols,(wrap.clientHeight-20)/G.rows)));G.cell=cell;
  const b=E.board;b.style.width=cell*G.cols+'px';b.style.height=cell*G.rows+'px';b.style.setProperty('--cell',cell+'px');
  G.pieces.forEach(p=>{if(p.placed)placeEl(p)});
  const tc=Math.round(Math.min(76,Math.max(44,innerWidth/8)));
  E.root.style.setProperty('--tp',Math.round(tc*G.ratio)+'px');
  renderGhosts();
}
function placeEl(p){const cell=G.cell,ps=cell*G.ratio;Object.assign(p.el.style,{left:(p.c-G.mr)*cell+'px',top:(p.r-G.mr)*cell+'px',width:ps+'px',height:ps+'px',transform:''})}

/* ================= Sürükle & dokun ================= */
function canAct(p){
  if(!G||G.over||p.placed)return false;
  const fr=G.frozenUntil-Date.now();if(fr>0){A.toast('Ceza: '+Math.ceil(fr/1000)+' sn bekle');return false}
  const h=HOLDS[p.id];if(h){A.toast(h.name+' bu parçayı tutuyor');return false}
  return true;
}
function onDown(e){
  const p=this._p;if(e.pointerType==='mouse'&&e.button!==0)return;if(!canAct(p))return;
  D={p,id:e.pointerId,x0:e.clientX,y0:e.clientY,on:false,touch:e.pointerType!=='mouse'};
}
window.addEventListener('pointermove',e=>{
  if(!D||e.pointerId!==D.id)return;
  if(!D.on){if(Math.hypot(e.clientX-D.x0,e.clientY-D.y0)<8)return;beginDrag()}
  moveDrag(e.clientX,e.clientY);
});
window.addEventListener('pointerup',e=>{
  if(!D||e.pointerId!==D.id)return;const d=D;D=null;
  if(!G||!E)return;
  if(d.on)endDrag(d);else toggleSelect(d.p);
});
window.addEventListener('pointercancel',e=>{
  if(!D||e.pointerId!==D.id)return;const d=D;D=null;if(d.on&&E){returnToTray(d.p,false,d.next);releaseHold()}
});
function beginDrag(){
  const p=D.p;D.on=true;clearSel();D.next=p.el.nextSibling;
  const ps=G.cell*G.ratio;D.ps=ps;D.oy=D.touch?Math.max(ps*.55,30):0;D.br=E.board.getBoundingClientRect();
  p.el.style.width=p.el.style.height=ps+'px';E.drag.appendChild(p.el);
  pres({hold:p.id,hx:null,hy:null});
}
function moveDrag(x,y){
  D.cx=x;D.cy=y-D.oy;D.p.el.style.transform='translate('+(D.cx-D.ps/2)+'px,'+(D.cy-D.ps/2)+'px)';
  if(D.br){const b=D.br;pres({hx:Math.round((D.cx-b.left)/b.width*1000)/1000,hy:Math.round((D.cy-b.top)/b.height*1000)/1000})}
}
function endDrag(d){
  const br=E.board.getBoundingClientRect(),cell=G.cell,pad=cell*.3;
  if(d.cx==null||d.cx<br.left-pad||d.cx>br.right+pad||d.cy<br.top-pad||d.cy>br.bottom+pad){returnToTray(d.p,false,d.next);releaseHold();return}
  const fx=(d.cx-br.left)/cell-.5,fy=(d.cy-br.top)/cell-.5;
  const ok=Math.abs(fx-d.p.c)<.45&&Math.abs(fy-d.p.r)<.45;
  attempt(d.p,ok,Math.round(fx),Math.round(fy),d.next);
}
function returnToTray(p,shake,next){
  const el=p.el;el.style.transform='';el.style.width=el.style.height='';el.style.left=el.style.top='';
  const ti=E.tray;if(next&&next.parentNode===ti&&next!==el)ti.insertBefore(el,next);else ti.appendChild(el);
  if(shake){el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake')}
}
function toggleSelect(p){
  if(sel===p){clearSel();return}clearSel();sel=p;p.el.classList.add('sel');E.board.classList.add('targeting');
  pres({hold:p.id,hx:null,hy:null});
}
function clearSel(){
  const had=!!sel;if(sel)sel.el.classList.remove('sel');sel=null;if(E)E.board.classList.remove('targeting');
  if(had&&G)releaseHold();
}
function onBoardClick(e){
  if(!sel||!G||G.over)return;
  if(G.frozenUntil>Date.now()){A.toast('Ceza süresi bitmedi');return}
  const br=E.board.getBoundingClientRect();
  const c=Math.floor((e.clientX-br.left)/G.cell),r=Math.floor((e.clientY-br.top)/G.cell);
  if(c<0||r<0||c>=G.cols||r>=G.rows)return;
  const p=sel;clearSel();attempt(p,r===p.r&&c===p.c,c,r,null);
}
function attempt(p,ok,gc,gr,next){
  G.moves++;
  if(ok)netPlace(p);
  else{returnToTray(p,true,next||p.el.nextSibling);flashCell(gc,gr);netWrong(p,gc,gr);releaseHold()}
}
function snapFx(p){p.el.classList.remove('snap');void p.el.offsetWidth;p.el.classList.add('snap');clearTimeout(p.snapT);p.snapT=setTimeout(()=>p.el.classList.remove('snap'),750)}
function flashCell(c,r){
  if(c<0||r<0||c>=G.cols||r>=G.rows)return;
  const f=document.createElement('div');f.className='flash';
  Object.assign(f.style,{left:c*G.cell+'px',top:r*G.cell+'px',width:G.cell+'px',height:G.cell+'px'});
  E.board.appendChild(f);setTimeout(()=>f.remove(),650);
}
function startTicker(){
  clearInterval(tick);
  tick=setInterval(()=>{
    if(!G||G.over||!G.pieces)return;
    G.elapsed=G.startedAt?Math.max(0,(Date.now()+A.offset-G.startedAt)/1000):0;renderStatus();
  },200);
}

/* ================= Puanlar ve durum ================= */
function renderHUD(){
  if(!G||!E)return;
  E.scores.innerHTML=G.players.map(p=>'<div class="chip'+(p.uid===A.me?' on':'')+(p.online?'':' away')+'" style="--pc:'+p.color+'"><span class="dot" style="background:'+p.color+'"></span>'+esc(p.name)+'<b>'+(p.score||0)+'</b></div>').join('');
  renderStatus();
}
function renderStatus(){
  if(!G||!E)return;let left;
  const fr=G.frozenUntil-Date.now();
  if(fr>0)left='<span class="pill warn">Ceza: '+Math.ceil(fr/1000)+' sn</span>';
  else{const n=onlineCount();left='Kapış kapış'+(n?' <span class="pill">'+n+' kişi</span>':'')}
  E.left.innerHTML=left;
  E.right.innerHTML='<span class="pill">'+G.placed+'/'+G.total+'</span> <span class="pill">'+fmt(G.elapsed)+'</span>';
}
function finish(){
  G.over=true;clearSel();clearInterval(tick);renderStatus();
  if(D&&D.on){const d=D;D=null;returnToTray(d.p,false,d.next)}
  const g=G;
  setTimeout(()=>{
    if(G!==g||!E)return;
    const stats='<div class="yp-stats"><div><b>'+fmt(G.elapsed)+'</b>süre</div><div><b>'+G.total+'</b>parça</div><div><b>'+G.mistakes+'</b>hatan</div></div>';
    const list=G.players.filter(p=>p.score||p.online).sort((a,b)=>b.score-a.score);
    const top=list.length?list[0].score:0,w=list.filter(p=>p.score===top);
    const title=list.length<2?'Tamamlandı! 🎉':w.length>1?'Berabere! 🤝':(w[0].uid===A.me?'🏆 Kazandın!':'🏆 '+esc(w[0].name)+' kazandı!');
    const body=list.map((p,i)=>'<div class="rank"><span><i class="dot" style="background:'+p.color+'"></i>'+(i+1)+'. '+esc(p.name)+(p.uid===A.me?' (sen)':'')+'</span><b>'+p.score+'</b></div>').join('')+stats;
    const host=A.amHost();
    E.win.querySelector('[data-a=again]').classList.toggle('hidden',!host);
    E.win.querySelector('[data-a=lounge]').classList.toggle('hidden',!host);
    E.win.querySelector('.hint').classList.toggle('hidden',host);
    E.win.querySelector('h2').innerHTML=title;E.win.querySelector('.yp-winbody').innerHTML=body;E.win.classList.remove('hidden');confetti();
  },600);
}
function confetti(){
  const cv=E.win.querySelector('.yp-confetti'),ctx=cv.getContext('2d'),W=cv.width=innerWidth,H=cv.height=innerHeight;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const parts=Array.from({length:160},(_,i)=>({x:Math.random()*W,y:-Math.random()*H*.6,vx:(Math.random()-.5)*3,vy:2+Math.random()*3,r:Math.random()*6.3,vr:(Math.random()-.5)*.3,c:COLORS[i%6],w:7+Math.random()*7}));
  const t0=performance.now(),win=E.win;
  (function f(now){ctx.clearRect(0,0,W,H);parts.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=.03;p.r+=p.vr;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.r);ctx.fillStyle=p.c;ctx.fillRect(-p.w/2,-p.w/4,p.w,p.w/2);ctx.restore()});
    if(now-t0<4200&&!win.classList.contains('hidden'))requestAnimationFrame(f);else ctx.clearRect(0,0,W,H)})(t0);
}

/* ================= Sunucuyla eşitleme ================= */
function applyState(){
  if(!G||!G.pieces||!SG)return;
  G.startedAt=SG.startedAt;
  (SG.placed||[]).forEach(([pid,by])=>placeFromServer(pid,by,false));
  refreshScores();
  if(SG.status==='done'&&!G.over){G.elapsed=Math.max(0,((SG.finishedAt||Date.now())-SG.startedAt)/1000);finish()}
}
function placeFromServer(pid,by,live){
  const p=G.pieces[pid];if(!p)return;
  if(!p.placed){
    if(D&&D.p===p){D=null;if(live)A.toast(A.nameOf(by)+' kaptı!')}
    if(sel===p){sel.el.classList.remove('sel');sel=null;E.board.classList.remove('targeting')}
    p.placed=true;p.owner=by;p.el.classList.remove('sel','shake','held');delete p.el.dataset.who;
    p.el.style.setProperty('--pc',A.colorOf(by));E.board.appendChild(p.el);placeEl(p);if(live&&G.ready)snapFx(p);
  }else if(p.owner!==by){
    const prev=p.owner;p.owner=by;p.el.style.setProperty('--pc',A.colorOf(by));snapFx(p);
    if(prev===A.me&&live)A.toast('Kıl payı! '+A.nameOf(by)+' daha hızlıydı');
  }
}
function onPlaced(pid,by){
  if(!SG||!Number.isInteger(pid))return;
  if(!SG.placed.some(x=>x[0]===pid))SG.placed.push([pid,by]);
  if(G&&G.pieces){placeFromServer(pid,by,true);refreshScores()}
}
function refreshScores(){
  const sc={};let n=0;
  G.pieces.forEach(p=>{if(p.placed){n++;sc[p.owner]=(sc[p.owner]||0)+1}});
  G.placed=n;
  G.players=players().filter(p=>p.online||sc[p.id]).map(p=>({uid:p.id,name:p.name,color:p.color,online:p.online,score:sc[p.id]||0}));
  renderHUD();
}
function onHolds(list){
  HOLDS={};
  if(Array.isArray(list))list.forEach(h=>{
    if(!Array.isArray(h))return;const[by,pid,hx,hy]=h;
    if(by===A.me||!Number.isInteger(pid))return;
    HOLDS[pid]={uid:by,name:A.nameOf(by),color:A.colorOf(by),peer:by,hx,hy};
  });
  if(G&&G.pieces){markHeld();renderGhosts()}
}
function markHeld(){
  if(!G||!G.pieces)return;
  G.pieces.forEach(p=>{
    const h=HOLDS[p.id];
    if(h&&!p.placed){p.el.classList.add('held');p.el.style.setProperty('--pc',h.color);p.el.dataset.who=h.name}
    else if(p.el.classList.contains('held')){p.el.classList.remove('held');delete p.el.dataset.who}
  });
}
function renderGhosts(){
  const keep=new Set();
  if(G&&G.pieces&&G.cell&&E){
    const W=G.cell*G.cols,H=G.cell*G.rows,ps=G.cell*G.ratio;
    for(const pid in HOLDS){
      const h=HOLDS[pid],p=G.pieces[pid];
      if(!p||p.placed||typeof h.hx!=='number'||typeof h.hy!=='number')continue;
      const key=h.peer;keep.add(key);let g=ghosts[key];
      if(!g||g.pid!==p.id){
        if(g)g.el.remove();
        const el=document.createElement('div');el.className='ghost';
        const s=p.el.querySelector('canvas'),cv=document.createElement('canvas');cv.width=s.width;cv.height=s.height;cv.getContext('2d').drawImage(s,0,0);
        const tag=document.createElement('span');tag.className='gtag';el.append(cv,tag);
        E.board.appendChild(el);g=ghosts[key]={el,tag,pid:p.id};
      }
      g.tag.textContent=h.name;g.el.style.setProperty('--pc',h.color);
      Object.assign(g.el.style,{width:ps+'px',height:ps+'px',left:(h.hx*W-ps/2)+'px',top:(h.hy*H-ps/2)+'px'});
    }
  }
  for(const k in ghosts)if(!keep.has(k)){ghosts[k].el.remove();delete ghosts[k]}
}

// "Tuttuğum parça" bilgisini en fazla 50 ms'de bir gönder
const HS={pid:null,hx:null,hy:null};let hsT=null,hsLast=0;
function pres(patch){
  if('hold' in patch)HS.pid=patch.hold;if('hx' in patch)HS.hx=patch.hx;if('hy' in patch)HS.hy=patch.hy;
  clearTimeout(hsT);
  hsT=setTimeout(()=>{hsLast=Date.now();A.send({t:'hold',pid:HS.pid,hx:HS.hx,hy:HS.hy})},Math.max(0,50-(Date.now()-hsLast)));
}
function releaseHold(){if(G)pres({hold:null,hx:null,hy:null})}
function netPlace(p){
  clearTimeout(hsT);HS.pid=HS.hx=HS.hy=null;
  p.placed=true;p.owner=A.me;p.el.classList.remove('sel','shake','held');
  p.el.style.setProperty('--pc',A.colorOf(A.me));E.board.appendChild(p.el);placeEl(p);snapFx(p);A.vib(15);
  if(!A.send({t:'place',pid:p.id,r:p.r,c:p.c}))A.toast('Bağlantı yok, yeniden bağlanılıyor');
  refreshScores();
}
function netWrong(p,gc,gr){
  G.mistakes++;G.frozenUntil=Date.now()+1500;A.vib([30,40,30]);
  A.toast('Yanlış yer! 1,5 sn ceza');renderStatus();
  clearTimeout(hsT);HS.pid=HS.hx=HS.hy=null;
  A.send({t:'place',pid:p.id,r:gr,c:gc});
}

A.register({
  id:'yapboz',title:'Yapboz Düellosu',icon:'🧩',color:'#19b394',css:'yp',
  blurb:'Bir resim seç, parçalara bölünsün. Herkes aynı anda yerleştirir, ilk oturtan kapar.',
  setup,mount,unmount,state,
  line(){return G&&G.total?G.placed+'/'+G.total+' parça':''},
  menu(){
    if(A.amHost()&&SG&&SG.status==='done')return[{label:'🔁 Rövanş (yeni karışık)',cls:'sun',onClick:()=>A.send({t:'rematch'})}];
    return[];
  },
  msg(m){
    switch(m.t){
      case 'placed':onPlaced(m.pid,m.by);break;
      case 'wrong':if(G){G.frozenUntil=Date.now()+(+m.ms||1500);renderStatus()}break;
      case 'frozen':if(G){G.frozenUntil=Date.now()+(+m.ms||0);A.toast('Ceza süresi bitmedi');renderStatus()}break;
      case 'holds':onHolds(m.list);break;
    }
  },
});
})();
