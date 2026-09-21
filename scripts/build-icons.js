'use strict';
// Genera los PNG estaticos del manifest. Correr con el node de StreamDock:
//   & "C:\Program Files (x86)\StreamDock\node\node20.exe" build-icons.js

const fs = require('fs');
const path = require('path');
const render = require('../com.greenpanter.claude.sdPlugin/plugin/render');
const { encodePNG } = require('../com.greenpanter.claude.sdPlugin/plugin/png');

const OUT = path.join(__dirname, '..', 'com.greenpanter.claude.sdPlugin', 'resources');
fs.mkdirSync(OUT, { recursive: true });

function fromURI(uri) {
    return Buffer.from(uri.split(',')[1], 'base64');
}

// Se escribe el mismo render de 144px en ambos tamanos: el host reescala al
// tamano de tecla. Un downscale propio solo anadiria codigo sin mejorar nada.
function save(name, uri) {
    const png = fromURI(uri);
    fs.writeFileSync(path.join(OUT, name + '@2x.png'), png);
    fs.writeFileSync(path.join(OUT, name + '.png'), png);
    console.log('  ' + name);
}

console.log('generando iconos...');
save('pluginIcon',   render.idle(render.COLORS.naranja));
save('categoryIcon', render.idle(render.COLORS.naranja));
save('actionLaunch', render.idle(render.COLORS.naranja));
save('actionStatus', render.statusPanel([
    { on: true,  accent: render.COLORS.naranja },
    { on: false, accent: render.COLORS.azul },
    { on: true,  accent: render.COLORS.brillante },
], 0.25));

// limpia los PNG de prueba
for (const f of fs.readdirSync(OUT)) {
    if (f.startsWith('test_')) fs.unlinkSync(path.join(OUT, f));
}
console.log('listo');

// icono de la accion wallpaper: cuadricula sugiriendo imagen repartida
(function () {
    const c = new render.Canvas(144);
    c.gradientV([0x1a, 0x1d, 0x2b], [0x0d, 0x0d, 0x14]);
    c.roundRect(6, 6, 137, 137, 14, [0x12, 0x14, 0x1e], 1);
    const cols = [render.COLORS.naranja, render.COLORS.brillante, render.COLORS.violeta];
    for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 3; k++) {
            c.roundRect(24 + k * 34, 24 + r * 34, 24 + k * 34 + 26, 24 + r * 34 + 26,
                        5, cols[(r + k) % 3], 0.35 + 0.2 * ((r + k) % 3));
        }
    }
    save('actionWall', c.toURI());
})();
