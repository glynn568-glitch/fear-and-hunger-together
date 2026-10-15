// In-page helpers the tests install into each player's tab.
module.exports = function install() {
    window.T = {
        // Skip the intro: become one of the four protagonists at the dungeon gate.
        quickStart(actorId, x, y) {
            const identity = { 1: 246, 3: 242, 4: 243, 5: 244 }[actorId];
            DataManager.setupNewGame();
            $gameSwitches._data[identity] = true;
            $gameSwitches._data[{ 1: 661, 3: 662, 4: 663, 5: 664 }[actorId]] = true; // INITIAL_*, as the intro sets it
            $gameParty._actors = [actorId];
            // The real intro feeds everyone: hunger is kept as experience points,
            // and a character left at zero starves within the first minute.
            const actor = $gameActors.actor(actorId);
            actor.changeExp(actor.currentExp() + 99, false);
            $gamePlayer.refresh();
            $gamePlayer.reserveTransfer(1, x, y, 8, 0);
            SceneManager.goto(Scene_Map);
        },
        onMap() {
            return SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && !$gamePlayer.isTransferring();
        },
        // Stop whatever intro event the gate map starts, so tests begin idle.
        settle() {
            $gameMap._interpreter.clear();
            $gameMessage.clear();
            $gameMap._interpreter._waitMode = '';
            for (const ev of $gameMap.events()) { ev._starting = false; if (ev._trigger === 3) ev._erased = true; }
            $gameScreen.clear();
            $gamePlayer.setTransparent(false);
            $gamePlayer.setThrough(false);
            $gameScreen.startFadeIn(1);
        },
        events() { return $gameMap.events().map((e) => [e._eventId, e._x, e._y, e._erased ? 1 : 0].join(',')).join(';'); },
        begin() { $gameSwitches.setValue(79, true); },
        step(dir) { $gamePlayer.setThrough(true); $gamePlayer.moveStraight(dir); $gamePlayer.setThrough(false); },
        avatar(id) {
            const a = Coop.avatars.get(id);
            const entry = SceneManager._scene._spriteset && SceneManager._scene._spriteset._coopSprites.get(id);
            return a ? { x: a.x, y: a.y, d: a.direction(), name: a.characterName(), drawn: !!entry, label: entry ? entry.text : '' } : null;
        },
    };
};
