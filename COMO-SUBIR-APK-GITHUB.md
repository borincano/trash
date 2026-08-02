# Cómo publicar el APK en GitHub (y por qué “no deja”)

## Por qué GitHub “no deja” el APK

| Método | Límite / problema |
|--------|-------------------|
| Arrastrar APK a la carpeta del **código** (web) | GitHub no está pensado para binarios; a veces falla o avisa |
| `git add` + `git push` del APK | Funciona si es &lt; 100 MB, pero **no es la forma correcta** de distribuir apps |
| **GitHub Releases** (recomendado) | Hasta **2 GB** por archivo — **sí permite APK** |

Tu APK pesa ~**6 MB** → en **Releases** no hay problema de tamaño.

---

## Método correcto: GitHub Releases (descarga pública)

### 1. Crear el repositorio
1. Entra a https://github.com/new  
2. Nombre: `muzz-galaxy` (o el que quieras)  
3. Público  
4. **No** marques “Add README” si ya vas a subir este proyecto  
5. Create repository  

### 2. Subir el código (sin el APK dentro del git)

Abre PowerShell:

```powershell
cd "C:\Users\borin\OneDrive\Desktop\muzz-galaxy-app"

git init
git add .
git commit -m "MUZZ GALAXY commercial edition + Android project"

git branch -M main
git remote add origin https://github.com/TU_USUARIO/muzz-galaxy.git
git push -u origin main
```

(Sustituye `TU_USUARIO` por tu usuario de GitHub.)

### 3. Crear el Release y adjuntar el APK

1. En el repo de GitHub: pestaña **Releases**  
2. **Create a new release**  
3. **Choose a tag**: escribe `v1.0.0` → Create new tag  
4. **Release title**: `MUZZ GALAXY v1.0.0`  
5. Description (ejemplo):

```text
# MUZZ GALAXY v1.0.0

APK debug para Android.

## Instalar
1. Descarga MUZZ-GALAXY-debug.apk
2. En el teléfono permite "Instalar apps desconocidas"
3. Abre el APK e instala
4. Clave de acceso: 2025

## Requisitos
- Android 7.0+ recomendado
```

6. En **Attach binaries** arrastra:

`C:\Users\borin\OneDrive\Desktop\MUZZ-GALAXY-debug.apk`

7. **Publish release**

### 4. Enlace de descarga directa

Quedará algo así:

```text
https://github.com/TU_USUARIO/muzz-galaxy/releases/download/v1.0.0/MUZZ-GALAXY-debug.apk
```

Ese enlace **sí se puede compartir** para descargar el APK.

---

## Si aún falla el Release

1. **Inicia sesión** en GitHub y verifica el email de la cuenta.  
2. Usa el navegador en **modo normal** (no incógnito raro / bloqueadores).  
3. Sube el APK con **otro nombre** sin espacios: `MUZZ-GALAXY-v1.apk`.  
4. Prueba en Chrome / Edge actualizado.  
5. Si la red/empresa bloquea `.apk`, usa una de las alternativas de abajo.

---

## Alternativas fáciles (si GitHub te sigue bloqueando)

| Servicio | Uso |
|----------|-----|
| [Google Drive](https://drive.google.com) | Sube APK → Compartir → “Cualquiera con el enlace” |
| [MediaFire](https://www.mediafire.com) | Muy usado para APK |
| [itch.io](https://itch.io) | Ideal para juegos (gratis) |
| [Firebase App Distribution](https://firebase.google.com/products/app-distribution) | Testing con testers |

### Google Drive (rápido)
1. Sube `MUZZ-GALAXY-debug.apk`  
2. Clic derecho → Compartir → Cualquiera con el enlace → Lector  
3. Copia el enlace y compártelo  

---

## Aviso importante

- Este APK es **debug** (pruebas). No es release firmado de Play Store.  
- Android puede mostrar “app peligrosa” en apps fuera de Play Store: es normal; el usuario debe confirmar la instalación.  
- No subas claves, ni `local.properties`, ni contraseñas al repo.

---

## Recompilar el APK

```powershell
cd "C:\Users\borin\OneDrive\Desktop\muzz-galaxy-app"
npm run apk:debug
```

Sale en el Escritorio: `MUZZ-GALAXY-debug.apk`
