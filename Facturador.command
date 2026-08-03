#!/bin/bash
# Lanzador del Facturador Óptica (doble clic para abrir).
cd "/Users/juan/Facturador optica" || { echo "No se encontró la carpeta del Facturador."; read -r; exit 1; }

# Asegura que Node/npm estén en el PATH al abrir desde el Finder.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"

if ! command -v npm >/dev/null 2>&1; then
  echo "No se encontró npm. Instalá Node.js (https://nodejs.org) y volvé a intentar."
  read -r; exit 1
fi

echo "Iniciando Facturador Óptica..."
npm run app
