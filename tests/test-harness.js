'use strict';
// Simula el host StreamDock: levanta un WebSocket server, arranca el plugin
// igual que lo hace la app, y comprueba el handshake, los repintados y el
// keyUp. NO lanza Windows Terminal de verdad (DRY=1 en el entorno).

const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 28196;
const PLUGIN_UUID = 'com.greenpanter.claude';
const NODE = 'C:\\Program Files (x86)\\StreamDock\\node\\node20.exe';

const seen = { register: false, images: 0, titles: [], logs: [], lastImageLen: 0 };
let child = null;

const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw.toString()); } catch { return; }

        if (m.event === 'registerPlugin') {
            seen.register = true;
            console.log('[host] registerPlugin uuid=' + m.uuid);

            // willAppear del boton "las 5 sesiones"
            send(ws, {
                event: 'willAppear',
                action: 'com.greenpanter.claude.launch',
                context: 'CTX-LAUNCH',
                payload: { settings: { project: 'all' }, coordinates: { column: 1, row: 1 } },
            });
            // willAppear del panel de estado
            send(ws, {
                event: 'willAppear',
                action: 'com.greenpanter.claude.status',
                context: 'CTX-STATUS',
                payload: { settings: {}, coordinates: { column: 2, row: 1 } },
            });

            // pulsacion a los 900 ms
            setTimeout(() => {
                console.log('[host] -> keyUp en CTX-LAUNCH');
                send(ws, {
                    event: 'keyUp',
                    action: 'com.greenpanter.claude.launch',
                    context: 'CTX-LAUNCH',
                    payload: { settings: { project: 'all' } },
                });
            }, 900);

            setTimeout(finish, 4200);
            return;
        }

        if (m.event === 'setImage') {
            seen.images++;
            seen.lastImageLen = (m.payload && m.payload.image || '').length;
        } else if (m.event === 'setTitle') {
            const t = m.payload && m.payload.title;
            if (seen.titles[seen.titles.length - 1] !== t) seen.titles.push(t);
        } else if (m.event === 'logMessage') {
            seen.logs.push(m.payload && m.payload.message);
        }
    });
});

function send(ws, obj) { ws.send(JSON.stringify(obj)); }

function finish() {
    console.log('\n=== RESULTADO ===');
    const checks = [
        ['registerPlugin recibido', seen.register],
        ['pinto imagenes (>20 frames)', seen.images > 20],
        ['data-URI PNG valido', seen.lastImageLen > 1000],
        ['puso titulos', seen.titles.length > 0],
        ['sin errores de spawn', !seen.logs.some(l => /spawn|fallo/i.test(l || ''))],
    ];
    let allOk = true;
    for (const [name, ok] of checks) {
        console.log((ok ? '  OK   ' : '  FALLA') + '  ' + name);
        if (!ok) allOk = false;
    }
    console.log('\n  frames pintados : ' + seen.images);
    console.log('  titulos         : ' + JSON.stringify(seen.titles));
    console.log('  logs del plugin : ' + JSON.stringify(seen.logs));

    if (child) child.kill();
    wss.close();
    process.exit(allOk ? 0 : 1);
}

child = spawn(NODE, [
    path.join(__dirname, '..', 'com.greenpanter.claude.sdPlugin', 'plugin', 'index.js'),
    '-port', String(PORT),
    '-pluginUUID', PLUGIN_UUID,
    '-registerEvent', 'registerPlugin',
    '-info', JSON.stringify({ application: { platform: 'windows' } }),
], { env: { ...process.env, CLAUDE_SD_DRYRUN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });

child.stdout.on('data', d => process.stdout.write('[plugin] ' + d));
child.stderr.on('data', d => process.stdout.write('[plugin:err] ' + d));
