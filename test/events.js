// Step 5: events are in the same place for both players.
const { twoPlayers, checker, sleep } = require('./common');
const { shot } = require('./lib');

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8433);
        const { a, b, idA } = s;
        check('A simulates the map, B follows', await a.evaluate(() => Coop.events.amOwner()) && !(await b.evaluate(() => Coop.events.amOwner())),
            JSON.stringify(await b.evaluate(() => Coop.events.owners)));
        const info = await a.evaluate(() => {
            const movers = $gameMap.events().filter((e) => e._moveType !== 0 && !e._erased);
            return { total: $gameMap.events().length, movers: movers.length, first: movers.length ? movers[0]._eventId : 0 };
        });
        console.log('map events', JSON.stringify(info));
        // Walk one event three tiles on the owner's machine.
        const id = info.first;
        const before = await b.evaluate((id) => { const e = $gameMap.event(id); return [e.x, e.y]; }, id);
        await a.evaluate((id) => { const e = $gameMap.event(id); e.setThrough(true); e.forceMoveRoute({ list: [{ code: 1 }, { code: 1 }, { code: 1 }, { code: 0 }], repeat: false, skippable: true, wait: false }); }, id);
        await sleep(2500);
        const onA = await a.evaluate((id) => { const e = $gameMap.event(id); return [e.x, e.y]; }, id);
        const onB = await b.evaluate((id) => { const e = $gameMap.event(id); return [e.x, e.y, e._realX, e._realY]; }, id);
        check('an event walked by A arrives at the same tile for B', onA[0] === onB[0] && onA[1] === onB[1] && (onA[1] !== before[1]), `${before} -> A ${onA} B ${onB}`);
        check('B glides it there rather than snapping', onB[2] === onB[0] && onB[3] === onB[1]);
        // Let the map run; every event must stay in the same place on both.
        await sleep(5000);
        const ea = await a.evaluate(() => T.events()), eb = await b.evaluate(() => T.events());
        const la = ea.split(';'), lb = eb.split(';');
        const diff = la.filter((row, i) => row !== lb[i]);
        check('all event positions agree after 5 s of play', diff.length === 0, diff.slice(0, 6).join(' | '));
        await a.evaluate((id) => $gameMap.eraseEvent(id), id);
        await sleep(400);
        check('an erased event disappears for B too', await b.evaluate((id) => $gameMap.event(id)._erased, id));
        // B walks an event (as a cutscene would); A must follow.
        const id2 = await b.evaluate(() => $gameMap.events().find((e) => !e._erased && e._moveType === 0 && e._priorityType === 1)._eventId);
        await b.evaluate((id) => { const e = $gameMap.event(id); e.setThrough(true); e.forceMoveRoute({ list: [{ code: 4 }, { code: 0 }], repeat: false, skippable: true, wait: false }); }, id2);
        await sleep(1200);
        const p2a = await a.evaluate((id) => { const e = $gameMap.event(id); return [e.x, e.y]; }, id2);
        const p2b = await b.evaluate((id) => { const e = $gameMap.event(id); return [e.x, e.y]; }, id2);
        check('an event walked by the follower reaches the owner', p2a[0] === p2b[0] && p2a[1] === p2b[1], `A ${p2a} B ${p2b}`);
        // Owner opens a menu: the other player takes over the map.
        await a.evaluate(() => SceneManager.push(Scene_Menu));
        await sleep(800);
        check('when A opens a menu, B takes over the map', await b.evaluate(() => Coop.events.amOwner()));
        await a.evaluate(() => SceneManager.pop());
        await sleep(800);
        check('exactly one owner afterwards', (await a.evaluate(() => Coop.events.amOwner())) !== (await b.evaluate(() => Coop.events.amOwner())));
        console.log('screenshot', await shot(b, 'events-b'));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
