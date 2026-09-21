/* Property Inspector de Launch Sessions. Corre en el CEF del host, sin fs:
   la lista de sesiones se la pide al plugin por WebSocket. */
let ws = null;
let piContext = null;
let piAction = null;
let settings = {};
let lista = [];
let excluidas = [];
let cwdPorDefecto = '';

const $ = id => document.getElementById(id);
const $session = $('session');
const $refresh = $('refresh');
const $cwd = $('cwd');
const $excluir = $('excluir');
const $excluirRow = $('excluirRow');
const $params = $('params');
const $paramsRow = $('paramsRow');
const $cwdInput = $('cwdInput');
const $cwdRow = $('cwdRow');
const $titulo = $('titulo');
const $tituloRow = $('tituloRow');
const $hintSesion = $('hintSesion');
const $hintCustom = $('hintCustom');

const FIJOS = ['all', 'picker', 'custom'];

$session.addEventListener('change', () => {
    const v = $session.value;
    if (FIJOS.includes(v)) {
        settings.sessionId = v;
        if (v !== 'custom') { delete settings.params; }
        delete settings.sessionTitle;
    } else {
        const s = lista.find(x => x.id === v);
        settings.sessionId = v;
        // el nombre solo como respaldo si el id desaparece
        settings.sessionTitle = s ? s.title : '';
    }
    pintar();
    save();
});

$refresh.addEventListener('click', pedirSesiones);

$excluir.addEventListener('change', () => {
    const id = $session.value;
    if (FIJOS.includes(id)) return;
    const fuera = new Set(excluidas);
    if ($excluir.checked) fuera.add(id); else fuera.delete(id);
    excluidas = [...fuera];
    // se manda la lista completa para que dos botones no se pisen
    enviar({ request: 'excluir', excluidas });
});

for (const [el, key] of [[$params, 'params'], [$cwdInput, 'cwd'], [$titulo, 'sessionTitle']]) {
    el.addEventListener('change', () => {
        const v = el.value.trim();
        if (v) settings[key] = v; else delete settings[key];
        save();
    });
}

function pintar() {
    const v = $session.value;
    const esCustom = v === 'custom';
    const esPicker = v === 'picker';
    const esSesion = !FIJOS.includes(v);

    $excluirRow.hidden = !esSesion;
    $paramsRow.hidden = !esCustom;
    $cwdRow.hidden = !(esCustom || esPicker);
    $tituloRow.hidden = !esCustom;
    $hintSesion.hidden = !esSesion;
    $hintCustom.hidden = !esCustom;

    if (esSesion) $excluir.checked = excluidas.includes(v);

    const s = lista.find(x => x.id === v);
    $cwd.textContent = s ? s.cwd : '';
    $cwdInput.placeholder = cwdPorDefecto || '(por defecto)';
}

function render() {
    const elegido = settings.sessionId || 'all';

    // se conservan las tres opciones fijas y se recarga solo la lista
    for (const o of [...$session.options]) {
        if (!FIJOS.includes(o.value)) o.remove();
    }
    $session.options[0].textContent = 'Todas las sesiones con nombre (' +
        lista.filter(s => !excluidas.includes(s.id)).length + ')';

    for (const s of lista) {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.title + (excluidas.includes(s.id) ? '  ·' : '');
        $session.appendChild(o);
    }

    // si el id guardado ya no esta, se anade para no perder la seleccion
    if (!FIJOS.includes(elegido) && !lista.some(s => s.id === elegido)) {
        const o = document.createElement('option');
        o.value = elegido;
        o.textContent = (settings.sessionTitle || elegido.slice(0, 8)) + '  (no encontrada)';
        $session.appendChild(o);
    }

    $session.value = elegido;
    $params.value = settings.params || '';
    $cwdInput.value = settings.cwd || '';
    if (settings.sessionId === 'custom') $titulo.value = settings.sessionTitle || '';
    pintar();
}

function enviar(payload) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ event: 'sendToPlugin', context: piContext, action: piAction, payload }));
}

function pedirSesiones() { enviar({ request: 'sessions' }); }

function save() {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ event: 'setSettings', context: piContext, payload: settings }));
}

function connectElgatoStreamDeckSocket(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
    piContext = inUUID;

    try {
        const ai = typeof inActionInfo === 'string' ? JSON.parse(inActionInfo) : inActionInfo;
        settings = (ai && ai.payload && ai.payload.settings) || {};
        piAction = ai && ai.action;
    } catch (e) { settings = {}; }

    ws = new WebSocket('ws://127.0.0.1:' + inPort);
    ws.onopen = () => {
        ws.send(JSON.stringify({ event: inRegisterEvent, uuid: inUUID }));
        pedirSesiones();
    };
    ws.onmessage = (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }

        if (msg.event === 'didReceiveSettings') {
            settings = (msg.payload && msg.payload.settings) || {};
            render();
        } else if (msg.event === 'sendToPropertyInspector') {
            const p = msg.payload || {};
            if (Array.isArray(p.sessions)) lista = p.sessions;
            if (Array.isArray(p.excluidas)) excluidas = p.excluidas;
            if (p.cwdPorDefecto) cwdPorDefecto = p.cwdPorDefecto;
            render();
        }
    };
}

window.connectSocket = connectElgatoStreamDeckSocket;
