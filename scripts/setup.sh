#!/usr/bin/env bash
# KandiDate — first setup from the zip: git repo + k3ui / k3ux submodules (pinned) + deps.
set -euo pipefail
cd "$(dirname "$0")/.."
K3UI_REF=c4df3b9106ce408b91b581f0977612080b569766
K3UX_REF=0daab3ee7023def2dd049c3905e4364b6964f653

[ -d .git ] || git init -b main
for spec in "k3ui-expressive vendor/k3ui $K3UI_REF" "k3ux-expressive vendor/k3ux $K3UX_REF"; do
  set -- $spec
  if [ ! -e "$2/.git" ]; then
    rm -rf "$2"
    git submodule add --force "https://github.com/Kam3leoN/$1.git" "$2"
  fi
  git -C "$2" fetch --quiet origin
  git -C "$2" checkout --quiet "$3"
  git add "$2"   # record the pinned commit
done
npm install
[ -f .env ] || cp .env.example .env
echo "✔ Prêt : npm run db:seed (optionnel, démo locale) puis npm run dev"
