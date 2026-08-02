# MUZZ GALAXY — Online features

## 1) Global Rank — Firebase Firestore (permanent)

**Project:** `galaxymuzz` (same as muzzsnap)  
**Collection ONLY:** `muzzgalaxy_scores`  

Does **not** read/write:
- `social`
- `private`
- chat / other muzzsnap data

Default REST endpoint (hardcoded in game):

```
https://firestore.googleapis.com/v1/projects/galaxymuzz/databases/(default)/documents/muzzgalaxy_scores
```

### Security rules (add ONLY this block)

In Firebase Console → Firestore → **Rules**, keep your existing rules for social/private/chat and **add**:

```
match /muzzgalaxy_scores/{docId} {
  allow read: if true;
  allow create: if
    request.resource.data.keys().hasAll(['name','score','wave','ts']) &&
    request.resource.data.name is string &&
    request.resource.data.name.size() <= 12 &&
    request.resource.data.score is int &&
    request.resource.data.score >= 0 &&
    request.resource.data.score < 100000000;
  allow update, delete: if false;
}
```

Full example if you only had default deny:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // --- muzzsnap (KEEP YOUR REAL RULES) ---
    match /social/{document=**} {
      allow read, write: if request.auth != null;
    }
    match /private/{document=**} {
      allow read, write: if request.auth != null;
    }
    // --- MUZZ GALAXY rank only ---
    match /muzzgalaxy_scores/{docId} {
      allow read: if true;
      allow create: if
        request.resource.data.keys().hasAll(['name','score','wave','ts']) &&
        request.resource.data.name is string &&
        request.resource.data.name.size() <= 12 &&
        request.resource.data.score is int &&
        request.resource.data.score >= 0 &&
        request.resource.data.score < 100000000;
      allow update, delete: if false;
    }
  }
}
```

**Important:** Do not replace your whole rules file if social/private already have custom rules — only **append** the `muzzgalaxy_scores` block.

After Publish, scores appear under Data → collection `muzzgalaxy_scores`.

Works on **Spark (free)** plan.

## 2) SUPER SURVIVAL VS (internet)

**Shared arena** (not two parallel solo runs):

- Both ships on the **same screen**
- Shared alien waves (host is authority)
- **PvP**: shoot the other pilot (lives / KO)
- Win: **KO** or most **kills** when the 60s timer ends
- PeerJS / WebRTC — no Firebase needed for multiplayer

How to play:
1. Both open the same HTTPS game URL
2. Host creates room → share code
3. Guest joins → both READY
4. Fight aliens + each other

## Play
- https://borincano.github.io/trash/docs/play.html  
- Access key: `2025`
