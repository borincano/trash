# MUZZ GALAXY — Versión iPhone / iOS

## Respuesta corta

**Sí, se puede.** Hay dos caminos:

| Opción | ¿Qué es? | ¿Sirve ya? | Requisitos |
|--------|----------|------------|------------|
| **A) PWA en Safari** | Instalar el juego en pantalla de inicio | **Sí, hoy** | iPhone + Safari + hosting HTTPS |
| **B) App nativa (.ipa)** | App real en App Store / TestFlight | Requiere **Mac + Xcode** | Cuenta Apple Developer (~99 USD/año) |

En **Windows no se puede compilar** un IPA nativo (Apple lo exige con Xcode en macOS).

---

## Opción A — PWA en iPhone (recomendado para probar ya)

El juego ya es PWA (manifest + iconos + meta Apple).

### 1. Sube `www/` a un hosting HTTPS
Ejemplos: GitHub Pages, Netlify, Vercel, Firebase Hosting.

Ejemplo con GitHub Pages (repo `trash`):
1. En el repo, copia la carpeta `www` al branch `gh-pages` o usa Actions.
2. URL tipo: `https://borincano.github.io/trash/`

### 2. En el iPhone
1. Abre la URL en **Safari** (no Chrome).
2. Botón **Compartir** → **Añadir a pantalla de inicio**.
3. Abre el icono **MUZZ GALAXY**.
4. Clave: `2025`.

Se ve y se siente casi como app (fullscreen, icono).

**Limitación PWA en iOS:** no es App Store; audio a veces pide un toque primero; notificaciones push limitadas.

---

## Opción B — App nativa iOS (Capacitor)

El proyecto ya puede incluir plataforma `ios/` (Capacitor).

### Requisitos
1. **Mac** con **Xcode** (App Store).
2. **Apple Developer Program** (para instalar en tu iPhone y TestFlight/App Store).
3. iPhone con cable USB.

### En el Mac (cuando tengas uno o un CI Mac)

```bash
cd muzz-galaxy-app
npm install
npx cap sync ios
npx cap open ios
```

En Xcode:
1. Selecciona el target **App** → Signing & Capabilities.
2. Elige tu **Team** (Apple ID / Developer).
3. Bundle ID: `com.muzzinteractive.galaxy` (o uno único tuyo).
4. Conecta el iPhone → Run ▶.

### Publicar
- **TestFlight:** Archive → Distribute → TestFlight (testers).
- **App Store:** revisión de Apple (políticas, capturas, privacidad).

### Build en la nube (sin Mac propio)
Servicios que alquilan Mac:
- [MacStadium](https://www.macstadium.com/)
- [Codemagic](https://codemagic.io/) (CI iOS)
- GitHub Actions `macos-latest` + secretos de firma

---

## ¿Qué te conviene?

| Objetivo | Elige |
|----------|--------|
| Probar ya en tu iPhone | **PWA** |
| App con icono en App Store | **Capacitor iOS + Mac + Developer** |
| Solo amigos (sin store) | TestFlight o PWA |

---

## Clave del juego
`2025`
