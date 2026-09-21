'use strict';
// El Property Inspector corre en CEF y guarda las rutas URL-encoded:
//   C%3A%5CUsers%5C...%5Cfoto.jpg
// Sin decodificar, fs las trata como nombre literal y da ENOENT (esto llego a
// pintar el aspa roja en el device). Aqui se genera una imagen temporal y se
// comprueba que llega igual por las tres formas de escribir su ruta.

const fs = require('fs');
const os = require('os');
const path = require('path');

const wp = require('../com.greenpanter.claude.sdPlugin/plugin/wallpaper');
const render = require('../com.greenpanter.claude.sdPlugin/plugin/render');
const { encodePNG } = require('../com.greenpanter.claude.sdPlugin/plugin/png');

// carpeta con espacio y acento: los dos casos que rompen el encoding
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd test ñ-'));
const IMG = path.join(DIR, 'prueba imagen.png');

const c = new render.Canvas(240, 144);
c.gradientV([0xf2, 0x75, 0x07], [0x37, 0x3c, 0xa6]);
c.disc(120, 72, 40, [0xff, 0xff, 0xff], 1);
fs.writeFileSync(IMG, encodePNG(c.buf, c.w, c.h));

const casos = [
    ['ruta normal',      IMG],
    ['URL-encoded',      encodeURIComponent(IMG)],
    ['file:/// + encode', 'file:///' + encodeURIComponent(IMG)],
    ['barras al reves',  IMG.replace(/\\/g, '/')],
];

let ok = true;
try {
    for (const [nombre, ruta] of casos) {
        try {
            const t = wp.tilesFor(ruta, 2, 1, 'span', { fit: 'stretch' });
            const bien = t.uris.length === 1 && t.uris[0].startsWith('data:image/png;base64,');
            if (!bien) ok = false;
            console.log('  ' + (bien ? 'OK   ' : 'FALLA') + '  ' + nombre.padEnd(20) +
                        'normalizado -> ' + path.basename(wp.normalizePath(ruta)));
        } catch (e) {
            ok = false;
            console.log('  FALLA  ' + nombre.padEnd(20) + e.message);
        }
        wp.clearCache();
    }

    // una ruta que no existe debe fallar de forma clara, no en silencio
    let lanzo = false;
    try { wp.tilesFor(path.join(DIR, 'no-existe.png'), 0, 0, 'span', {}); }
    catch { lanzo = true; }
    if (!lanzo) ok = false;
    console.log('  ' + (lanzo ? 'OK   ' : 'FALLA') + '  archivo inexistente lanza error');
} finally {
    fs.rmSync(DIR, { recursive: true, force: true });
}

process.exit(ok ? 0 : 1);
