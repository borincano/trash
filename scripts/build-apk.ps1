# MUZZ GALAXY — debug APK builder
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "=== MUZZ GALAXY APK BUILD ===" -ForegroundColor Cyan

function Find-Java {
  if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\java.exe")) { return $env:JAVA_HOME }
  $candidates = @(
    "C:\Program Files\Microsoft\jdk-21*",
    "C:\Program Files\Eclipse Adoptium\jdk-21*",
    "C:\Program Files\Java\jdk-21*",
    "C:\Program Files\Microsoft\jdk-17*",
    "C:\Program Files\Eclipse Adoptium\jdk-17*",
    "C:\Program Files\Java\jdk-17*",
    "C:\Program Files\Android\Android Studio\jbr"
  )
  foreach ($p in $candidates) {
    $hit = Get-Item $p -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit -and (Test-Path (Join-Path $hit.FullName "bin\java.exe"))) { return $hit.FullName }
    if ($hit -and (Test-Path (Join-Path $hit.FullName "java.exe"))) { return (Split-Path $hit.FullName -Parent) }
  }
  # jbr is java home itself
  if (Test-Path "C:\Program Files\Android\Android Studio\jbr\bin\java.exe") {
    return "C:\Program Files\Android\Android Studio\jbr"
  }
  return $null
}

function Find-Sdk {
  if ($env:ANDROID_HOME -and (Test-Path $env:ANDROID_HOME)) { return $env:ANDROID_HOME }
  if ($env:ANDROID_SDK_ROOT -and (Test-Path $env:ANDROID_SDK_ROOT)) { return $env:ANDROID_SDK_ROOT }
  $local = Join-Path $env:LOCALAPPDATA "Android\Sdk"
  if (Test-Path $local) { return $local }
  return $null
}

# Sync web + icons
Write-Host "[1/4] Capacitor sync..." -ForegroundColor Yellow
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw "cap sync failed" }
node scripts/apply-android-icons.mjs

$javaHome = Find-Java
$sdk = Find-Sdk

if (-not $javaHome) {
  Write-Host "JDK not found. Install Microsoft OpenJDK 17 or Android Studio." -ForegroundColor Red
  Write-Host "  winget install Microsoft.OpenJDK.17" -ForegroundColor DarkYellow
  Write-Host "  winget install Google.AndroidStudio" -ForegroundColor DarkYellow
  exit 2
}
if (-not $sdk) {
  Write-Host "Android SDK not found. Install Android Studio and open SDK Manager once." -ForegroundColor Red
  Write-Host "  winget install Google.AndroidStudio" -ForegroundColor DarkYellow
  exit 3
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = "$javaHome\bin;$sdk\platform-tools;$env:Path"

Write-Host "JAVA_HOME=$javaHome"
Write-Host "ANDROID_HOME=$sdk"

# local.properties
$lp = Join-Path $Root "android\local.properties"
$sdkProp = $sdk -replace '\\', '\\'
# Actually properties need escaped backslashes or forward slashes
$sdkFwd = $sdk -replace '\\', '/'
Set-Content -Path $lp -Value "sdk.dir=$sdkFwd" -Encoding ASCII

Write-Host "[2/4] Gradle assembleDebug..." -ForegroundColor Yellow
Push-Location (Join-Path $Root "android")
try {
  if (Test-Path ".\gradlew.bat") {
    .\gradlew.bat assembleDebug --stacktrace
  } else {
    throw "gradlew.bat missing"
  }
} finally {
  Pop-Location
}

$apk = Join-Path $Root "android\app\build\outputs\apk\debug\app-debug.apk"
$outDir = Join-Path $Root "dist"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$dest = Join-Path $outDir "MUZZ-GALAXY-debug.apk"

if (Test-Path $apk) {
  Copy-Item $apk $dest -Force
  Write-Host "[OK] APK listo:" -ForegroundColor Green
  Write-Host "  $dest" -ForegroundColor Green
  # also copy to Desktop
  $desk = Join-Path ([Environment]::GetFolderPath('Desktop')) "MUZZ-GALAXY-debug.apk"
  Copy-Item $apk $desk -Force
  Write-Host "  $desk" -ForegroundColor Green
  Write-Host ""
  Write-Host "Instalar en telefono (USB depuracion):" -ForegroundColor Cyan
  Write-Host "  adb install -r `"$dest`""
} else {
  Write-Host "APK no generado. Abre Android Studio: npx cap open android" -ForegroundColor Red
  exit 4
}
