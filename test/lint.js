// Scripts written through a shell have twice had a backslash eaten into a
// control character ("\b" -> backspace, "\tools\node" -> tab + newline).
// This fails on any such character in the launchers and sources.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const files = [];
for (const dir of ['', 'client', 'tools', 'test']) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
        if (/\.(js|cmd|ps1|json|md)$/.test(name)) files.push(path.join(dir, name));
    }
}
let bad = 0;
for (const file of files) {
    const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
        // A line may end in \r (CRLF files); anything else below 0x20 but tab is wrong,
        // and a tab is wrong in the launchers, which never indent with one.
        const text = line.replace(/\r$/, '');
        const ctl = /\.(cmd|ps1)$/.test(file) ? /[\x00-\x1f\x7f]/ : /[\x00-\x08\x0b-\x1f\x7f]/;
        if (ctl.test(text)) { bad++; console.log(`FAIL ${file}:${i + 1} has a control character: ${JSON.stringify(text.slice(0, 120))}`); }
        if (/\.(cmd|ps1)$/.test(file) && /\r/.test(text)) { bad++; console.log(`FAIL ${file}:${i + 1} has a stray carriage return`); }
    });
    // Launchers: either every line ends CRLF or none does; a mix means a line was cut in two.
    if (/\.(cmd|ps1)$/.test(file)) {
        const crlf = lines.slice(0, -1).filter((l) => l.endsWith('\r')).length;
        if (crlf && crlf !== lines.length - 1) { bad++; console.log(`FAIL ${file} mixes CRLF and LF line ends`); }
    }
}
// The release zip holds every script the packaged ones load or start.
const pkg = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'tools', 'package.js'), '--check'], { encoding: 'utf8' });
if (pkg.status !== 0) { bad++; console.log('FAIL ' + pkg.stderr.trim()); }
console.log(bad ? `${bad} problem(s)` : `lint: ${files.length} files clean`);
process.exit(bad ? 1 : 0);
