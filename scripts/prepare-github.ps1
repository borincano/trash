# Prepara el repo y deja el APK listo para GitHub Releases
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "=== MUZZ GALAXY → GitHub prep ===" -ForegroundColor Cyan

# Ensure APK exists on Desktop
$apk = Join-Path $Root "dist\MUZZ-GALAXY-debug.apk"
$desk = Join-Path ([Environment]::GetFolderPath("Desktop")) "MUZZ-GALAXY-debug.apk"
if (-not (Test-Path $apk)) {
  if (Test-Path $desk) { Copy-Item $desk $apk -Force }
  else {
    Write-Host "No hay APK. Generando..." -ForegroundColor Yellow
    powershell -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\build-apk.ps1")
  }
}
if (Test-Path $apk) {
  Copy-Item $apk $desk -Force
  $size = [math]::Round((Get-Item $apk).Length / 1MB, 2)
  Write-Host "APK listo: $desk ($size MB)" -ForegroundColor Green
}

if (-not (Test-Path ".git")) {
  git init
  Write-Host "git init OK" -ForegroundColor Green
}

git add .
$status = git status --porcelain
if ($status) {
  git commit -m "MUZZ GALAXY v1.0.0 - commercial mobile + Android"
  Write-Host "Commit creado." -ForegroundColor Green
} else {
  Write-Host "Nada nuevo que commitear." -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "SIGUIENTE PASO (manual en github.com):" -ForegroundColor Cyan
Write-Host "1) Crea repo publico: https://github.com/new"
Write-Host "2) Ejecuta (cambia TU_USUARIO):"
Write-Host '   git branch -M main'
Write-Host '   git remote add origin https://github.com/TU_USUARIO/muzz-galaxy.git'
Write-Host '   git push -u origin main'
Write-Host "3) Releases → Create release → tag v1.0.0"
Write-Host "4) Adjunta el APK del Escritorio: MUZZ-GALAXY-debug.apk"
Write-Host ""
Write-Host "Guia completa: COMO-SUBIR-APK-GITHUB.md" -ForegroundColor Yellow
