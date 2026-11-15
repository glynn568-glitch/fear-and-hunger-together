// Hunt: recruit pages where Add Actor runs before the shared flag that closes the page,
// with a message, choice or wait first. Prints the commands from the page start to the flag.
const fs = require('fs');
const path = require('path');
const { findGame, readGameJson } = require('../find-game');
const DATA = path.join(process.env.FH_GAME || findGame(), 'data');
const census = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'census.json'), 'utf8'));
const sw = new Set(census.sw), priv = new Set(census.ssPrivate);
const actors = readGameJson(path.join(DATA, 'Actors.json'));
const sys = readGameJson(path.join(DATA, 'System.json'));
const WINDOW = new Set([101, 102, 103, 104, 230]);
const seenActor = {};
for (const file of fs.readdirSync(DATA).filter((n) => /^Map\d+\.json$/.test(n))) {
    const map = readGameJson(path.join(DATA, file));
    const mapId = Number(file.slice(3, 6));
    for (const ev of map.events || []) {
        if (!ev) continue;
        const condSw = new Set(), condSs = new Set();
        for (const p of ev.pages) { const c = p.conditions; if (c.switch1Valid) condSw.add(c.switch1Id); if (c.switch2Valid) condSw.add(c.switch2Id); if (c.selfSwitchValid) condSs.add(c.selfSwitchCh); }
        ev.pages.forEach((page, pi) => {
            if (page.trigger > 2) return;
            const l = page.list;
            l.forEach((c, i) => {
                if (c.code !== 129 || c.parameters[1] !== 0) return;
                // the closing flag: first shared write at or above this indent after the page start that a page of this event reads
                let win = l.slice(0, i).some((x) => WINDOW.has(x.code));
                let closeAt = -1, what = '';
                for (let j = 0; j < l.length; j++) {
                    const x = l[j], p = x.parameters;
                    if (x.code === 123 && p[1] === 0 && condSs.has(p[0]) && !priv.has(mapId + ',' + ev.id + ',' + p[0])) { closeAt = j; what = 'ss' + p[0]; }
                    if (x.code === 121) for (let id = p[0]; id <= p[1]; id++) if (sw.has(id) && condSw.has(id)) { closeAt = j; what = 'sw' + id + ':' + sys.switches[id]; }
                    if (closeAt >= 0) break;
                }
                if (!win || (closeAt >= 0 && closeAt < i)) return;
                const name = (actors[c.parameters[0]] || {}).name;
                const k = name + ' ' + (closeAt < 0 ? 'NO-CLOSE' : what);
                if (seenActor[k]) { seenActor[k]++; return; }
                seenActor[k] = 1;
                console.log(`${mapId},${ev.id} p${pi} ${ev.name}: recruits ${name} at ${i}, closed by ${closeAt < 0 ? 'nothing on this page' : what + ' at ' + closeAt}; window: ${l.slice(0, i).filter((x) => WINDOW.has(x.code)).length} boxes before`);
            });
        });
    }
}
console.log(seenActor);
