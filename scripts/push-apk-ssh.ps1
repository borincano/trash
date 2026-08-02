$ErrorActionPreference = "Stop"
$proj = "C:\Users\borin\OneDrive\Desktop\muzz-galaxy-app"
$key = "$env:USERPROFILE\.ssh\muzz_github_deploy"
$env:GIT_SSH_COMMAND = "ssh -i `"$key`" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
Set-Location $proj
git remote remove origin 2>$null
git remote add origin git@github.com:borincano/trash.git
# Ensure download files tracked (override gitignore for this path)
# .gitignore has *.apk - force add
git add -f download/MUZZ-GALAXY-debug.apk download/MUZZ-GALAXY-debug.zip
git add download/README.md 2>$null
if (git status --porcelain) {
  git commit -m "Add MUZZ GALAXY APK download"
}
git pull origin main --rebase --allow-unrelated-histories 2>&1
git push -u origin main 2>&1
Write-Host "DONE"
Write-Host "Download: https://github.com/borincano/trash/releases"
Write-Host "Or raw: https://github.com/borincano/trash/raw/main/download/MUZZ-GALAXY-debug.apk"
