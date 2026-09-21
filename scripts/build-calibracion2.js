'use strict';
// Calibracion v2: un color UNICO por posicion (15 teclas + 3 sidebar).
//
// La v1 usaba 5 bandas verticales, asi que un desorden se leia modulo 5 y
// quedaban varias explicaciones posibles. Con 18 colores distintos la
// permutacion queda determinada: el color que aparece en una tecla dice
// exactamente de que posicion del lienzo vino.

const fs = require('fs');
const path = require('path');
const render = require('../com.greenpanter.claude.sdPlugin/plugin/render');
const wallpaper = require('../com.greenpanter.claude.sdPlugin/plugin/wallpaper');
const { encodePNG } = require('../com.greenpanter.claude.sdPlugin/plugin/png');

const cols = wallpaper.LAYOUT.cols;      // 5
const rows = wallpaper.LAYOUT.rows;      // 3
const ratio = wallpaper.LAYOUT.sidebarWidthRatio;

const W = Math.round(wallpaper.TILE * (cols + ratio));
const H = wallpaper.TILE * rows;
const unit = W / (cols + ratio);

// 18 colores bien separados en tono y luminancia
const COLORES = [
    [0xe6, 0x19, 0x4b], [0x3c, 0xb4, 0x4b], [0xff, 0xe1, 0x19],
    [0x43, 0x63, 0xd8], [0xf5, 0x82, 0x31], [0x91, 0x1e, 0xb4],
    [0x46, 0xf0, 0xf0], [0xf0, 0x32, 0xe6], [0xbc, 0xf6, 0x0c],
    [0xfa, 0xbe, 0xbe], [0x00, 0x80, 0x80], [0xe6, 0xbe, 0xff],
    [0x9a, 0x63, 0x24], [0xff, 0xfa, 0xc8], [0x80, 0x00, 0x00],
    [0xaa, 0xff, 0xc3], [0x80, 0x80, 0x00], [0xff, 0xd8, 0xb1],
];

const c = new render.Canvas(W, H);
c.clear([0x08, 0x08, 0x0a], 1);

const mapa = [];

function pinta(x0, y0, x1, y1, idx, etiqueta) {
    const col = COLORES[idx % COLORES.length];
    for (let y = Math.floor(y0); y < Math.ceil(y1) && y < H; y++) {
        for (let x = Math.floor(x0); x < Math.ceil(x1) && x < W; x++) {
            c.blend(x, y, col, 1);
        }
    }
    // marca de orientacion: circulo arriba-izquierda del recuadro
    c.disc(x0 + (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.25, 10, [0x00, 0x00, 0x00], 1);
    c.disc(x0 + (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.25, 5, [0xff, 0xff, 0xff], 1);
    mapa.push({ idx, etiqueta, rgb: col });
}

let n = 0;
for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
        pinta(k * unit, r * H / rows, (k + 1) * unit, (r + 1) * H / rows, n, k + ',' + r);
        n++;
    }
}
for (let r = 0; r < rows; r++) {
    pinta(cols * unit, r * H / rows, W, (r + 1) * H / rows, n, '5,' + r + ' (sidebar)');
    n++;
}

fs.writeFileSync(path.join(__dirname, '..', 'calibracion2.png'), encodePNG(c.buf, W, H));
fs.writeFileSync(path.join(__dirname, '..', 'calibracion2-mapa.json'), JSON.stringify(mapa, null, 2));

console.log('calibracion2.png  ' + W + 'x' + H);
console.log('\n  idx  posicion        color');
for (const m of mapa) {
    const hex = '#' + m.rgb.map(v => v.toString(16).padStart(2, '0')).join('');
    console.log('  ' + String(m.idx).padStart(3) + '  ' + m.etiqueta.padEnd(16) + hex);
}
