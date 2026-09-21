'use strict';
// Lanza Windows Terminal con una tab por proyecto.
//
// Por que --continue y no --resume <uuid>:
//   --resume <id> exige el UUID exacto, y Claude Code purga los .jsonl viejos
//   (comprobado: una sesion de youtube desaparecio sola en 2 dias). Un UUID
//   hardcodeado caduca. --resume "nombre" tampoco sirve: abre el selector
//   interactivo y pide una tecla, lo que rompe el "un click y listo".
//   --continue retoma la mas reciente de ESE cwd, sin id y sin caducidad.

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const sessions = require('./sessions');

function exists(p) {
    try { return fs.existsSync(p); } catch { return false; }
}

// wt.exe vive en WindowsApps como "app execution alias": un reparse point
// APPEXECLINK que fs.stat NO sabe seguir (da ENOENT aunque el binario exista).
// Por eso no se valida con existsSync; se resuelve con `where` y, si eso
// falla, se deja el nombre pelado para que CreateProcess lo busque en PATH.
function resolveWt() {
    try {
        const out = execSync('where wt.exe', { encoding: 'utf8', windowsHide: true });
        const first = out.split(/\r?\n/).find(l => l.trim());
        if (first) return first.trim();
    } catch { /* no esta en PATH */ }
    return 'wt.exe';
}

const WT = resolveWt();

// wt.exe lanza el comando de la tab con CreateProcess, que NO resuelve
// PATHEXT como lo hace una shell. En el PATH solo hay `claude` (script sh) y
// `claude.cmd`; no existe `claude.exe`. Por eso pasar "claude" a secas da
// 0x80070002 "The system cannot find the file specified".
// claude.cmd solo envuelve a:
//   <dir del shim>\node_modules\@anthropic-ai\claude-code\bin\claude.exe
// asi que se resuelve ese binario y se lanza directo.
function resolveClaude() {
    const fs = require('fs');
    const path = require('path');

    // 1) por si algun dia hay un claude.exe de verdad en el PATH
    try {
        const out = execSync('where claude.exe', { encoding: 'utf8', windowsHide: true });
        const hit = out.split(/\r?\n/).find(l => l.trim());
        if (hit && fs.existsSync(hit.trim())) return [hit.trim()];
    } catch { /* no hay */ }

    // 2) derivar el binario real desde el shim de npm
    try {
        const out = execSync('where claude.cmd', { encoding: 'utf8', windowsHide: true });
        const shim = (out.split(/\r?\n/).find(l => l.trim()) || '').trim();
        if (shim) {
            const exe = path.join(path.dirname(shim),
                'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
            if (fs.existsSync(exe)) return [exe];
        }
    } catch { /* no hay */ }

    // 3) ultimo recurso: que lo resuelva cmd, que si aplica PATHEXT
    return ['cmd', '/c', 'claude'];
}

const CLAUDE = resolveClaude();

// spawn() detached no propaga ENOENT por excepcion; queda aqui para que el
// boton pueda pintar el aspa si el lanzamiento fallo de verdad.
let lastSpawnError = null;
function takeSpawnError() {
    const e = lastSpawnError;
    lastSpawnError = null;
    return e;
}

/**
 * Construye la tab de UNA sesion aplicando la doble verificacion de
 * sessions.resolve():
 *   id vivo      -> --resume <id>            (inmune a que renombres)
 *   id muerto    -> --resume <id del nombre> (inmune a rotacion de archivo)
 *   ninguno      -> --resume "<nombre>"      (abre el selector de Claude, que
 *                   falla amable, en vez del "not found" seco de un id malo)
 *
 * @param {{id?:string,title?:string}} entry
 */
function tabArgs(entry, isFirst) {
    const r = sessions.resolve(entry.id, entry.title);
    if (r.mode === 'none') return null;

    const label = (r.title || entry.title || 'claude').slice(0, 32);
    const args = [];
    if (!isFirst) args.push(';');

    if (r.mode === 'picker') {
        // sin carpeta conocida: se abre donde el usuario tenga por defecto y
        // se deja que el selector resuelva con el nombre como filtro
        args.push('new-tab', '--title', label, ...CLAUDE, '--resume', r.title);
    } else {
        args.push('new-tab', '--title', label, '-d', r.cwd, ...CLAUDE, '--resume', r.id);
    }
    return { args, mode: r.mode, label };
}

/**
 * @param {Array<{id?:string,title?:string}>} entries sesiones a abrir
 * @returns {{ok:boolean, opened:string[], skipped:string[], modes:object, error?:string}}
 */
function launch(entries) {
    const opened = [], skipped = [], modes = {};
    let args = [];

    for (const e of entries) {
        const t = tabArgs(e, args.length === 0);
        if (t) {
            args = args.concat(t.args);
            opened.push(t.label);
            modes[t.label] = t.mode;
        } else {
            skipped.push(e.title || e.id || '?');
        }
    }

    if (args.length === 0) {
        return { ok: false, opened, skipped, modes, error: 'ninguna sesion resuelta' };
    }

    // CLAUDE_SD_DRYRUN=1 -> no abrir nada (lo usa test-harness.js)
    if (process.env.CLAUDE_SD_DRYRUN === '1') {
        return { ok: true, opened, skipped, modes, dryRun: true, args };
    }

    try {
        const child = spawn(WT, args, { detached: true, stdio: 'ignore', windowsHide: false });
        // spawn no lanza en ENOENT: llega por el evento 'error'
        child.on('error', (e) => { lastSpawnError = e.message; });
        child.unref();
        return { ok: true, opened, skipped, modes };
    } catch (e) {
        return { ok: false, opened: [], skipped: entries.map(e => e.title || e.id || '?'),
                 modes, error: e.message };
    }
}

/**
 * "Todas" = las sesiones a las que el usuario les puso nombre, menos las que
 * tengan su propio boton (lista `excluidas`). Las sin bautizar son restos de
 * pruebas. Asi la lista se mantiene sola: nombra una y entra, quita el nombre
 * y sale.
 *
 * @param {string[]} excluidas ids que NO deben entrar en el grupo
 */
function namedSessions(excluidas = [], limit = 12) {
    const fuera = new Set(excluidas || []);
    return sessions.list()
        .filter(s => s.title && !fuera.has(s.id))
        .slice(0, limit)
        .map(s => ({ id: s.id, title: s.title }));
}

function launchAll(excluidas) { return launch(namedSessions(excluidas)); }
function launchOne(id, title) { return launch([{ id, title }]); }

/**
 * Carpeta por defecto para los botones que no apuntan a una sesion concreta.
 * Se resuelve del entorno, no de una ruta fija, para que funcione en cualquier
 * maquina. Se puede forzar con la variable CLAUDE_SD_CWD.
 */
function cwdPorDefecto() {
    if (process.env.CLAUDE_SD_CWD) return process.env.CLAUDE_SD_CWD;

    const home = require('os').homedir();
    const path = require('path');
    const candidatos = [
        path.join(home, 'Documents', 'Claude', 'Projects'),
        path.join(home, 'Documents', 'Claude'),
        path.join(home, 'Documents'),
    ];
    return candidatos.find(exists) || home;
}

const CWD_POR_DEFECTO = cwdPorDefecto();

/**
 * Parte una linea de parametros respetando comillas:
 *   --model opus --add-dir "C:\Mi Carpeta"
 *   -> ['--model','opus','--add-dir','C:\Mi Carpeta']
 */
function partirArgs(linea) {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(String(linea || ''))) !== null) {
        out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
    }
    return out;
}

/** Abre Claude con parametros libres (o sin ninguno) en una carpeta. */
function launchCustom(params, cwd, titulo) {
    const dir = (cwd && String(cwd).trim()) || CWD_POR_DEFECTO;
    if (!exists(dir)) {
        return { ok: false, opened: [], skipped: [titulo || 'custom'], modes: {},
                 error: 'no existe la carpeta ' + dir };
    }

    const extra = partirArgs(params);
    const label = (titulo && titulo.trim()) || (extra.length ? extra.join(' ').slice(0, 24) : 'claude');
    const args = ['new-tab', '--title', label, '-d', dir, ...CLAUDE, ...extra];

    if (process.env.CLAUDE_SD_DRYRUN === '1') {
        return { ok: true, opened: [label], skipped: [], modes: { [label]: 'custom' },
                 dryRun: true, args };
    }
    try {
        const child = spawn(WT, args, { detached: true, stdio: 'ignore', windowsHide: false });
        child.on('error', (e) => { lastSpawnError = e.message; });
        child.unref();
        return { ok: true, opened: [label], skipped: [], modes: { [label]: 'custom' } };
    } catch (e) {
        return { ok: false, opened: [], skipped: [label], modes: {}, error: e.message };
    }
}

/** `claude --resume` sin id: abre el selector interactivo de Claude. */
function launchPicker(cwd) {
    return launchCustom('--resume', cwd, 'resume');
}

module.exports = {
    launch, launchAll, launchOne, launchCustom, launchPicker,
    namedSessions, partirArgs, takeSpawnError,
    WT, CLAUDE, CWD_POR_DEFECTO,
};
