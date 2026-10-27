'use strict';
/*
 * 📺 Sekme Partisi
 * Yayıncı bir tarayıcı sekmesini paylaşır, herkes izler, imleçle gösterir.
 * Görüntü yayıncıdan herkese doğrudan gider; sunucu sadece kimin yayıncı
 * olduğunu, imleçleri ve işaretleri yönetir.
 */
const HOST_AWAY_MS = 30 * 1000;
const coord = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000 : null);

function setPresenter(room, g, pid, why, api) {
  if (g.presenter === pid) return;
  g.presenter = pid;
  g.shareCid = null; // yeni yayıncı kendi sekmesini seçene kadar ekran boş kalır
  api.sys(room, `${api.nameOf(room, pid)} artık yayıncı${why ? ' (' + why + ')' : ''}`);
}

module.exports = {
  id: 'w2g',
  title: 'Sekme Partisi',
  icon: '📺',
  maxPlayers: 6, // yayıncı görüntüyü herkese ayrı ayrı gönderir

  start(room) {
    return { presenter: room.host, shareCid: null, presAway: 0 };
  },

  snapshot(room, g) {
    return { presenter: g.presenter, share: g.shareCid };
  },

  handle(room, g, me, ws, m, api) {
    switch (m.t) {
      case 'share': {
        if (g.presenter !== me.id) return api.sendTo(ws, { t: 'error', msg: 'Sekmeyi yalnızca yayıncı paylaşabilir' });
        if (m.on) {
          const first = g.shareCid !== ws.cid;
          g.shareCid = ws.cid;
          if (first) api.sys(room, `${me.name} sekmesini paylaşmaya başladı`);
        } else if (g.shareCid === ws.cid) {
          g.shareCid = null;
          api.sys(room, `${me.name} paylaşımı durdurdu`);
        }
        return api.pushState(room);
      }

      case 'present': {
        // Kurucu herkesi yayıncı yapabilir; yayıncı da yayını başkasına devredebilir
        if (room.host !== me.id && g.presenter !== me.id) return;
        const target = room.players.get(m.pid);
        if (!target || !target.conns.size) return api.sendTo(ws, { t: 'error', msg: 'Bu kişi şu an salonda değil' });
        setPresenter(room, g, target.id, null, api);
        return api.pushState(room);
      }

      case 'ask': {
        // "Ben de paylaşmak istiyorum" isteği: kurucuya ve yayıncıya gider
        if (g.presenter === me.id || api.tooFast(ws, 'ask', 10000)) return;
        for (const c of api.conns(room)) if (c.pid === room.host || c.pid === g.presenter) api.sendTo(c, { t: 'ask', pid: me.id });
        return api.sendTo(ws, { t: 'notice', msg: 'İsteğin iletildi' });
      }

      case 'ptr': {
        // İmleç konumu (paylaşılan sekmeye göre 0–1 arası)
        if (!g.shareCid || api.tooFast(ws, 'ptr', 40)) return;
        return api.broadcast(room, { t: 'ptr', pid: me.id, x: coord(m.x), y: coord(m.y) }, ws);
      }

      case 'ping': {
        // Tıklayarak "şuraya bak" işareti
        if (!g.shareCid || api.tooFast(ws, 'ping', 150)) return;
        const x = coord(m.x), y = coord(m.y);
        if (x === null || y === null) return;
        return api.broadcast(room, { t: 'ping', pid: me.id, x, y });
      }

      case 'opened': {
        // Yayıncı sohbetteki linki açtı: herkese "✓ açıldı" göster
        if (g.presenter !== me.id) return;
        const msg = room.msgs.find((x) => x.id === m.id);
        if (!msg || msg.opened) return;
        msg.opened = true;
        return api.broadcast(room, { t: 'opened', id: msg.id });
      }
    }
  },

  onConnClose(room, g, ws, api) {
    if (g.shareCid === ws.cid) g.shareCid = null;
    api.broadcast(room, { t: 'ptr', pid: ws.pid, x: null, y: null }, ws);
  },

  onLeave(room, g, p, api) {
    if (g.presenter === p.id) setPresenter(room, g, room.host, 'yayıncı ayrıldı', api);
  },

  // Yayıncının bağlantısı 30 saniyeden uzun koparsa yayın kurucuya döner
  tick(room, g, now, api) {
    if (api.isOnline(room, g.presenter)) { g.presAway = 0; return false; }
    if (!g.presAway) { g.presAway = now; return false; }
    if (now - g.presAway < HOST_AWAY_MS) return false;
    g.presAway = 0;
    if (api.isOnline(room, room.host) && g.presenter !== room.host) {
      setPresenter(room, g, room.host, 'yayıncının bağlantısı koptu', api);
      return true;
    }
    return false;
  },
};
