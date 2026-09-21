'use strict';
// Renderiza el tile de cada posicion desde calibracion.png y dice que banda
// de color le toco. Si esto sale correcto, el fallo esta en las coordenadas
// que manda el host; si sale desordenado, el fallo es mio.

const path = require('path');
const wp = require('../com.greenpanter.claude.sdPlugin/plugin/wallpaper');
const { decodePNG } = require('../com.greenpanter.claude.sdPlugin/plugin/png');

const SRC = path.join(__dirname, '..', 'calibracion.png');

const BANDAS = [
    ['naranja',  [0xf2, 0x75, 0x07]],
    ['azul',     [0x38, 0x95, 0xea]],
    ['verde',    [0x3f, 0xb9, 0x50]],
    ['rojo',     [0xd9, 0x3f, 0x3f]],
    ['violeta',  [0x37, 0x3c, 0xa6]],
    ['crema',    [0xf2, 0xe8, 0xd5]],
];

/** color dominante del tile, comparado contra la paleta */
function bandaDe(uri) {
    const px = decodePNG(Buffer.from(uri.split(',')[1], 'base64'));
    // muestra el centro para no coger las lineas negras de los bordes
    const x = Math.floor(px.width / 2);
    const y = Math.floor(px.height / 4);      // cuarto superior: evita el punto central
    const i = (y * px.width + x) * 4;
    const rgb = [px.data[i], px.data[i + 1], px.data[i + 2]];

    let best = -1, bestD = 1e9;
    BANDAS.forEach(([, c], idx) => {
        const d = Math.abs(c[0] - rgb[0]) + Math.abs(c[1] - rgb[1]) + Math.abs(c[2] - rgb[2]);
        if (d < bestD) { bestD = d; best = idx; }
    });
    return { idx: best, nombre: BANDAS[best][0], rgb, dist: bestD };
}

console.log('  esperado: columna N -> banda N\n');
let ok = true;

for (let row = 0; row < 3; row++) {
    const linea = [];
    for (let col = 0; col < 5; col++) {
        const t = wp.tilesFor(SRC, col, row, 'span', { fit: 'stretch' });
        const b = bandaDe(t.uris[0]);
        const bien = b.idx === col;
        if (!bien) ok = false;
        linea.push((bien ? ' ' : '!') + col + '->' + b.idx);
    }
    console.log('  fila ' + row + ':  ' + linea.join('   '));
}

console.log('\n  sidebar:');
for (let row = 0; row < 3; row++) {
    const t = wp.tilesFor(SRC, 5, row, 'span', { fit: 'stretch' });
    const b = bandaDe(t.uris[0]);
    const bien = b.idx === 5;
    if (!bien) ok = false;
    console.log('  5,' + row + ' -> ' + b.nombre + (bien ? '' : '  <-- deberia ser crema'));
}

console.log('\n  ' + (ok ? 'TODO CORRECTO -> el fallo esta en las coordenadas del host'
                        : 'DESORDENADO -> el fallo esta en mi calculo'));
process.exit(ok ? 0 : 1);
