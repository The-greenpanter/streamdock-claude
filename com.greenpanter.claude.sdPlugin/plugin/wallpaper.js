'use strict';
// Reparte una imagen (o GIF animado) entre varias teclas, como el screensaver.
//
// Limitacion real: el screensaver de fabrica usa qwebchannel (puente Qt
// privado) y pinta el device entero de golpe. La API publica de plugins no
// da eso. Aqui cada tecla es una instancia independiente de la accion que
// recorta SU pedazo segun sus coordenadas. Efecto final igual; hay que poner
// la accion en cada tecla que deba formar parte de la imagen.

const image = require('./image');

const TILE = 144;

// Geometria del Stream Dock 293SV3: 5 columnas de teclas (0-4) x 3 filas,
// mas la barra lateral en la columna 5. Las proporciones son un punto de
// partida razonable, no medidas del fabricante: si la imagen sale estirada,
// se ajustan aqui o desde los settings.
const LAYOUT = {
    cols: 5,
    rows: 3,
    sidebarCol: 5,
    sidebarWidthRatio: 0.62,   // ancho del sidebar respecto a una tecla
};

/**
 * Region normalizada (0..1) de la imagen que le toca a una coordenada.
 * @returns {{x:number,y:number,w:number,h:number}}
 */
function regionFor(col, row, layout = LAYOUT) {
    const unit = 1 / (layout.cols + layout.sidebarWidthRatio);
    const keyW = unit;
    if (col >= layout.sidebarCol) {
        // el sidebar ocupa toda la altura; cada slot se queda su tercio
        const sw = unit * layout.sidebarWidthRatio;
        return { x: 1 - sw, y: row / layout.rows, w: sw, h: 1 / layout.rows };
    }
    return { x: col * keyW, y: row / layout.rows, w: keyW, h: 1 / layout.rows };
}

/** Cache de tiles ya renderizados: clave = archivo|col|row|modo */
const cache = new Map();
const MAX_CACHE = 60;

function cacheKey(file, col, row, mode, trKey) {
    return file + '|' + col + ',' + row + '|' + mode + '|' + trKey;
}

/**
 * Tamano en pixeles del tile de una posicion.
 *
 * Las teclas son cuadradas (144x144) pero la barra lateral es una franja
 * alta y estrecha. Antes se generaba SIEMPRE 144x144 y el host estiraba ese
 * cuadrado para llenar la franja: por eso la imagen del sidebar salia
 * deformada. Ahora cada posicion recibe un lienzo con su proporcion real.
 */
function tileSize(col, row, layout = LAYOUT) {
    if (col >= layout.sidebarCol) {
        const r = regionFor(col, row, layout);
        const c = canvasSize(layout);
        // OJO: r.w y r.h son fracciones del lienzo, y el lienzo NO es cuadrado
        // (809x432). Hay que pasarlas a pixeles antes de sacar la proporcion,
        // o el tile sale el doble de estrecho de lo que toca.
        const aspect = (r.w * c.w) / (r.h * c.h);
        return { w: Math.max(8, Math.round(TILE * aspect)), h: TILE };
    }
    return { w: TILE, h: TILE };
}

// Cache del ORIGEN ya decodificado y reducido al tamano del device.
// Sin esto se re-decodificaba el archivo entero por cada tecla: con una foto
// de 4096x2304 eso eran ~11 s para 18 tiles. Reducir una vez y recortar de
// ahi lo baja a decimas.
const sourceCache = new Map();

/** Ancho/alto del lienzo virtual que representa el device completo. */
function canvasSize(layout = LAYOUT) {
    return {
        w: Math.round(TILE * (layout.cols + layout.sidebarWidthRatio)),
        h: TILE * layout.rows,
    };
}

/**
 * El Property Inspector corre en CEF y la ruta llega URL-encoded:
 *   C%3A%5CUsers%5Cyo%5CPictures%5Cfoto.jpg  ->  C:\Users\yo\Pictures\foto.jpg
 * Sin decodificar, fs la trata como nombre literal y da ENOENT.
 * Tambien se admite el prefijo file:/// por si el host lo manda asi.
 */
function normalizePath(p) {
    if (!p) return p;
    let s = String(p).trim();

    if (/^file:\/\//i.test(s)) {
        s = s.replace(/^file:\/{2,3}/i, '');
    }
    if (/%[0-9A-Fa-f]{2}/.test(s)) {
        try {
            const dec = decodeURIComponent(s);
            // solo aceptar el decodificado si mejora las cosas
            if (require('fs').existsSync(dec) || !require('fs').existsSync(s)) s = dec;
        } catch { /* encoding invalido: dejar como esta */ }
    }
    return s.replace(/\//g, '\\');
}

/** Normaliza los settings de encuadre a algo con defaults completos. */
function normTransform(t = {}) {
    return {
        fit: t.fit || 'contain',
        zoom: Number(t.zoom) || 100,
        offsetX: Number(t.offsetX) || 0,
        offsetY: Number(t.offsetY) || 0,
    };
}

function transformKey(t) {
    return t.fit + ':' + t.zoom + ':' + t.offsetX + ':' + t.offsetY;
}

function loadSource(file, tr) {
    const st = require('fs').statSync(file);
    const key = file + '|' + st.mtimeMs + '|' + st.size + '|' + transformKey(tr);
    if (sourceCache.has(key)) return sourceCache.get(key);

    const { w, h } = canvasSize();
    const frames = image.load(file).map(f => {
        // place() en vez de cover(): el encuadre lo manda el usuario, no el
        // codigo. Nada se recorta ni se encoge por decision propia.
        const placed = image.place(f, w, h, {
            fit: tr.fit,
            zoom: tr.zoom,
            offsetX: tr.offsetX,
            offsetY: tr.offsetY,
        });
        placed.delay = f.delay;
        return placed;
    });

    sourceCache.clear();          // solo interesa el ultimo origen usado
    sourceCache.set(key, frames);
    return frames;
}

/**
 * Renderiza los frames que le tocan a una tecla.
 * @param {string} file  ruta a png/jpg/gif
 * @param {number} col
 * @param {number} row
 * @param {'span'|'fit'} mode  span = recortar su pedazo; fit = imagen entera
 * @returns {{uris:string[], delays:number[]}}
 */
function tilesFor(rawFile, col, row, mode = 'span', transform) {
    const file = normalizePath(rawFile);
    const tr = normTransform(transform);
    const key = cacheKey(file, col, row, mode, transformKey(tr));
    if (cache.has(key)) return cache.get(key);

    const uris = [], delays = [];

    const size = tileSize(col, row);

    if (mode === 'fit') {
        // La imagen entera vive en ESTA tecla: se encuadra directo al tile,
        // sin pasar por el lienzo del device.
        for (const f of image.load(file)) {
            uris.push(image.toURI(image.place(f, size.w, size.h, tr)));
            delays.push(f.delay || 100);
        }
    } else {
        const frames = loadSource(file, tr);
        const r = regionFor(col, row);
        for (const f of frames) {
            const tile = image.cropScale(
                f,
                r.x * f.width, r.y * f.height,
                r.w * f.width, r.h * f.height,
                size.w, size.h
            );
            uris.push(image.toURI(tile));
            delays.push(f.delay || 100);
        }
    }

    const out = { uris, delays };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(key, out);
    return out;
}

function clearCache() { cache.clear(); sourceCache.clear(); }

module.exports = { tilesFor, regionFor, tileSize, clearCache, canvasSize, normalizePath, LAYOUT, TILE };
