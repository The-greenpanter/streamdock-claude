'use strict';
// Cliente del protocolo StreamDock / Elgato SDK v2.
// El host arranca este proceso con:
//   node20.exe index.js -port N -pluginUUID X -registerEvent E -info {...}

const WebSocket = require('ws');
const EventEmitter = require('events');

/**
 * El host lanza:  node20.exe index.js -port N -pluginUUID U -registerEvent E -info {...}
 *
 * Se parsea por nombre, pero con respaldo POSICIONAL: los plugins de fabrica
 * que funcionan leen process.argv[3]/[5]/[7]/[9] a pelo, sin mirar los flags.
 * Si el host cambiara los nombres, el parseo por nombre se queda vacio y el
 * plugin no arrancaria nunca; las posiciones son el contrato real.
 */
function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('-') && i + 1 < argv.length) {
            out[a.replace(/^-+/, '')] = argv[i + 1];
            i++;
        }
    }
    // argv aqui ya viene sin [node, script]: -port=0, valor=1, -uuid=2, valor=3...
    if (!out.port && argv[1]) out.port = argv[1];
    if (!out.pluginUUID && argv[3]) out.pluginUUID = argv[3];
    if (!out.registerEvent && argv[5]) out.registerEvent = argv[5];
    if (!out.info && argv[7]) out.info = argv[7];
    return out;
}

class StreamDock extends EventEmitter {
    constructor(argv = process.argv.slice(2)) {
        super();
        const a = parseArgs(argv);
        this.port = a.port;
        this.uuid = a.pluginUUID;
        this.registerEvent = a.registerEvent;
        try { this.info = JSON.parse(a.info || '{}'); } catch { this.info = {}; }
        this.ws = null;
    }

    connect() {
        if (!this.port || !this.uuid || !this.registerEvent) {
            throw new Error('faltan argumentos del host (-port/-pluginUUID/-registerEvent)');
        }
        this.ws = new WebSocket('ws://127.0.0.1:' + this.port);

        this.ws.on('open', () => {
            this.send({ event: this.registerEvent, uuid: this.uuid });
            this.emit('connected');
        });

        this.ws.on('message', (data) => {
            let msg;
            try { msg = JSON.parse(data.toString()); } catch { return; }
            this.emit('event', msg);
            if (msg.event) this.emit(msg.event, msg);
        });

        this.ws.on('error', (e) => this.log('ws error: ' + e.message));
        this.ws.on('close', () => this.emit('disconnected'));
        return this;
    }

    send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }

    // --- API de acciones -------------------------------------------------
    setImage(context, image, target = 0) {
        this.send({ event: 'setImage', context, payload: { image, target } });
    }
    setTitle(context, title, target = 0) {
        this.send({ event: 'setTitle', context, payload: { title: String(title), target } });
    }
    setState(context, state) {
        this.send({ event: 'setState', context, payload: { state } });
    }
    setSettings(context, settings) {
        this.send({ event: 'setSettings', context, payload: settings });
    }
    getSettings(context) {
        this.send({ event: 'getSettings', context });
    }
    // Globales: compartidos por todos los botones del plugin. Se usan para la
    // lista de sesiones excluidas del boton "Todas", que una tecla decide y
    // otra tiene que respetar.
    setGlobalSettings(settings) {
        this.send({ event: 'setGlobalSettings', context: this.uuid, payload: settings });
    }
    getGlobalSettings() {
        this.send({ event: 'getGlobalSettings', context: this.uuid });
    }
    showOk(context)    { this.send({ event: 'showOk', context }); }
    showAlert(context) { this.send({ event: 'showAlert', context }); }
    sendToPropertyInspector(context, action, payload) {
        this.send({ event: 'sendToPropertyInspector', context, action, payload });
    }
    /**
     * El log del host NO recoge los logMessage de los plugins (comprobado:
     * cero lineas en log-*.txt). Se escribe ademas a un archivo propio, que es
     * el unico sitio donde se puede ver que le paso al plugin.
     */
    log(message) {
        const line = '[' + new Date().toISOString() + '] ' + String(message);
        this.send({ event: 'logMessage', payload: { message: String(message) } });
        try {
            const fs = require('fs');
            const path = require('path');
            const dir = path.join(__dirname, '..', 'log');
            fs.mkdirSync(dir, { recursive: true });
            const f = path.join(dir, 'plugin.log');
            // rotacion simple: evita que crezca sin limite
            try {
                if (fs.statSync(f).size > 512 * 1024) {
                    fs.renameSync(f, f.replace(/\.log$/, '.1.log'));
                }
            } catch { /* aun no existe */ }
            fs.appendFileSync(f, line + '\n');
        } catch { /* el log nunca debe tumbar el plugin */ }
    }
}

module.exports = { StreamDock, parseArgs };
