'use strict';
/*
 * 🔁 Tersine
 * Söyleyen gizli kelimeyi söyler, telefon kaydı ters çevirip SADECE ters halini
 * gönderir. Tahmin eden ters sesi taklit eder, taklit tekrar ters çevrilir,
 * kelime (az çok) geri gelir. Ses kayıtları küçük wav dosyaları olarak sunucuda
 * tutulur ve tur bitince silinir.
 */
const crypto = require('crypto');

const MAX_CLIP = 600 * 1024;   // tek ses kaydı (wav) en fazla
const MAX_TRIES = 3;           // tahmin hakkı
const POINTS = [3, 2, 1];      // 1., 2., 3. denemede bilene

/* ---------------- Kelimeler ---------------- */
/* ---------------- Kelimeler ---------------- */
const WORDS = {
  kolay: ['elma', 'kedi', 'masa', 'kalem', 'kapı', 'ayna', 'saat', 'gemi', 'uçak', 'balık', 'kuzu', 'ördek', 'limon',
    'çilek', 'simit', 'çanta', 'yastık', 'terlik', 'bardak', 'tabak', 'kaşık', 'çatal', 'bulut', 'yıldız', 'deniz',
    'orman', 'tavuk', 'aslan', 'kaplan', 'maymun', 'tavşan', 'lamba', 'perde', 'koltuk', 'sabun', 'havlu', 'kitap',
    'defter', 'silgi', 'makas', 'çorap', 'şapka', 'karpuz', 'kiraz', 'üzüm', 'peynir', 'zeytin', 'ekmek', 'çorba',
    'sincap', 'kirpi', 'timsah', 'gitar', 'davul', 'kamyon', 'tren', 'köprü', 'kale', 'bahçe', 'çiçek'],
  orta: ['araba', 'telefon', 'pencere', 'şemsiye', 'merdiven', 'kurbağa', 'zürafa', 'eldiven', 'salata', 'makarna',
    'patates', 'domates', 'portakal', 'dondurma', 'tencere', 'bisiklet', 'kelebek', 'penguen', 'papağan', 'örümcek',
    'karınca', 'hamburger', 'otobüs', 'piyano', 'keman', 'futbolcu', 'uçurtma', 'dinozor', 'hastane', 'patlıcan',
    'ananas', 'baklava', 'lahmacun', 'kurabiye', 'battaniye', 'tornavida', 'sandalye', 'kalemlik', 'yumurta',
    'kanepe', 'kamera', 'gazete', 'paraşüt', 'balina', 'yunus', 'ahtapot', 'kaktüs', 'mantar', 'pamuk', 'sihirbaz'],
  zor: ['buzdolabı', 'bilgisayar', 'çikolata', 'televizyon', 'helikopter', 'kaplumbağa', 'ayakkabı', 'gökkuşağı',
    'denizaltı', 'hipopotam', 'astronot', 'kütüphane', 'salatalık', 'mandalina', 'karnabahar', 'çamaşırhane',
    'gökdelen', 'süpermarket', 'itfaiyeci', 'hamamböceği', 'uğurböceği', 'deniz kızı', 'kardan adam', 'ateşböceği',
    'akordeon', 'trampolin', 'buzdağı', 'yanardağ', 'portakal suyu', 'diş fırçası', 'çamaşır makinesi',
    'kırmızı başlıklı kız', 'elektrik süpürgesi', 'bulaşık makinesi', 'satranç tahtası', 'gözlükçü'],
};
WORDS.karisik = [...WORDS.kolay, ...WORDS.orta, ...WORDS.zor];
const DIFFS = Object.keys(WORDS);

/* ---------------- Yardımcılar ---------------- */
const TR = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
// Karşılaştırma için: küçük harf, Türkçe karakterler sadeleşir, boşluk ve noktalama gider ("Köpek" = "kopek")
const norm = (s) => String(s || '').toLocaleLowerCase('tr').normalize('NFC').replace(/i̇/g, 'i')
  .replace(/[çğıöşüâîû]/g, (c) => TR[c]).replace(/[^a-z]/g, '');
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
const pick = (arr, n) => { const a = arr.slice(); const out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]); return out; };

function storeClip(g, data) {
  const mm = typeof data === 'string' && data.match(/^data:audio\/wav;base64,([A-Za-z0-9+/=]+)$/);
  if (!mm) return null;
  const buf = Buffer.from(mm[1], 'base64');
  if (buf.length < 100 || buf.length > MAX_CLIP || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  const id = crypto.randomBytes(8).toString('hex');
  g.audio.set(id, buf);
  return id;
}

/* ---------------- Tur akışı ----------------
 * pick   : söyleyen gizli kelimeyi seçer (3 öneri ya da kendi kelimesi)
 * record : söyleyen kaydeder; telefon ters çevirip SADECE ters halini yollar
 * guess  : tahmin eden ters sesi dinler, taklit eder, taklidi tersine çevrilir, tahmin eder
 * reveal : kelime açıklanır, herkes ses zincirini dinler
 */
function startGame(room, g, api) {
  g.order = api.onlinePlayers(room).map((p) => p.id);
  if (g.order.length < 2) return false;
  g.scores = {};
  for (const id of g.order) g.scores[id] = 0;
  g.status = 'playing';
  beginTurn(room, g, 0, api, true);
  api.log(`Oda ${room.code}: Tersine başladı (${g.order.length} oyuncu, ${g.settings.laps} tur)`);
  return true;
}

function beginTurn(room, g, no, api, quiet) {
  g.audio.clear();
  const n = g.order.length, total = n * g.settings.laps;
  // Bağlı olmayan söyleyenleri atla
  while (no < total && !api.isOnline(room, g.order[no % n])) no++;
  if (no >= total) {
    g.status = 'done'; g.turn = null;
    api.log(`Oda ${room.code}: Tersine bitti`);
    return quiet || api.pushState(room);
  }
  const speaker = g.order[no % n];
  let listener = null;
  for (let k = 1; k < n; k++) { const id = g.order[(no + k) % n]; if (api.isOnline(room, id)) { listener = id; break; } }
  if (!listener) listener = g.order[(no + 1) % n];
  g.turn = {
    no, speaker, listener, phase: 'pick', options: pick(WORDS[g.settings.diff] || WORDS.karisik, 3),
    word: null, rev: null, imits: [], guesses: [], tries: 0, rec: null, result: null, pts: 0,
  };
  if (!quiet) api.pushState(room);
}

function finishTurn(room, g, result, api) {
  const T = g.turn;
  T.phase = 'reveal'; T.result = result; T.rec = null;
  if (result === 'ok') {
    T.pts = POINTS[T.tries - 1] || 1;
    g.scores[T.listener] = (g.scores[T.listener] || 0) + T.pts;
    g.scores[T.speaker] = (g.scores[T.speaker] || 0) + 1;
  }
  if (!T.word) return beginTurn(room, g, T.no + 1, api); // kelime bile seçilmeden geçildiyse doğrudan sıradaki tura
  api.pushState(room);
}

module.exports = {
  id: 'tersine',
  title: 'Tersine',
  icon: '🔁',
  minPlayers: 2,

  start(room, opts, api) {
    const g = {
      status: 'playing', order: [], turn: null, audio: new Map(), scores: {},
      settings: {
        diff: DIFFS.includes(opts.diff) ? opts.diff : 'karisik',
        laps: [1, 2, 3].includes(opts.laps) ? opts.laps : 1,
      },
    };
    if (!startGame(room, g, api)) return { error: 'Başlamak için en az 2 kişi lazım' };
    return g;
  },

  stop(room, g) { g.audio.clear(); },

  // Gizli kelime sadece söyleyene gider, tur bitince herkese açılır
  snapshot(room, g, pid) {
    const T = g.turn;
    let turn = null;
    if (T) {
      const isSp = pid === T.speaker, open = T.phase === 'reveal';
      turn = {
        no: T.no, speaker: T.speaker, listener: T.listener, phase: T.phase,
        options: isSp && T.phase === 'pick' ? T.options : null,
        word: isSp || open ? T.word : null,
        len: T.word ? [...T.word].map((c) => (c === ' ' ? ' ' : '_')).join('') : null,
        rev: T.rev, imits: T.imits, guesses: T.guesses, tries: T.tries, maxTries: MAX_TRIES,
        rec: T.rec, result: T.result, pts: T.pts,
      };
    }
    return { status: g.status, settings: g.settings, total: g.order.length * g.settings.laps, order: g.order, scores: g.scores, turn };
  },

  http(room, g, rest, req, res) {
    const m = rest.match(/^a\/([a-f0-9]{16})$/);
    const clip = m && g.audio.get(m[1]);
    if (!clip) return false;
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=3600', 'Content-Length': clip.length });
    res.end(clip);
    return true;
  },

  // Oyun sürerken gelen, sıradaki turlara eklenir
  onJoin(room, g, p) {
    if (g.status === 'playing' && !g.order.includes(p.id)) { g.order.push(p.id); g.scores[p.id] = 0; }
  },

  onOffline(room, g, p) {
    if (g.turn && g.turn.rec === p.id) g.turn.rec = null;
  },

  handle(room, g, me, ws, m, api) {
    const T = g.turn;
    const isHost = room.host === me.id;
    switch (m.t) {
      case 'rematch':
        if (!isHost || g.status !== 'done') return;
        if (!startGame(room, g, api)) return api.sendTo(ws, { t: 'error', msg: 'Başlamak için en az 2 kişi lazım' });
        return api.pushState(room);

      case 'pick': {
        if (!T || T.phase !== 'pick' || T.speaker !== me.id) return;
        const w = api.clean(m.word, 24).toLocaleLowerCase('tr').replace(/\s+/g, ' ');
        if (!T.options.includes(w)) {
          if (!/^[a-zçğıöşüâîû ]+$/.test(w) || norm(w).length < 2) return api.sendTo(ws, { t: 'error', msg: 'Sadece harflerden oluşan bir kelime yaz' });
        }
        T.word = w; T.phase = 'record';
        return api.pushState(room);
      }

      case 'rec': // biri kelime mikrofonuyla kayıt yapıyor: herkeste göster
        if (!T || (T.phase === 'record' ? T.speaker : T.phase === 'guess' ? T.listener : null) !== me.id) return;
        T.rec = m.on ? me.id : null;
        return api.pushState(room);

      case 'rev': { // söyleyenin TERS çevrilmiş kaydı
        if (!T || T.phase !== 'record' || T.speaker !== me.id) return;
        const id = storeClip(g, m.audio);
        if (!id) return api.sendTo(ws, { t: 'error', msg: 'Ses kaydı gönderilemedi, tekrar dene' });
        T.rev = id; T.rec = null; T.phase = 'guess';
        return api.pushState(room);
      }

      case 'imit': { // tahmin edenin taklidi (olduğu gibi; ters çevirmeyi herkesin telefonu yapar)
        if (!T || T.phase !== 'guess' || T.listener !== me.id) return;
        const id = storeClip(g, m.audio);
        if (!id) return api.sendTo(ws, { t: 'error', msg: 'Ses kaydı gönderilemedi, tekrar dene' });
        for (const old of T.imits.splice(0, Math.max(0, T.imits.length - 2))) g.audio.delete(old.id); // son 3 deneme kalsın
        T.imits.push({ id, at: Date.now() });
        return api.pushState(room);
      }

      case 'guess': {
        if (!T || T.phase !== 'guess' || T.listener !== me.id) return;
        const text = api.clean(m.text, 30);
        const gs = norm(text), w = norm(T.word);
        if (!gs) return;
        T.tries++;
        const ok = gs === w;
        T.guesses.push({ text, ok, close: !ok && w.length >= 4 && lev(gs, w) <= 1 });
        if (ok) return finishTurn(room, g, 'ok', api);
        if (T.tries >= MAX_TRIES) return finishTurn(room, g, 'fail', api);
        return api.pushState(room);
      }

      case 'giveup':
        if (!T || T.phase !== 'guess' || T.listener !== me.id) return;
        return finishTurn(room, g, 'fail', api);

      case 'skip': // kurucu, takılan turu geçer
        if (!isHost || !T || T.phase === 'reveal') return;
        return finishTurn(room, g, 'skip', api);

      case 'next':
        if (!T || T.phase !== 'reveal') return;
        if (!isHost && me.id !== T.speaker && me.id !== T.listener) return;
        return beginTurn(room, g, T.no + 1, api);
    }
  },
};
