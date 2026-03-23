#!/usr/bin/env bash
# Script de construcción para Render (Optimizado para Puppeteer)

# 1. Instalar dependencias de Node
npm install

# 2. Instalar el navegador para Puppeteer en el entorno de Linux de Render
# Esto evita el error "Could not find Chrome" en producción.
npx puppeteer install
