# Usa una imagen oficial de Puppeteer (Tiene todas las dependencias de Linux)
FROM ghcr.io/puppeteer/puppeteer:latest

# Cambiamos a root para instalar cualquier extra si fuera necesario
USER root

# Creamos el directorio de la app
WORKDIR /app

# Copiamos archivos de dependencias
COPY package*.json ./

# Instalamos dependencias de Node
# (Como ya estamos en la imagen de Puppeteer, no hace falta descargar Chrome de nuevo)
RUN npm install

# Copiamos todo el código fuente
COPY . .

# Exponemos el puerto del portal de Relié Labs
EXPOSE 4000

# Iniciamos el servidor con el comando de inicio profesional
CMD ["node", "--env-file=.env", "src/server.js"]
