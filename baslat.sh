#!/usr/bin/env bash
# Kullanım:  ./baslat.sh            (aynı Wi-Fi)
#            ./baslat.sh --internet (her yerden)
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js bulunamadı. https://nodejs.org adresinden LTS sürümünü kur."; exit 1; }
[ -d node_modules ] || { echo "İlk çalıştırma: paketler kuruluyor..."; npm install --no-audit --no-fund; }
exec node server.js "$@"
