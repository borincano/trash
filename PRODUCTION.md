# MUZZ GALAXY — Production Readiness (Studio QA)

Target quality band: **9.0 – 9.5 / 10** for live-ops mobile/web.

## Online VS (production rules)
- **2 players** same arena (host + guest)
- Score by **eliminating enemies**
- Win: **first to 10,000** OR highest score at **90s**
- Rooms: list-only join, max **10** global, idle purge **60s**
- Net: soft ONLINE detect + live peer RTT/bitrate monitor (QoS adapts sync)

## QA checklist
- [ ] Create room → appears in AVAILABLE ROOMS within ~1s
- [ ] Second device JOIN → auto or FIGHT starts race
- [ ] Both ships visible; scores climb on kills
- [ ] First to 10k ends match; else timer ends fairly
- [ ] Disconnect mid-match → remaining player wins
- [ ] Close room / leave → room removed from list
- [ ] Ranking SURVIVOR top 10 + VS RACE top 10 refresh
- [ ] PROFILE nick unique + optional wallet connect
- [ ] Mobile Safari PWA + Android WebView playable
- [ ] CHECK ONLINE shows ONLINE when cloud reachable

## Deploy surfaces
| Channel | URL / artifact |
|---------|----------------|
| Vercel (iPhone PWA) | https://muzz-galaxy.vercel.app |
| GitHub Pages | https://borincano.github.io/trash/docs/play.html |
| Android APK | `dist/MUZZ-GALAXY-debug.apk` / `D:\MUZZ-GALAXY\apk\` |

Access key: `2@26!` (not shown on marketing site)

## Non-goals (kept for later, not removed)
- Native App Store IPA (needs Mac + Apple Developer)
- Dedicated authoritative game server (current: PeerJS + Firestore rooms)
- Paid TURN fleet (public TURN fallbacks included for NAT)

## Build
```bash
npx cap sync android
powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1
npx vercel deploy www --prod --yes --scope borincanoprs-projects
```
