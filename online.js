/**
 * MUZZ GALAXY — Online layer
 * - Global leaderboard (free JSONBin-compatible / Firebase REST / local fallback)
 * - 1v1 VS via PeerJS (WebRTC over internet)
 */
(function (global) {
  'use strict';

  const STORAGE_LB = 'muzz_online_board_v1';
  const STORAGE_CFG = 'muzz_online_cfg_v1';
  const PEER_PREFIX = 'muzzgal-';

  // Default free backend: public JSON via free "jsonblob" style OR custom endpoint.
  // Users can set their own in Settings. Fallback merges local + optional remote.
  const DEFAULT_CFG = {
    // Optional: full URL that accepts GET (array) and POST (score object)
    // Example Firebase: https://YOUR.firebaseio.com/scores.json
    // Example custom worker: https://muzz-scores.you.workers.dev/scores
    leaderboardUrl: '',
    // Optional API key header
    apiKey: '',
  };

  function loadCfg() {
    try {
      return Object.assign({}, DEFAULT_CFG, JSON.parse(localStorage.getItem(STORAGE_CFG) || '{}'));
    } catch (e) {
      return Object.assign({}, DEFAULT_CFG);
    }
  }
  function saveCfg(c) {
    localStorage.setItem(STORAGE_CFG, JSON.stringify(c));
  }

  function loadLocalBoard() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_LB) || '[]');
    } catch (e) {
      return [];
    }
  }
  function saveLocalBoard(arr) {
    localStorage.setItem(STORAGE_LB, JSON.stringify(arr.slice(0, 100)));
  }

  const Online = {
    cfg: loadCfg(),
    peer: null,
    conn: null,
    role: null, // 'host' | 'guest'
    roomCode: null,
    ready: false,
    vsActive: false,
    opp: { name: 'OPP', score: 0, waveScore: 0, lives: 3, ready: false, dead: false },
    meReady: false,
    onMsg: null,
    status: 'idle',

    /* ───────── LEADERBOARD ───────── */
    async fetchTop(limit = 25) {
      const local = loadLocalBoard();
      let remote = [];
      const url = this.cfg.leaderboardUrl;
      if (url) {
        try {
          const headers = { Accept: 'application/json' };
          if (this.cfg.apiKey) headers['X-Master-Key'] = this.cfg.apiKey;
          if (this.cfg.apiKey) headers['Authorization'] = 'Bearer ' + this.cfg.apiKey;
          const res = await fetch(url, { headers, cache: 'no-store' });
          if (res.ok) {
            let data = await res.json();
            // Firebase returns object map
            if (data && !Array.isArray(data)) {
              remote = Object.keys(data).map((k) => Object.assign({ id: k }, data[k]));
            } else if (Array.isArray(data)) {
              remote = data;
            } else if (data && Array.isArray(data.record)) {
              remote = data.record;
            } else if (data && Array.isArray(data.scores)) {
              remote = data.scores;
            }
          }
        } catch (e) {
          console.warn('Leaderboard fetch failed', e);
        }
      }
      const map = new Map();
      [...local, ...remote].forEach((e) => {
        if (!e || typeof e.score !== 'number') return;
        const key = (e.name || 'PILOT') + '|' + e.score + '|' + (e.wave || 0) + '|' + (e.ts || 0);
        map.set(key, {
          name: String(e.name || 'PILOT').slice(0, 12).toUpperCase(),
          score: e.score | 0,
          wave: e.wave | 0,
          waveScore: e.waveScore | 0,
          mode: e.mode || 'endless',
          country: e.country || '',
          ts: e.ts || Date.now(),
        });
      });
      return [...map.values()].sort((a, b) => b.score - a.score || b.wave - a.wave).slice(0, limit);
    },

    async submitScore(entry) {
      const row = {
        name: String(entry.name || 'PILOT').slice(0, 12).toUpperCase(),
        score: entry.score | 0,
        wave: entry.wave | 0,
        waveScore: entry.waveScore | 0,
        mode: entry.mode || 'endless',
        ts: Date.now(),
        ver: '1.1',
      };
      const local = loadLocalBoard();
      local.push(row);
      saveLocalBoard(local.sort((a, b) => b.score - a.score).slice(0, 100));

      const url = this.cfg.leaderboardUrl;
      if (!url) return { ok: true, remote: false, row };
      try {
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (this.cfg.apiKey) {
          headers['X-Master-Key'] = this.cfg.apiKey;
          headers['Authorization'] = 'Bearer ' + this.cfg.apiKey;
        }
        // Firebase push: POST to collection.json
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(row) });
        return { ok: res.ok, remote: true, status: res.status, row };
      } catch (e) {
        return { ok: false, remote: true, error: String(e), row };
      }
    },

    setConfig(partial) {
      this.cfg = Object.assign({}, this.cfg, partial);
      saveCfg(this.cfg);
    },

    /* ───────── PEER VS ───────── */
    ensurePeerScript() {
      return new Promise((resolve, reject) => {
        if (global.Peer) return resolve();
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('PeerJS load failed'));
        document.head.appendChild(s);
      });
    },

    genCode() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let c = '';
      for (let i = 0; i < 5; i++) c += chars[(Math.random() * chars.length) | 0];
      return c;
    },

    async hostRoom() {
      await this.ensurePeerScript();
      this.destroyPeer();
      this.role = 'host';
      this.roomCode = this.genCode();
      this.status = 'hosting';
      this.ready = false;
      this.meReady = false;
      this.opp = { name: 'OPP', score: 0, waveScore: 0, lives: 3, ready: false, dead: false };

      return new Promise((resolve, reject) => {
        const id = PEER_PREFIX + this.roomCode;
        this.peer = new Peer(id, { debug: 1 });
        this.peer.on('open', () => {
          this.status = 'waiting';
          resolve(this.roomCode);
        });
        this.peer.on('error', (err) => {
          this.status = 'error';
          reject(err);
        });
        this.peer.on('connection', (conn) => {
          if (this.conn) {
            conn.close();
            return;
          }
          this.conn = conn;
          this.wireConn(conn);
        });
      });
    },

    async joinRoom(code) {
      await this.ensurePeerScript();
      this.destroyPeer();
      this.role = 'guest';
      this.roomCode = String(code || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6);
      this.status = 'joining';
      this.ready = false;
      this.meReady = false;
      this.opp = { name: 'HOST', score: 0, waveScore: 0, lives: 3, ready: false, dead: false };

      return new Promise((resolve, reject) => {
        this.peer = new Peer(undefined, { debug: 1 });
        this.peer.on('open', () => {
          const conn = this.peer.connect(PEER_PREFIX + this.roomCode, { reliable: true });
          this.conn = conn;
          conn.on('open', () => {
            this.wireConn(conn);
            this.status = 'connected';
            this.send({ t: 'hello', name: this.myName() });
            resolve(this.roomCode);
          });
          conn.on('error', reject);
        });
        this.peer.on('error', reject);
        setTimeout(() => {
          if (this.status === 'joining') reject(new Error('Room timeout'));
        }, 15000);
      });
    },

    myName() {
      try {
        return (global.Meta && Meta.callsign) || 'PILOT';
      } catch (e) {
        return 'PILOT';
      }
    },

    wireConn(conn) {
      this.status = 'connected';
      conn.on('data', (msg) => this.handleMsg(msg));
      conn.on('close', () => {
        this.status = 'disconnected';
        this.vsActive = false;
        if (typeof Toast !== 'undefined') Toast.show('OPPONENT DISCONNECTED', 'pink');
        if (this.onDisconnect) this.onDisconnect();
      });
      if (this.role === 'host') {
        this.send({ t: 'hello', name: this.myName() });
      }
      if (this.onConnect) this.onConnect();
    },

    handleMsg(msg) {
      if (!msg || !msg.t) return;
      switch (msg.t) {
        case 'hello':
          this.opp.name = msg.name || 'OPP';
          this.send({ t: 'hello_ack', name: this.myName() });
          if (this.onLobby) this.onLobby();
          break;
        case 'hello_ack':
          this.opp.name = msg.name || this.opp.name;
          if (this.onLobby) this.onLobby();
          break;
        case 'ready':
          this.opp.ready = true;
          if (this.onLobby) this.onLobby();
          if (this.role === 'host' && this.meReady && this.opp.ready) {
            const seed = (Math.random() * 1e9) | 0;
            this.send({ t: 'start', seed, diff: msg.diff || 'hard' });
            if (this.onStart) this.onStart({ seed, diff: msg.diff || 'hard' });
          }
          break;
        case 'start':
          if (this.onStart) this.onStart({ seed: msg.seed, diff: msg.diff || 'hard' });
          break;
        case 'sync':
          this.opp.score = msg.score | 0;
          this.opp.waveScore = msg.waveScore | 0;
          this.opp.lives = msg.lives | 0;
          this.opp.dead = !!msg.dead;
          if (this.onSync) this.onSync(this.opp);
          break;
        case 'end':
          this.opp.score = msg.score | 0;
          this.opp.waveScore = msg.waveScore | 0;
          this.opp.dead = true;
          if (this.onOppEnd) this.onOppEnd(msg);
          break;
        default:
          break;
      }
      if (this.onMsg) this.onMsg(msg);
    },

    send(obj) {
      if (this.conn && this.conn.open) {
        try {
          this.conn.send(obj);
        } catch (e) {}
      }
    },

    setReady(diff) {
      this.meReady = true;
      this.send({ t: 'ready', diff: diff || 'hard', name: this.myName() });
      // host starts when both ready
      if (this.role === 'host' && this.opp.ready) {
        const seed = (Math.random() * 1e9) | 0;
        this.send({ t: 'start', seed, diff: diff || 'hard' });
        if (this.onStart) this.onStart({ seed, diff: diff || 'hard' });
      }
    },

    syncState(state) {
      if (!this.vsActive) return;
      this.send({
        t: 'sync',
        score: state.score | 0,
        waveScore: state.waveScore | 0,
        lives: state.lives | 0,
        dead: !!state.dead,
      });
    },

    sendEnd(state) {
      this.send({
        t: 'end',
        score: state.score | 0,
        waveScore: state.waveScore | 0,
        name: this.myName(),
      });
    },

    destroyPeer() {
      try {
        if (this.conn) this.conn.close();
      } catch (e) {}
      try {
        if (this.peer) this.peer.destroy();
      } catch (e) {}
      this.conn = null;
      this.peer = null;
      this.vsActive = false;
      this.status = 'idle';
    },
  };

  global.Online = Online;
})(typeof window !== 'undefined' ? window : globalThis);
