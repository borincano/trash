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
  const ROOM_TTL_MS = 8 * 60 * 1000; // stale rooms auto-drop from list
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
    return {
      id: id,
      code: String(fieldVal(f.code) || id || '').toUpperCase(),
      host: String(fieldVal(f.host) || 'HOST').slice(0, 12),
      diff: String(fieldVal(f.diff) || 'hard'),
      status: String(fieldVal(f.status) || 'open'),
      players: Number(fieldVal(f.players) || 1) | 0,
      ts: Number(fieldVal(f.ts) || 0),
    };
  }

  function roomToBody(room) {
    return {
      fields: {
        code: { stringValue: String(room.code || '').toUpperCase() },
        host: { stringValue: String(room.host || 'HOST').slice(0, 12) },
        diff: { stringValue: String(room.diff || 'hard') },
        status: { stringValue: String(room.status || 'open') },
        players: { integerValue: String(room.players | 0) },
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

  async function firestoreUpsertRoom(room) {
    const code = String(room.code || '').toUpperCase();
    const url = withKey(ROOMS_URL + '/' + encodeURIComponent(code), '');
    // PATCH with updateMask creates if missing on some APIs; use PATCH then POST fallback
    let res = await fetch(url + '?updateMask.fieldPaths=code&updateMask.fieldPaths=host&updateMask.fieldPaths=diff&updateMask.fieldPaths=status&updateMask.fieldPaths=players&updateMask.fieldPaths=ts', {
      method: 'PATCH',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(roomToBody(room)),
    });
    if (res.status === 404) {
      res = await fetch(withKey(ROOMS_URL + '?documentId=' + encodeURIComponent(code), ''), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(roomToBody(room)),
      });
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('Room save ' + res.status + (t ? ': ' + t.slice(0, 100) : ''));
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

    /* ───────── GLOBAL ROOM BROWSER (max 10) ───────── */
    async listRooms() {
      const now = Date.now();
      let docs = [];
      try {
        docs = await firestoreListRaw(ROOMS_URL);
        this.lastRoomsError = null;
      } catch (e) {
        this.lastRoomsError = String(e.message || e);
        return [];
      }
      const rooms = docs.map(roomFromDoc).filter(Boolean);
      const live = [];
      for (const r of rooms) {
        const age = now - (r.ts || 0);
        if (age > ROOM_TTL_MS || r.status === 'playing') {
          // purge stale / finished in background
          firestoreDeleteRoom(r.code).catch(() => {});
          continue;
        }
        if (r.status === 'open' || r.status === 'full') live.push(r);
      }
      live.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      return live.slice(0, MAX_GLOBAL_ROOMS);
    },

    async publishRoom(meta) {
      const open = await this.listRooms();
      // Don't count our own room if re-publish
      const others = open.filter((r) => r.code !== String(meta.code || '').toUpperCase());
      if (others.length >= MAX_GLOBAL_ROOMS) {
        throw new Error('GLOBAL FULL · max ' + MAX_GLOBAL_ROOMS + ' rooms');
      }
      const room = {
        code: String(meta.code || '').toUpperCase(),
        host: String(meta.host || this.myName()).slice(0, 12),
        diff: meta.diff || 'hard',
        status: meta.status || 'open',
        players: meta.players | 0 || 1,
        ts: Date.now(),
      };
      await firestoreUpsertRoom(room);
      this.publishedRoom = room;
      return room;
    },

    async setRoomStatus(code, status, players) {
      const c = String(code || this.roomCode || '').toUpperCase();
      if (!c) return;
      const room = {
        code: c,
        host: (this.publishedRoom && this.publishedRoom.host) || this.myName(),
        diff: (this.publishedRoom && this.publishedRoom.diff) || this._pendingDiff || 'hard',
        status: status || 'open',
        players: players != null ? players : status === 'full' || status === 'playing' ? 2 : 1,
        ts: (this.publishedRoom && this.publishedRoom.ts) || Date.now(),
      };
      try {
        if (status === 'playing') {
          await firestoreDeleteRoom(c); // free slot when match starts
          this.publishedRoom = null;
        } else {
          await firestoreUpsertRoom(room);
          this.publishedRoom = room;
        }
      } catch (e) {
        console.warn('setRoomStatus', e);
      }
    },

    async unpublishRoom(code) {
      const c = String(code || this.roomCode || (this.publishedRoom && this.publishedRoom.code) || '').toUpperCase();
      if (!c) return;
      try {
        await firestoreDeleteRoom(c);
      } catch (e) {}
      if (this.publishedRoom && this.publishedRoom.code === c) this.publishedRoom = null;
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
      this._matchStarted = false;
      this._helloOk = false;
      this._pendingDiff = 'hard';
      this.opp = { name: 'OPP', score: 0, waveScore: 0, lives: 3, kills: 0, ready: false, dead: false };

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
          if (this.conn && this.conn.open) {
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
      this._matchStarted = false;
      this._helloOk = false;
      this.opp = { name: 'HOST', score: 0, waveScore: 0, lives: 3, kills: 0, ready: false, dead: false };

      return new Promise((resolve, reject) => {
        this.peer = new Peer(undefined, { debug: 1 });
        let settled = false;
        const failTimer = setTimeout(() => {
          if (!settled && this.status === 'joining') reject(new Error('Room timeout — check code / internet'));
        }, 15000);
        this.peer.on('open', () => {
          const conn = this.peer.connect(PEER_PREFIX + this.roomCode, { reliable: true });
          this.conn = conn;
          conn.on('open', () => {
            this.wireConn(conn);
            this.status = 'connected';
            this.send({ t: 'hello', name: this.myName() });
            settled = true;
            clearTimeout(failTimer);
            resolve(this.roomCode);
          });
          conn.on('error', (err) => {
            if (!settled) {
              settled = true;
              clearTimeout(failTimer);
              reject(err);
            }
          });
        });
        this.peer.on('error', (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(failTimer);
            reject(err);
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

    wireConn(conn) {
      const onOpen = () => {
        this.status = 'connected';
        if (this.role === 'host') this.send({ t: 'hello', name: this.myName() });
        if (this.onConnect) this.onConnect();
        if (this.onLobby) this.onLobby();
      };
      conn.on('data', (msg) => this.handleMsg(msg));
      conn.on('close', () => {
        this.status = 'disconnected';
        this.vsActive = false;
        if (typeof Toast !== 'undefined') Toast.show('OPPONENT DISCONNECTED', 'pink');
        if (this.onDisconnect) this.onDisconnect();
      });
      conn.on('error', () => {
        this.status = 'error';
        if (this.onLobby) this.onLobby();
      });
      // Critical: wait until data channel is open (host race fix)
      if (conn.open) onOpen();
      else conn.on('open', onOpen);
    },

    /** Host starts match once (auto after hello, or manual READY) */
    beginMatch(diff) {
      if (this._matchStarted) return false;
      if (this.role !== 'host') return false;
      if (!this.conn || !this.conn.open) return false;
      this._matchStarted = true;
      this.vsActive = true;
      const seed = (Math.random() * 1e9) | 0;
      const d = diff || this._pendingDiff || 'hard';
      this.setRoomStatus(this.roomCode, 'playing', 2); // frees global slot
      this.send({ t: 'start', seed, diff: d, mode: 'survival' });
      if (this.onStart) this.onStart({ seed, diff: d, mode: 'survival' });
      return true;
    },

    handleMsg(msg) {
      if (!msg || !msg.t) return;
      switch (msg.t) {
        case 'hello':
          this.opp.name = msg.name || 'OPP';
          this._helloOk = true;
          this.send({ t: 'hello_ack', name: this.myName() });
          if (this.onLobby) this.onLobby();
          // Host: mark room full, then auto-start
          if (this.role === 'host') {
            this.setRoomStatus(this.roomCode, 'full', 2);
            setTimeout(() => {
              if (!this._matchStarted) this.beginMatch(this._pendingDiff);
            }, 700);
          }
          break;
        case 'hello_ack':
          this.opp.name = msg.name || this.opp.name;
          this._helloOk = true;
          if (this.onLobby) this.onLobby();
          break;
        case 'ready':
          this.opp.ready = true;
          if (msg.diff) this._pendingDiff = msg.diff;
          if (this.onLobby) this.onLobby();
          if (this.role === 'host' && (this.meReady || this.opp.ready)) {
            this.beginMatch(msg.diff || this._pendingDiff);
          }
          break;
        case 'start':
          if (this._matchStarted) break;
          this._matchStarted = true;
          this.vsActive = true;
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
      this._pendingDiff = diff || 'hard';
      this.send({ t: 'ready', diff: this._pendingDiff, name: this.myName() });
      if (this.role === 'host') {
        // Host can force start on READY once connected
        if (this.status === 'connected' || this.opp.ready || this._helloOk) {
          this.beginMatch(this._pendingDiff);
        }
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
      const code = this.roomCode || (this.publishedRoom && this.publishedRoom.code);
      if (code && this.role === 'host' && !this._matchStarted) {
        this.unpublishRoom(code);
      }
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
      this._matchStarted = false;
      this._helloOk = false;
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
