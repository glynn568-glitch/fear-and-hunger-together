//=============================================================================
// fh-coop: saving. Save files live on the host's machine, filed under each
// player's name, so nothing depends on one browser's storage. When one player
// saves, the others save the same slot as soon as it is safe, and the server
// freezes a copy of the world beside it, so a reload brings everyone back to
// the same moment.
//=============================================================================
(function () {
    const cache = { name: null, exists: {}, data: {} };
    let accepted = ''; // the name the host has taken from this tab, on this line

    function base() {
        return 'coop/store/' + encodeURIComponent(Coop.name) + '/';
    }

    function keyOf(savefileId) {
        return savefileId === 0 ? 'global' : 'file' + savefileId;
    }

    function routed(savefileId) {
        return savefileId >= 0 && !!Coop.name;
    }

    function ensureIndex() {
        if (cache.name === Coop.name) return;
        // The host refuses until it has taken the name; nameok asks then.
        if (accepted.toLowerCase() !== Coop.name.toLowerCase()) return;
        cache.name = Coop.name;
        cache.exists = {};
        cache.data = {};
        const res = Coop.fetchSync('GET', base() + 'index');
        if (res.status === 200) {
            try { for (const key of JSON.parse(res.text)) cache.exists[key] = true; } catch (e) { /* empty index */ }
        }
    }

    const _saveToWeb = StorageManager.saveToWebStorage;
    StorageManager.saveToWebStorage = function (savefileId, json) {
        if (!routed(savefileId)) return _saveToWeb.call(this, savefileId, json);
        ensureIndex();
        const key = keyOf(savefileId);
        const data = LZString.compressToBase64(json);
        const res = Coop.fetchSync('PUT', base() + key, data);
        if (res.status !== 204) throw new Error('The host did not accept the save (' + res.status + ').');
        cache.exists[key] = true;
        cache.data[key] = json;
    };

    const _loadFromWeb = StorageManager.loadFromWebStorage;
    StorageManager.loadFromWebStorage = function (savefileId) {
        if (!routed(savefileId)) return _loadFromWeb.call(this, savefileId);
        ensureIndex();
        const key = keyOf(savefileId);
        if (!cache.exists[key]) return null;
        if (cache.data[key] == null) {
            const res = Coop.fetchSync('GET', base() + key);
            if (res.status !== 200) return null;
            cache.data[key] = LZString.decompressFromBase64(res.text);
        }
        return cache.data[key];
    };

    const _webExists = StorageManager.webStorageExists;
    StorageManager.webStorageExists = function (savefileId) {
        if (!routed(savefileId)) return _webExists.call(this, savefileId);
        ensureIndex();
        return !!cache.exists[keyOf(savefileId)];
    };

    const _removeWeb = StorageManager.removeWebStorage;
    StorageManager.removeWebStorage = function (savefileId) {
        if (!routed(savefileId)) return _removeWeb.call(this, savefileId);
        // The engine deletes a slot when writing it fails, counting on a
        // backup copy. Here the host still holds the last good file; keep it.
        if (saving) return;
        ensureIndex();
        const key = keyOf(savefileId);
        Coop.fetchSync('DELETE', base() + key);
        delete cache.exists[key];
        delete cache.data[key];
    };

    // The engine's backup copies exist to survive a failed local write; the
    // host writes each file atomically, so they are skipped.
    for (const name of ['backup', 'cleanBackup', 'restoreBackup']) {
        const orig = StorageManager[name];
        StorageManager[name] = function (savefileId) {
            if (routed(savefileId)) return;
            return orig.call(this, savefileId);
        };
    }
    const _backupExists = StorageManager.backupExists;
    StorageManager.backupExists = function (savefileId) {
        return routed(savefileId) ? false : _backupExists.call(this, savefileId);
    };

    Coop.on('offline', function () { accepted = ''; });

    // A different name means a different set of save files.
    const _setName = Coop.setName;
    Coop.setName = function (name) {
        const before = Coop.name;
        _setName.call(this, name);
        if (before !== Coop.name) {
            const scene = SceneManager._scene;
            if (scene instanceof Scene_Title && scene._commandWindow) scene._commandWindow.refresh();
        }
    };

    // The host lets this tab at its saves once it has taken the name.
    Coop.on('nameok', function (msg) {
        accepted = String(msg.name || '');
        cache.name = null;
        const scene = SceneManager._scene;
        if (scene instanceof Scene_Title && scene._commandWindow) scene._commandWindow.refresh();
        tellWhoseSaves(20);
    });

    // Saves go by name: back under a new one, this PC's saves seem gone.
    // Said at the title (the name is often taken before the title is up).
    let toldWhose = false;
    function tellWhoseSaves(triesLeft) {
        if (toldWhose) return;
        let savedAs = '';
        try { savedAs = localStorage.getItem('fhcoop.savedAs') || ''; } catch (e) { /* storage blocked */ }
        if (!savedAs || savedAs.toLowerCase() === accepted.toLowerCase()) return;
        if (!(SceneManager._scene instanceof Scene_Title) || !Coop.toast) {
            if (triesLeft > 0) setTimeout(function () { tellWhoseSaves(triesLeft - 1); }, 500);
            return;
        }
        ensureIndex();
        toldWhose = true;
        if (!Object.keys(cache.exists).some((k) => k !== 'global')) Coop.toast('Your saves are under the name ' + savedAs + '.', 9000);
    }

    //--- saving together ----------------------------------------------------

    let quiet = false; // true while saving because someone else did
    let pending = null; // { slot, stamp, by, runId }
    let saving = false;

    const _saveGame = DataManager.saveGame;
    DataManager.saveGame = function (savefileId) {
        const stamp = quiet && pending ? pending.stamp : Date.now();
        Coop.world.saveStamp = stamp;
        saving = true;
        let ok = false;
        try { ok = _saveGame.call(this, savefileId); } finally { saving = false; }
        // AI partners share the host's browser storage: only a person's saves count.
        if (ok && !Coop.isBot) try { localStorage.setItem('fhcoop.savedAs', Coop.name); } catch (e) { /* storage blocked */ }
        if (ok && Coop.world.live && !quiet) Coop.send({ t: 'savepoint', slot: savefileId, stamp, by: Coop.name, runId: Coop.world.runId });
        return ok;
    };

    Coop.on('savepoint', function (msg) {
        if (Coop.world.live && msg.runId === Coop.world.runId) pending = { slot: msg.slot, stamp: msg.stamp, by: msg.by, runId: msg.runId };
    });

    // A save owed to one run must never land in another game.
    const _leave = Coop.world.leave;
    Coop.world.leave = function () {
        pending = null;
        _leave.call(this);
    };

    const _makeSavefileInfo = DataManager.makeSavefileInfo;
    DataManager.makeSavefileInfo = function () {
        const info = _makeSavefileInfo.call(this);
        info.coopRun = Coop.world.runId || '';
        info.coopStamp = Coop.world.saveStamp || 0;
        return info;
    };

    // The slot the other player chose, unless this player keeps a save from
    // a different game there; then the first slot that is free or already
    // belongs to this run.
    function slotFor(wanted) {
        const info = DataManager.loadGlobalInfo() || [];
        const usable = (i) => !info[i] || info[i].coopRun === Coop.world.runId;
        if (usable(wanted)) return wanted;
        for (let i = 1; i <= DataManager.maxSavefiles(); i++) if (usable(i)) return i;
        return wanted;
    }

    function safeToSave() {
        return Coop.world.live && !Coop.dead && !Coop.battle && SceneManager._scene instanceof Scene_Map
            && !SceneManager.isSceneChanging() && !$gameMap.isEventRunning() && !$gamePlayer.isTransferring() && !$gameMessage.isBusy();
    }

    function saveAlongside() {
        quiet = true;
        let ok = false;
        const slot = slotFor(pending.slot);
        try {
            $gameSystem.onBeforeSave();
            ok = DataManager.saveGame(slot);
        } catch (e) { console.error('[coop] could not save alongside', e); }
        quiet = false;
        if (ok) {
            StorageManager.cleanBackup(slot);
            Coop.toast(pending.by + ' saved. ' + (Coop.dead ? 'You were saved with them as you are, in your slot ' : 'Your game was saved with theirs, in your slot ') + slot + '.', 5000);
        }
        pending = null;
    }

    const _mapUpdate = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _mapUpdate.call(this);
        if (pending && pending.runId !== Coop.world.runId) pending = null;
        if (pending && safeToSave()) saveAlongside();
    };

    // The dead are saved too, as dead: everyone in a run then holds a save
    // from the same moment, and loading it brings back the same situation.
    const _deadUpdate = Scene_CoopDead.prototype.update;
    Scene_CoopDead.prototype.update = function () {
        _deadUpdate.call(this);
        if (pending && pending.runId !== Coop.world.runId) pending = null;
        if (pending && Coop.dead && Coop.world.live && !SceneManager.isSceneChanging()) saveAlongside();
    };

    // With a partner already playing a run this player has a save of,
    // Continue opens on the save from the moment they carried on from.
    const _firstIndex = Scene_Load.prototype.firstSavefileIndex;
    Scene_Load.prototype.firstSavefileIndex = function () {
        const on = Coop.world.on;
        const slot = on ? Coop.world.slotsOf(on.runId)[on.stamp] : 0;
        return slot ? slot - 1 : _firstIndex.call(this);
    };
})();
