'use strict';
// Simula el host con la accion wallpaper puesta en las 18 posiciones y
// comprueba que todas se pintan y que la animacion avanza sincronizada.

const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 28197;
const NODE = 'C:/Program Files (x86)/StreamDock/node/node20.exe';
const GIF = path.join(__dirname, '..', 'test-anim.gif');

const perContext = new Map();
let child = null;

const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw.toString()); } catch { return; }

        if (m.event === 'registerPlugin') {
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 6; col++) {
                    ws.send(JSON.stringify({
                        event: 'willAppear',
                        action: 'com.greenpanter.claude.wallpaper',
                        context: 'C' + col + row,
                        payload: {
                            settings: { source: GIF, mode: 'span' },
                            coordinates: { column: col, row: row },
                        },
                    }));
                }
            }
            setTimeout(finish, 4500);
            return;
        }

        if (m.event === 'setImage') {
            const e = perContext.get(m.context) || { n: 0, uris: new Set() };
            e.n++;
            e.uris.add((m.payload.image || '').slice(-24));
            perContext.set(m.context, e);
        }
        if (m.event === 'logMessage') console.log('[plugin] ' + m.payload.message);
    });
});

function finish() {
    const ctxs = [...perContext.keys()].sort();
    const counts = ctxs.map(c => perContext.get(c).n);
    const distinct = ctxs.map(c => perContext.get(c).uris.size);
    const fingerprints = new Set(ctxs.map(c => [...perContext.get(c).uris].sort().join()));

    const checks = [
        ['las 18 posiciones pintaron', ctxs.length === 18],
        ['todas animaron (>8 repintados)', counts.length > 0 && counts.every(n => n > 8)],
        ['cada tile recorre sus 8 frames', distinct.length > 0 && distinct.every(d => d === 8)],
        ['los 18 tiles son distintos', fingerprints.size === 18],
        ['sincronizadas (spread <= 2)', counts.length > 0 && (Math.max(...counts) - Math.min(...counts)) <= 2],
    ];

    console.log('\n=== WALLPAPER ===');
    let ok = true;
    for (const [n, v] of checks) {
        console.log((v ? '  OK   ' : '  FALLA') + '  ' + n);
        if (!v) ok = false;
    }
    if (counts.length) {
        console.log('\n  contextos: ' + ctxs.length +
                    '   repintados por tile: ' + Math.min(...counts) + '-' + Math.max(...counts));
    }

    if (child) child.kill();
    wss.close();
    process.exit(ok ? 0 : 1);
}

child = spawn(NODE, [
    path.join(__dirname, '..', 'com.greenpanter.claude.sdPlugin', 'plugin', 'index.js'),
    '-port', String(PORT),
    '-pluginUUID', 'com.greenpanter.claude',
    '-registerEvent', 'registerPlugin',
    '-info', '{}',
], { stdio: ['ignore', 'pipe', 'pipe'] });

child.stdout.on('data', d => process.stdout.write('[out] ' + d));
child.stderr.on('data', d => process.stdout.write('[err] ' + d));
