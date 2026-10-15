//=============================================================================
// fh-coop: the other players' light. The dungeon is drawn through a darkness
// mask with a hole around the local player's light; this cuts the same kind
// of hole around each other player, sized to the light they carry.
//=============================================================================
(function () {
    const _createLightmask = Spriteset_Map.prototype.createLightmask;
    if (!_createLightmask || !Bitmap.prototype.radialgradientFillRect) return; // lighting plugin absent

    let broken = false;

    function drawRemoteLights(bitmap) {
        const peers = Coop.peersHere();
        if (!peers.length) return;
        const ctx = bitmap.canvas.getContext('2d');
        const tw = $gameMap.tileWidth(), th = $gameMap.tileHeight();
        ctx.globalCompositeOperation = 'lighter';
        try {
            for (const peer of peers) {
                const radius = Number(peer.lr) || 0;
                if (radius <= 0 || peer.tr) continue;
                const avatar = Coop.avatarFor(peer.id);
                const x = $gameMap.adjustX(avatar._realX) * tw + tw / 2;
                const y = $gameMap.adjustY(avatar._realY) * th + th / 2;
                if (x < -radius || y < -radius || x > bitmap.width + radius || y > bitmap.height + radius) continue;
                const color = /^#[0-9a-f]{6}$/i.test(peer.lc || '') ? peer.lc : '#FFFFFF';
                bitmap.radialgradientFillRect(x, y, radius < 100 ? 0 : 20, radius, color, 'black', false, 0);
            }
        } finally {
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    function patch(proto) {
        const original = proto._updateMask;
        proto._updateMask = function () {
            if (broken || !Coop.world.live) return original.call(this);
            // The plugin repaints the mask black before adding lights. Only
            // then is it right to add more; otherwise they would pile up.
            const bitmap = this._maskBitmap;
            let repainted = false;
            const fill = bitmap.fillRect;
            bitmap.fillRect = function (x, y, w, h, color) {
                if (color === 'black') repainted = true;
                return fill.apply(this, arguments);
            };
            try { original.call(this); } finally { delete bitmap.fillRect; }
            if (!repainted) return;
            try { drawRemoteLights(bitmap); } catch (e) {
                broken = true;
                console.error('[coop] remote lights switched off', e);
            }
        };
    }

    Spriteset_Map.prototype.createLightmask = function () {
        _createLightmask.call(this);
        const proto = this._lightmask && Object.getPrototypeOf(this._lightmask);
        if (proto && !proto._coopLights) {
            proto._coopLights = true;
            patch(proto);
        }
    };

    // What this player's own light is, for the others.
    Coop.myLight = function () {
        const saved = $gameVariables._Terrax_Lighting_Radius;
        return {
            lr: saved === undefined ? 300 : Number(saved) || 0,
            lc: $gameVariables.valuePlayerColorSave ? $gameVariables.valuePlayerColorSave() : '#FFFFFF',
        };
    };
})();
