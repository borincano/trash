# MUZZ GALAXY — App package

Premium mobile shooter (HTML + Android + iOS path).

## iPhone / iOS

**Sí es posible.** Ver guía completa: [IOS.md](./IOS.md)

| Ruta | Notas |
|------|--------|
| **PWA (Safari)** | Funciona ya — Añadir a pantalla de inicio |
| **App nativa (.ipa)** | Requiere **Mac + Xcode** + Apple Developer |

Instrucciones rápidas iPhone: `www/ios-install.html`

## Descargar APK (GitHub)

**No subas el APK dentro del código.** Usa **Releases**:

1. Publica el repo en GitHub  
2. **Releases → Create a new release**  
3. Tag: `v1.0.0`  
4. Adjunta `MUZZ-GALAXY-debug.apk` del Escritorio  
5. Publish  

Guía paso a paso: [COMO-SUBIR-APK-GITHUB.md](./COMO-SUBIR-APK-GITHUB.md)

Si GitHub te bloquea el APK en el código, es normal: el sitio de descarga es **Releases**, no la carpeta de archivos.

## Desktop (HTML)

**Opción A — doble clic (rápido):**

Abre:

`www\index.html`

**Opción B — servidor local (recomendado, PWA + icono):**

```powershell
cd "C:\Users\borin\OneDrive\Desktop\muzz-galaxy-app"
npm run desktop
```

Luego ve a: http://localhost:5173  
Clave: `2025`

En Chrome: menú → **Instalar MUZZ GALAXY** (PWA).

## Iconos

- Web/PWA: `www/icons/`
- Master: `icons/icon-512.png`, `icons/icon-1024.png`
- Android: `android/app/src/main/res/mipmap-*/`

Regenerar:

```powershell
npm run icons
node scripts/apply-android-icons.mjs
```

## Android APK

### Requisitos
- JDK 17+ (ya se puede instalar con `winget install Microsoft.OpenJDK.17`)
- Android SDK (Android Studio o command-line tools)

### Build automático

```powershell
cd "C:\Users\borin\OneDrive\Desktop\muzz-galaxy-app"
npm run apk:debug
```

El APK sale en:
- `dist\MUZZ-GALAXY-debug.apk`
- Escritorio: `MUZZ-GALAXY-debug.apk`

### Instalar en el teléfono
1. Activa **Opciones de desarrollador** + **Depuración USB**
2. Conecta el USB
3. `adb install -r dist\MUZZ-GALAXY-debug.apk`

O copia el APK al teléfono y ábrelo (permite “orígenes desconocidos”).

### Build con Android Studio
```powershell
npx cap open android
```
Build → Build Bundle(s) / APK(s) → Build APK(s)

## Package ID
`com.muzzinteractive.galaxy`

## Jugar en iPhone / Web (GitHub Pages)

**URL del juego:** https://borincano.github.io/trash/

- Jugar: https://borincano.github.io/trash/play.html
- Instalar iPhone: https://borincano.github.io/trash/ios-install.html
- APK Android: [download/MUZZ-GALAXY-debug.apk](./download/MUZZ-GALAXY-debug.apk)

### Activar GitHub Pages (solo una vez)
Si el link no abre:
1. Repo **Settings** ? **Pages**
2. Source: **Deploy from a branch**
3. Branch: **gh-pages** / folder **/** (root)
4. Save

Clave del juego: `2025`
