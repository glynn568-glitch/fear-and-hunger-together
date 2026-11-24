// Beds in a run take the host's clock, learned from hello before the page has a
// chance to stamp with its own. A PC set a quarter-hour off still sorts after a
// bed made earlier, and the file is within a few seconds of the host. A save made
// alone keeps that PC's clock. Ports 8544 and 8644 (8644 is PORT + 100, the
// friend's own server, only when FH_TEST_JOIN is set).
const fs = require('fs');
const path = require('path');
const { startServer, launch, openPlayer } = require('./lib');
const { checker, sleep, waitFor } = require('./common');
const install = require('./helpers');

const PORT = 8544;
const AHEAD = 15 * 60 * 1000;
// Hello is late by a fraction of a second. The window is a little wider so a slow
// write still counts, and a clock a quarter-hour off still fails.
const NEAR = 8000;

function bedList(server, runId) {
    const dir = path.join(server.saves, 'runs', String(runId).replace(/[^\w-]/g, ''));
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).map((name) => /^world@(\d+)\.json$/.exec(name)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
}

async function newBeds(server, runId, before) {
    for (let i = 0; i < 40; i++) {
        const added = bedList(server, runId).filter((n) => before.indexOf(n) < 0);
        if (added.length) return added;
        await sleep(50);
    }
    return [];
}

// openPlayer navigates as soon as the page exists. The clock has to be wrong
// before that, as it is on a real PC, so the offset is learned from the skewed clock.
async function openSkewed(browser, url, label, skew) {
    const orig = browser.createBrowserContext.bind(browser);
    browser.createBrowserContext = async () => {
        browser.createBrowserContext = orig;
        const ctx = await orig();
        const origPage = ctx.newPage.bind(ctx);
        ctx.newPage = async () => {
            const page = await origPage();
            await page.evaluateOnNewDocument((skew) => {
                const Real = Date;
                const now = function () { return Real.now() + skew; };
                function SkewDate(...args) {
                    if (!new.target) return new Real(now()).toString();
                    if (args.length === 0) return new Real(now());
                    return new Real(...args);
                }
                SkewDate.prototype = Real.prototype;
                SkewDate.now = now;
                SkewDate.parse = Real.parse;
                SkewDate.UTC = Real.UTC;
                window.Date = SkewDate;
            }, skew);
            return page;
        };
        return ctx;
    };
    return openPlayer(browser, url, label);
}

async function boot(skew, labelA, labelB) {
    let server = null, joiner = null, browser = null;
    try {
        server = await startServer(PORT);
        if (process.env.FH_TEST_JOIN) joiner = await startServer(PORT + 100, { FH_JOIN: `http://localhost:${PORT}/` });
        browser = await launch();
        const a = await openPlayer(browser, `http://localhost:${PORT}/?name=Ann`, labelA);
        const b = await openSkewed(browser, `http://localhost:${joiner ? PORT + 100 : PORT}/?name=Bo`, labelB, skew);
        for (const p of [a, b]) {
            await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title + connection');
            await p.evaluate(install);
        }
        let closed = false;
        return {
            server, joiner, browser, a, b,
            close: async () => {
                if (closed) return;
                closed = true;
                try { await browser.close(); } catch (e) { /* already gone */ }
                server.kill();
                if (joiner) joiner.kill();
            },
        };
    } catch (e) {
        if (browser) try { await browser.close(); } catch (err) { /* already gone */ }
        if (server) server.kill();
        if (joiner) joiner.kill();
        throw e;
    }
}

// The server we just stopped may still hold the port for a moment.
async function bootRetry(skew, labelA, labelB) {
    let last;
    for (let i = 0; i < 6; i++) {
        try { return await boot(skew, labelA, labelB); }
        catch (e) {
            last = e;
            // A title that never came up is not a busy port. Only the server we just stopped is retried.
            if (!/is taken|server exited|server start timeout|EADDRINUSE/.test(String(e && e.message || e)) || i === 5) throw e;
            await sleep(500);
        }
    }
    throw last;
}

const clockOf = (page) => page.evaluate(() => ({
    page: Date.now(),
    host: typeof Coop.now === 'function' ? Coop.now() : null,
    off: typeof Coop.clockOffset === 'number' ? Coop.clockOffset : null,
}));

const fileStamp = (page, slot) => page.evaluate((n) => {
    const info = (DataManager.loadGlobalInfo() || [])[n];
    const m = /"coop":\{[^{}]*"stamp":(\d+)/.exec(StorageManager.load(n) || '');
    return { info: info && Number(info.coopStamp) || 0, file: m ? Number(m[1]) : 0, page: Date.now() };
}, slot);

const save = (page, slot) => page.evaluate((n) => { $gameSystem.onBeforeSave(); return DataManager.saveGame(n); }, slot);

async function beside(page, slot, what) {
    try {
        await waitFor(page, (n) => StorageManager.exists(n), 8000, what, slot);
        return true;
    } catch (e) { return false; }
}

// Both into one run, the way the other suites start a game.
async function enter(a, b) {
    await a.evaluate((act, x, y) => T.quickStart(act, x, y), 1, 27, 67);
    await waitFor(a, () => T.onMap(), 60000, 'A on map');
    await a.evaluate(() => T.settle());
    await a.evaluate(() => T.begin());
    await waitFor(a, () => Coop.world.live, 10000, 'A live');
    await b.evaluate((act, x, y) => T.quickStart(act, x, y), 3, 28, 67);
    await waitFor(b, () => T.onMap(), 60000, 'B on map');
    await b.evaluate(() => T.settle());
    await b.evaluate(() => T.begin());
    await waitFor(b, () => Coop.world.live, 10000, 'B live');
    await a.evaluate(() => T.settle());
    await b.evaluate(() => T.settle());
    await sleep(500);
}

(async () => {
    const check = checker();
    const pages = [];
    let s = null;
    try {
        s = await boot(-AHEAD, 'A', 'B');
        pages.push(s.a, s.b);
        const { a, b, server } = s;

        const node = Date.now();
        const behind = await clockOf(b);
        check('Bo 15 minutes behind: his page learned the host clock',
            behind.host !== null && Math.abs(behind.page - (node - AHEAD)) < NEAR && Math.abs(behind.host - node) < NEAR,
            JSON.stringify(behind) + ' node ' + node);

        // Not in a run: still at the title, so the gate cannot enter him between the
        // setup and the write. A frame on the map could found a run before the save.
        const tSolo = Date.now();
        const solo = await b.evaluate((slot) => {
            DataManager.setupNewGame();
            const live = !!Coop.world.live;
            $gameSystem.onBeforeSave();
            const ok = DataManager.saveGame(slot);
            const info = (DataManager.loadGlobalInfo() || [])[slot];
            const m = /"coop":\{[^{}]*"stamp":(\d+)/.exec(StorageManager.load(slot) || '');
            return { ok: !!ok, live, info: info && Number(info.coopStamp) || 0, file: m ? Number(m[1]) : 0, page: Date.now() };
        }, 7);
        check('a save made alone uses the page\'s own clock',
            solo.ok && !solo.live && solo.file === solo.info && solo.file > 0
            && Math.abs(solo.file - solo.page) < NEAR && Math.abs(solo.file - tSolo) > 10 * 60 * 1000,
            JSON.stringify(solo) + ' host ' + tSolo);

        await enter(a, b);
        const runId = await a.evaluate(() => Coop.world.runId);

        let before = bedList(server, runId);
        await save(a, 1);
        const annBeds = await newBeds(server, runId, before);
        const annWrote = await beside(b, 1, 'Bo saved with Ann');
        const ann = await fileStamp(a, 1);
        const boWithAnn = await fileStamp(b, 1);
        const annBed = annBeds.indexOf(ann.file) >= 0 ? ann.file : (annBeds[0] || 0);

        await sleep(1000);
        before = bedList(server, runId);
        const t0 = Date.now();
        await save(b, 2);
        const t1 = Date.now();
        const boBeds = await newBeds(server, runId, before);
        const boWrote = await beside(a, 2, 'Ann saved with Bo');
        const bo = await fileStamp(b, 2);
        const annWithBo = await fileStamp(a, 2);
        const boBed = boBeds.indexOf(bo.file) >= 0 ? bo.file : (boBeds[boBeds.length - 1] || 0);
        check('Bo\'s clock 15 minutes behind: his later save is numbered after Ann\'s',
            annBed > 0 && boBed > annBed && bo.file === boBed && ann.file === annBed,
            annBed + ' then ' + boBed);
        check('his file\'s stamp is within a few seconds of the host\'s clock',
            bo.file >= t0 - NEAR && bo.file <= t1 + NEAR && Math.abs(bo.file - bo.page) > 10 * 60 * 1000,
            'file ' + bo.file + ' host ' + t0 + '..' + t1 + ' page ' + bo.page);
        check('the save alongside carries the same number as the saver\'s',
            annWrote && boWrote && ann.file > 0 && boWithAnn.file === ann.file && boWithAnn.info === ann.file && ann.info === ann.file
            && annWithBo.file === bo.file && annWithBo.info === bo.file && bo.info === bo.file,
            JSON.stringify({ ann: ann.file, besideAnn: boWithAnn.file, bo: bo.file, besideBo: annWithBo.file }));

        await s.close();
        s = null;
        await sleep(500);

        s = await bootRetry(AHEAD, 'A2', 'B2');
        pages.push(s.a, s.b);
        const node2 = Date.now();
        const ahead = await clockOf(s.b);
        check('Bo 15 minutes ahead: his page learned the host clock',
            ahead.host !== null && Math.abs(ahead.page - (node2 + AHEAD)) < NEAR && Math.abs(ahead.host - node2) < NEAR,
            JSON.stringify(ahead) + ' node ' + node2);

        await enter(s.a, s.b);
        const run2 = await s.a.evaluate(() => Coop.world.runId);
        before = bedList(s.server, run2);
        const u0 = Date.now();
        await save(s.b, 1);
        const u1 = Date.now();
        const first = await newBeds(s.server, run2, before);
        const boFirstFile = await fileStamp(s.b, 1);
        const boFirst = first.indexOf(boFirstFile.file) >= 0 ? boFirstFile.file : (first[0] || 0);
        await beside(s.a, 1, 'Ann saved beside Bo');
        await sleep(1000);
        before = bedList(s.server, run2);
        await save(s.a, 2);
        const second = await newBeds(s.server, run2, before);
        const annSecondFile = await fileStamp(s.a, 2);
        const annSecond = second.indexOf(annSecondFile.file) >= 0 ? annSecondFile.file : (second[second.length - 1] || 0);
        check('Bo\'s clock 15 minutes ahead: Ann\'s later save is numbered after his',
            boFirst > 0 && annSecond > boFirst && annSecondFile.file === annSecond && boFirstFile.file === boFirst,
            boFirst + ' then ' + annSecond);
        check('his fast clock is not the number on that earlier bed',
            boFirstFile.file >= u0 - NEAR && boFirstFile.file <= u1 + NEAR && Math.abs(boFirstFile.file - boFirstFile.page) > 10 * 60 * 1000,
            'file ' + boFirstFile.file + ' host ' + u0 + '..' + u1 + ' page ' + boFirstFile.page);
    } catch (e) {
        console.error(e);
        check('test ran to the end', false, String(e && e.stack || e).split('\n')[0].slice(0, 300));
    }
    const code = check.finish(pages);
    if (s) await s.close();
    process.exit(code);
})();
