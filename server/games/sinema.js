'use strict';
/*
 * 🎬 Sinema
 * Herkes 3B bir sinema salonunda kendi karakteriyle dolaşır, koltuklara oturur.
 * Yayıncı bir sekme paylaşır, görüntü perdede oynar. Kamerası açık olanların
 * yüzü karakterin yüzüne geçer: yüz tespiti her kişinin kendi cihazında yapılır,
 * sunucudan yalnızca yüzün kameradaki yeri (kutu) geçer.
 *
 * Paylaşım, yayıncı değiştirme ve "sıra iste" kuralları Sekme Partisi ile aynıdır.
 */
const w2g = require('./w2g');

const SEATS = 24;             // 3 sıra × 8 koltuk (istemcideki yerleşimle aynı)
const LM_LEN = 142;         // 71 yüz noktası × (x, y), istemcideki listeyle aynı
const BOUNDS = { x: 6.6, zMin: -6.4, zMax: 9.4 };
const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.round(Math.max(lo, Math.min(hi, v)) * 100) / 100 : null);

function seatOf(g, pid) {
  for (const k in g.seats) if (g.seats[k] === pid) return +k;
  return -1;
}

module.exports = {
  id: 'sinema',
  title: 'Sinema',
  icon: '🎬',
  maxPlayers: 8, // perdedeki görüntü yayıncıdan herkese ayrı ayrı gider

  start(room) {
    return {
      presenter: room.host, shareCid: null, presAway: 0,
      seats: {},   // koltuk no → kişi
      pos: {},     // kişi → {x, z, r, w}
      face: {},    // kişi → {lm: [...]} yüz noktaları ya da {b: [x, y, w, h]} kutu (kamera görüntüsünde, 0–1)
    };
  },

  snapshot(room, g, pid, api) {
    const seats = {}, pos = {}, face = {};
    for (const k in g.seats) if (api.isOnline(room, g.seats[k])) seats[g.seats[k]] = +k;
    for (const id in g.pos) if (api.isOnline(room, id)) pos[id] = g.pos[id];
    for (const id in g.face) if (api.isOnline(room, id)) face[id] = g.face[id];
    return { presenter: g.presenter, share: g.shareCid, seats, pos, face, seatCount: SEATS };
  },

  handle(room, g, me, ws, m, api) {
    switch (m.t) {
      case 'share': case 'present': case 'ask':
        return w2g.handle(room, g, me, ws, m, api);

      case 'pos': {
        // Karakterin yeri: sık gelir, sadece diğerlerine iletilir
        if (api.tooFast(ws, 'pos', 50)) return;
        const x = num(m.x, -BOUNDS.x, BOUNDS.x), z = num(m.z, BOUNDS.zMin, BOUNDS.zMax), r = num(m.r, -10, 10);
        if (x === null || z === null || r === null) return;
        const p = { x, z, r, w: m.w ? 1 : 0 };
        g.pos[me.id] = p;
        return api.broadcast(room, { t: 'pos', pid: me.id, ...p }, ws);
      }

      case 'face': {
        // Yüzün kameradaki yeri: ya yüz noktaları (lm, binde bir birimle tam sayı) ya da kutu (b)
        if (api.tooFast(ws, 'face', 100)) return;
        let f = null;
        if (Array.isArray(m.lm) && m.lm.length === LM_LEN && m.lm.every((v) => Number.isInteger(v) && v >= -300 && v <= 1300)) {
          f = { lm: m.lm };
        } else if (Array.isArray(m.b) && m.b.length === 4) {
          const b = m.b.map((v) => num(v, 0, 1));
          if (!b.some((v) => v === null) && b[2] >= 0.02 && b[3] >= 0.02) f = { b };
        }
        if (f) g.face[me.id] = f; else delete g.face[me.id];
        return api.broadcast(room, { t: 'face', pid: me.id, ...(f || {}) }, ws);
      }

      case 'sit': {
        const s = parseInt(m.seat, 10);
        if (!(s >= 0 && s < SEATS)) return;
        const owner = g.seats[s];
        if (owner && owner !== me.id && api.isOnline(room, owner)) return api.sendTo(ws, { t: 'error', msg: 'Bu koltuk dolu' });
        const old = seatOf(g, me.id);
        if (old >= 0) delete g.seats[old];
        g.seats[s] = me.id;
        return api.pushState(room);
      }

      case 'stand': {
        const old = seatOf(g, me.id);
        if (old < 0) return;
        delete g.seats[old];
        return api.pushState(room);
      }
    }
  },

  onConnClose(room, g, ws) {
    if (g.shareCid === ws.cid) g.shareCid = null;
  },

  onLeave(room, g, p, api) {
    const old = seatOf(g, p.id);
    if (old >= 0) delete g.seats[old];
    delete g.pos[p.id];
    delete g.face[p.id];
    w2g.onLeave(room, g, p, api);
  },

  tick(room, g, now, api) {
    return w2g.tick(room, g, now, api);
  },
};
