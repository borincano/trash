# MUZZ GALAXY — Online features

## What works now

### 1) VS 1v1 (internet) — ready out of the box
Uses **PeerJS / WebRTC** (public cloud). No server setup.

1. Both players open the **same game URL** (web HTTPS recommended).
2. Player A: **VS 1v1 → HOST ROOM** → share the 5-letter code.
3. Player B: enter code → **JOIN ROOM**.
4. Both press **READY**.
5. Same 60s assault seed — highest **wave objective score** wins.

**Note:** Both devices need internet. Some corporate networks block WebRTC.

### 2) Global Rank
- Every run **submits** to the local online cache.
- With a free backend URL, scores sync **across all players**.

#### Free Firebase setup (2 minutes)
1. https://console.firebase.google.com → create project  
2. Build → Realtime Database → create (test mode for 30 days or locked rules below)  
3. Rules:

```json
{
  "rules": {
    "scores": {
      ".read": true,
      ".write": true
    }
  }
}
```

4. Copy database URL, e.g.  
   `https://YOUR-PROJECT-default-rtdb.firebaseio.com/scores.json`
5. In game: **GLOBAL RANK → paste URL → SAVE**

#### Free Cloudflare Worker (optional, more control)
Deploy a tiny worker that stores scores in KV; paste its `/scores` URL in the same field.

## Access key
`2025`
