// Prints what each player's browser is measuring about its own smoothness.
//   node tools/stats.js [seconds] [ws url]
const WebSocket = require('ws');

const seconds = Number(process.argv[2] || 12);
const url = process.argv[3] || 'ws://localhost:' + (process.env.PORT || 8420) + '/coop/ws' + require('./version').socketQuery();
const ws = new WebSocket(url);
const seen = {};
ws.on('error', (e) => { console.error('cannot reach the server: ' + e.message); process.exit(1); });
ws.on('message', (raw, binary) => {
    if (binary) return;
    const msg = JSON.parse(raw);
    if (msg.t !== 'stats') return;
    (seen[msg.name || msg.from] = seen[msg.name || msg.from] || []).push(msg.s);
});
setTimeout(() => {
    const names = Object.keys(seen);
    if (!names.length) console.log('no reports: nobody has the game open in a visible tab (or their page predates the meter; reload it)');
    for (const name of names) {
        console.log('== ' + name);
        for (const s of seen[name]) {
            console.log(`  ${s.scene} map ${s.map}: screen ${s.screenHz} Hz, game ${s.stepsPerSec}/s, late ${s.lateSteps}, worst gap ${s.worstStepGapMs} ms, step ${s.stepCostMs} ms (worst ${s.stepCostWorstMs}), `
                + `stalls ${s.stalls}${s.stalls ? ' (worst ' + s.stallWorstMs + ' ms)' : ''}, keys ${s.keys}${s.keys ? ': ' + s.keyToGameMs + ' ms to game, ' + s.keyToPictureMs + ' ms to picture (worst ' + s.keyToPictureWorstMs + ')' : ''}`
                + `${s.streamingTo ? ', streaming to ' + s.streamingTo : ''}${s.fight ? ', fight ' + s.fight : ''}`);
        }
        const last = seen[name][seen[name].length - 1];
        console.log(`  ${last.window}, ${last.gpu}`);
    }
    ws.close();
    process.exit(0);
}, seconds * 1000);
