//=============================================================================
// fh-coop: a built-in meter for "is it laggy, and where". F9 shows it on
// screen. The same numbers are sent to the host every few seconds, so a lag
// report can be checked against what the player's own browser measured.
//
// What it measures, per five-second window:
//   - how often the screen refreshes and how often the game steps (60 is right)
//   - steps that came late (a visible hitch)
//   - how long a key press waits before the game acts on it, and before the
//     picture that shows the result is drawn
//   - stalls: stretches over 50 ms where the page could not respond at all
//=============================================================================
(function () {
    const WINDOW_MS = 5000;
    const M = Coop.meter = { last: null, show: false };

    let frames = 0;
    let steps = 0;
    let lastStep = 0;
    let lateSteps = 0;
    let worstGap = 0;
    let drawWorst = 0;
    let stepCost = 0;
    let stepWorst = 0;
    let stalls = 0;
    let stallWorst = 0;
    const keyToStep = [];
    const keyToDraw = [];
    let waitingStep = []; // press times not yet seen by a game step
    let waitingDraw = []; // press times seen by a step, not yet on screen
    let windowStart = performance.now();

    // A key press is stamped by the browser when the keyboard reported it.
    window.addEventListener('keydown', function (e) {
        if (e.repeat || waitingStep.length > 8) return;
        waitingStep.push(e.timeStamp || performance.now());
    }, true);

    const _updateScene = SceneManager.updateScene;
    SceneManager.updateScene = function () {
        const t = performance.now();
        if (lastStep) {
            const gap = t - lastStep;
            if (gap > 25) lateSteps++;
            if (gap > worstGap) worstGap = gap;
        }
        lastStep = t;
        steps++;
        if (waitingStep.length) {
            for (const pressed of waitingStep) { keyToStep.push(t - pressed); waitingDraw.push(pressed); }
            waitingStep = [];
        }
        _updateScene.call(this);
        const cost = performance.now() - t;
        stepCost += cost;
        if (cost > stepWorst) stepWorst = cost;
    };

    const _render = Graphics.render;
    Graphics.render = function (stage) {
        const t = performance.now();
        _render.call(this, stage);
        const end = performance.now();
        if (end - t > drawWorst) drawWorst = end - t;
        if (this._rendered && waitingDraw.length) {
            for (const pressed of waitingDraw) keyToDraw.push(end - pressed);
            waitingDraw = [];
        }
    };

    try {
        new PerformanceObserver(function (list) {
            for (const entry of list.getEntries()) {
                stalls++;
                if (entry.duration > stallWorst) stallWorst = entry.duration;
            }
        }).observe({ entryTypes: ['longtask'] });
    } catch (e) { /* not supported; the other numbers still stand */ }

    function middle(list) {
        if (!list.length) return null;
        const s = list.slice().sort((a, b) => a - b);
        return Math.round(s[Math.floor(s.length / 2)]);
    }
    function top(list) {
        return list.length ? Math.round(Math.max.apply(null, list)) : null;
    }

    let gpu = '';
    function gpuName() {
        if (gpu) return gpu;
        try {
            const gl = Graphics._renderer && Graphics._renderer.gl;
            const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
            gpu = gl ? (ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'WebGL') : 'no WebGL (slow path)';
        } catch (e) { gpu = 'unknown'; }
        return gpu;
    }

    function closeWindow() {
        const now = performance.now();
        const secs = (now - windowStart) / 1000;
        const b = Coop.battle;
        M.last = {
            screenHz: Math.round(frames / secs),
            stepsPerSec: Math.round(steps / secs),
            lateSteps,
            worstStepGapMs: Math.round(worstGap),
            stepCostMs: steps ? +(stepCost / steps).toFixed(2) : 0,
            stepCostWorstMs: Math.round(stepWorst),
            drawWorstMs: Math.round(drawWorst),
            keyToGameMs: middle(keyToStep), keyToGameWorstMs: top(keyToStep),
            keyToPictureMs: middle(keyToDraw), keyToPictureWorstMs: top(keyToDraw),
            keys: keyToStep.length,
            stalls, stallWorstMs: Math.round(stallWorst),
            hidden: document.hidden,
            scene: SceneManager._scene ? SceneManager._scene.constructor.name : '',
            map: window.$gameMap && Coop.world.live ? $gameMap.mapId() : 0,
            events: window.$gameMap && Coop.world.live ? $gameMap.events().length : 0,
            streamingTo: Coop.stream ? Coop.stream.watchers.size : 0,
            watching: Coop.viewer && Coop.viewer.active ? (Coop.viewer.video ? 'video' : 'stills') : '',
            watchFps: Coop.viewer && Coop.viewer.active ? Math.round((Coop.viewer.frames - (M._frames || 0)) / secs) : 0,
            videoTo: Coop.stream && Coop.stream.onVideo ? Coop.stream.onVideo.size : 0,
            fight: b ? b.role + (b.guests ? ':' + b.guests.size : '') : '',
            others: Coop.peers.size,
            window: innerWidth + 'x' + innerHeight + ' @' + (+devicePixelRatio.toFixed(2)),
            gpu: gpuName(),
        };
        M._frames = Coop.viewer ? Coop.viewer.frames : 0;
        frames = 0; steps = 0; lateSteps = 0; worstGap = 0; drawWorst = 0; stepCost = 0; stepWorst = 0; stalls = 0; stallWorst = 0;
        keyToStep.length = 0; keyToDraw.length = 0;
        windowStart = now;
        if (Coop.connected && !document.hidden) Coop.send({ t: 'stats', name: Coop.name, s: M.last });
        draw();
    }

    (function count() {
        frames++;
        if (performance.now() - windowStart >= WINDOW_MS) closeWindow();
        requestAnimationFrame(count);
    })();

    //--- on screen ----------------------------------------------------------

    const box = document.createElement('div');
    box.id = 'coop-meter';
    box.style.cssText = 'position:fixed;right:10px;top:8px;z-index:70;pointer-events:none;display:none;white-space:pre;'
        + 'font:13px/1.4 Consolas,monospace;color:#cfe3c0;background:rgba(0,0,0,0.72);padding:8px 10px;border:1px solid #3d4a36;';
    (document.body ? Promise.resolve() : new Promise((r) => window.addEventListener('DOMContentLoaded', r))).then(() => (document.getElementById('coop-corner') || document.body).appendChild(box));

    function verdict(s) {
        if (s.stepsPerSec < 55) return 'game is running slow (' + s.stepsPerSec + ' of 60 steps a second)';
        if (s.screenHz < 50) return 'the browser is only refreshing ' + s.screenHz + ' times a second';
        if (s.stalls > 2 || s.stallWorstMs > 120) return 'the page keeps stalling (' + s.stalls + ' times, worst ' + s.stallWorstMs + ' ms)';
        if (s.lateSteps > 5) return 'frames are arriving unevenly (' + s.lateSteps + ' late)';
        if (s.keyToPictureMs != null && s.keyToPictureMs > 60) return 'key presses are slow to show (' + s.keyToPictureMs + ' ms)';
        return 'nothing slow on this machine';
    }
    M.verdict = verdict;

    function draw() {
        if (!M.show || !M.last) return;
        const s = M.last;
        const key = s.keys ? s.keyToGameMs + ' ms to the game, ' + s.keyToPictureMs + ' ms to the picture (worst ' + s.keyToPictureWorstMs + ')' : 'press some keys';
        box.textContent = [
            'co-op meter (F9 hides)      ' + verdict(s),
            'screen ' + s.screenHz + ' Hz   game ' + s.stepsPerSec + ' steps/s   late ' + s.lateSteps + '   worst gap ' + s.worstStepGapMs + ' ms',
            'step cost ' + s.stepCostMs + ' ms (worst ' + s.stepCostWorstMs + ')   draw worst ' + s.drawWorstMs + ' ms   stalls ' + s.stalls + (s.stalls ? ' (worst ' + s.stallWorstMs + ' ms)' : ''),
            'key press: ' + key,
            (s.watching ? 'watching partner: ' + s.watching + ' at ' + s.watchFps + ' fps   ' : '') + (s.streamingTo ? 'streaming to ' + s.streamingTo + (s.videoTo ? ' (live video)' : ' (stills)') + '   ' : '') + (s.fight ? 'fight ' + s.fight + '   ' : '') + 'map ' + s.map + ' (' + s.events + ' events)   ' + s.window,
            s.gpu.slice(0, 70),
        ].join('\n');
    }

    document.addEventListener('keydown', function (e) {
        if (e.code !== 'F9' || e.repeat) return;
        e.preventDefault();
        M.show = !M.show;
        box.style.display = M.show ? '' : 'none';
        if (M.show && !M.last) box.textContent = 'co-op meter: measuring, five seconds...';
        draw();
    });
})();
