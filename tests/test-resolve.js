'use strict';
// Verifica la cadena de resolucion de sesiones:
//   1. id vivo            -> mode 'id'
//   2. id muerto + nombre -> mode 'title'  (sobrevive a que el archivo rote)
//   3. nada vivo          -> mode 'picker' (selector de Claude, no "not found")
//   4. sin datos          -> mode 'none'
//
// Tambien comprueba que un RENAME no rompe el boton: el id manda.

const sessions = require('../com.greenpanter.claude.sdPlugin/plugin/sessions');

const all = sessions.list();
const conNombre = all.filter(s => s.title);

if (conNombre.length === 0) {
    console.log('  SALTADO: no hay sesiones con nombre para probar');
    process.exit(0);
}

const real = conNombre[0];
const MUERTO = '00000000-dead-dead-dead-000000000000';

const casos = [
    ['id vivo -> id',
        () => sessions.resolve(real.id, real.title),
        r => r.mode === 'id' && r.id === real.id && r.cwd === real.cwd],

    ['rename: id vivo + nombre viejo -> id',
        () => sessions.resolve(real.id, 'nombre-que-ya-no-existe'),
        r => r.mode === 'id' && r.id === real.id],

    ['id muerto + nombre bueno -> title',
        () => sessions.resolve(MUERTO, real.title),
        r => r.mode === 'title' && r.id === real.id],

    ['ambos muertos -> picker',
        () => sessions.resolve(MUERTO, 'no-existe-esta-sesion-xyz'),
        r => r.mode === 'picker' && r.title === 'no-existe-esta-sesion-xyz'],

    ['sin datos -> none',
        () => sessions.resolve(null, null),
        r => r.mode === 'none'],

    ['busqueda por prefijo',
        () => sessions.resolve(MUERTO, real.title.slice(0, 5)),
        r => r.mode === 'title' && r.id === real.id],
];

let ok = true;
console.log('  probando con: "' + real.title + '" (' + real.id.slice(0, 8) + ')\n');
for (const [nombre, fn, check] of casos) {
    let r, pass = false;
    try { r = fn(); pass = check(r); } catch (e) { r = { error: e.message }; }
    if (!pass) ok = false;
    console.log('  ' + (pass ? 'OK   ' : 'FALLA') + '  ' + nombre.padEnd(38) +
                ' -> ' + JSON.stringify(r).slice(0, 80));
}
process.exit(ok ? 0 : 1);
