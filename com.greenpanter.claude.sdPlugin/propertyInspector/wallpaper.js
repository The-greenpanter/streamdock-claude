/* Property Inspector del wallpaper. Corre en el CEF del host. */
let ws = null;
let piContext = null;
let settings = {};

const $source = document.getElementById('source');
const $mode = document.getElementById('mode');
const $fit = document.getElementById('fit');
const $browse = document.getElementById('browse');
const $picker = document.getElementById('picker');
const $reset = document.getElementById('reset');

const SLIDERS = [
    { el: document.getElementById('zoom'),    out: document.getElementById('zoomVal'),    key: 'zoom',    def: 100 },
    { el: document.getElementById('offsetX'), out: document.getElementById('offsetXVal'), key: 'offsetX', def: 0 },
    { el: document.getElementById('offsetY'), out: document.getElementById('offsetYVal'), key: 'offsetY', def: 0 },
];

$source.addEventListener('change', () => { settings.source = $source.value.trim(); save(); });
$mode.addEventListener('change', () => { settings.mode = $mode.value; save(); });
$fit.addEventListener('change', () => { settings.fit = $fit.value; save(); });

for (const s of SLIDERS) {
    // 'input' refresca la etiqueta en vivo; 'change' (al soltar) es el que
    // guarda, para no re-renderizar el device en cada pixel del arrastre.
    s.el.addEventListener('input', () => { s.out.textContent = s.el.value + '%'; });
    s.el.addEventListener('change', () => { settings[s.key] = Number(s.el.value); save(); });
}

$reset.addEventListener('click', () => {
    for (const s of SLIDERS) {
        s.el.value = s.def;
        s.out.textContent = s.def + '%';
        settings[s.key] = s.def;
    }
    save();
});

$browse.addEventListener('click', () => $picker.click());
$picker.addEventListener('change', () => {
    const f = $picker.files && $picker.files[0];
    if (!f) return;
    // En el CEF, File.path trae la ruta absoluta real del disco.
    const p = f.path || f.name;
    $source.value = p;
    settings.source = p;
    save();
});

function save() {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ event: 'setSettings', context: piContext, payload: settings }));
}

function apply(s) {
    settings = s || {};
    if (settings.source) $source.value = settings.source;
    if (settings.mode) $mode.value = settings.mode;
    if (settings.fit) $fit.value = settings.fit;
    for (const sl of SLIDERS) {
        const v = settings[sl.key] == null ? sl.def : Number(settings[sl.key]);
        sl.el.value = v;
        sl.out.textContent = v + '%';
    }
}

function connectElgatoStreamDeckSocket(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
    piContext = inUUID;
    try {
        const ai = typeof inActionInfo === 'string' ? JSON.parse(inActionInfo) : inActionInfo;
        apply(ai && ai.payload && ai.payload.settings);
    } catch (e) { /* sin settings previos */ }

    ws = new WebSocket('ws://127.0.0.1:' + inPort);
    ws.onopen = () => ws.send(JSON.stringify({ event: inRegisterEvent, uuid: inUUID }));
    ws.onmessage = (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }
        if (msg.event === 'didReceiveSettings') apply(msg.payload && msg.payload.settings);
    };
}

window.connectSocket = connectElgatoStreamDeckSocket;
