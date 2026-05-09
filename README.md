# Study Tree

Aplicacion hecha con Next.js para organizar contenido de estudio en forma de arbol visual.

## Requisitos

- Node.js 20 o superior
- npm

## Instalacion

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

La app queda disponible en `http://localhost:3000`.

## Build de produccion

```bash
npm run build
npm run start
```

## Datos del proyecto

El proyecto usa `study-tree.json` y la carpeta `study-assets/` para persistir el contenido del arbol. Esos archivos se mantienen versionados en este repositorio.

## Git y despliegue

El repositorio ignora dependencias, builds locales, configuracion de Vercel, variables de entorno y la carpeta `proyecto guia/`, que hoy funciona como material local de referencia y no como parte de la app principal.

## Mantenimiento de Excalidraw

La app usa un fork local basado en `@excalidraw/excalidraw@0.18.1`, alojado en `vendor-excalidraw/`, con un cambio puntual: `onDropFile` para consumir drops de archivos custom antes del import interno de Excalidraw.

- Mantener autoalojado solo `public/excalidraw/fonts/`.
- El cambio local vive en `vendor-excalidraw/dist/dev/index.js` y se tipa desde `lib/excalidraw.ts`.
- Si se actualiza Excalidraw, rebasar el fork sobre la misma version base y volver a aplicar `onDropFile` en `handleAppOnDrop()`.
- No copiar `vendor-excalidraw/dist/dev/index.js`, `index.css`, `chunk-*.js`, `subset-*.chunk.js` ni los directorios `data/` o `locales/` a `public/`.
