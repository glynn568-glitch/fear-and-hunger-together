// Marks files in a zip as runnable on Linux and macOS (mode 755). The zip is
// made on Windows, where a shell script has no such mark; without it a Steam
// Deck cannot start play.sh as a game. Rewrites the central directory in place.
const fs = require('fs');

function markRunnable(zip, test) {
    const buf = fs.readFileSync(zip);
    const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0) throw new Error(zip + ' is not a zip');
    const count = buf.readUInt16LE(end + 10);
    let p = buf.readUInt32LE(end + 16);
    const marked = [];
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('unexpected zip layout at entry ' + i);
        const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        if (test(name)) {
            buf.writeUInt16LE((3 << 8) | (buf.readUInt16LE(p + 4) & 0xff), p + 4); // made on Unix: the mode below counts
            buf.writeUInt32LE(((0o100755 << 16) | (buf.readUInt32LE(p + 38) & 0xffff)) >>> 0, p + 38);
            marked.push(name);
        }
        p += 46 + nameLen + extraLen + commentLen;
    }
    fs.writeFileSync(zip, buf);
    return marked;
}

module.exports = { markRunnable };
