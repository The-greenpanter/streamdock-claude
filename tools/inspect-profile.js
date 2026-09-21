'use strict';
// Herramienta de diagnostico: muestra que acciones de este plugin hay en el
// perfil activo, en que coordenadas y con que ajustes. Solo lectura.
//
// OJO: StreamDock escribe el .sdProfile con retraso, asi que este archivo
// puede ir por detras del estado real de la app. Para saber que coordenadas
// ve el plugin, mirar log/plugin.log, no esto.
//
//   node20.exe inspect-profile.js [ruta-al-manifest.json]

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(process.env.APPDATA || '', 'HotSpot', 'StreamDock');

/** Lee el perfil activo del INI de la app en vez de quemar un GUID. */
function perfilActivo() {
    const ini = path.join(RAIZ, 'config', 'StreamDockConfig.ini');
    let txt;
    try { txt = fs.readFileSync(ini, 'utf8'); } catch { return null; }

    // sdProfilePath=C:\\Users\\...\\XXXX.sdProfile  (el INI duplica las barras)
    const rutas = [...txt.matchAll(/sdProfilePath=(.+)/g)]
        .map(m => m[1].trim().replace(/\\\\/g, '\\'))
        .map(p => path.join(p, 'manifest.json'))
        .filter(p => fs.existsSync(p));

    if (rutas.length === 0) return null;
    // el mas reciente suele ser el que se esta usando
    return rutas.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

const PERFIL = process.argv[2] || perfilActivo();

if (!PERFIL) {
    console.error('No encuentro ningun perfil. Pasa la ruta del manifest.json como argumento.');
    process.exit(1);
}

console.log('perfil: ' + PERFIL + '\n');

const m = JSON.parse(fs.readFileSync(PERFIL, 'utf8'));
let n = 0;

for (const k of Object.keys(m.Actions || {}).sort()) {
    const a = m.Actions[k];
    const uuid = a.UUID || '';
    if (!uuid.includes('greenpanter')) continue;

    const s = Object.assign({}, a.Settings || {});
    if (s.source) s.source = path.basename(decodeURIComponent(s.source));

    n++;
    console.log(
        'col,row=' + k.padEnd(4),
        '| ' + uuid.replace('com.greenpanter.claude.', '').padEnd(10),
        '| ' + JSON.stringify(s)
    );
}

if (n === 0) console.log('(ninguna accion de este plugin en el perfil)');
