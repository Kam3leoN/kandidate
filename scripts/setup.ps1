# KandiDate — first setup from the zip (Windows PowerShell): git repo + k3ui / k3ux submodules (pinned) + deps.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$subs = @(
  @{ repo = 'k3ui-expressive'; path = 'vendor/k3ui'; ref = 'c4df3b9106ce408b91b581f0977612080b569766' },
  @{ repo = 'k3ux-expressive'; path = 'vendor/k3ux'; ref = '0daab3ee7023def2dd049c3905e4364b6964f653' }
)
if (-not (Test-Path .git)) { git init -b main }
foreach ($s in $subs) {
  if (-not (Test-Path (Join-Path $s.path '.git'))) {
    if (Test-Path $s.path) { Remove-Item -Recurse -Force $s.path }
    git submodule add --force "https://github.com/Kam3leoN/$($s.repo).git" $s.path
  }
  git -C $s.path fetch --quiet origin
  git -C $s.path checkout --quiet $s.ref
  git add $s.path   # record the pinned commit
}
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
Write-Host 'OK : npm run db:seed (optionnel, demo locale) puis npm run dev'
