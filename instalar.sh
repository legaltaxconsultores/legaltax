#!/usr/bin/env bash
# LegalTax — instalación en un servidor Ubuntu desde este paquete. Ejecute como root:  bash instalar.sh
# (Instrucciones completas en INSTALAR.txt)
cd "$(dirname "$0")" && exec bash scripts/instalar-servidor.sh "$@"
