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

  // Permanent global board — same Firebase project as muzzsnap, isolated collections.
  const FIRESTORE_PROJECT = 'galaxymuzz';
  const FIRESTORE_COLLECTION = 'muzzgalaxy_scores';
  const FIRESTORE_ROOMS = 'muzzgalaxy_rooms';
  const FIRESTORE_PROFILES = 'muzzgalaxy_profiles';
  const MAX_GLOBAL_ROOMS = 10;
  const MAX_ROOM_PLAYERS = 4; // host + up to 3 guests — squad survival
  // Room vanishes if no host heartbeat for this long (host offline / empty)
  const ROOM_TTL_MS = 60 * 1000;
  const GLOBAL_FIRESTORE_URL =
    'https://firestore.googleapis.com/v1/projects/' +
    FIRESTORE_PROJECT +
    '/databases/(default)/documents/' +
    FIRESTORE_COLLECTION;
  const ROOMS_URL =
    'https://firestore.googleapis.com/v1/projects/' +
    FIRESTORE_PROJECT +
    '/databases/(default)/documents/' +
    FIRESTORE_ROOMS;
  const PROFILES_URL =
    'https://firestore.googleapis.com/v1/projects/' +
    FIRESTORE_PROJECT +
    '/databases/(default)/documents/' +
    FIRESTORE_PROFILES;
  const STORAGE_UID = 'muzz_device_uid_v1';

  function deviceUid() {
    try {
      let id = localStorage.getItem(STORAGE_UID);
      if (!id) {
        id =
          'u_' +
          Math.random().toString(36).slice(2, 10) +
          Date.now().toString(36) +
          Math.random().toString(36).slice(2, 8);
        localStorage.setItem(STORAGE_UID, id);
      }
      return id;
    } catch (e) {
      return 'u_local_' + String(Date.now());
    }
  }

  function cleanNick(n) {
    return String(n || '')
      .toUpperCase()
      .replace(/[^A-Z0-9_\-]/g, '')
      .slice(0, 12);
  }

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
    const mode = String(e.mode || 'endless').toLowerCase();
    return {
      name: String(e.name || 'PILOT').slice(0, 12).toUpperCase(),
      score: e.score | 0,
      wave: e.wave | 0,
      waveScore: e.waveScore | 0,
      kills: e.kills | 0,
      mode: mode,
      cat: mode === 'vs' ? 'vs' : 'survivor',
      ts: e.ts || Date.now(),
      ver: e.ver || '1.2',
    };
  }

  function betterEntry(a, b) {
    // Prefer higher score, then wave, then kills
    if (a.score !== b.score) return a.score > b.score;
    if (a.wave !== b.wave) return a.wave > b.wave;
    if (a.kills !== b.kills) return a.kills > b.kills;
    return a.ts > b.ts;
  }

  function betterBattler(a, b) {
    // VS: kills first, then score
    if (a.kills !== b.kills) return a.kills > b.kills;
    if (a.score !== b.score) return a.score > b.score;
    return a.ts > b.ts;
  }

  function mergeBoards(...lists) {
    const map = new Map();
    lists.flat().forEach((raw) => {
      const e = normalizeEntry(raw);
      if (!e) return;
      const key = e.name + '|' + e.cat + '|' + e.score + '|' + e.wave + '|' + e.ts;
      map.set(key, e);
    });
    // Best per name+category
    const best = new Map();
    [...map.values()].forEach((e) => {
      const k = e.name + '|' + e.cat;
      const prev = best.get(k);
      const win = e.cat === 'vs' ? betterBattler(e, prev || { kills: -1, score: -1, ts: 0 }) : betterEntry(e, prev || { score: -1, wave: -1, ts: 0 });
      if (!prev || win) best.set(k, e);
    });
    return [...best.values()].sort((a, b) => b.score - a.score || b.wave - a.wave || b.ts - a.ts);
  }

  function splitCategories(list) {
    const survivor = (list || [])
      .filter((e) => e.cat !== 'vs' && e.mode !== 'vs')
      .sort((a, b) => b.score - a.score || b.wave - a.wave)
      .slice(0, 10);
    const battler = (list || [])
      .filter((e) => e.cat === 'vs' || e.mode === 'vs')
      .sort((a, b) => b.kills - a.kills || b.score - a.score)
      .slice(0, 10);
    return { survivor, battler };
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
      kills: Number(fieldVal(f.kills) || 0),
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
        kills: { integerValue: String(row.kills | 0) },
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

  function roomFromDoc(doc) {
    if (!doc || !doc.fields) return null;
    const f = doc.fields;
    const id = (doc.name || '').split('/').pop();
    const code = String(fieldVal(f.code) || id || '').toUpperCase();
    const peerId = String(fieldVal(f.peerId) || PEER_PREFIX + code);
    return {
      id: id,
      code: code,
      peerId: peerId,
      host: String(fieldVal(f.host) || 'HOST').slice(0, 12),
      title: String(fieldVal(f.title) || (fieldVal(f.host) || 'SQUAD') + ' SQUAD').slice(0, 24),
      diff: String(fieldVal(f.diff) || 'hard'),
      status: String(fieldVal(f.status) || 'open'),
      players: Number(fieldVal(f.players) || 1) | 0,
      maxPlayers: Number(fieldVal(f.maxPlayers) || MAX_ROOM_PLAYERS) | 0 || MAX_ROOM_PLAYERS,
      ts: Number(fieldVal(f.ts) || 0),
    };
  }

  function roomToBody(room) {
    const code = String(room.code || '').toUpperCase();
    return {
      fields: {
        code: { stringValue: code },
        peerId: { stringValue: String(room.peerId || PEER_PREFIX + code) },
        host: { stringValue: String(room.host || 'HOST').slice(0, 12) },
        title: { stringValue: String(room.title || room.host || 'SQUAD').slice(0, 24) },
        diff: { stringValue: String(room.diff || 'hard') },
        status: { stringValue: String(room.status || 'open') },
        players: { integerValue: String(room.players | 0) },
        maxPlayers: { integerValue: String(room.maxPlayers || MAX_ROOM_PLAYERS) },
        ts: { integerValue: String(room.ts | 0) },
      },
    };
  }

  async function firestoreListRaw(url) {
    const listUrl = withKey(url.replace(/\?.*$/, '') + '?pageSize=50', '');
    const res = await fetch(listUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 404) return [];
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('Rooms GET ' + res.status + (t ? ': ' + t.slice(0, 100) : ''));
    }
    const data = await res.json();
    return data.documents || [];
  }

  const ROOM_MASK =
    '?updateMask.fieldPaths=code&updateMask.fieldPaths=peerId&updateMask.fieldPaths=host&updateMask.fieldPaths=title&updateMask.fieldPaths=diff&updateMask.fieldPaths=status&updateMask.fieldPaths=players&updateMask.fieldPaths=maxPlayers&updateMask.fieldPaths=ts';

  async function firestoreUpsertRoom(room) {
    const code = String(room.code || '').toUpperCase();
    const body = JSON.stringify(roomToBody(room));
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    // PATCH first (create-or-update style when exists), else POST
    let res = await fetch(withKey(ROOMS_URL + '/' + encodeURIComponent(code) + ROOM_MASK, ''), {
      method: 'PATCH',
      headers,
      body,
    });
    if (res.status === 404) {
      res = await fetch(withKey(ROOMS_URL + '?documentId=' + encodeURIComponent(code), ''), {
        method: 'POST',
        headers,
        body,
      });
    }
    if (res.status === 409) {
      res = await fetch(withKey(ROOMS_URL + '/' + encodeURIComponent(code) + ROOM_MASK, ''), {
        method: 'PATCH',
        headers,
        body,
      });
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('Room save ' + res.status + (t ? ': ' + t.slice(0, 120) : ''));
    }
    return true;
  }

  async function firestoreDeleteRoom(code) {
    const url = withKey(ROOMS_URL + '/' + encodeURIComponent(String(code).toUpperCase()), '');
    const res = await fetch(url, { method: 'DELETE', headers: { Accept: 'application/json' } });
    if (res.status === 404) return true;
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('Room delete ' + res.status + (t ? ': ' + t.slice(0, 80) : ''));
    }
    return true;
  }

  function profileFromDoc(doc) {
    if (!doc || !doc.fields) return null;
    const f = doc.fields;
    return {
      nick: String(fieldVal(f.nick) || '').toUpperCase(),
      uid: String(fieldVal(f.uid) || ''),
      points: Number(fieldVal(f.points) || 0) | 0,
      level: Number(fieldVal(f.level) || 1) | 0,
      rankVs: Number(fieldVal(f.rankVs) || 0) | 0,
      rankSurvivor: Number(fieldVal(f.rankSurvivor) || 0) | 0,
      bestScore: Number(fieldVal(f.bestScore) || 0) | 0,
      bestWave: Number(fieldVal(f.bestWave) || 0) | 0,
      vsKills: Number(fieldVal(f.vsKills) || 0) | 0,
      ts: Number(fieldVal(f.ts) || 0),
    };
  }

  function profileToBody(p) {
    return {
      fields: {
        nick: { stringValue: String(p.nick || '').toUpperCase() },
        uid: { stringValue: String(p.uid || '') },
        points: { integerValue: String(p.points | 0) },
        level: { integerValue: String(Math.max(1, p.level | 0)) },
        rankVs: { integerValue: String(p.rankVs | 0) },
        rankSurvivor: { integerValue: String(p.rankSurvivor | 0) },
        bestScore: { integerValue: String(p.bestScore | 0) },
        bestWave: { integerValue: String(p.bestWave | 0) },
        vsKills: { integerValue: String(p.vsKills | 0) },
        ts: { integerValue: String(p.ts || Date.now()) },
      },
    };
  }

  async function firestoreGetProfile(nick) {
    const n = cleanNick(nick);
    if (!n) return null;
    const url = withKey(PROFILES_URL + '/' + encodeURIComponent(n), '');
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('Profile GET ' + res.status + (t ? ': ' + t.slice(0, 80) : ''));
    }
    return profileFromDoc(await res.json());
  }

  async function firestoreUpsertProfile(p) {
    const n = cleanNick(p.nick);
    const url =
      PROFILES_URL +
      '/' +
      encodeURIComponent(n) +
      '?updateMask.fieldPaths=nick&updateMask.fieldPaths=uid&updateMask.fieldPaths=points&updateMask.fieldPaths=level&updateMask.fieldPaths=rankVs&updateMask.fieldPaths=rankSurvivor&updateMask.fieldPaths=bestScore&updateMask.fieldPaths=bestWave&updateMask.fieldPaths=vsKills&updateMask.fieldPaths=ts';
    let res = await fetch(withKey(url, ''), {
      method: 'PATCH',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(profileToBody(Object.assign({}, p, { nick: n }))),
    });
    if (res.status === 404) {
      res = await fetch(withKey(PROFILES_URL + '?documentId=' + encodeURIComponent(n), ''), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(profileToBody(Object.assign({}, p, { nick: n }))),
      });
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('Profile save ' + res.status + (t ? ': ' + t.slice(0, 100) : ''));
    }
    return true;
  }

  async function firestoreDeleteProfile(nick) {
    const n = cleanNick(nick);
    if (!n) return true;
    const url = withKey(PROFILES_URL + '/' + encodeURIComponent(n), '');
    const res = await fetch(url, { method: 'DELETE', headers: { Accept: 'application/json' } });
    if (res.status === 404) return true;
    if (!res.ok) throw new Error('Profile delete ' + res.status);
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
    publishedRoom: null,
    lastRoomsError: null,
    MAX_ROOMS: MAX_GLOBAL_ROOMS,
    uid: deviceUid(),
    profile: null,

    /* ───────── UNIQUE NICK + PROFILE ───────── */
    async getProfile(nick) {
      try {
        return await firestoreGetProfile(nick || (this.profile && this.profile.nick));
      } catch (e) {
        return null;
      }
    },

    async isNickAvailable(nick) {
      const n = cleanNick(nick);
      if (n.length < 3) return { ok: false, reason: 'MIN 3 CHARS' };
      if (n === 'PILOT' || n === 'OPP' || n === 'HOST') return { ok: false, reason: 'RESERVED' };
      try {
        const p = await firestoreGetProfile(n);
        if (!p) return { ok: true };
        if (p.uid === this.uid) return { ok: true, own: true };
        return { ok: false, reason: 'NICK TAKEN' };
      } catch (e) {
        return { ok: false, reason: 'OFFLINE' };
      }
    },

    /**
     * Claim unique nick for this device. Fails if taken by another uid.
     */
    async claimNick(nick, stats) {
      const n = cleanNick(nick);
      if (n.length < 3) throw new Error('Nick min 3 characters');
      if (n === 'PILOT' || n === 'OPP' || n === 'HOST') throw new Error('Nick reserved');
      const existing = await firestoreGetProfile(n);
      if (existing && existing.uid && existing.uid !== this.uid) {
        throw new Error('NICK TAKEN');
      }
      // Release previous nick if we own a different one
      const prev = this.profile && this.profile.nick;
      if (prev && prev !== n) {
        try {
          const old = await firestoreGetProfile(prev);
          if (old && old.uid === this.uid) await firestoreDeleteProfile(prev);
        } catch (e) {}
      }
      const ranks = await this.computeRanks(n);
      const body = {
        nick: n,
        uid: this.uid,
        points: (stats && stats.points) | 0,
        level: Math.max(1, (stats && stats.level) | 0 || 1),
        rankVs: ranks.rankVs,
        rankSurvivor: ranks.rankSurvivor,
        bestScore: (stats && stats.bestScore) | 0,
        bestWave: (stats && stats.bestWave) | 0,
        vsKills: (stats && stats.vsKills) | 0,
        ts: Date.now(),
      };
      // If reclaiming own nick, keep higher stats
      if (existing && existing.uid === this.uid) {
        body.points = Math.max(body.points, existing.points | 0);
        body.level = Math.max(body.level, existing.level | 0);
        body.bestScore = Math.max(body.bestScore, existing.bestScore | 0);
        body.bestWave = Math.max(body.bestWave, existing.bestWave | 0);
        body.vsKills = Math.max(body.vsKills, existing.vsKills | 0);
      }
      await firestoreUpsertProfile(body);
      this.profile = body;
      return body;
    },

    async computeRanks(nick) {
      const n = cleanNick(nick);
      let all = [];
      try {
        all = await this.fetchTop(120);
      } catch (e) {
        all = [];
      }
      const survivor = all
        .filter((e) => e.mode !== 'vs')
        .sort((a, b) => b.score - a.score || b.wave - a.wave);
      const battler = all
        .filter((e) => e.mode === 'vs')
        .sort((a, b) => b.kills - a.kills || b.score - a.score);
      const si = survivor.findIndex((e) => e.name === n);
      const vi = battler.findIndex((e) => e.name === n);
      return {
        rankSurvivor: si >= 0 ? si + 1 : 0,
        rankVs: vi >= 0 ? vi + 1 : 0,
      };
    },

    async syncProfile(stats) {
      const n = cleanNick((stats && stats.nick) || (this.profile && this.profile.nick) || '');
      if (!n || n === 'PILOT') return null;
      try {
        const existing = await firestoreGetProfile(n);
        if (existing && existing.uid && existing.uid !== this.uid) return null; // not our nick
        const ranks = await this.computeRanks(n);
        const body = {
          nick: n,
          uid: this.uid,
          points: Math.max((stats && stats.points) | 0, (existing && existing.points) | 0),
          level: Math.max(1, (stats && stats.level) | 0 || 1, (existing && existing.level) | 0),
          rankVs: ranks.rankVs,
          rankSurvivor: ranks.rankSurvivor,
          bestScore: Math.max((stats && stats.bestScore) | 0, (existing && existing.bestScore) | 0),
          bestWave: Math.max((stats && stats.bestWave) | 0, (existing && existing.bestWave) | 0),
          vsKills: Math.max((stats && stats.vsKills) | 0, (existing && existing.vsKills) | 0),
          ts: Date.now(),
        };
        await firestoreUpsertProfile(body);
        this.profile = body;
        return body;
      } catch (e) {
        console.warn('syncProfile', e);
        return null;
      }
    },

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

    async fetchCategories(limit) {
      limit = limit || 10;
      const all = await this.fetchTop(80);
      const { survivor, battler } = splitCategories(all);
      return {
        survivor: survivor.slice(0, limit),
        battler: battler.slice(0, limit),
        error: this.lastRemoteError,
      };
    },

    async submitScore(entry) {
      const row = normalizeEntry({
        name: entry.name,
        score: entry.score,
        wave: entry.wave,
        waveScore: entry.waveScore,
        kills: entry.kills,
        mode: entry.mode,
        ts: Date.now(),
        ver: '1.2',
      });
      // Allow VS posts even with low score if they have kills
      if (!row) return { ok: false, remote: false };
      if (row.score <= 0 && row.kills <= 0) return { ok: false, remote: false };

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

    /* ───────── GLOBAL ROOM BROWSER (max 10) — list only, no codes shown ───────── */
    async listRooms() {
      const now = Date.now();
      let docs = [];
      try {
        docs = await firestoreListRaw(ROOMS_URL);
        this.lastRoomsError = null;
      } catch (e) {
        this.lastRoomsError = String(e.message || e);
        console.warn('listRooms', e);
        return [];
      }
      const rooms = docs.map(roomFromDoc).filter(Boolean);
      const live = [];
      for (const r of rooms) {
        const ts = r.ts > 1e12 ? r.ts : 0;
        const age = ts ? now - ts : ROOM_TTL_MS + 1;
        // Playing, empty, or no host heartbeat for 1 min → delete
        if (r.status === 'playing' || (r.players | 0) <= 0 || age > ROOM_TTL_MS) {
          firestoreDeleteRoom(r.code).catch(() => {});
          continue;
        }
        if (r.status === 'open' || r.status === 'full' || !r.status) {
          r.players = Math.min(MAX_ROOM_PLAYERS, Math.max(1, (r.players | 0) || 1));
          r.maxPlayers = r.maxPlayers || MAX_ROOM_PLAYERS;
          r.title = r.title || r.host + ' SQUAD';
          live.push(r);
        }
      }
      live.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      return live.slice(0, MAX_GLOBAL_ROOMS);
    },

    async publishRoom(meta) {
      let open = [];
      try {
        open = await this.listRooms();
      } catch (e) {
        open = [];
      }
      const code = String(meta.code || this.roomCode || '').toUpperCase();
      if (!code) throw new Error('No room id');
      const others = open.filter((r) => r.code !== code);
      if (others.length >= MAX_GLOBAL_ROOMS) {
        throw new Error('GLOBAL FULL · max ' + MAX_GLOBAL_ROOMS + ' rooms');
      }
      const host = String(meta.host || this.myName()).slice(0, 12);
      const players = Math.min(MAX_ROOM_PLAYERS, Math.max(1, (meta.players | 0) || 1));
      const room = {
        code,
        peerId: meta.peerId || this.peerId || PEER_PREFIX + code,
        host,
        title: String(meta.title || host + ' SQUAD').slice(0, 24),
        diff: meta.diff || 'hard',
        status: players >= MAX_ROOM_PLAYERS ? 'full' : 'open',
        players,
        maxPlayers: MAX_ROOM_PLAYERS,
        ts: Date.now(),
      };
      await firestoreUpsertRoom(room);
      this.publishedRoom = room;
      this.startRoomHeartbeat();
      return room;
    },

    startRoomHeartbeat() {
      this.stopRoomHeartbeat();
      // Keep room listed only while host is online (refresh every 15s; TTL = 60s)
      this._roomBeat = setInterval(() => {
        if (!this.publishedRoom || this._matchStarted || this.role !== 'host') {
          this.stopRoomHeartbeat();
          return;
        }
        if (this.status === 'disconnected' || this.status === 'idle' || this.status === 'error') {
          this.unpublishRoom(this.roomCode);
          this.stopRoomHeartbeat();
          return;
        }
        const p = Math.max(1, this.guestCount() + 1);
        this.setRoomStatus(this.roomCode, p >= MAX_ROOM_PLAYERS ? 'full' : 'open', p);
      }, 15000);
    },

    stopRoomHeartbeat() {
      if (this._roomBeat) {
        clearInterval(this._roomBeat);
        this._roomBeat = null;
      }
    },

    async setRoomStatus(code, status, players) {
      const c = String(code || this.roomCode || '').toUpperCase();
      if (!c) return;
      const p = players != null ? players : this.guestCount() + 1;
      const prev = this.publishedRoom || {};
      const room = {
        code: c,
        peerId: prev.peerId || this.peerId || PEER_PREFIX + c,
        host: prev.host || this.myName(),
        title: prev.title || this.myName() + ' SQUAD',
        diff: prev.diff || this._pendingDiff || 'hard',
        status: status || (p >= MAX_ROOM_PLAYERS ? 'full' : 'open'),
        players: Math.min(MAX_ROOM_PLAYERS, Math.max(1, p)),
        maxPlayers: MAX_ROOM_PLAYERS,
        ts: Date.now(),
      };
      try {
        if (status === 'playing') {
          this.stopRoomHeartbeat();
          await firestoreDeleteRoom(c);
          this.publishedRoom = null;
        } else {
          await firestoreUpsertRoom(room);
          this.publishedRoom = room;
        }
      } catch (e) {
        console.warn('setRoomStatus', e);
      }
    },

    guestCount() {
      return (this.conns || []).filter((c) => c && c.open).length;
    },

    lobbyList() {
      const list = [{ id: 'host', name: this.myName(), role: 'host' }];
      (this.lobbyGuests || []).forEach((g) => list.push({ id: g.id, name: g.name, role: 'guest' }));
      return list;
    },

    async unpublishRoom(code) {
      this.stopRoomHeartbeat();
      const c = String(code || this.roomCode || (this.publishedRoom && this.publishedRoom.code) || '').toUpperCase();
      if (!c) return;
      try {
        await firestoreDeleteRoom(c);
      } catch (e) {}
      if (this.publishedRoom && this.publishedRoom.code === c) this.publishedRoom = null;
    },

    /* ───────── PEER SQUAD SURVIVAL (2–4 players) ───────── */
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

    resetLobbyState() {
      this.conns = [];
      this.lobbyGuests = [];
      this.guestInputs = {}; // id -> last input
      this._slotSeq = 0;
      this.conn = null;
      this.opp = { name: '—', score: 0, waveScore: 0, lives: 3, kills: 0, ready: false, dead: false };
      this._matchStarted = false;
      this._helloOk = false;
      this.meReady = false;
      this.lastWorld = null;
      this.lastGuestInput = { L: 0, R: 0, shoot: 0, special: 0, x: 0, y: 0, seq: 0, id: 'g0' };
    },

    peerOptions() {
      // Public PeerJS cloud — works on HTTPS (web + Capacitor)
      return {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        debug: 0,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
          ],
        },
      };
    },

    async hostRoom() {
      await this.ensurePeerScript();
      this.destroyPeer(true);
      this.resetLobbyState();
      this.role = 'host';
      this.roomCode = this.genCode();
      this.peerId = PEER_PREFIX + this.roomCode;
      this.status = 'hosting';
      this._pendingDiff = 'hard';

      return new Promise((resolve, reject) => {
        this.peer = new Peer(this.peerId, this.peerOptions());
        const failTimer = setTimeout(() => {
          if (this.status === 'hosting') {
            this.status = 'error';
            reject(new Error('Host peer timeout — check internet'));
          }
        }, 20000);
        this.peer.on('open', (id) => {
          clearTimeout(failTimer);
          this.peerId = id || this.peerId;
          this.status = 'waiting';
          resolve(this.roomCode);
        });
        this.peer.on('error', (err) => {
          clearTimeout(failTimer);
          this.status = 'error';
          reject(err);
        });
        this.peer.on('connection', (conn) => {
          if (this._matchStarted) {
            conn.close();
            return;
          }
          if (this.guestCount() >= MAX_ROOM_PLAYERS - 1) {
            try {
              conn.on('open', () => {
                try {
                  conn.send({ t: 'room_full' });
                } catch (e) {}
                setTimeout(() => conn.close(), 200);
              });
            } catch (e) {
              conn.close();
            }
            return;
          }
          this.wireHostConn(conn);
        });
      });
    },

    /** Join from room list object (preferred) or raw code/peerId */
    async joinRoom(codeOrRoom) {
      await this.ensurePeerScript();
      this.destroyPeer(true);
      this.resetLobbyState();
      this.role = 'guest';
      this.status = 'joining';

      let code = '';
      let targetPeer = '';
      if (codeOrRoom && typeof codeOrRoom === 'object') {
        code = String(codeOrRoom.code || codeOrRoom.id || '').toUpperCase();
        targetPeer = codeOrRoom.peerId || PEER_PREFIX + code;
        this._joinDiff = codeOrRoom.diff;
      } else {
        code = String(codeOrRoom || '')
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 8);
        targetPeer = PEER_PREFIX + code;
      }
      this.roomCode = code;
      if (!code || !targetPeer) throw new Error('Invalid room');

      return new Promise((resolve, reject) => {
        this.peer = new Peer(undefined, this.peerOptions());
        let settled = false;
        const failTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('Cannot join — host offline or room expired'));
          }
        }, 20000);
        this.peer.on('open', () => {
          const conn = this.peer.connect(targetPeer, { reliable: true, serialization: 'json' });
          this.conn = conn;
          conn.on('open', () => {
            this.wireGuestConn(conn);
            this.status = 'connected';
            this.send({ t: 'hello', name: this.myName() });
            if (!settled) {
              settled = true;
              clearTimeout(failTimer);
              resolve(this.roomCode);
            }
          });
          conn.on('error', (err) => {
            if (!settled) {
              settled = true;
              clearTimeout(failTimer);
              reject(err.type ? new Error('Join failed: ' + err.type) : err);
            }
          });
        });
        this.peer.on('error', (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(failTimer);
            reject(err.type ? new Error('Peer error: ' + err.type) : err);
          }
        });
      });
    },

    myName() {
      try {
        return (global.Meta && Meta.callsign) || 'PILOT';
      } catch (e) {
        return 'PILOT';
      }
    },

    wireHostConn(conn) {
      const slot = 'g' + this._slotSeq++;
      conn._muzzId = slot;
      const attach = () => {
        if (!this.conns.includes(conn)) this.conns.push(conn);
        this.status = 'connected';
        this.sendTo(conn, {
          t: 'hello_ack',
          name: this.myName(),
          id: slot,
          lobby: this.lobbyList(),
        });
        this.broadcast({ t: 'lobby', lobby: this.lobbyList() });
        this.setRoomStatus(this.roomCode, this.guestCount() + 1 >= MAX_ROOM_PLAYERS ? 'full' : 'open', this.guestCount() + 1);
        if (this.onConnect) this.onConnect();
        if (this.onLobby) this.onLobby();
      };
      conn.on('data', (msg) => this.handleMsg(msg, conn));
      conn.on('close', () => {
        this.conns = this.conns.filter((c) => c !== conn);
        this.lobbyGuests = this.lobbyGuests.filter((g) => g.id !== slot);
        delete this.guestInputs[slot];
        this.setRoomStatus(this.roomCode, 'open', this.guestCount() + 1);
        this.broadcast({ t: 'lobby', lobby: this.lobbyList() });
        if (this.onLobby) this.onLobby();
        if (!this.guestCount() && !this._matchStarted) this.status = 'waiting';
      });
      if (conn.open) attach();
      else conn.on('open', attach);
    },

    wireGuestConn(conn) {
      conn.on('data', (msg) => this.handleMsg(msg, conn));
      conn.on('close', () => {
        this.status = 'disconnected';
        this.vsActive = false;
        if (typeof Toast !== 'undefined') Toast.show('HOST DISCONNECTED', 'pink');
        if (this.onDisconnect) this.onDisconnect();
      });
      if (this.onConnect) this.onConnect();
      if (this.onLobby) this.onLobby();
    },

    sendTo(conn, obj) {
      if (conn && conn.open) {
        try {
          conn.send(obj);
        } catch (e) {}
      }
    },

    broadcast(obj) {
      (this.conns || []).forEach((c) => this.sendTo(c, obj));
      // also keep primary conn alias for first guest
      if (this.conn && this.conn.open && !(this.conns || []).includes(this.conn)) this.sendTo(this.conn, obj);
    },

    /** Host starts when ≥1 guest (2 pilots) — squad survival */
    beginMatch(diff) {
      if (this._matchStarted) return false;
      if (this.role !== 'host') return false;
      if (this.guestCount() < 1) return false;
      this._matchStarted = true;
      this.vsActive = true;
      const seed = (Math.random() * 1e9) | 0;
      const d = diff || this._pendingDiff || 'hard';
      const lobby = this.lobbyList();
      this.setRoomStatus(this.roomCode, 'playing', this.guestCount() + 1);
      this.broadcast({ t: 'start', seed, diff: d, mode: 'survival', lobby });
      if (this.onStart) this.onStart({ seed, diff: d, mode: 'survival', lobby });
      return true;
    },

    handleMsg(msg, conn) {
      if (!msg || !msg.t) return;
      switch (msg.t) {
        case 'hello':
          if (this.role === 'host' && conn) {
            const id = conn._muzzId || 'g0';
            const name = String(msg.name || 'PILOT').slice(0, 12);
            if (!this.lobbyGuests.find((g) => g.id === id)) this.lobbyGuests.push({ id, name });
            else this.lobbyGuests.forEach((g) => { if (g.id === id) g.name = name; });
            this.opp.name = this.lobbyGuests[0] ? this.lobbyGuests[0].name : name;
            this._helloOk = true;
            this.sendTo(conn, { t: 'hello_ack', name: this.myName(), id, lobby: this.lobbyList() });
            this.broadcast({ t: 'lobby', lobby: this.lobbyList() });
            this.setRoomStatus(this.roomCode, this.guestCount() + 1 >= MAX_ROOM_PLAYERS ? 'full' : 'open', this.guestCount() + 1);
            if (this.onLobby) this.onLobby();
            // Auto-start only when room is full (4) — otherwise host presses FIGHT
            if (this.guestCount() + 1 >= MAX_ROOM_PLAYERS) {
              setTimeout(() => {
                if (!this._matchStarted) this.beginMatch(this._pendingDiff);
              }, 900);
            }
          }
          break;
        case 'hello_ack':
          this.opp.name = msg.name || this.opp.name;
          this.mySlot = msg.id || this.mySlot;
          this._helloOk = true;
          if (msg.lobby) this._remoteLobby = msg.lobby;
          if (this.onLobby) this.onLobby();
          break;
        case 'lobby':
          this._remoteLobby = msg.lobby || [];
          if (this.onLobby) this.onLobby();
          break;
        case 'room_full':
          if (typeof Toast !== 'undefined') Toast.show('ROOM FULL (4)', 'pink');
          this.status = 'error';
          if (this.onLobby) this.onLobby();
          break;
        case 'ready':
          if (msg.diff) this._pendingDiff = msg.diff;
          if (this.role === 'host') {
            const id = (conn && conn._muzzId) || 'g0';
            this.lobbyGuests.forEach((g) => {
              if (g.id === id) g.ready = true;
            });
            if (this.meReady || this.guestCount() >= 1) {
              // host pressed ready earlier or guest ready with host wanting start
            }
            if (this.meReady) this.beginMatch(msg.diff || this._pendingDiff);
          }
          if (this.onLobby) this.onLobby();
          break;
        case 'start':
          if (this._matchStarted) break;
          this._matchStarted = true;
          this.vsActive = true;
          if (msg.lobby) this._remoteLobby = msg.lobby;
          if (this.onStart)
            this.onStart({ seed: msg.seed, diff: msg.diff || 'hard', mode: msg.mode || 'survival', lobby: msg.lobby });
          break;
        case 'input':
          if (this.role === 'host') {
            const id = (conn && conn._muzzId) || msg.id || 'g0';
            const inp = {
              id,
              L: !!msg.L,
              R: !!msg.R,
              shoot: !!msg.shoot,
              special: !!msg.special,
              x: +msg.x || 0,
              y: +msg.y || 0,
              seq: msg.seq | 0,
            };
            this.guestInputs[id] = inp;
            // compat: first guest also lastGuestInput
            if (!this.lobbyGuests.length || this.lobbyGuests[0].id === id) this.lastGuestInput = inp;
            if (this.onInput) this.onInput(inp);
          }
          break;
        case 'world':
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
      if (this.role === 'host') this.broadcast(obj);
      else if (this.conn && this.conn.open) {
        try {
          this.conn.send(obj);
        } catch (e) {}
      }
    },

    setReady(diff) {
      this.meReady = true;
      this._pendingDiff = diff || 'hard';
      this.send({ t: 'ready', diff: this._pendingDiff, name: this.myName() });
      if (this.role === 'host' && this.guestCount() >= 1) {
        this.beginMatch(this._pendingDiff);
      }
    },

    sendInput(input) {
      if (!this.vsActive || this.role !== 'guest') return;
      this.inputSeq = (this.inputSeq + 1) | 0;
      this.send({
        t: 'input',
        id: this.mySlot || 'g0',
        L: !!input.L,
        R: !!input.R,
        shoot: !!input.shoot,
        special: !!input.special,
        x: input.x | 0,
        y: input.y | 0,
        seq: this.inputSeq,
      });
    },

    sendWorld(world) {
      if (!this.vsActive || this.role !== 'host') return;
      this.broadcast(Object.assign({ t: 'world' }, world));
    },

    sendEvt(evt) {
      if (!this.vsActive) return;
      this.broadcast(Object.assign({ t: 'evt' }, evt));
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

    destroyPeer(skipUnpublish) {
      this.stopRoomHeartbeat();
      const code = this.roomCode || (this.publishedRoom && this.publishedRoom.code);
      if (!skipUnpublish && code && this.role === 'host' && !this._matchStarted) {
        this.unpublishRoom(code);
      }
      (this.conns || []).forEach((c) => {
        try {
          c.close();
        } catch (e) {}
      });
      try {
        if (this.conn) this.conn.close();
      } catch (e) {}
      try {
        if (this.peer) this.peer.destroy();
      } catch (e) {}
      this.conns = [];
      this.lobbyGuests = [];
      this.guestInputs = {};
      this.conn = null;
      this.peer = null;
      this.vsActive = false;
      this.status = 'idle';
      this.meReady = false;
      this._matchStarted = false;
      this._helloOk = false;
      this.lastWorld = null;
      this.lastGuestInput = { L: 0, R: 0, shoot: 0, special: 0, x: 0, y: 0, seq: 0 };
    },
  };

  Online.MAX_PLAYERS = MAX_ROOM_PLAYERS;

  global.Online = Online;
  global.MUZZ_GLOBAL_LB = GLOBAL_FIRESTORE_URL;
  global.MUZZ_FIRESTORE = {
    project: FIRESTORE_PROJECT,
    collection: FIRESTORE_COLLECTION,
    url: GLOBAL_FIRESTORE_URL,
  };
})(typeof window !== 'undefined' ? window : globalThis);
