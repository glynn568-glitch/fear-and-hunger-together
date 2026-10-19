//=============================================================================
// fh-coop: live video for anyone watching this screen (a partner inside your
// fight, a dead partner). The browsers connect to each other directly and the
// picture travels as real video: 60 frames a second, a few megabits, little
// delay. The relay only carries the handshake.
//
// If the two browsers cannot reach each other directly (some routers refuse),
// nothing here takes effect and the watcher keeps getting the picture
// through the relay (battle.js).
//=============================================================================
(function () {
    const Stream = Coop.stream;
    const Viewer = Coop.viewer;
    if (!window.RTCPeerConnection || !HTMLCanvasElement.prototype.captureStream) return;

    const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] };
    const DEAD = ['failed', 'disconnected', 'closed'];

    // By default a video call starts blurry and sharpens over several
    // seconds as it probes the link. A fight's menus have to be readable from
    // the first frame, so the encoder is told to start high and never drop
    // below a floor. (These are Chrome's own knobs, set on the answer.)
    function startSharp(description) {
        const lines = description.sdp.split('\r\n');
        const video = lines.findIndex((l) => l.startsWith('m=video'));
        if (video < 0) return description;
        const hint = 'x-google-start-bitrate=5000;x-google-min-bitrate=2500;x-google-max-bitrate=8000';
        const result = [];
        lines.forEach(function (line, i) {
            const map = i > video ? /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\//.exec(line) : null;
            const fmtp = i > video ? /^a=fmtp:(\d+) (.*)$/.exec(line) : null;
            if (fmtp && !/apt=/.test(fmtp[2]) && !/x-google-start-bitrate/.test(line)) { result.push(line + ';' + hint); return; }
            result.push(line);
            if (map && !lines.some((l) => l.startsWith('a=fmtp:' + map[1] + ' '))) result.push('a=fmtp:' + map[1] + ' ' + hint);
        });
        return { type: description.type, sdp: result.join('\r\n') };
    }

    //--- sending ------------------------------------------------------------

    Stream.onVideo = new Set(); // watchers confirmed to be showing the video
    const out = new Map(); // watcher id -> { pc, queue, ready }
    let media = null;

    function canSend() {
        // While this player is themselves watching someone, their own canvas
        // is not what their watchers should see; those get it through the relay.
        return !Stream.noVideo && !Viewer.active && !!Graphics._canvas && !Coop.relayOnly;
    }

    function stopOut(id, tell) {
        const link = out.get(id);
        if (link) { out.delete(id); try { link.pc.close(); } catch (e) { /* already closed */ } }
        Stream.onVideo.delete(id);
        if (tell) Coop.sendTo(id, 'rtco', { stop: true });
    }

    // Private hosting switched on: any direct call already up is hung up; the relay carries on.
    Coop.on('relay', function (msg) {
        if (!msg.on) return;
        for (const id of Array.from(out.keys())) stopOut(id, true);
        if (incoming) stopIn();
    });

    function startOut(id) {
        if (!canSend() || out.has(id) || !Coop.peers.has(id)) return;
        if (!media) media = Graphics._canvas.captureStream(60);
        const pc = new RTCPeerConnection(ICE);
        const link = { pc, queue: [], ready: false };
        out.set(id, link);
        const senders = [];
        for (const track of media.getVideoTracks()) {
            track.contentHint = 'detail'; // text first: a readable menu beats a silky blur
            senders.push(pc.addTrack(track, media));
        }
        pc.onicecandidate = function (e) { if (e.candidate) Coop.sendTo(id, 'rtco', { c: e.candidate }); };
        pc.onconnectionstatechange = function () {
            if (DEAD.indexOf(pc.connectionState) >= 0 && out.get(id) === link) stopOut(id, false);
        };
        pc.createOffer().then(function (offer) { return pc.setLocalDescription(offer); }).then(function () {
            for (const sender of senders) {
                const p = sender.getParameters();
                if (!p.encodings || !p.encodings.length) p.encodings = [{}];
                p.encodings[0].maxBitrate = 8000000;
                p.encodings[0].maxFramerate = 60;
                p.encodings[0].scaleResolutionDownBy = 1;
                p.degradationPreference = 'maintain-resolution';
                sender.setParameters(p).catch(function () { /* defaults will do */ });
            }
            Coop.sendTo(id, 'rtco', { sdp: pc.localDescription });
        }).catch(function () { stopOut(id, false); });
    }

    const _add = Stream.add;
    Stream.add = function (id) {
        _add.call(this, id);
        startOut(id);
    };
    const _remove = Stream.remove;
    Stream.remove = function (id) {
        _remove.call(this, id);
        stopOut(id, true);
    };
    Coop.on('leave', function (peer) { stopOut(peer.id, false); });
    Coop.on('offline', function () { for (const id of Array.from(out.keys())) stopOut(id, false); });

    Coop.on('to:rtca', function (msg) {
        const link = out.get(msg.from);
        if (!link) return;
        if (msg.bad) { stopOut(msg.from, false); return; }
        if (msg.ok) { Stream.onVideo.add(msg.from); return; }
        if (msg.sdp) {
            link.pc.setRemoteDescription(startSharp(msg.sdp)).then(function () {
                link.ready = true;
                for (const c of link.queue.splice(0)) link.pc.addIceCandidate(c).catch(function () {});
            }).catch(function () { stopOut(msg.from, true); });
        } else if (msg.c) {
            if (link.ready) link.pc.addIceCandidate(msg.c).catch(function () {}); else link.queue.push(msg.c);
        }
    });

    //--- receiving ----------------------------------------------------------
    // Frames are painted onto the same canvas the relayed pictures use. A bare
    // <video> element is handed to the display's video path, which on an HDR
    // monitor comes out much darker than the rest of the page; a canvas is
    // ordinary page content and matches the game.

    let incoming = null; // { pc, from, queue, ready, reader }
    let video = null; // only for browsers without direct frame access
    Viewer.video = false;
    Viewer.videoSize = null;

    function stopIn() {
        const link = incoming;
        incoming = null;
        if (link) {
            if (link.reader) { try { link.reader.cancel(); } catch (e) { /* already ended */ } }
            try { link.pc.close(); } catch (e) { /* already closed */ }
        }
        Viewer.video = false;
        Viewer.videoSize = null;
        if (video) video.srcObject = null;
    }

    function giveUp(from) {
        Coop.sendTo(from, 'rtca', { bad: true });
        stopIn();
    }

    function paint(link, source, width, height) {
        if (incoming !== link || !Viewer.active || !Viewer.ctx) return;
        Viewer.ctx.drawImage(source, 0, 0, Viewer.el.width, Viewer.el.height);
        if (!Viewer.video) {
            // First real frame: from here the video is the picture.
            Viewer.video = true;
            Coop.sendTo(link.from, 'rtca', { ok: true });
        }
        Viewer.videoSize = { w: width, h: height };
        Viewer.frames++;
        Viewer.lastFrameAt = Date.now();
    }

    function readFrames(link, track) {
        if (window.MediaStreamTrackProcessor) {
            if (link.reader) { try { link.reader.cancel(); } catch (e) { /* already ended */ } }
            const reader = link.reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
            // Read to the end, even after the picture stopped mattering: every
            // frame still queued is closed, not left for the garbage collector.
            (function next() {
                reader.read().then(function (result) {
                    if (result.done) return;
                    const frame = result.value;
                    try { paint(link, frame, frame.displayWidth, frame.displayHeight); } finally { frame.close(); }
                    next();
                }, function () { /* stream ended */ });
            })();
            return;
        }
        // Older browsers: play it in a video element kept out of sight and copy each frame across.
        if (!video) {
            video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:0;';
            document.body.appendChild(video);
        }
        video.srcObject = new MediaStream([track]);
        video.play().catch(function () {});
        (function onFrame() {
            if (incoming !== link) return;
            if (video.videoWidth) paint(link, video, video.videoWidth, video.videoHeight);
            video.requestVideoFrameCallback(onFrame);
        })();
    }

    Coop.on('to:rtco', function (msg) {
        if (!Viewer.active || msg.from !== Viewer.from) return;
        if (msg.stop) { stopIn(); return; }
        if (msg.sdp) {
            stopIn();
            if (Coop.relayOnly) return;
            const pc = new RTCPeerConnection(ICE);
            const link = incoming = { pc, from: msg.from, queue: [], ready: false, reader: null };
            pc.ontrack = function (e) {
                // Show each frame as it lands instead of buffering for smoothness.
                try { e.receiver.jitterBufferTarget = 0; } catch (err) { /* older browser */ }
                try { e.receiver.playoutDelayHint = 0; } catch (err) { /* older browser */ }
                readFrames(link, e.track);
            };
            pc.onicecandidate = function (e) { if (e.candidate) Coop.sendTo(msg.from, 'rtca', { c: e.candidate }); };
            pc.onconnectionstatechange = function () {
                if (DEAD.indexOf(pc.connectionState) >= 0 && incoming === link) giveUp(msg.from);
            };
            pc.setRemoteDescription(msg.sdp).then(function () {
                link.ready = true;
                for (const c of link.queue.splice(0)) pc.addIceCandidate(c).catch(function () {});
                return pc.createAnswer();
            }).then(function (answer) { return pc.setLocalDescription(answer); }).then(function () {
                Coop.sendTo(msg.from, 'rtca', { sdp: pc.localDescription });
            }).catch(function () { if (incoming === link) giveUp(msg.from); });
            // No picture within a few seconds means the direct route is not
            // happening; say so, and the relay carries on.
            setTimeout(function () { if (incoming === link && !Viewer.video) giveUp(msg.from); }, 8000);
        } else if (msg.c && incoming) {
            if (incoming.ready) incoming.pc.addIceCandidate(msg.c).catch(function () {}); else incoming.queue.push(msg.c);
        }
    });

    // The picture a relay should pass on: whatever this player is being shown.
    Viewer.pictureSource = function () {
        return Viewer.el;
    };

    const _show = Viewer.show;
    Viewer.show = function (fromId) {
        if (Viewer.from !== fromId) stopIn();
        _show.call(this, fromId);
        // This player's own canvas is no longer what their watchers should see.
        for (const id of Array.from(out.keys())) stopOut(id, true);
    };
    const _hide = Viewer.hide;
    Viewer.hide = function () {
        const was = Viewer.active;
        stopIn();
        _hide.call(this);
        if (was) for (const id of Stream.watchers) startOut(id);
    };

})();
