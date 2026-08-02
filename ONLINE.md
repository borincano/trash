# MUZZ GALAXY — Online features

## 1) Global Rank — ON by default (all players)

Every client shares the **same cloud board**. No setup required.

- After each run, your best score is posted to the world leaderboard.
- Open **GLOBAL RANK** → see pilots from every device / country.
- Local cache still works offline; cloud re-syncs when online.

Default store: public JSONBlob document shared by the game build.  
Optional: paste your own **Firebase Realtime Database** URL for a permanent private board.

### Optional permanent Firebase (recommended long-term)
1. https://console.firebase.google.com → create project  
2. Build → Realtime Database → create  
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

4. Copy URL, e.g.  
   `https://YOUR-PROJECT-default-rtdb.firebaseio.com/scores.json`
5. In game: **GLOBAL RANK → paste URL → SAVE**  
   Or press **USE GLOBAL** to return to the shared world board.

## 2) VS 1v1 (internet) — ready out of the box

Uses **PeerJS / WebRTC** (public cloud). No server setup.

1. Both players open the **same game URL** (web HTTPS recommended).
2. Player A: **VS 1v1 → HOST ROOM** → share the 5-letter code.
3. Player B: enter code → **JOIN ROOM**.
4. Both press **READY**.
5. Same 60s assault seed — highest **wave objective score** wins.

**Note:** Both devices need internet. Some corporate networks block WebRTC.

## Play online
- PWA / browser: https://borincano.github.io/trash/docs/play.html  
- Promo site: https://borincano.github.io/trash/docs/promo/

## Access key
`2025`
