'use strict';
// Codificador PNG minimo, sin dependencias: RGBA crudo -> buffer PNG.
// Usa zlib de Node, asi no hace falta canvas/skia (26 MB de addon nativo).

const zlib = require('zlib');

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
}

/**
 * @param {Buffer} rgba  width*height*4 bytes
 * @returns {Buffer} PNG
 */
function encodePNG(rgba, width, height) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // color type RGBA
    ihdr[10] = 0;  // deflate
    ihdr[11] = 0;  // filter
    ihdr[12] = 0;  // no interlace

    // cada scanline lleva un byte de filtro (0 = None) por delante
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function toDataURI(png) {
    return 'data:image/png;base64,' + png.toString('base64');
}

/**
 * Decodifica PNG de 8 bits (RGB/RGBA/gris) a RGBA crudo.
 * Aplica los 5 filtros del spec; sin soporte de interlace Adam7 ni 16 bits.
 * @returns {{width:number,height:number,data:Buffer}}
 */
function decodePNG(buf) {
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('no es PNG');

    let p = 8, width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
    let palette = null, trns = null;
    const idat = [];

    while (p < buf.length) {
        const len = buf.readUInt32BE(p);
        const type = buf.toString('ascii', p + 4, p + 8);
        const data = buf.slice(p + 8, p + 8 + len);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            depth = data[8];
            colorType = data[9];
            interlace = data[12];
        } else if (type === 'PLTE') palette = data;
        else if (type === 'tRNS') trns = data;
        else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        p += 12 + len;
    }

    if (depth !== 8) throw new Error('solo PNG de 8 bits (este es de ' + depth + ')');
    if (interlace !== 0) throw new Error('PNG entrelazado no soportado');

    const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
    const ch = CHANNELS[colorType];
    if (!ch) throw new Error('colorType ' + colorType + ' no soportado');

    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * ch;
    const out = Buffer.alloc(width * height * 4);
    const prev = Buffer.alloc(stride);
    const cur = Buffer.alloc(stride);

    let ptr = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[ptr++];
        raw.copy(cur, 0, ptr, ptr + stride);
        ptr += stride;

        for (let i = 0; i < stride; i++) {
            const a = i >= ch ? cur[i - ch] : 0;   // izquierda
            const b = prev[i];                      // arriba
            const c = i >= ch ? prev[i - ch] : 0;   // arriba-izquierda
            let v = cur[i];
            switch (filter) {
                case 1: v += a; break;
                case 2: v += b; break;
                case 3: v += (a + b) >> 1; break;
                case 4: {
                    const pa = Math.abs(b - c), pb = Math.abs(a - c);
                    const pc = Math.abs(a + b - 2 * c);
                    v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
                    break;
                }
            }
            cur[i] = v & 0xff;
        }

        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            const s = x * ch;
            if (colorType === 6)      { cur.copy(out, o, s, s + 4); }
            else if (colorType === 2) { out[o] = cur[s]; out[o+1] = cur[s+1]; out[o+2] = cur[s+2]; out[o+3] = 255; }
            else if (colorType === 0) { out[o] = out[o+1] = out[o+2] = cur[s]; out[o+3] = 255; }
            else if (colorType === 4) { out[o] = out[o+1] = out[o+2] = cur[s]; out[o+3] = cur[s+1]; }
            else if (colorType === 3) {
                const idx = cur[s] * 3;
                out[o] = palette[idx]; out[o+1] = palette[idx+1]; out[o+2] = palette[idx+2];
                out[o+3] = trns && cur[s] < trns.length ? trns[cur[s]] : 255;
            }
        }
        cur.copy(prev);
    }

    return { width, height, data: out };
}

module.exports = { encodePNG, decodePNG, toDataURI };
