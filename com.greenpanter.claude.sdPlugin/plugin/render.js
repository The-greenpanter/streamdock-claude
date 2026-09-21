'use strict';
// Rasterizador por software para los botones. Solo formas: el texto lo pinta
// StreamDock con setTitle, asi no hace falta empotrar una fuente.
// Paleta = thegreenpanter.com.

const { encodePNG, toDataURI } = require('./png');

const SIZE = 144; // renderizamos a @2x y el device lo baja a 72

const COLORS = {
    naranja:  [0xf2, 0x75, 0x07],
    azul:     [0x41, 0x5a, 0xa6],
    violeta:  [0x37, 0x3c, 0xa6],
    brillante:[0x38, 0x95, 0xea],
    crema:    [0xf2, 0xe8, 0xd5],
    negro:    [0x0d, 0x0d, 0x0d],
    verde:    [0x3f, 0xb9, 0x50],
    rojo:     [0xd9, 0x3f, 0x3f],
    gris:     [0x55, 0x59, 0x66],
};

class Canvas {
    constructor(w = SIZE, h = w) {
        this.w = w;
        this.h = h;
        this.buf = Buffer.alloc(w * h * 4);
    }

    // mezcla alfa sobre lo que ya hay
    blend(x, y, rgb, a) {
        if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        if (a > 1) a = 1;
        const i = (y * this.w + x) * 4;
        const dstA = this.buf[i + 3] / 255;
        const outA = a + dstA * (1 - a);
        if (outA <= 0) return;
        for (let c = 0; c < 3; c++) {
            this.buf[i + c] = Math.round((rgb[c] * a + this.buf[i + c] * dstA * (1 - a)) / outA);
        }
        this.buf[i + 3] = Math.round(outA * 255);
    }

    clear(rgb, a = 1) {
        for (let y = 0; y < this.h; y++) {
            for (let x = 0; x < this.w; x++) {
                const i = (y * this.w + x) * 4;
                this.buf[i] = rgb[0]; this.buf[i + 1] = rgb[1];
                this.buf[i + 2] = rgb[2]; this.buf[i + 3] = Math.round(a * 255);
            }
        }
    }

    // degradado vertical, para el fondo
    gradientV(top, bottom) {
        for (let y = 0; y < this.h; y++) {
            const t = y / (this.h - 1);
            const rgb = [
                Math.round(top[0] + (bottom[0] - top[0]) * t),
                Math.round(top[1] + (bottom[1] - top[1]) * t),
                Math.round(top[2] + (bottom[2] - top[2]) * t),
            ];
            for (let x = 0; x < this.w; x++) {
                const i = (y * this.w + x) * 4;
                this.buf[i] = rgb[0]; this.buf[i + 1] = rgb[1];
                this.buf[i + 2] = rgb[2]; this.buf[i + 3] = 255;
            }
        }
    }

    // rectangulo redondeado con antialias por cobertura
    roundRect(x0, y0, x1, y1, r, rgb, alpha = 1) {
        for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
            for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
                const cx = Math.min(Math.max(x + 0.5, x0 + r), x1 - r);
                const cy = Math.min(Math.max(y + 0.5, y0 + r), y1 - r);
                const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
                const cov = Math.min(Math.max(r + 0.5 - d, 0), 1);
                if (cov > 0) this.blend(x, y, rgb, cov * alpha);
            }
        }
    }

    disc(cx, cy, r, rgb, alpha = 1) {
        for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
            for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
                const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
                const cov = Math.min(Math.max(r + 0.5 - d, 0), 1);
                if (cov > 0) this.blend(x, y, rgb, cov * alpha);
            }
        }
    }

    /**
     * Arco de anillo. Angulos en radianes, 0 = arriba, sentido horario.
     * fade: si true, la opacidad decae a lo largo del barrido (cola de spinner).
     */
    ring(cx, cy, radius, thickness, from, sweep, rgb, alpha = 1, fade = false) {
        const rOut = radius + thickness / 2;
        const rIn = radius - thickness / 2;
        const TAU = Math.PI * 2;
        for (let y = Math.floor(cy - rOut - 1); y <= Math.ceil(cy + rOut + 1); y++) {
            for (let x = Math.floor(cx - rOut - 1); x <= Math.ceil(cx + rOut + 1); x++) {
                const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
                const d = Math.hypot(dx, dy);
                const cov = Math.min(
                    Math.min(Math.max(rOut + 0.5 - d, 0), 1),
                    Math.min(Math.max(d - rIn + 0.5, 0), 1)
                );
                if (cov <= 0) continue;
                let ang = Math.atan2(dx, -dy);           // 0 arriba, horario
                if (ang < 0) ang += TAU;
                let rel = ang - from;
                rel = ((rel % TAU) + TAU) % TAU;
                if (rel > sweep) continue;
                const a = fade ? alpha * (0.15 + 0.85 * (rel / sweep)) : alpha;
                this.blend(x, y, rgb, cov * a);
            }
        }
    }

    // segmento grueso con extremos redondeados (distancia punto-segmento)
    line(x0, y0, x1, y1, width, rgb, alpha = 1) {
        const r = width / 2;
        const minX = Math.floor(Math.min(x0, x1) - r - 1);
        const maxX = Math.ceil(Math.max(x0, x1) + r + 1);
        const minY = Math.floor(Math.min(y0, y1) - r - 1);
        const maxY = Math.ceil(Math.max(y0, y1) + r + 1);
        const vx = x1 - x0, vy = y1 - y0;
        const len2 = vx * vx + vy * vy;
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const px = x + 0.5 - x0, py = y + 0.5 - y0;
                let t = len2 > 0 ? (px * vx + py * vy) / len2 : 0;
                t = Math.min(Math.max(t, 0), 1);
                const d = Math.hypot(px - vx * t, py - vy * t);
                const cov = Math.min(Math.max(r + 0.5 - d, 0), 1);
                if (cov > 0) this.blend(x, y, rgb, cov * alpha);
            }
        }
    }

    toURI() {
        return toDataURI(encodePNG(this.buf, this.w, this.h));
    }
}

// --- Frames concretos ---------------------------------------------------

function background(c, accent) {
    c.gradientV([0x1a, 0x1d, 0x2b], [0x0d, 0x0d, 0x14]);
    // borde de acento sutil
    c.roundRect(2, 2, SIZE - 3, SIZE - 3, 18, accent, 0.22);
    c.roundRect(6, 6, SIZE - 7, SIZE - 7, 14, [0x12, 0x14, 0x1e], 1);
}

/** Estado reposo: anillo cerrado + punto central. */
function idle(accent = COLORS.naranja) {
    const c = new Canvas();
    background(c, accent);
    const m = SIZE / 2;
    c.ring(m, m, 40, 7, 0, Math.PI * 2, accent, 0.30);
    c.disc(m, m, 13, accent, 0.95);
    return c.toURI();
}

/** Spinner: cola de 270 grados girando. phase 0..1 */
function spinner(phase, accent = COLORS.brillante) {
    const c = new Canvas();
    background(c, accent);
    const m = SIZE / 2;
    c.ring(m, m, 40, 7, 0, Math.PI * 2, [0x2a, 0x2e, 0x3d], 1);
    c.ring(m, m, 40, 7, phase * Math.PI * 2, Math.PI * 1.5, accent, 1, true);
    c.disc(m, m, 9, accent, 0.5 + 0.5 * Math.abs(Math.sin(phase * Math.PI * 2)));
    return c.toURI();
}

/** Anillo de progreso 0..1 con N segmentos encendidos. */
function progress(done, total, accent = COLORS.naranja) {
    const c = new Canvas();
    background(c, accent);
    const m = SIZE / 2;
    const TAU = Math.PI * 2;
    c.ring(m, m, 40, 7, 0, TAU, [0x2a, 0x2e, 0x3d], 1);
    if (total > 0) {
        const gap = 0.06;
        const seg = TAU / total;
        for (let i = 0; i < done && i < total; i++) {
            c.ring(m, m, 40, 7, i * seg + gap / 2, seg - gap, accent, 1);
        }
    }
    c.disc(m, m, 11, accent, 0.9);
    return c.toURI();
}

/** Check verde. progreso 0..1 dibuja el trazo entrando. */
function ok(t = 1) {
    const c = new Canvas();
    background(c, COLORS.verde);
    const m = SIZE / 2;
    c.ring(m, m, 40, 7, 0, Math.PI * 2, COLORS.verde, 0.9);
    // dos tramos: bajada corta y subida larga
    const A = [54, 72], B = [67, 88], C = [93, 55];
    const t1 = Math.min(t / 0.35, 1);
    c.line(A[0], A[1], A[0] + (B[0] - A[0]) * t1, A[1] + (B[1] - A[1]) * t1, 11, COLORS.verde);
    if (t > 0.35) {
        const t2 = (t - 0.35) / 0.65;
        c.line(B[0], B[1], B[0] + (C[0] - B[0]) * t2, B[1] + (C[1] - B[1]) * t2, 11, COLORS.verde);
    }
    return c.toURI();
}

/** Aspa roja. */
function fail() {
    const c = new Canvas();
    background(c, COLORS.rojo);
    const m = SIZE / 2;
    c.ring(m, m, 40, 7, 0, Math.PI * 2, COLORS.rojo, 0.9);
    c.line(m - 20, m - 20, m + 20, m + 20, 11, COLORS.rojo);
    c.line(m + 20, m - 20, m - 20, m + 20, 11, COLORS.rojo);
    return c.toURI();
}

/**
 * Panel de estado: una barra por proyecto.
 * items = [{ on: bool, accent: [r,g,b] }]
 */
function statusPanel(items, pulse = 0) {
    const c = new Canvas();
    background(c, COLORS.azul);
    const n = Math.max(items.length, 1);
    const top = 26, bottom = SIZE - 26;
    const h = (bottom - top) / n;
    items.forEach((it, i) => {
        const y0 = top + i * h + 2;
        const y1 = y0 + h - 6;
        c.roundRect(24, y0, SIZE - 24, y1, (y1 - y0) / 2, [0x24, 0x28, 0x36], 1);
        if (it.on) {
            const p = 0.75 + 0.25 * Math.sin(pulse * Math.PI * 2 + i);
            c.roundRect(24, y0, SIZE - 24, y1, (y1 - y0) / 2, it.accent, p);
        }
    });
    return c.toURI();
}

module.exports = { Canvas, COLORS, SIZE, idle, spinner, progress, ok, fail, statusPanel };
