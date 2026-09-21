'use strict';
// Carga imagenes (PNG / JPG / GIF) a RGBA crudo, recorta y reescala.
// Todo JS puro: png propio, jpeg-js y omggif. Sin binarios nativos.

const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { GifReader } = require('omggif');
const { decodePNG, encodePNG, toDataURI } = require('./png');

/** @typedef {{width:number,height:number,data:Buffer,delay?:number}} Frame */

/** @returns {Frame[]} un frame para estaticas, N para GIF animado */
function load(file) {
    const buf = fs.readFileSync(file);
    const ext = path.extname(file).toLowerCase();

    if (ext === '.gif' || (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46)) {
        return loadGif(buf);
    }
    if (ext === '.jpg' || ext === '.jpeg' || (buf[0] === 0xff && buf[1] === 0xd8)) {
        const r = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
        return [{ width: r.width, height: r.height, data: Buffer.from(r.data) }];
    }
    const r = decodePNG(buf);
    return [r];
}

function loadGif(buf) {
    const reader = new GifReader(buf);
    const w = reader.width, h = reader.height;
    const frames = [];
    // el canvas persiste entre frames: los GIF suelen traer solo el delta
    const canvas = Buffer.alloc(w * h * 4);

    for (let i = 0; i < reader.numFrames(); i++) {
        const info = reader.frameInfo(i);
        const tmp = new Uint8Array(w * h * 4);
        reader.decodeAndBlitFrameRGBA(i, tmp);

        // blit respetando alfa (0 = pixel transparente, conserva lo anterior)
        for (let p = 0; p < w * h; p++) {
            if (tmp[p * 4 + 3] !== 0) {
                canvas[p * 4] = tmp[p * 4];
                canvas[p * 4 + 1] = tmp[p * 4 + 1];
                canvas[p * 4 + 2] = tmp[p * 4 + 2];
                canvas[p * 4 + 3] = tmp[p * 4 + 3];
            }
        }
        frames.push({
            width: w,
            height: h,
            data: Buffer.from(canvas),
            delay: Math.max((info.delay || 8) * 10, 40),   // centisegundos -> ms
        });
        if (info.disposal === 2) canvas.fill(0);           // restaurar a fondo
    }
    return frames;
}

/**
 * Recorta una region y la reescala a destW x destH (bilineal).
 * @param {Frame} img
 */
function cropScale(img, sx, sy, sw, sh, destW, destH) {
    const out = Buffer.alloc(destW * destH * 4);
    for (let y = 0; y < destH; y++) {
        const fy = sy + (y + 0.5) * sh / destH - 0.5;
        const y0 = Math.floor(fy), ty = fy - y0;
        for (let x = 0; x < destW; x++) {
            const fx = sx + (x + 0.5) * sw / destW - 0.5;
            const x0 = Math.floor(fx), tx = fx - x0;
            const o = (y * destW + x) * 4;
            for (let c = 0; c < 4; c++) {
                let acc = 0;
                for (let dy = 0; dy < 2; dy++) {
                    for (let dx = 0; dx < 2; dx++) {
                        const px = Math.min(Math.max(x0 + dx, 0), img.width - 1);
                        const py = Math.min(Math.max(y0 + dy, 0), img.height - 1);
                        const wgt = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
                        acc += img.data[(py * img.width + px) * 4 + c] * wgt;
                    }
                }
                out[o + c] = Math.round(acc);
            }
        }
    }
    return { width: destW, height: destH, data: out };
}

/** "cover": recorta al aspecto destino sin deformar, luego escala. */
function cover(img, destW, destH) {
    const scale = Math.max(destW / img.width, destH / img.height);
    const sw = destW / scale, sh = destH / scale;
    return cropScale(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, destW, destH);
}

/**
 * Coloca la imagen en un lienzo destino con control explicito de escala y
 * posicion. A diferencia de cover(), aqui NADA se recorta ni se encoge solo:
 * lo decide el llamador.
 *
 * @param {Frame} img
 * @param {number} destW
 * @param {number} destH
 * @param {object} [o]
 * @param {'cover'|'contain'|'stretch'|'none'} [o.fit='contain']
 *        cover   = llena el lienzo, se sale lo que sobre
 *        contain = imagen entera visible, sobra fondo
 *        stretch = deforma hasta encajar exacto
 *        none    = 1 pixel de imagen = 1 pixel de lienzo (sin reescalar)
 * @param {number} [o.zoom=100]     porcentaje sobre la escala de `fit`
 * @param {number} [o.offsetX=0]    desplazamiento horizontal, % del lienzo
 * @param {number} [o.offsetY=0]    desplazamiento vertical, % del lienzo
 * @param {number[]} [o.background=[0,0,0]] color donde no llega la imagen
 * @param {number} [o.backgroundAlpha=255]
 */
function place(img, destW, destH, o = {}) {
    const fit = o.fit || 'contain';
    const zoom = (o.zoom == null ? 100 : o.zoom) / 100;
    const offX = (o.offsetX || 0) / 100 * destW;
    const offY = (o.offsetY || 0) / 100 * destH;
    const bg = o.background || [0, 0, 0];
    const bgA = o.backgroundAlpha == null ? 255 : o.backgroundAlpha;

    let sx, sy;   // escala por eje (distinta solo en 'stretch')
    if (fit === 'cover')        sx = sy = Math.max(destW / img.width, destH / img.height);
    else if (fit === 'contain') sx = sy = Math.min(destW / img.width, destH / img.height);
    else if (fit === 'stretch') { sx = destW / img.width; sy = destH / img.height; }
    else                        sx = sy = 1;              // none
    sx *= zoom; sy *= zoom;

    const drawW = img.width * sx, drawH = img.height * sy;
    const dx = (destW - drawW) / 2 + offX;
    const dy = (destH - drawH) / 2 + offY;

    const out = Buffer.alloc(destW * destH * 4);
    for (let y = 0; y < destH; y++) {
        for (let x = 0; x < destW; x++) {
            const o4 = (y * destW + x) * 4;
            // mapeo inverso: de pixel del lienzo a coordenada de la imagen
            const fx = (x + 0.5 - dx) / sx - 0.5;
            const fy = (y + 0.5 - dy) / sy - 0.5;

            if (fx < -0.5 || fy < -0.5 || fx > img.width - 0.5 || fy > img.height - 0.5) {
                out[o4] = bg[0]; out[o4 + 1] = bg[1]; out[o4 + 2] = bg[2]; out[o4 + 3] = bgA;
                continue;
            }

            const x0 = Math.floor(fx), y0 = Math.floor(fy);
            const tx = fx - x0, ty = fy - y0;
            for (let c = 0; c < 4; c++) {
                let acc = 0;
                for (let ddy = 0; ddy < 2; ddy++) {
                    for (let ddx = 0; ddx < 2; ddx++) {
                        const px = Math.min(Math.max(x0 + ddx, 0), img.width - 1);
                        const py = Math.min(Math.max(y0 + ddy, 0), img.height - 1);
                        acc += img.data[(py * img.width + px) * 4 + c] *
                               (ddx ? tx : 1 - tx) * (ddy ? ty : 1 - ty);
                    }
                }
                out[o4 + c] = Math.round(acc);
            }
        }
    }
    return { width: destW, height: destH, data: out };
}

function toURI(frame) {
    return toDataURI(encodePNG(frame.data, frame.width, frame.height));
}

module.exports = { load, cropScale, cover, place, toURI };
