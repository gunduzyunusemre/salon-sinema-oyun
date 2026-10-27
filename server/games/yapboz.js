'use strict';
/*
 * 🧩 Yapboz Düellosu
 * Kurucu bir resim seçer, herkes aynı tahtada aynı anda parça yerleştirir.
 * Sunucu hakemdir: bir parçayı ilk doğru yere koyan puanı alır. Yanlış yere
 * bırakan 1,5 saniye bekler.
 */
const MAX_IMG = 3 * 1024 * 1024;
const PENALTY_MS = 1500;
const clampInt = (v, lo, hi, d) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d);
const coord = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(Math.max(-0.5, Math.min(1.5, v)) * 1000) / 1000 : null);
const newSeed = () => Math.floor(Math.random() * 2147483647);

function stat(g, pid) {
  if (!g.stats[pid]) g.stats[pid] = { score: 0, miss: 0, frozenUntil: 0 };
  return g.stats[pid];
}

module.exports = {
  id: 'yapboz',
  title: 'Yapboz Düellosu',
  icon: '🧩',

  start(room, opts) {
    const mm = typeof opts.img === 'string' && opts.img.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!mm) return { error: 'Resim okunamadı' };
    const img = Buffer.from(mm[2], 'base64');
    if (!img.length || img.length > MAX_IMG) return { error: 'Resim çok büyük' };
    const cols = clampInt(opts.cols, 2, 24, 4), rows = clampInt(opts.rows, 2, 24, 3);
    return {
      status: 'playing', cols, rows, seed: newSeed(), ver: 1, startedAt: Date.now(), finishedAt: 0,
      img, imgType: mm[1], placed: new Map(), holds: new Map(), holdsDirty: false, stats: {},
    };
  },

  snapshot(room, g) {
    const stats = {};
    for (const id in g.stats) stats[id] = { score: g.stats[id].score, miss: g.stats[id].miss };
    return {
      status: g.status, cols: g.cols, rows: g.rows, seed: g.seed, ver: g.ver,
      startedAt: g.startedAt, finishedAt: g.finishedAt, placed: [...g.placed.entries()], stats,
    };
  },

  http(room, g, rest, req, res) {
    if (rest !== 'image') return false;
    res.writeHead(200, { 'Content-Type': g.imgType, 'Cache-Control': 'no-store', 'Content-Length': g.img.length });
    res.end(g.img);
    return true;
  },

  onOffline(room, g, p) {
    if (g.holds.delete(p.id)) g.holdsDirty = true;
  },

  // "Kim hangi parçayı tutuyor" bilgisini toplu gönder (saniyede ~16 kez)
  fastTick(room, g, api) {
    if (!g.holdsDirty) return;
    g.holdsDirty = false;
    api.broadcast(room, { t: 'holds', list: [...g.holds.values()] });
  },

  handle(room, g, me, ws, m, api) {
    switch (m.t) {
      case 'rematch':
        if (room.host !== me.id || g.status !== 'done') return;
        g.seed = newSeed(); g.ver++;
        g.placed.clear(); g.holds.clear(); g.stats = {};
        g.status = 'playing'; g.startedAt = Date.now(); g.finishedAt = 0;
        api.log(`Oda ${room.code}: yapboz rövanşı`);
        return api.pushState(room);

      case 'hold': {
        if (g.status !== 'playing') return;
        const total = g.cols * g.rows;
        const pid = Number.isInteger(m.pid) && m.pid >= 0 && m.pid < total && !g.placed.has(m.pid) ? m.pid : null;
        if (pid === null) g.holds.delete(me.id);
        else g.holds.set(me.id, [me.id, pid, coord(m.hx), coord(m.hy)]);
        g.holdsDirty = true;
        return;
      }

      case 'place': {
        if (g.status !== 'playing') return;
        const total = g.cols * g.rows, pid = m.pid;
        if (!Number.isInteger(pid) || pid < 0 || pid >= total) return;
        const now = Date.now();
        const st = stat(g, me.id);
        if (now < st.frozenUntil) return api.sendTo(ws, { t: 'frozen', ms: st.frozenUntil - now });
        if (g.holds.delete(me.id)) g.holdsDirty = true;
        // Başkası daha önce koyduysa: kaybedene sonucu bildir
        if (g.placed.has(pid)) return api.sendTo(ws, { t: 'placed', pid, by: g.placed.get(pid) });
        const ok = Number.isInteger(m.r) && Number.isInteger(m.c) && m.c >= 0 && m.c < g.cols && m.r * g.cols + m.c === pid;
        if (!ok) {
          st.miss++;
          st.frozenUntil = now + PENALTY_MS;
          return api.sendTo(ws, { t: 'wrong', ms: PENALTY_MS });
        }
        g.placed.set(pid, me.id);
        st.score++;
        for (const [k, h] of g.holds) if (h[1] === pid) { g.holds.delete(k); g.holdsDirty = true; }
        api.broadcast(room, { t: 'placed', pid, by: me.id });
        if (g.placed.size >= total) {
          g.status = 'done';
          g.finishedAt = now;
          api.log(`Oda ${room.code}: yapboz bitti`);
          api.pushState(room);
        }
        return;
      }
    }
  },
};
