'use strict';
// Genera una imagen de calibracion para medir la geometria REAL del device.
//
// Por que: el reparto usa LAYOUT.sidebarWidthRatio, que hoy es una estimacion
// hecha a ojo desde una foto (0.62). Si ese numero no es el real, la franja
// lateral recibe un trozo de imagen que no le corresponde y el dibujo no
// continua entre las teclas y la barra.
//
// La imagen tiene bandas verticales de colores: una por columna de teclas y
// una para el sidebar. Si el ratio es correcto, CADA tecla se ve de un color
// plano y el sidebar tambien. Si esta mal, alguna tecla saldra partida en dos
// colores, y cuanto se cuela dice exactamente cuanto hay que corregir.
//
//   node20.exe build-calibracion.js [ratio]

const fs = require('fs');
const path = require('path');
const render = require('../com.greenpanter.claude.sdPlugin/plugin/render');
const wallpaper = require('../com.greenpanter.claude.sdPlugin/plugin/wallpaper');
const { encodePNG } = require('../com.greenpanter.claude.sdPlugin/plugin/png');

const ratio = Number(process.argv[2]) || wallpaper.LAYOUT.sidebarWidthRatio;
const cols = wallpaper.LAYOUT.cols;
const rows = wallpaper.LAYOUT.rows;

// mismo lienzo virtual que usa el reparto, con el ratio a probar
const W = Math.round(wallpaper.TILE * (cols + ratio));
const H = wallpaper.TILE * rows;

const c = new render.Canvas(W, H);
c.clear([0x10, 0x10, 0x14], 1);

const BANDAS = [
    [0xf2, 0x75, 0x07],   // col 0  naranja
    [0x38, 0x95, 0xea],   // col 1  azul
    [0x3f, 0xb9, 0x50],   // col 2  verde
    [0xd9, 0x3f, 0x3f],   // col 3  rojo
    [0x37, 0x3c, 0xa6],   // col 4  violeta
    [0xf2, 0xe8, 0xd5],   // sidebar crema
];

const unit = W / (cols + ratio);

// bandas verticales: 5 de tecla + 1 de sidebar
for (let i = 0; i <= cols; i++) {
    const x0 = i * unit;
    const x1 = (i === cols) ? W : (i + 1) * unit;
    for (let y = 0; y < H; y++) {
        for (let x = Math.floor(x0); x < Math.ceil(x1) && x < W; x++) {
            c.blend(x, y, BANDAS[i], 1);
        }
    }
}

// lineas negras en los limites de fila: deben caer en los huecos entre teclas
for (let r = 1; r < rows; r++) {
    const y = Math.round(r * H / rows);
    c.line(0, y, W, y, 5, [0x00, 0x00, 0x00], 1);
}

// marcas blancas en el centro de cada tecla: deben quedar centradas
for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
        c.disc((i + 0.5) * unit, (r + 0.5) * H / rows, 9, [0xff, 0xff, 0xff], 1);
        c.disc((i + 0.5) * unit, (r + 0.5) * H / rows, 4, [0x00, 0x00, 0x00], 1);
    }
    // centro de cada casilla del sidebar
    c.disc(cols * unit + (W - cols * unit) / 2, (r + 0.5) * H / rows, 9, [0x00, 0x00, 0x00], 1);
}

const out = path.join(__dirname, '..', 'calibracion.png');
fs.writeFileSync(out, encodePNG(c.buf, W, H));

console.log('ratio probado : ' + ratio);
console.log('lienzo        : ' + W + 'x' + H);
console.log('ancho tecla   : ' + Math.round(unit) + 'px');
console.log('ancho sidebar : ' + Math.round(W - cols * unit) + 'px');
console.log('archivo       : ' + out);
