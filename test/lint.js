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
// Node 24's rmSync does nothing, and its cpSync writes elsewhere, in a folder whose
// name is not plain ASCII (a player named José or Иван, say): never in what players run.
for (const file of files.filter((f) => /\.js$/.test(f) && !/^test|^tools[\\/](package|release)\.js$/.test(f))) {
    fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
        if (/\b(rmSync|cpSync)\s*\(|\{[^}]*\b(rmSync|cpSync)\b[^}]*\}\s*=\s*require/.test(line)) { bad++; console.log(`FAIL ${file}:${i + 1} uses fs.rmSync/cpSync (unlinkSync, or async fs.rm)`); }
    });
}
// The release zip holds every script the packaged ones load or start.
const pkg = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'tools', 'package.js'), '--check'], { encoding: 'utf8' });
if (pkg.status !== 0) { bad++; console.log('FAIL ' + pkg.stderr.trim()); }
// Every broken twin still finds the fix it takes out (test/twins.js).
const twins = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'twins.js'), '--check'], { encoding: 'utf8' });
if (twins.status !== 0) { bad++; console.log(twins.stdout.trim() + twins.stderr.trim()); }
// Suites run several at a time: no two in the full run may use the same port (a joiner sits at
// its twoPlayers() or night() port + 100). publish and carry once shared one, and failed together.
const all = JSON.parse(fs.readFileSync(path.join(__dirname, 'run.js'), 'utf8').match(/const ALL = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
const claimed = {};
for (const suite of all) {
    const text = fs.readFileSync(path.join(__dirname, suite + '.js'), 'utf8');
    const ports = new Set([...text.matchAll(/\b8[4-8]\d\d\b/g)].map((m) => +m[0]));
    for (const m of text.matchAll(/\b(?:twoPlayers|night)\((8[4-8]\d\d)\b/g)) ports.add(+m[1] + 100);
    // Ports worked out from a constant (four.js: HOST + 1, HOST + 2). carry once took one of them.
    for (const m of text.matchAll(/\bconst (\w+) = (8[4-8]\d\d)\b/g)) {
        for (const k of text.matchAll(new RegExp('\\b' + m[1] + ' \\+ (\\d+)\\b', 'g'))) ports.add(+m[2] + +k[1]);
    }
    for (const p of ports) (claimed[p] = claimed[p] || []).push(suite);
}
for (const [p, by] of Object.entries(claimed)) if (by.length > 1) { bad++; console.log(`FAIL port ${p} is used by ${by.join(' and ')}, which can run at the same time`); }
console.log(bad ? `${bad} problem(s)` : `lint: ${files.length} files clean`);
process.exit(bad ? 1 : 0);
