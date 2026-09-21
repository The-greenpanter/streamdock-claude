'use strict';
// Plugin StreamDock — sesiones de Claude Code.
//
// Acciones:
//   .launch  Keypad                                 abre las sesiones
//   .status  Keypad / Information / SecondaryScreen  panel de estado
//
// Corre bajo el node20.exe que trae StreamDock.

const { StreamDock } = require('./sd');
const render = require('./render');
const {
    launch, launchAll, launchOne, launchCustom, launchPicker,
    namedSessions, takeSpawnError, CWD_POR_DEFECTO,
} = require('./launcher');

/**
 * Ajustes compartidos entre botones. Hoy solo `excluidas`: los ids que no
 * deben entrar en el boton "Todas" porque ya tienen tecla propia.
 */
let globales = { excluidas: [] };

// Colores por posicion en la lista, para que cada boton se distinga.
const ACCENTS = [
    render.COLORS.naranja, render.COLORS.brillante, render.COLORS.verde,
    render.COLORS.violeta, render.COLORS.azul, render.COLORS.rojo,
];

const wallpaper = require('./wallpaper');
const sessions = require('./sessions');

const ACTION_LAUNCH = 'com.greenpanter.claude.launch';
const ACTION_STATUS = 'com.greenpanter.claude.status';
const ACTION_WALL   = 'com.greenpanter.claude.wallpaper';

const FPS = 12;
const FRAME_MS = Math.round(1000 / FPS);

const sd = new StreamDock();

/** contexto -> estado del boton */
const buttons = new Map();

function getBtn(context, action) {
    if (!buttons.has(context)) {
        buttons.set(context, { context, action, settings: {}, phase: 0, mode: 'idle', until: 0 });
    }
    return buttons.get(context);
}

/**
 * Modo del boton:
 *   'all'    grupo de sesiones con nombre (menos las excluidas)
 *   'picker' claude --resume sin id -> selector interactivo de Claude
 *   'custom' claude con los parametros que escriba el usuario
 *   <id>     una sesion concreta
 */
function modoDe(settings) {
    const v = settings && settings.sessionId;
    if (!v || v === 'all') return 'all';
    if (v === 'picker' || v === 'custom') return v;
    return 'session';
}

function isGroup(settings) {
    return modoDe(settings) === 'all';
}

function accentFor(settings) {
    const m = modoDe(settings);
    if (m === 'all') return render.COLORS.naranja;
    if (m === 'picker') return render.COLORS.brillante;
    if (m === 'custom') return render.COLORS.verde;
    // color estable derivado del id, para que no cambie entre repintados
    const id = String(settings.sessionId);
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return ACCENTS[h % ACCENTS.length];
}

function recortar(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function labelFor(settings) {
    const m = modoDe(settings);

    if (m === 'all') {
        const n = namedSessions(globales.excluidas).length;
        return 'Claude\n' + n + ' sesiones';
    }
    if (m === 'picker') return 'elegir\nsesion';
    if (m === 'custom') {
        const p = (settings.params || '').trim();
        return p ? recortar(p, 18) : 'claude\nnuevo';
    }
    // el nombre puede haber cambiado: se pregunta al indice, no al settings
    const live = sessions.byId(settings.sessionId);
    const name = (live && live.title) || settings.sessionTitle || 'sesion';
    return recortar(name, 16);
}

// --- Bucle de animacion --------------------------------------------------
// Un solo timer para todos los botones: repintar es barato pero no gratis,
// y N timers desincronizados hacen parpadear el device.

let ticking = false;

function tick() {
    const now = Date.now();
    let alive = false;

    for (const b of buttons.values()) {
        if (b.action === ACTION_LAUNCH) {
            if (b.mode === 'launching') {
                alive = true;
                b.phase = (b.phase + 1 / (FPS * 1.2)) % 1;
                sd.setImage(b.context, render.spinner(b.phase, accentFor(b.settings)));
                if (now > b.until) { setMode(b, 'ok'); }
            } else if (b.mode === 'ok') {
                const t = 1 - Math.max(b.until - now, 0) / 900;
                if (t < 1) {
                    alive = true;
                    sd.setImage(b.context, render.ok(Math.min(t / 0.5, 1)));
                } else if (!b.settled) {
                    b.settled = true;
                    sd.setImage(b.context, render.ok(1));
                    setTimeout(() => setMode(b, 'idle'), 1200);
                }
            } else if (b.mode === 'fail') {
                if (now > b.until) setMode(b, 'idle');
                else alive = true;
            }
        } else if (b.action === ACTION_STATUS) {
            alive = true;
            b.phase = (b.phase + 1 / (FPS * 3)) % 1;
            paintStatus(b);
        }
    }

    if (!alive) { clearInterval(ticking); ticking = false; }
}

function ensureTicking() {
    if (!ticking) ticking = setInterval(tick, FRAME_MS);
}

function setMode(b, mode) {
    b.mode = mode;
    b.settled = false;
    if (mode === 'idle') {
        sd.setImage(b.context, render.idle(accentFor(b.settings)));
        sd.setTitle(b.context, labelFor(b.settings));
    } else if (mode === 'launching') {
        b.until = Date.now() + 2600;
        sd.setTitle(b.context, 'abriendo...');
        ensureTicking();
    } else if (mode === 'ok') {
        b.until = Date.now() + 900;
        ensureTicking();
    } else if (mode === 'fail') {
        b.until = Date.now() + 2000;
        sd.setImage(b.context, render.fail());
        ensureTicking();
    }
}

// --- Panel de estado -----------------------------------------------------

let statusCache = { at: 0, items: [], live: 0 };

const RECIENTE_MS = 24 * 60 * 60 * 1000;

function readStatus() {
    const now = Date.now();
    if (now - statusCache.at < 15000) return statusCache;

    // Una barra por sesion con nombre; encendida si se toco en el ultimo dia.
    // Antes contaba CARPETAS, que era justo el error de fondo del plugin.
    const named = sessions.list().filter(s => s.title).slice(0, 6);
    const items = named.map((s, i) => ({
        key: s.title,
        on: (now - s.mtime) < RECIENTE_MS,
        accent: ACCENTS[i % ACCENTS.length],
    }));

    statusCache = { at: now, items, live: items.filter(i => i.on).length };
    return statusCache;
}

function paintStatus(b) {
    const s = readStatus();
    sd.setImage(b.context, render.statusPanel(s.items, b.phase));
    sd.setTitle(b.context, s.live + '/' + s.items.length);
}

// --- Wallpaper -----------------------------------------------------------
// Un unico reloj para todas las teclas: si cada una llevara su propio timer
// se desincronizarian y la imagen se partiria visiblemente.

const wall = { timer: null, frame: 0, delays: [100], repaint: null };

/**
 * Botones de wallpaper ORDENADOS por posicion: teclas por filas
 * (0,0) (1,0) ... (4,0) (0,1) ... y despues las 3 del sidebar.
 *
 * El orden importa de verdad. Medido con una imagen de 18 colores unicos:
 * el device coloca la enesima imagen recibida en la enesima tecla fisica e
 * ignora el contexto. Los willAppear llegan desordenados, asi que pintar en
 * ese orden reparte la imagen mal. Emitiendo en orden de fila, la posicion
 * n-esima recibe su trozo n-esimo.
 *
 * Si el firmware respetara los contextos, ordenar no estropea nada: cada
 * contexto sigue recibiendo su propio recorte. Por eso es seguro en ambos
 * casos.
 */
function wallButtons(soloConTiles = true) {
    return [...buttons.values()]
        .filter(b => b.action === ACTION_WALL && (!soloConTiles || b.tiles))
        .sort((a, b) => {
            const ca = a.coords || { column: 0, row: 0 };
            const cb = b.coords || { column: 0, row: 0 };
            const sa = ca.column >= wallpaper.LAYOUT.sidebarCol ? 1 : 0;
            const sb = cb.column >= wallpaper.LAYOUT.sidebarCol ? 1 : 0;
            if (sa !== sb) return sa - sb;          // teclas primero, sidebar despues
            if (ca.row !== cb.row) return ca.row - cb.row;
            return ca.column - cb.column;
        });
}

/**
 * Recalcula y pinta los botones de wallpaper.
 *
 * Se agrupa con debounce porque los willAppear llegan en rafaga, pero cada
 * boton pinta SU contexto: es el contrato estandar del SDK.
 *
 * Hubo un intento de emitir en orden de posicion, partiendo de que el device
 * colocaba la enesima imagen en la enesima tecla. Ese patron encajaba con un
 * experimento de 18 casillas identicas, pero se cayo en cuanto hubo imagenes
 * distintas, modos mezclados y contextos obsoletos: el numero de envios dejo
 * de coincidir con el de teclas y no pintaba nada en su sitio. Inferencia de
 * una sola muestra; no se vuelve a ella sin una prueba controlada.
 */
function scheduleWallRepaint() {
    if (wall.repaint) clearTimeout(wall.repaint);
    wall.repaint = setTimeout(() => {
        wall.repaint = null;

        // Purga de contextos zombis: al mover o quitar teclas, el host no
        // siempre manda willDisappear, y quedaban botones fantasma con
        // coordenadas viejas. Se descartan los que no se han vuelto a ver en
        // esta rafaga de willAppear.
        const corte = Date.now() - 5000;
        for (const [ctx, b] of [...buttons]) {
            if (b.action === ACTION_WALL && b.seen && b.seen < corte) {
                buttons.delete(ctx);
            }
        }

        const bs = wallButtons(false);
        for (const b of bs) prepareWallpaper(b);

        wall.frame = 0;
        const animadas = bs.filter(b => b.tiles && b.tiles.uris.length > 1);
        if (animadas.length) {
            wall.delays = animadas[0].tiles.delays;
            startWall();
        } else {
            stopWall();
        }

        sd.log('wallpaper repintado: ' + bs.length + ' casillas [' +
               bs.map(b => (b.coords ? b.coords.column + ',' + b.coords.row : '?') +
                           (b.tiles ? '' : ':vacia')).join(' ') + ']');
    }, 250);
}

/** Calcula los tiles de un boton y pinta SU contexto. */
function prepareWallpaper(b) {
    const file = b.settings && b.settings.source;
    if (!file) {
        b.tiles = null;
        sd.setImage(b.context, render.idle(render.COLORS.gris));
        sd.setTitle(b.context, 'elige\nimagen');
        return;
    }
    try {
        const col = b.coords ? b.coords.column : 0;
        const row = b.coords ? b.coords.row : 0;
        b.tiles = wallpaper.tilesFor(file, col, row, b.settings.mode || 'span', {
            fit: b.settings.fit,
            zoom: b.settings.zoom,
            offsetX: b.settings.offsetX,
            offsetY: b.settings.offsetY,
        });
        sd.setTitle(b.context, '');
        // pintar el primer frame ya: la animacion, si la hay, sigue desde aqui
        sd.setImage(b.context, b.tiles.uris[0]);
    } catch (e) {
        b.tiles = null;
        sd.log('wallpaper FALLO en ' + (b.coords ? b.coords.column + ',' + b.coords.row : '?') +
               ' | archivo=' + file +
               ' | normalizado=' + wallpaper.normalizePath(file) +
               ' | ' + e.message);
        sd.setImage(b.context, render.fail());
        sd.setTitle(b.context, 'error');
    }
}

function startWall() {
    if (wall.timer) return;
    const step = () => {
        const bs = wallButtons().filter(b => b.tiles.uris.length > 1);
        if (bs.length === 0) { stopWall(); return; }
        for (const b of bs) {
            sd.setImage(b.context, b.tiles.uris[wall.frame % b.tiles.uris.length]);
        }
        wall.frame++;
        const d = wall.delays[wall.frame % wall.delays.length] || 100;
        wall.timer = setTimeout(step, d);
    };
    wall.timer = setTimeout(step, 0);
}

function stopWall() {
    if (wall.timer) { clearTimeout(wall.timer); wall.timer = null; }
}

// --- Eventos del host ----------------------------------------------------

sd.on('connected', () => {
    sd.log('claude plugin conectado');
    sd.getGlobalSettings();
});

sd.on('didReceiveGlobalSettings', (msg) => {
    const g = (msg.payload && msg.payload.settings) || {};
    globales = { excluidas: Array.isArray(g.excluidas) ? g.excluidas : [] };
    sd.log('globales: ' + globales.excluidas.length + ' sesiones excluidas del grupo');
    // el boton de grupo muestra el conteo, que acaba de cambiar
    for (const b of buttons.values()) {
        if (b.action === ACTION_LAUNCH && b.mode === 'idle') setMode(b, 'idle');
    }
});

sd.on('willAppear', (msg) => {
    const b = getBtn(msg.context, msg.action);
    b.settings = (msg.payload && msg.payload.settings) || {};
    b.coords = (msg.payload && msg.payload.coordinates) || b.coords;

    // Diagnostico de geometria: el reparto salio desordenado en el device
    // aunque el render local es correcto, asi que hay que ver que coordenadas
    // llegan de verdad y con que forma.
    b.seen = Date.now();

    if (b.action === ACTION_WALL) {
        sd.log('willAppear wallpaper ctx=' + String(msg.context).slice(0, 10) +
               ' coords=' + JSON.stringify(msg.payload && msg.payload.coordinates) +
               ' controller=' + (msg.payload && msg.payload.controller));
    }
    if (b.action === ACTION_STATUS) { ensureTicking(); paintStatus(b); }
    else if (b.action === ACTION_WALL) scheduleWallRepaint();
    else setMode(b, 'idle');
});

sd.on('willDisappear', (msg) => {
    buttons.delete(msg.context);
    if (wallButtons().length === 0) stopWall();
});

sd.on('didReceiveSettings', (msg) => {
    const b = getBtn(msg.context, msg.action);
    b.settings = (msg.payload && msg.payload.settings) || {};
    b.coords = (msg.payload && msg.payload.coordinates) || b.coords;
    if (b.action === ACTION_WALL) scheduleWallRepaint();
    else if (b.mode === 'idle' && b.action === ACTION_LAUNCH) setMode(b, 'idle');
});

sd.on('keyUp', (msg) => {
    const b = getBtn(msg.context, msg.action);
    b.settings = (msg.payload && msg.payload.settings) || b.settings;

    if (b.action === ACTION_STATUS) {
        statusCache.at = 0;   // refresco inmediato
        paintStatus(b);
        return;
    }

    if (b.action === ACTION_WALL) {
        wallpaper.clearCache();   // recarga desde disco por si cambio el archivo
        wall.frame = 0;
        for (const w of wallButtons()) w.tiles = null;
        scheduleWallRepaint();
        return;
    }

    const m = modoDe(b.settings);
    let res;
    if (m === 'all')          res = launchAll(globales.excluidas);
    else if (m === 'picker')  res = launchPicker(b.settings.cwd);
    else if (m === 'custom')  res = launchCustom(b.settings.params, b.settings.cwd,
                                                 b.settings.sessionTitle);
    else                      res = launchOne(b.settings.sessionId, b.settings.sessionTitle);

    sd.log('launch -> abiertas=' + res.opened.length +
           ' modos=' + JSON.stringify(res.modes || {}) +
           (res.skipped.length ? ' omitidas=' + res.skipped.join(',') : ''));

    if (!res.ok) {
        sd.log('fallo lanzamiento: ' + (res.error || '?'));
        setMode(b, 'fail');
        sd.setTitle(b.context, 'error');
        return;
    }
    if (res.skipped.length) sd.log('omitidos: ' + res.skipped.join(','));
    setMode(b, 'launching');

    // ENOENT llega asincrono por el evento 'error' del hijo
    setTimeout(() => {
        const err = takeSpawnError();
        if (err) { sd.log('spawn: ' + err); setMode(b, 'fail'); }
    }, 700);
});

// El Property Inspector pide la lista de sesiones al abrirse: no puede
// escanear el disco por su cuenta (corre en CEF, sin fs).
sd.on('sendToPlugin', (msg) => {
    const p = msg.payload || {};

    if (p.request === 'sessions') {
        const lista = sessions.list()
            .filter(s => s.title)
            .map(s => ({ id: s.id, title: s.title, cwd: s.cwd }));
        sd.sendToPropertyInspector(msg.context, msg.action, {
            sessions: lista,
            excluidas: globales.excluidas,
            cwdPorDefecto: CWD_POR_DEFECTO,
        });
        sd.log('PI pidio sesiones -> ' + lista.length);
        return;
    }

    if (p.request === 'excluir') {
        // el PI manda la lista completa, no un delta: asi dos botones no se
        // pisan si se editan seguidos
        globales.excluidas = Array.isArray(p.excluidas) ? p.excluidas : [];
        sd.setGlobalSettings({ excluidas: globales.excluidas });
        sd.log('excluidas del grupo: [' + globales.excluidas.join(', ') + ']');
        for (const b of buttons.values()) {
            if (b.action === ACTION_LAUNCH && b.mode === 'idle') setMode(b, 'idle');
        }
    }
});

sd.on('disconnected', () => process.exit(0));

try {
    sd.connect();
} catch (e) {
    console.error('[claude-plugin] ' + e.message);
    process.exit(1);
}
