'use strict';
/*
 * Salon — sunucu
 *   node server.js            → aynı Wi-Fi'daki cihazlar katılabilir
 *   node server.js --internet → Cloudflare tüneli açılır, her yerden katılınabilir
 *
 * Bir oda = bir salon. Salonda yazılı sohbet, mikrofon, kamera ve tepkiler her
 * zaman açıktır. Kurucu ortadan bir etkinlik seçer (server/games/*.js). Etkinlik
 * değişince kimsenin bağlantısı kopmaz.
 *
 * Görüntü ve ses sunucudan geçmez: katılımcılar WebRTC ile birbirine doğrudan
 * bağlanır, sunucu sadece bağlantı kurulum mesajlarını iletir.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
let qr = null;
try { qr = require('qrcode-terminal'); } catch (e) { /* QR isteğe bağlı */ }

const PORT = parseInt(process.env.PORT, 10) || 3000;
const INTERNET = process.argv.includes('--internet') || process.env.TUNNEL === '1';
const PUBLIC = path.join(__dirname, 'public');
const COLORS = ['#ff4d6d', '#5b4dff', '#19b394', '#ff8a3d', '#2fa4ff', '#c04bd6', '#d4a000', '#00a3a3', '#e05297', '#6b8e23', '#8a5cf6', '#c2571a'];
const CODE_CH = 'ABCDEFGHJKMNPRSTUVYZ23456789';
const MAX_PLAYERS = 12;    // herkes herkese bağlanır; kamerayla 6–8 kişi rahat çalışır
const MAX_ROOMS = 200;
const MAX_MSGS = 80;
const EMPTY_ROOM_TTL = 2 * 60 * 60 * 1000;
const HOST_AWAY_MS = 30 * 1000;
const REACTIONS = ['😂', '😮', '🔥', '👏', '❤️', '👀'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
};

// Etkinlikler: yenisini eklemek için server/games altına bir modül koyup buraya ekle
const GAMES = {};
for (const g of [require('./server/games/w2g'), require('./server/games/tersine'), require('./server/games/yapboz'), require('./server/games/sinema')]) GAMES[g.id] = g;

const rooms = new Map();
const log = (...a) => console.log(new Date().toLocaleTimeString('tr-TR'), '·', ...a);

/* ---------------- HTTP ---------------- */
const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); return res.end(); }

  // Etkinliklerin dosyaları: /room/KOD/... (yapboz resmi, Tersine ses kayıtları)
  const rm = u.pathname.match(/^\/room\/([A-Z0-9]{4})\/(.+)$/);
  if (rm) {
    const r = rooms.get(rm[1]);
    const act = r && r.activity;
    const game = act && GAMES[act.id];
    if (game && game.http && game.http(r, act.g, rm[2], req, res, api)) return;
    res.writeHead(404); return res.end('Yok');
  }
  if (u.pathname === '/ice') {
    // Bağlantı sunucuları. TURN_URLS verilirse zor ağlarda da (mobil veri, şirket ağı) çalışır.
    const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    if (process.env.TURN_URLS) {
      ice.push({
        urls: process.env.TURN_URLS.split(',').map((x) => x.trim()).filter(Boolean),
        username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '',
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ iceServers: ice }));
  }
  if (u.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }

  let rel;
  try { rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\/+/, ''); }
  catch (e) { res.writeHead(400); return res.end(); }
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Bulunamadı'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

/* ---------------- Yardımcılar ---------------- */
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const cleanText = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, n);

function genCode() {
  for (let i = 0; i < 100; i++) {
    let s = '';
    for (let j = 0; j < 4; j++) s += CODE_CH[Math.floor(Math.random() * CODE_CH.length)];
    if (!rooms.has(s)) return s;
  }
  return null;
}
function sendTo(ws, o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }
function conns(room) { const out = []; for (const p of room.players.values()) for (const ws of p.conns) out.push(ws); return out; }
function broadcast(room, o, except) {
  const s = JSON.stringify(o);
  for (const ws of conns(room)) if (ws !== except && ws.readyState === 1) ws.send(s);
}
const isOnline = (room, id) => { const p = room.players.get(id); return !!(p && p.conns.size); };
const onlinePlayers = (room) => [...room.players.values()].filter((p) => p.conns.size).sort((a, b) => a.joinedAt - b.joinedAt);
const nameOf = (room, pid) => { const p = room.players.get(pid); return p ? p.name : '?'; };

// Herkese kendi görebileceği durum gider (Tersine'de gizli kelime sadece söyleyene gider)
function snapshot(room, pid) {
  const act = room.activity;
  const game = act && GAMES[act.id];
  return {
    t: 'state', code: room.code, host: room.host, now: Date.now(),
    players: [...room.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, online: p.conns.size > 0 })),
    peers: conns(room).map((ws) => ({ cid: ws.cid, pid: ws.pid, mic: !!ws.media.mic, cam: !!ws.media.cam })),
    activity: act ? act.id : null,
    game: game ? game.snapshot(room, act.g, pid, api) : null,
  };
}
function pushState(room) {
  for (const p of room.players.values()) {
    if (!p.conns.size) continue;
    const s = JSON.stringify(snapshot(room, p.id));
    for (const ws of p.conns) if (ws.readyState === 1) ws.send(s);
  }
}

let msgSeq = 0;
function addMsg(room, m) {
  m.id = ++msgSeq; m.ts = Date.now();
  room.msgs.push(m);
  if (room.msgs.length > MAX_MSGS) room.msgs.shift();
  broadcast(room, { t: 'chat', m });
  return m;
}
const sys = (room, text) => addMsg(room, { sys: true, text });

// Basit hız sınırı: aynı türden mesaj en fazla `ms` aralıkla
function tooFast(ws, key, ms) {
  const now = Date.now();
  if (now - (ws.rl[key] || 0) < ms) return true;
  ws.rl[key] = now;
  return false;
}

// Etkinlik modüllerine verilen araç kutusu
const api = { pushState, broadcast, sendTo, sys, log, conns, nameOf, isOnline, onlinePlayers, tooFast, clean, cleanText };

function passHost(room) {
  const cand = [...room.players.values()]
    .filter((p) => p.conns.size && p.id !== room.host)
    .sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (!cand) return false;
  room.host = cand.id; room.hostAway = 0;
  sys(room, `${cand.name} artık salonun kurucusu`);
  log(`Oda ${room.code}: yeni kurucu ${cand.name}`);
  return true;
}

function callGame(room, fn, ...args) {
  const act = room.activity;
  const game = act && GAMES[act.id];
  if (game && typeof game[fn] === 'function') return game[fn](room, act.g, ...args, api);
  return undefined;
}

function startActivity(room, id, opts, ws) {
  const game = GAMES[id];
  if (!game) return sendTo(ws, { t: 'error', msg: 'Böyle bir etkinlik yok' });
  const n = onlinePlayers(room).length;
  if (game.minPlayers && n < game.minPlayers) return sendTo(ws, { t: 'error', msg: `${game.title} için en az ${game.minPlayers} kişi lazım` });
  if (game.maxPlayers && n > game.maxPlayers) return sendTo(ws, { t: 'error', msg: `${game.title} en fazla ${game.maxPlayers} kişiyle açılabilir` });
  const res = game.start(room, opts && typeof opts === 'object' ? opts : {}, api);
  if (!res || res.error) return sendTo(ws, { t: 'error', msg: (res && res.error) || 'Etkinlik başlatılamadı' });
  if (room.activity) endActivity(room, true);
  room.activity = { id, g: res };
  sys(room, `${nameOf(room, room.host)} ${game.icon} ${game.title} başlattı`);
  log(`Oda ${room.code}: ${game.title} başladı`);
  pushState(room);
}

function endActivity(room, silent) {
  if (!room.activity) return;
  callGame(room, 'stop');
  const game = GAMES[room.activity.id];
  room.activity = null;
  // Etkinlik sürerken çıkanların kaydı burada temizlenir
  for (const [id, p] of room.players) if (!p.conns.size && id !== room.host) room.players.delete(id);
  if (!silent) {
    sys(room, `Herkes salona döndü`);
    log(`Oda ${room.code}: ${game ? game.title : 'etkinlik'} bitti`);
    pushState(room);
  }
}

function attach(ws, room) {
  detach(ws, false);
  let p = room.players.get(ws.pid);
  const isNew = !p;
  if (!p) {
    if (onlinePlayers(room).length >= MAX_PLAYERS) {
      return sendTo(ws, { t: 'error', code: 'full', msg: 'Salon dolu (en fazla ' + MAX_PLAYERS + ' kişi)' });
    }
    const used = new Set([...room.players.values()].map((x) => x.color));
    const color = COLORS.find((c) => !used.has(c)) || COLORS[room.players.size % COLORS.length];
    p = { id: ws.pid, name: ws.name, color, joinedAt: Date.now(), conns: new Set() };
    room.players.set(p.id, p);
    log(`Oda ${room.code}: ${p.name} katıldı`);
  }
  const wasOffline = p.conns.size === 0;
  p.name = ws.name || p.name;
  p.conns.add(ws);
  ws.room = room.code;
  ws.media = { mic: false, cam: false };
  room.emptySince = null;
  if (isNew) callGame(room, 'onJoin', p);
  sendTo(ws, { t: 'history', list: room.msgs });
  if (isNew || wasOffline) sys(room, `${p.name} katıldı`);
  pushState(room);
}

function detach(ws, explicit) {
  const room = ws.room && rooms.get(ws.room);
  ws.room = null;
  if (!room) return;
  callGame(room, 'onConnClose', ws);
  const p = room.players.get(ws.pid);
  if (p) {
    p.conns.delete(ws);
    if (p.conns.size === 0) {
      callGame(room, 'onOffline', p);
      if (explicit) {
        sys(room, `${p.name} ayrıldı`);
        log(`Oda ${room.code}: ${p.name} ayrıldı`);
        if (room.host === p.id) passHost(room);
        callGame(room, 'onLeave', p);
        // Etkinlik sürerken puanı kalsın diye kayıt silinmez; salona dönülünce temizlenir
        if (!room.activity && room.host !== p.id) room.players.delete(p.id);
      }
    }
  }
  if (!conns(room).length) room.emptySince = Date.now();
  pushState(room);
}

/* ---------------- Mesajlar ---------------- */
function handle(ws, m) {
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'alive') return; // canlı tutma sinyali
  if (m.t === 'hello') {
    if (typeof m.id === 'string' && /^[a-z0-9]{20}$/.test(m.id)) ws.pid = m.id;
    ws.name = clean(m.name, 14) || 'Misafir';
    return sendTo(ws, { t: 'welcome', cid: ws.cid });
  }
  if (!ws.pid) return sendTo(ws, { t: 'error', msg: 'Bağlantı henüz hazır değil' });
  if (typeof m.name === 'string') ws.name = clean(m.name, 14) || ws.name;

  switch (m.t) {
    case 'create': {
      if (rooms.size >= MAX_ROOMS) return sendTo(ws, { t: 'error', msg: 'Sunucuda çok fazla oda var' });
      const code = genCode();
      if (!code) return sendTo(ws, { t: 'error', msg: 'Oda kodu üretilemedi' });
      const r = {
        code, host: ws.pid, hostAway: 0, players: new Map(), msgs: [], activity: null,
        emptySince: null, created: Date.now(),
      };
      rooms.set(code, r);
      log(`Oda ${code} kuruldu`);
      return attach(ws, r);
    }
    case 'join': {
      const r = rooms.get(String(m.code || '').toUpperCase());
      if (!r) return sendTo(ws, { t: 'error', code: 'noroom', msg: 'Bu kodla bir oda bulunamadı' });
      return attach(ws, r);
    }
    case 'leave':
      return detach(ws, true);
  }

  const room = ws.room && rooms.get(ws.room);
  const me = room && room.players.get(ws.pid);
  if (!room || !me) return;

  switch (m.t) {
    case 'media':
      ws.media = { mic: !!m.mic, cam: !!m.cam };
      return pushState(room);

    case 'rtc': {
      // Bağlantı kurulum mesajlarını yalnızca aynı odadaki kişiler arasında iletir
      if (typeof m.to !== 'string') return;
      if (JSON.stringify(m.data || null).length > 30000) return;
      for (const c of conns(room)) if (c.cid === m.to) return sendTo(c, { t: 'rtc', from: ws.cid, data: m.data });
      return;
    }

    case 'chat': {
      const text = cleanText(m.text, 500);
      if (!text || tooFast(ws, 'chat', 300)) return;
      return addMsg(room, { pid: me.id, text });
    }

    case 'react':
      if (!REACTIONS.includes(m.e) || tooFast(ws, 'react', 250)) return;
      return broadcast(room, { t: 'react', pid: me.id, e: m.e });

    case 'activity': {
      // Etkinliği yalnızca kurucu seçer ya da bitirir
      if (room.host !== me.id) return sendTo(ws, { t: 'error', msg: 'Etkinliği kurucu seçer' });
      if (m.id === null) return endActivity(room, false);
      return startActivity(room, String(m.id), m.opts, ws);
    }
  }

  // Geri kalan her şey o an açık olan etkinliğe gider
  if (room.activity) callGame(room, 'handle', me, ws, m);
}

/* ---------------- WebSocket ---------------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 5 * 1024 * 1024 });
wss.on('connection', (ws) => {
  ws.cid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  ws.isAlive = true;
  ws.rl = {};
  ws.media = { mic: false, cam: false };
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf); } catch (e) { return; }
    try { handle(ws, msg); } catch (e) { console.error('Mesaj işlenemedi:', e); }
  });
  ws.on('close', () => detach(ws, false));
  ws.on('error', () => {});
});

// Kopan bağlantıları yakala
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* yoksay */ }
  });
}, 20000);

// Sık çalışan işler (yapbozda "kim hangi parçayı tutuyor" bilgisi gibi)
setInterval(() => { for (const r of rooms.values()) if (r.activity) callGame(r, 'fastTick'); }, 60);

// Bakım: boş odaları kapat, ortadan kaybolan kurucunun yerine birini geçir
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.emptySince && now - r.emptySince > EMPTY_ROOM_TTL) {
      if (r.activity) callGame(r, 'stop');
      rooms.delete(code); log(`Oda ${code} kapatıldı (boş)`); continue;
    }
    let changed = false;
    const h = r.players.get(r.host);
    if (h && h.conns.size) r.hostAway = 0;
    else if (!r.hostAway) r.hostAway = now;
    else if (now - r.hostAway > HOST_AWAY_MS && passHost(r)) changed = true;
    if (r.activity && callGame(r, 'tick', now)) changed = true;
    if (changed) pushState(r);
  }
}, 10000);

/* ---------------- Başlangıç ---------------- */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}
function showUrl(title, url) {
  console.log(`\n  ${title}\n  👉 ${url}\n`);
  if (qr) qr.generate(url, { small: true }, (s) => console.log(s.split('\n').map((l) => '  ' + l).join('\n')));
}

function startTunnel() {
  const bin = process.env.CLOUDFLARED || 'cloudflared';
  console.log('  İnternet tüneli açılıyor (Cloudflare)…');
  let found = false;
  const cp = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const onData = (d) => {
    if (found) return;
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) {
      found = true;
      showUrl('🌍 HERKES İÇİN BAĞLANTI (farklı Wi-Fi / mobil veri):', m[0]);
      console.log('  Bu bağlantıyı arkadaşlarına gönder. Pencereyi kapatma; kapatınca salon da kapanır.\n');
    }
  };
  cp.stdout.on('data', onData);
  cp.stderr.on('data', onData);
  cp.on('error', () => {
    console.log(
      '\n  ⚠️  cloudflared bulunamadı. İnternet bağlantısı için bir kez kurman gerekiyor:\n' +
      '     Windows : winget install --id Cloudflare.cloudflared\n' +
      '     macOS   : brew install cloudflared\n' +
      '     Linux   : https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n' +
      '  Kurduktan sonra terminali kapatıp yeniden aç ve tekrar başlat.\n'
    );
  });
  cp.on('exit', (code) => { if (found) log(`Tünel kapandı (kod ${code})`); });
  const stop = () => { try { cp.kill(); } catch (e) { /* yoksay */ } process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  ❌ ${PORT} numaralı port kullanımda. Başka bir port dene:  PORT=3001 node server.js\n`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🛋️  Salon sunucusu çalışıyor\n');
  console.log(`  Bu bilgisayarda:  http://localhost:${PORT}`);
  const ips = lanAddresses();
  if (ips.length) showUrl('📶 AYNI WI-FI\'DAKİ CİHAZLAR İÇİN (mikrofon/kamera/paylaşım için https gerekir):', `http://${ips[0]}:${PORT}`);
  if (INTERNET) startTunnel();
  else console.log('  Arkadaşlarla kullanmak için sunucuyu "internet" modunda başlat (internet.bat ya da npm run internet).\n');
  console.log('  Durdurmak için: Ctrl + C\n');
});
