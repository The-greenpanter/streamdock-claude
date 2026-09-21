'use strict';
// Indice de sesiones de Claude Code leyendo ~/.claude/projects/<cwd>/<id>.jsonl
//
// Donde vive cada dato (comprobado, no supuesto):
//   cwd         -> primeras lineas del archivo
//   customTitle -> se APENDA cerca del final al renombrar
//                  (jarvis: linea 913 de 976; plotly: 320 de 329)
// Por eso se leen solo la cabeza y la cola, no el archivo entero: algunos
// pesan 2 MB y son 19+.

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const HEAD_BYTES = 8 * 1024;
const TAIL_BYTES = 96 * 1024;

function readChunk(file, bytes, fromEnd) {
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const size = fs.fstatSync(fd).size;
        const len = Math.min(bytes, size);
        const pos = fromEnd ? size - len : 0;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, pos);
        return buf.toString('utf8');
    } catch {
        return '';
    } finally {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ya cerrado */ } }
    }
}

/** Recorre las lineas JSON completas de un trozo y aplica fn a cada objeto. */
function eachJson(chunk, fn) {
    for (const line of chunk.split('\n')) {
        const t = line.trim();
        if (!t || t[0] !== '{') continue;   // trozo cortado a media linea
        try { fn(JSON.parse(t)); } catch { /* linea partida por el corte */ }
    }
}

function readSession(file) {
    let cwd = '';
    eachJson(readChunk(file, HEAD_BYTES, false), j => { if (!cwd && j.cwd) cwd = j.cwd; });

    let title = '';
    eachJson(readChunk(file, TAIL_BYTES, true), j => { if (j.customTitle) title = j.customTitle; });

    // si el archivo es pequeno, cabeza y cola se solapan y title ya salio;
    // si no salio y el archivo cabe entero, se mira completo como respaldo
    if (!title) {
        try {
            if (fs.statSync(file).size <= HEAD_BYTES + TAIL_BYTES) {
                eachJson(fs.readFileSync(file, 'utf8'), j => { if (j.customTitle) title = j.customTitle; });
            }
        } catch { /* ignorar */ }
    }

    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { /* ignorar */ }

    return {
        id: path.basename(file, '.jsonl'),
        title,
        cwd,
        mtime,
        file,
    };
}

/** @returns {Array<{id,title,cwd,mtime,file}>} mas recientes primero */
function list() {
    const out = [];
    let dirs;
    try { dirs = fs.readdirSync(ROOT); } catch { return out; }

    for (const d of dirs) {
        const dir = path.join(ROOT, d);
        try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }

        let files;
        try { files = fs.readdirSync(dir); } catch { continue; }

        for (const f of files) {
            if (!f.endsWith('.jsonl')) continue;
            const s = readSession(path.join(dir, f));
            if (s.cwd) out.push(s);
        }
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
}

function byId(id) {
    if (!id) return null;
    return list().find(s => s.id === id) || null;
}

function byTitle(title) {
    if (!title) return null;
    const t = String(title).toLowerCase();
    const all = list();
    return all.find(s => s.title.toLowerCase() === t) ||
           all.find(s => s.title.toLowerCase().startsWith(t)) ||
           null;
}

/**
 * Doble verificacion, en este orden:
 *   1. el id guardado sigue existiendo -> usarlo (inmune a renames)
 *   2. no existe pero el nombre si -> usar ese id (inmune a rotacion de archivo)
 *   3. ninguno -> dejar que Claude abra su selector con el nombre como filtro,
 *      que falla de forma amable en vez de "session not found"
 *
 * @returns {{mode:'id'|'title'|'picker'|'none', id?:string, cwd?:string, title?:string}}
 */
function resolve(savedId, savedTitle) {
    const hit = byId(savedId);
    if (hit) return { mode: 'id', id: hit.id, cwd: hit.cwd, title: hit.title || savedTitle || '' };

    const byName = byTitle(savedTitle);
    if (byName) return { mode: 'title', id: byName.id, cwd: byName.cwd, title: byName.title };

    if (savedTitle) return { mode: 'picker', title: savedTitle };
    return { mode: 'none' };
}

module.exports = { list, byId, byTitle, resolve, ROOT };
