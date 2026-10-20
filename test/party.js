// Joining another player's party: Enter facing them, "Join their party".
// The member walks in their line, goes through their doors, is in their
// fights from anywhere on the map, and sees them in the menu lineup (look only, on the Equip screen).
const { twoPlayers, checker, sleep, waitFor } = require('./common');
const { shot } = require('./lib');

const onMap = (id) => $gameMap.mapId() === id && SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && !$gamePlayer.isTransferring();
const pos = (p) => p.evaluate(() => [$gamePlayer.x, $gamePlayer.y]);
const gap = async (a, b) => { const [p, q] = [await pos(a), await pos(b)]; return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]); };
const toast = (p) => p.evaluate(() => document.getElementById('coop-toast').textContent);
async function press(page, code, ms) {
    await page.keyboard.down(code); await sleep(ms || 130); await page.keyboard.up(code); await sleep(250);
}

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8480);
        const { a, b, idA, idB } = s;

        // B faces A and presses Enter: the first line offered is joining.
        await b.evaluate(() => $gamePlayer.setDirection(4));
        await press(b, 'Enter');
        await waitFor(b, () => $gameMessage.isChoice(), 5000, 'the partner menu');
        const choices = await b.evaluate(() => $gameMessage._choices.slice());
        check('facing a partner, Enter offers to join their party', choices[0] === 'Join their party', JSON.stringify(choices));
        await sleep(400);
        await press(b, 'Enter');
        await waitFor(b, (id) => Coop.partyLeader === id, 5000, 'B in A\'s party', idA);
        await waitFor(a, () => document.getElementById('coop-toast').textContent.includes('Bo falls in behind you'), 5000, 'A told');
        check('B joins A\'s party and A is told', true);
        check('B\'s own party is still only B\'s character', await b.evaluate(() => $gameParty._actors.join()) === '3');

        // A walks off; B keeps up without a key pressed.
        await b.evaluate(() => T.settle());
        for (let i = 0; i < 6; i++) { await a.evaluate(() => T.step(8)); await sleep(300); }
        await sleep(2500);
        let g = await gap(a, b);
        check('B walks in A\'s line when A moves', g >= 1 && g <= 2, 'gap ' + g + ' A ' + await pos(a) + ' B ' + await pos(b));
        check('B is drawn walking, not jumping (no stray state)', await b.evaluate(() => Coop.partyLeader) === idA);

        // A goes through a door to another map: B follows onto the same spot.
        await a.evaluate(() => { $gamePlayer.reserveTransfer(74, 15, 22, 8, 0); });
        await waitFor(a, onMap, 30000, 'A on map 74', 74);
        await a.evaluate(() => T.settle());
        await waitFor(b, onMap, 30000, 'B follows A to map 74', 74);
        await b.evaluate(() => T.settle());
        await sleep(1500);
        g = await gap(a, b);
        check('B followed A to the other map and stands by them', g <= 2, 'gap ' + g);

        // A fight A starts pulls B in from across the map.
        await a.evaluate(() => { $gamePlayer.reserveTransfer(1, 27, 67, 8, 0); });
        await waitFor(a, onMap, 30000, 'A back on map 1', 1);
        await a.evaluate(() => T.settle());
        await waitFor(b, onMap, 30000, 'B back on map 1', 1);
        await b.evaluate(() => T.settle());
        await sleep(800);
        // B has a companion of their own (the girl): she walks behind B in A's line.
        await b.evaluate(() => { $gameParty.addActor(2); $gamePlayer.followers().show(); $gamePlayer.refresh(); });
        for (let i = 0; i < 4; i++) { await a.evaluate(() => T.step(8)); await sleep(300); }
        await sleep(2500);
        const girl = await a.evaluate((id) => { const tr = Coop.avatarFor(id) && Coop.avatarFor(id).trail()[0]; return tr ? [tr.x, tr.y] : null; }, idB);
        const real = await b.evaluate(() => { const f = $gamePlayer.followers().follower(0); return [f.x, f.y]; });
        check('B\'s own companion walks behind B in A\'s line, on A\'s screen too', !!girl && girl.join() === real.join() && await gap(a, b) <= 2, 'A sees ' + girl + ', B has ' + real);
        // Put B nine tiles off and start the fight before they can close in.
        await a.evaluate(() => { $gamePlayer.locate(27, 67); });
        await b.evaluate(() => { $gamePlayer.locate(27, 58); });
        await sleep(100);
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        const far = await gap(a, b);
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopSpectate, 10000, 'B pulled into the fight');
        check('a party mate is pulled into the fight from across the map', far > 6, 'gap when it began ' + far);
        await waitFor(a, () => BattleManager._phase === 'input' && BattleManager.actor(), 20000, 'A reaches command input');
        const lineup = await a.evaluate(() => ({ party: $gameParty._actors.slice(), guest: [...Coop.battle.guests.values()].map((g) => g.actors) }));
        check('B\'s companion fights beside B, as B\'s to command', lineup.party.join() === '1,3,2' && JSON.stringify(lineup.guest) === '[[3,2]]', JSON.stringify(lineup));
        await a.evaluate(() => { BattleManager.abort(); });
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 20000, 'A back on the map');
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 20000, 'B back on the map');
        await a.evaluate(() => T.settle());
        await b.evaluate(() => T.settle());
        await sleep(1500);
        check('B is still in A\'s party after the fight', await b.evaluate(() => Coop.partyLeader) === idA);
        check('and B\'s companion came back with B', await b.evaluate(() => $gameParty._actors.join()) === '3,2');
        await b.evaluate(() => { $gameParty.removeActor(2); $gamePlayer.refresh(); });

        // The menu lineup: A's character after B's own; Equip opens on it, to look.
        await b.evaluate(() => SceneManager.push(Scene_Menu));
        await waitFor(b, () => SceneManager._scene instanceof Scene_Menu && SceneManager._scene._statusWindow && SceneManager._scene._statusWindow.maxItems() === 2, 8000, 'A in B\'s menu lineup');
        console.log('screenshot', await shot(b, 'party-menu'));
        const menu = await b.evaluate(() => {
            const scene = SceneManager._scene;
            const syms = scene._commandWindow._list.map((c) => c.symbol);
            const w = scene._statusWindow;
            const out = { syms };
            for (const sym of ['item', 'skill', 'equip']) {
                const i = syms.indexOf(sym);
                if (i < 0) continue;
                scene._commandWindow.select(i);
                w.select(1);
                out[sym] = w.isCurrentItemEnabled();
            }
            w.select(0);
            out.ownEquip = (scene._commandWindow.select(syms.indexOf('equip')), w.isCurrentItemEnabled());
            return out;
        });
        check('in the lineup, only Equip opens on a party mate, to look', menu.equip === true && menu.item === false && menu.skill === false && menu.ownEquip === true, JSON.stringify(menu));
        await b.evaluate(() => {
            const scene = SceneManager._scene;
            scene._commandWindow.select(scene._commandWindow._list.findIndex((c) => c.symbol === 'equip'));
            scene._statusWindow.activate();
            scene._statusWindow.select(1);
            scene._statusWindow.processOk();
        });
        await waitFor(b, () => SceneManager._scene instanceof Scene_Equip && SceneManager._scene._actor, 8000, 'Equip opens');
        await sleep(600);
        const viewed = await b.evaluate(() => {
            const sc = SceneManager._scene, cw = sc._commandWindow;
            return { id: sc._actor.actorId(), slots: sc._slotWindow._actor === sc._actor, shut: cw._list.every((c, i) => !cw.isCommandEnabled(i)), equips: sc._actor.equips().filter(Boolean).map((e) => e.name) };
        });
        check('Equip shows A\'s character and gear, every command shut', viewed.id === 1 && viewed.slots && viewed.shut, JSON.stringify(viewed));
        console.log('screenshot', await shot(b, 'party-equip'));
        await b.evaluate(() => SceneManager.pop());
        await waitFor(b, () => SceneManager._scene instanceof Scene_Menu, 8000, 'back in the menu');
        check('after looking, the menu is B\'s own again', await b.evaluate(() => $gameParty.menuActor().actorId()) === 3);
        const picker = await b.evaluate(() => { const w = new Window_MenuActor(); return w.maxItems(); });
        check('items and skills can never be aimed at a party mate', picker === 1, 'targets ' + picker);
        await b.evaluate(() => SceneManager.goto(Scene_Map));
        await waitFor(b, () => T.onMap(), 10000, 'B back on the map');
        check('A\'s actors in B\'s world were not touched', await b.evaluate(() => $gameParty._actors.join() === '3' && !$gameParty.members().some((m) => m.actorId() === 1)));

        // Holding a direction steps out of line, even while the line is walking.
        const walking = a.evaluate(async () => { for (let i = 0; i < 5; i++) { T.step(8); await new Promise((r) => setTimeout(r, 280)); } });
        await sleep(250);
        await b.keyboard.down('ArrowLeft'); await sleep(1100); await b.keyboard.up('ArrowLeft');
        await walking;
        await sleep(300);
        check('holding a direction steps out of the party, even mid-walk', await b.evaluate(() => Coop.partyLeader) === 0, await toast(b));

        // The lineup shrinks under the cursor when a mate leaves the line: no crash.
        await b.evaluate((id) => Coop.joinParty(id), idA);
        await sleep(600);
        await b.evaluate(() => SceneManager.push(Scene_Menu));
        await waitFor(b, () => SceneManager._scene instanceof Scene_Menu && SceneManager._scene._statusWindow && SceneManager._scene._statusWindow.maxItems() === 2, 8000, 'A in the lineup again');
        await b.evaluate(() => {
            const scene = SceneManager._scene;
            scene._commandWindow.select(scene._commandWindow._list.findIndex((c) => c.symbol === 'equip'));
            scene._statusWindow.activate();
            scene._statusWindow.select(1);
        });
        await a.evaluate((id) => Coop.sendOff(id), idB);
        await waitFor(b, () => Coop.partyLeader === 0, 5000, 'B sent off with the menu open');
        await sleep(300);
        await b.evaluate(() => SceneManager._scene._statusWindow.processOk());
        await sleep(500);
        const after = await b.evaluate(() => ({ scene: SceneManager._scene.constructor.name, items: SceneManager._scene._statusWindow ? SceneManager._scene._statusWindow.maxItems() : -1, stopped: SceneManager._stopped || false }));
        check('a mate leaving while the cursor is on them does not break the menu', after.items === 1 && !after.stopped && /Scene_(Menu|Equip)/.test(after.scene), JSON.stringify(after));
        await b.evaluate(() => SceneManager.goto(Scene_Map));
        await waitFor(b, () => T.onMap(), 10000, 'B back on the map');

        // The leader can send a member off.
        await b.evaluate((id) => Coop.joinParty(id), idA);
        await waitFor(a, (id) => Coop.peers.get(id).pl === Coop.id, 5000, 'A sees B back', idB);
        await a.evaluate((id) => Coop.sendOff(id), idB);
        await waitFor(b, () => Coop.partyLeader === 0, 5000, 'B sent off');
        check('the leader can send a member off', (await toast(b)).includes('sends you off'));

        // A leader who leaves the dungeon leaves no line behind.
        await b.evaluate((id) => Coop.joinParty(id), idA);
        await sleep(500);
        await a.evaluate(() => SceneManager.goto(Scene_Title));
        await waitFor(b, () => Coop.partyLeader === 0, 8000, 'B on their own');
        check('when the leader leaves, the member walks on alone', (await toast(b)).includes('walk on your own'));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
