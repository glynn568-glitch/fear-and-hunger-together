//=============================================================================
// fh-coop: picking up after a dropped connection. The game only saves at
// beds, so a crashed tab or a closed laptop would cost a player everything
// since the last one, while the world kept every chest they had emptied.
//
// Every half minute, while a player is safely on the map, their own state is
// parked on the host. If they then vanish without saying goodbye, the title
// screen offers to carry on from that point for the next twenty minutes.
//
// It is not a save. It is thrown away when the player returns to the title
// on purpose, and when they drop out during a fight or while dead, so it
// cannot be used to walk back a death or a bad battle.
//=============================================================================
(function () {
    const EVERY = 30000;
    let lastSent = 0;
    let offer = null; // { ageSec }

    function safe() {
        return Coop.world.live && !Coop.dead && !Coop.battle && SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive()
            && !SceneManager.isSceneChanging() && !$gameMap.isEventRunning() && !$gamePlayer.isTransferring() && !$gameMessage.isBusy();
    }

    Coop.parkNow = function (anyway) {
        // anyway: a dead body sent home. The usual park is map-only, so a drop
        // cannot be used to walk back a death or a fight.
        if (!Coop.connected || !Coop.world.live) return false;
        if (anyway ? !Coop.dead : !safe()) return false;
        if (anyway) {
            // An earlier park's answer can still be on the wire. Only this one's counts.
            Coop._parkWait = (Coop._parkWait || 0) + 1;
            Coop._parkAck = 0;
        }
        $gameSystem.onBeforeSave();
        // Not tied to a bed save: carrying on uses the world as it is now.
        const stamp = Coop.world.saveStamp;
        Coop.world.saveStamp = 0;
        let json;
        try { json = JsonEx.stringify(DataManager.makeSaveContents()); } finally { Coop.world.saveStamp = stamp; }
        Coop.send({ t: 'park', runId: Coop.world.runId, blob: json, n: anyway ? Coop._parkWait : 0 });
        lastSent = Date.now();
        return true;
    };
    // The host has this park on disk. A dead send-home waits for that before the page closes.
    Coop.on('parkok', function (msg) { if (msg && msg.n && msg.n === Coop._parkWait) Coop._parkAck = msg.n; });

    // Right after something changes hands, so the parked state never holds
    // an item its owner has already given away.
    Coop.parkSoon = function () { lastSent = 0; };

    const _mapUpdate = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _mapUpdate.call(this);
        if (Date.now() - lastSent > EVERY && !$gamePlayer.isMoving()) Coop.parkNow();
    };

    //--- the offer on the title screen --------------------------------------

    const box = document.createElement('div');
    box.id = 'coop-resume';
    box.style.cssText = 'position:fixed;left:50%;top:9%;transform:translateX(-50%);z-index:56;pointer-events:none;display:none;white-space:nowrap;'
        + 'font:17px Georgia,"Times New Roman",serif;padding:6px 16px;border:1px solid #b08a3c;background:rgba(14,9,8,0.85);color:#f2d28a;';
    (document.body ? Promise.resolve() : new Promise((r) => window.addEventListener('DOMContentLoaded', r))).then(() => document.body.appendChild(box));

    function ask() {
        if (Coop.connected && Coop.name) Coop.send({ t: 'park?' });
    }
    Coop.on('nameok', ask);

    Coop.on('parked', function (msg) {
        offer = msg.has ? { ageSec: msg.ageSec } : null;
    });

    setInterval(function () {
        const onTitle = SceneManager._scene instanceof Scene_Title;
        if (!offer || !onTitle) { box.style.display = 'none'; return; }
        const mins = Math.max(1, Math.round(offer.ageSec / 60));
        const scale = Math.max(1, Math.min(2.4, (Graphics._realScale || 1) * 0.75));
        box.style.fontSize = Math.round(17 * scale) + 'px';
        box.textContent = 'You dropped out ' + (offer.ageSec < 90 ? 'a moment' : mins + ' minutes') + ' ago. Press ' + Coop.keyName('R') + ' to carry on from there.';
        box.style.display = '';
    }, 300);

    // Asked afresh on each visit. Cleared on the way out, not on the way in:
    // clearing it here could swallow an answer already on screen, and R with it.
    const _titleStart = Scene_Title.prototype.start;
    Scene_Title.prototype.start = function () {
        _titleStart.call(this);
        ask();
    };
    const _titleEnd = Scene_Title.prototype.terminate;
    Scene_Title.prototype.terminate = function () {
        _titleEnd.call(this);
        offer = null;
    };

    document.addEventListener('keydown', function (e) {
        if (e.code !== 'KeyR' || e.repeat || e.ctrlKey || e.altKey || e.metaKey || !offer) return;
        if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
        if (!(SceneManager._scene instanceof Scene_Title) || SceneManager.isSceneChanging()) return;
        offer = null;
        Coop.send({ t: 'park!' });
    });

    Coop.on('parkdata', function (msg) {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Title) || !msg.blob) return;
        try {
            DataManager.createGameObjects();
            Coop.world._nextHow = 'park';
            DataManager.extractSaveContents(JsonEx.parse(msg.blob));
        } catch (e) {
            console.error('[coop] could not carry on from the parked state', e);
            Coop.toast('That could not be loaded. Use Continue instead.');
            DataManager.setupNewGame();
            return;
        }
        SoundManager.playLoad();
        scene.fadeOutAll();
        // The same steps the engine takes after loading a save file.
        if ($gameSystem.versionId() !== $dataSystem.versionId) {
            $gamePlayer.reserveTransfer($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y);
            $gamePlayer.requestMapReload();
        }
        SceneManager.goto(Scene_Map);
        $gameSystem.onAfterLoad();
        lastSent = Date.now();
        let note = '';
        if (msg.droppedAs === 'dead') {
            // They were dead when they vanished, and still are.
            Coop.afterSpectate = function () { SceneManager.goto(Scene_Gameover); };
        } else if (msg.droppedAs === 'owner') {
            // Vanishing from a fight of one's own is not an escape from it.
            const leader = $gameParty.leader();
            if (leader && leader.isAlive()) leader.setHp(1);
            note = 'You dropped out in the middle of your own fight. You come back barely alive.';
        } else if (msg.droppedAs === 'guest') {
            note = 'Carrying on. The fight you were in may have gone on without you.';
        } else {
            note = 'Carrying on from where you dropped out.';
        }
        // Said once the world has answered, so it is not talked over.
        Coop.world._resumeNote = note;
    });
})();
