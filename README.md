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

Para activar el hook versionado de pre-push y bloquear bundles vendoreados con secretos o configuraciones embebidas:

```bash
git config core.hooksPath .githooks
```

Tambien se puede ejecutar el escaneo manualmente:

```bash
npm run check:secrets
```

## Mantenimiento de Excalidraw

La app integra `@excalidraw/excalidraw` desde npm. `public/excalidraw/` se usa solo para assets estaticos servidos por `EXCALIDRAW_ASSET_PATH`.

- Mantener autoalojado solo `public/excalidraw/fonts/`.
- No copiar `node_modules/@excalidraw/excalidraw/dist/prod/index.js`, `index.css`, `chunk-*.js`, `subset-*.chunk.js` ni los directorios `data/` o `locales/` a `public/`.
- No versionar `vendor-excalidraw/` ni otros bundles de desarrollo de Excalidraw.
- Si se actualiza Excalidraw, refrescar unicamente `node_modules/@excalidraw/excalidraw/dist/prod/fonts` dentro de `public/excalidraw/fonts/`.
