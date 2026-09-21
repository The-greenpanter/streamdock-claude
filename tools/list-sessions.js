'use strict';
// Lista las sesiones de Claude: titulo, id y carpeta. Solo lectura.
// El customTitle esta en la PRIMERA linea del .jsonl, asi que no hace falta
// leer archivos enteros (algunos pesan megas).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(require('os').homedir(), '.claude', 'projects');
const rows = [];

for (const d of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, d);
    let st; try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;

    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        const full = path.join(dir, f);

        // leer solo los primeros 8 KB: ahi caben la 1a y 2a linea
        let head = '';
        try {
            const fd = fs.openSync(full, 'r');
            const buf = Buffer.alloc(8192);
            const n = fs.readSync(fd, buf, 0, 8192, 0);
            fs.closeSync(fd);
            head = buf.slice(0, n).toString('utf8');
        } catch { continue; }

        let title = '', cwd = '';
        for (const line of head.split('\n')) {
            if (!line.trim()) continue;
            try {
                const j = JSON.parse(line);
                if (!title && j.customTitle) title = j.customTitle;
                if (!cwd && j.cwd) cwd = j.cwd;
            } catch { /* linea partida por el corte de 8 KB */ }
        }

        rows.push({
            id: f.replace('.jsonl', ''),
            title: title || '(sin titulo)',
            cwd,
            mt: fs.statSync(full).mtime,
        });
    }
}

rows.sort((a, b) => b.mt - a.mt);
for (const r of rows.slice(0, 14)) {
    console.log(r.mt.toISOString().slice(5, 16).replace('T', ' '),
        '|', r.title.slice(0, 26).padEnd(26),
        '|', r.id.slice(0, 8),
        '|', r.cwd);
}
