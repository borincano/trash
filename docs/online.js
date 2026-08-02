/**
 * MUZZ GALAXY — Online layer
 * - GLOBAL leaderboard via Firebase Firestore (project galaxymuzz)
 *   Collection ONLY: muzzgalaxy_scores  (never touches social / private / chat)
 * - 1v1 VS via PeerJS (WebRTC)
 */
(function (global) {
  'use strict';

  const STORAGE_LB = 'muzz_online_board_v3';
  const STORAGE_CFG = 'muzz_online_cfg_v3';
  const PEER_PREFIX = 'muzzgal-';

  // Permanent global board — same Firebase project as muzzsnap, isolated collection.
  const FIRESTORE_PROJECT = 'galaxymuzz';
  const FIRESTORE_COLLECTION = 'muzzgalaxy_scores';
  const GLOBAL_FIRESTORE_URL =
    'https://firestore.googleapis.com/v1/projects/' +
    FIRESTORE_PROJECT +
    '/databases/(default)/documents/' +
    FIRESTORE_COLLECTION;

  // Legacy fallback (only if Firestore unreachable and user overrides)
  const GLOBAL_BLOB_ID = '019fc495-2ae7-7692-b017-27f5a2ac92ef';
  const GLOBAL_BLOB_URL = 'https://jsonblob.com/api/jsonBlob/' + GLOBAL_BLOB_ID;

  const DEFAULT_CFG = {
    leaderboardUrl: GLOBAL_FIRESTORE_URL,
    apiKey: '',
    backend: 'firestore', // firestore | rtdb | jsonblob | custom
  };

  function detectBackend(url) {
    if (!url) return 'firestore';
    if (/firestore\.googleapis\.com/i.test(url)) return 'firestore';
    if (/firebaseio\.com|firebasedatabase\.app/i.test(url)) return 'rtdb';
    if (/jsonblob\.com/i.test(url)) return 'jsonblob';
    return 'custom';
  }

  function loadCfg() {
    try {
      const c = Object.assign({}, DEFAULT_CFG, JSON.parse(localStorage.getItem(STORAGE_CFG) || '{}'));
      // Migrate old jsonblob / empty → permanent Firestore global
      if (
        !c.leaderboardUrl ||
        c.leaderboardUrl === 'local' ||
        c.leaderboardUrl === 'none' ||
        /jsonblob\.com/i.test(c.leaderboardUrl)
      ) {
        c.leaderboardUrl = GLOBAL_FIRESTORE_URL;
        c.backend = 'firestore';
      }
      c.backend = detectBackend(c.leaderboardUrl);
      return c;
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
    localStorage.setItem(STORAGE_LB, JSON.stringify((arr || []).slice(0, 150)));
  }

  function normalizeEntry(e) {
    if (!e || typeof e.score !== 'number' || isNaN(e.score)) return null;
    return {
      name: String(e.name || 'PILOT').slice(0, 12).toUpperCase(),
      score: e.score | 0,
      wave: e.wave | 0,
      waveScore: e.waveScore | 0,
      mode: e.mode || 'endless',
      ts: e.ts || Date.now(),
      ver: e.ver || '1.2',
    };
  }

  function mergeBoards(...lists) {
    const map = new Map();
    lists.flat().forEach((raw) => {
      const e = normalizeEntry(raw);
      if (!e) return;
      const key = e.name + '|' + e.score + '|' + e.wave + '|' + e.ts;
      map.set(key, e);
    });
    const bestByName = new Map();
    [...map.values()].forEach((e) => {
      const prev = bestByName.get(e.name);
      if (!prev || e.score > prev.score || (e.score === prev.score && e.wave > prev.wave)) {
        bestByName.set(e.name, e);
      }
    });
    return [...bestByName.values()].sort((a, b) => b.score - a.score || b.wave - a.wave || b.ts - a.ts);
  }

  function fieldVal(f) {
    if (!f) return undefined;
    if (f.stringValue !== undefined) return f.stringValue;
    if (f.integerValue !== undefined) return parseInt(f.integerValue, 10);
    if (f.doubleValue !== undefined) return Number(f.doubleValue);
    if (f.booleanValue !== undefined) return !!f.booleanValue;
    return undefined;
  }

  function fromFirestoreDoc(doc) {
    if (!doc || !doc.fields) return null;
    const f = doc.fields;
    return normalizeEntry({
      name: fieldVal(f.name),
      score: Number(fieldVal(f.score)),
      wave: Number(fieldVal(f.wave) || 0),
      waveScore: Number(fieldVal(f.waveScore) || 0),
      mode: fieldVal(f.mode) || 'endless',
      ts: Number(fieldVal(f.ts) || Date.now()),
      ver: fieldVal(f.ver) || '1.2',
    });
  }

  function toFirestoreBody(row) {
    return {
      fields: {
        name: { stringValue: row.name },
        score: { integerValue: String(row.score | 0) },
        wave: { integerValue: String(row.wave | 0) },
        waveScore: { integerValue: String(row.waveScore | 0) },
        mode: { stringValue: String(row.mode || 'endless') },
        ts: { integerValue: String(row.ts | 0) },
        ver: { stringValue: String(row.ver || '1.2') },
      },
    };
  }

  function withKey(url, apiKey) {
    if (!apiKey) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent(apiKey);
  }

  async function firestoreList(url, apiKey) {
    // pageSize max 300 for REST; we keep 100
    let base = url.replace(/\?.*$/, '');
    const listUrl = withKey(base + '?pageSize=100', apiKey);
    const res = await fetch(listUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 404) return []; // empty collection
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('Firestore GET ' + res.status + (t ? ': ' + t.slice(0, 120) : ''));
    }
    const data = await res.json();
    const docs = data.documents || [];
    return docs.map(fromFirestoreDoc).filter(Boolean);
  }

  async function firestoreCreate(url, apiKey, row) {
    let base = url.replace(/\?.*$/, '');
    const postUrl = withKey(base, apiKey);
    const res = await fetch(postUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(toFirestoreBody(row)),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('Firestore POST ' + res.status + (t ? ': ' + t.slice(0, 120) : ''));
    }
    return true;
  }

  async function remoteGet(url, apiKey) {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['X-Master-Key'] = apiKey;
      headers.Authorization = 'Bearer ' + apiKey;
    }
    const res = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
    if (!res.ok) throw new Error('GET ' + res.status);
    let data = await res.json();
    if (data && !Array.isArray(data)) {
      if (Array.isArray(data.record)) data = data.record;
      else if (Array.isArray(data.scores)) data = data.scores;
      else if (data.documents) return (data.documents || []).map(fromFirestoreDoc).filter(Boolean);
      else data = Object.keys(data).map((k) => Object.assign({ id: k }, data[k]));
    }
    return Array.isArray(data) ? data : [];
  }

  async function remotePutArray(url, apiKey, arr) {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['X-Master-Key'] = apiKey;
      headers.Authorization = 'Bearer ' + apiKey;
    }
    const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(arr) });
    if (!res.ok) throw new Error('PUT ' + res.status);
    return true;
  }

  async function remotePostOne(url, apiKey, row) {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['X-Master-Key'] = apiKey;
      headers.Authorization = 'Bearer ' + apiKey;
    }
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(row) });
    if (!res.ok) throw new Error('POST ' + res.status);
    return true;
  }

  const Online = {
    cfg: loadCfg(),
    peer: null,
    conn: null,
    role: null,
    roomCode: null,
    ready: false,
    vsActive: false,
    // Super Survival: shared arena PvP+PvE
    vsMode: 'survival',
    opp: { name: 'OPP', score: 0, waveScore: 0, lives: 3, kills: 0, ready: false, dead: false },
    meReady: false,
    onMsg: null,
    status: 'idle',
    lastRemoteError: null,
    // netcode buffers
    lastGuestInput: { L: 0, R: 0, shoot: 0, special: 0, x: 0, y: 0, seq: 0 },
    lastWorld: null,
    inputSeq: 0,
    _inputAcc: 0,
    _worldAcc: 0,

    /* ───────── GLOBAL LEADERBOARD (Firestore galaxymuzz) ───────── */
    async fetchTop(limit) {
      limit = limit || 50;
      const local = loadLocalBoard();
      let remote = [];
      const url = this.cfg.leaderboardUrl || GLOBAL_FIRESTORE_URL;
      const backend = detectBackend(url);
      try {
        if (backend === 'firestore') remote = await firestoreList(url, this.cfg.apiKey);
        else remote = await remoteGet(url, this.cfg.apiKey);
        this.lastRemoteError = null;
      } catch (e) {
        this.lastRemoteError = String(e.message || e);
        console.warn('Global rank GET failed', e);
      }
      const merged = mergeBoards(local, remote);
      saveLocalBoard(merged);
      return merged.slice(0, limit);
    },

    async submitScore(entry) {
      const row = normalizeEntry({
        name: entry.name,
        score: entry.score,
        wave: entry.wave,
        waveScore: entry.waveScore,
        mode: entry.mode,
        ts: Date.now(),
        ver: '1.2',
      });
      if (!row || row.score <= 0) return { ok: false, remote: false };

      const local = loadLocalBoard();
      local.push(row);
      saveLocalBoard(mergeBoards(local));

      const url = this.cfg.leaderboardUrl || GLOBAL_FIRESTORE_URL;
      const backend = detectBackend(url);
      try {
        if (backend === 'firestore') {
          await firestoreCreate(url, this.cfg.apiKey, row);
          this.lastRemoteError = null;
          return { ok: true, remote: true, row, backend: 'firestore' };
        }
        if (backend === 'rtdb') {
          await remotePostOne(url, this.cfg.apiKey, row);
          this.lastRemoteError = null;
          return { ok: true, remote: true, row, backend: 'rtdb' };
        }
        // jsonblob / custom array document
        let remote = [];
        try {
          remote = await remoteGet(url, this.cfg.apiKey);
        } catch (e) {
          remote = [];
        }
        const merged = mergeBoards(remote, local, [row]).slice(0, 100);
        await remotePutArray(url, this.cfg.apiKey, merged);
        saveLocalBoard(merged);
        this.lastRemoteError = null;
        return { ok: true, remote: true, row, backend: backend, count: merged.length };
      } catch (e) {
        this.lastRemoteError = String(e.message || e);
        console.warn('Global rank POST failed', e);
        return { ok: false, remote: true, error: this.lastRemoteError, row };
      }
    },

    setConfig(partial) {
      this.cfg = Object.assign({}, this.cfg, partial);
      if (!this.cfg.leaderboardUrl) this.cfg.leaderboardUrl = GLOBAL_FIRESTORE_URL;
      this.cfg.backend = detectBackend(this.cfg.leaderboardUrl);
      saveCfg(this.cfg);
    },

    resetToGlobalDefault() {
      this.cfg = Object.assign({}, DEFAULT_CFG);
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
          if (this.status === 'joining') reject(new Error('Room timeout — check code / internet'));
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
      if (this.role === 'host') this.send({ t: 'hello', name: this.myName() });
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
            const diff = msg.diff || 'hard';
            this.send({ t: 'start', seed, diff, mode: 'survival' });
            if (this.onStart) this.onStart({ seed, diff, mode: 'survival' });
          }
          break;
        case 'start':
          if (this.onStart) this.onStart({ seed: msg.seed, diff: msg.diff || 'hard', mode: msg.mode || 'survival' });
          break;
        case 'input':
          // Host receives guest controls
          if (this.role === 'host') {
            this.lastGuestInput = {
              L: !!msg.L,
              R: !!msg.R,
              shoot: !!msg.shoot,
              special: !!msg.special,
              x: +msg.x || 0,
              y: +msg.y || 0,
              seq: msg.seq | 0,
            };
            if (this.onInput) this.onInput(this.lastGuestInput);
          }
          break;
        case 'world':
          // Guest receives authoritative arena
          if (this.role === 'guest') {
            this.lastWorld = msg;
            if (msg.me) {
              this.opp.score = msg.me.score | 0;
              this.opp.waveScore = msg.me.waveScore | 0;
              this.opp.lives = msg.me.lives | 0;
              this.opp.kills = msg.me.kills | 0;
              this.opp.dead = !!msg.me.dead;
              this.opp.name = msg.me.name || this.opp.name;
            }
            if (this.onWorld) this.onWorld(msg);
          }
          break;
        case 'evt':
          if (this.onEvt) this.onEvt(msg);
          break;
        case 'sync':
          // legacy thin sync (keep for safety)
          this.opp.score = msg.score | 0;
          this.opp.waveScore = msg.waveScore | 0;
          this.opp.lives = msg.lives | 0;
          this.opp.dead = !!msg.dead;
          if (this.onSync) this.onSync(this.opp);
          break;
        case 'end':
          this.opp.score = msg.score | 0;
          this.opp.waveScore = msg.waveScore | 0;
          this.opp.kills = msg.kills | 0;
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
      if (this.role === 'host' && this.opp.ready) {
        const seed = (Math.random() * 1e9) | 0;
        this.send({ t: 'start', seed, diff: diff || 'hard', mode: 'survival' });
        if (this.onStart) this.onStart({ seed, diff: diff || 'hard', mode: 'survival' });
      }
    },

    /** Guest → Host controls (~20 Hz) */
    sendInput(input) {
      if (!this.vsActive || this.role !== 'guest') return;
      this.inputSeq = (this.inputSeq + 1) | 0;
      this.send({
        t: 'input',
        L: !!input.L,
        R: !!input.R,
        shoot: !!input.shoot,
        special: !!input.special,
        x: input.x | 0,
        y: input.y | 0,
        seq: this.inputSeq,
      });
    },

    /** Host → Guest full arena snapshot (~15–20 Hz) */
    sendWorld(world) {
      if (!this.vsActive || this.role !== 'host') return;
      this.send(Object.assign({ t: 'world' }, world));
    },

    sendEvt(evt) {
      if (!this.vsActive) return;
      this.send(Object.assign({ t: 'evt' }, evt));
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
        kills: state.kills | 0,
        pvpHits: state.pvpHits | 0,
        name: this.myName(),
        result: state.result || '',
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
      this.meReady = false;
      this.lastWorld = null;
      this.lastGuestInput = { L: 0, R: 0, shoot: 0, special: 0, x: 0, y: 0, seq: 0 };
    },
  };

  global.Online = Online;
  global.MUZZ_GLOBAL_LB = GLOBAL_FIRESTORE_URL;
  global.MUZZ_FIRESTORE = {
    project: FIRESTORE_PROJECT,
    collection: FIRESTORE_COLLECTION,
    url: GLOBAL_FIRESTORE_URL,
  };
})(typeof window !== 'undefined' ? window : globalThis);
