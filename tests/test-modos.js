'use strict';
// Verifica los modos del boton Launch: grupo con exclusiones, selector y
// comando personalizado con parametros libres.

process.env.CLAUDE_SD_DRYRUN = '1';

const l = require('../com.greenpanter.claude.sdPlugin/plugin/launcher');
const sessions = require('../com.greenpanter.claude.sdPlugin/plugin/sessions');

let ok = true;
function check(nombre, cond, detalle) {
    if (!cond) ok = false;
    console.log('  ' + (cond ? 'OK   ' : 'FALLA') + '  ' + nombre.padEnd(46) +
                (detalle === undefined ? '' : detalle));
}

// --- partir parametros ---------------------------------------------------
const casos = [
    ['', []],
    ['--model opus', ['--model', 'opus']],
    ['--add-dir "C:\\Mi Carpeta" -c', ['--add-dir', 'C:\\Mi Carpeta', '-c']],
    ["--x 'con espacios'", ['--x', 'con espacios']],
];
for (const [entrada, esperado] of casos) {
    const got = l.partirArgs(entrada);
    check('partirArgs ' + JSON.stringify(entrada),
          JSON.stringify(got) === JSON.stringify(esperado), JSON.stringify(got));
}

// --- grupo con exclusiones -----------------------------------------------
const nombradas = sessions.list().filter(s => s.title);
const total = l.namedSessions().length;
check('grupo sin exclusiones == sesiones con nombre', total === Math.min(nombradas.length, 12), total);

if (nombradas.length) {
    const fuera = nombradas[0].id;
    const conExclusion = l.namedSessions([fuera]);
    check('excluir una la saca del grupo',
          conExclusion.length === total - 1 && !conExclusion.some(s => s.id === fuera),
          conExclusion.length);

    const r = l.launchAll([fuera]);
    check('launchAll respeta la exclusion',
          r.ok && !r.opened.includes(nombradas[0].title), r.opened.length + ' tabs');
}

// --- selector ------------------------------------------------------------
const p = l.launchPicker();
check('picker usa --resume sin id',
      p.ok && p.args.includes('--resume') && !p.args.some(a => /^[0-9a-f]{8}-/.test(a)));
check('picker cae en la carpeta por defecto', p.args.includes(l.CWD_POR_DEFECTO));

// --- personalizado -------------------------------------------------------
const c1 = l.launchCustom('--model opus', null, 'mi boton');
check('custom pasa los parametros',
      c1.ok && c1.args.includes('--model') && c1.args.includes('opus'));
check('custom usa el titulo dado', c1.args.includes('mi boton'));

const c2 = l.launchCustom('', null, null);
const claudeIdx = c2.args.findIndex(a => a.toLowerCase().endsWith('claude.exe'));
check('custom vacio abre claude sin flags',
      c2.ok && claudeIdx !== -1 && claudeIdx === c2.args.length - 1);

const c3 = l.launchCustom('-c', 'C:\\ruta\\que\\no\\existe', null);
check('custom avisa si la carpeta no existe', !c3.ok && /no existe/.test(c3.error || ''));

process.exit(ok ? 0 : 1);
