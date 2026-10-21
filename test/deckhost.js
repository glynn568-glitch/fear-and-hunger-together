// Hosting online on Linux, as a Steam Deck does it, through a real Cloudflare tunnel (WSL here).
// deck.js covers play.sh and finding the game; this covers what only Linux can break: cloudflared's
// Linux build fetched and checked against its published checksum, made runnable, started, and its
// address handed out once it works. A Deck player once could not host at all (10/20, never explained);
// nothing had ever run this. Needs the internet: gate mode internet only. Skipped where there is no WSL.
// Port 8547, never 8420: WSL hands its localhost ports to Windows, and a game started on Windows
// while this runs on 8420 plays on this test's server.
const { spawnSync } = require('child_process');
const { checker } = require('./common');

const check = checker();
const wsl = (script, ms) => spawnSync('wsl', ['-e', 'sh', '-c', script], { encoding: 'utf8', timeout: ms });
const probe = wsl('echo ok', 60000);
if (probe.error || !/ok/.test(probe.stdout || '')) {
    console.log('PASS no WSL on this PC: skipped');
    process.exit(0);
}

// This checkout, as WSL sees it (a worktree tests its own play.sh, not master's).
const REPO = '/mnt/' + require('path').resolve(__dirname, '..').replace(/^([A-Za-z]):/, (m, d) => d.toLowerCase()).replace(/\\/g, '/');
const GAME = '/mnt/d/SteamLibrary/steamapps/common/Fear & Hunger/www';
const NODE = REPO + '/tools/node-linux-x64/bin/node';
const VERSION = /const VERSION = '([^']+)'/.exec(require('fs').readFileSync(require('path').join(__dirname, '..', 'tools', 'tunnel.js'), 'utf8'))[1];

// A first-time player: no cloudflared yet. tunnel.js on its own in an empty folder fetches it there.
{
    const r = wsl(`T=$(mktemp -d); mkdir "$T/tools"; cp "${REPO}/tools/tunnel.js" "$T/tools/"
cd "$T" && "${NODE}" -e 'require(process.argv[1]).fetchCloudflared().then(() => console.log("FETCHED"), (e) => console.log("FETCHFAIL " + e.message))' "$T/tools/tunnel.js"
[ -x "$T/tools/cloudflared" ] && echo RUNNABLE
echo "SAYS $("$T/tools/cloudflared" --version 2>&1 | head -1)"
rm -rf "$T"`, 300000);
    const out = (r.stdout || '') + (r.stderr || '');
    check('cloudflared\'s Linux build downloads and matches its published checksum', /^FETCHED$/m.test(out), out.trim().slice(-400));
    check('and can be run', /^RUNNABLE$/m.test(out));
    check('it is the build tunnel.js names (' + VERSION + ')', new RegExp('^SAYS .*version ' + VERSION.replace(/\./g, '\\.') + '\\b', 'm').test(out), (out.match(/^SAYS .*$/m) || [''])[0]);
}

// Host online the way the Together panel does it, with Hide my IP on, and reach the link from outside.
{
    const r = wsl(`T=$(mktemp -d); H=$T/home
mkdir -p "$H/.local/share/Steam/steamapps/common/Fear & Hunger" "$T/saves"
printf '"libraryfolders"\\n{\\n\\t"0"\\n\\t{\\n\\t\\t"path"\\t\\t"%s"\\n\\t}\\n}\\n' "$H/.local/share/Steam" > "$H/.local/share/Steam/steamapps/libraryfolders.vdf"
ln -s "${GAME}" "$H/.local/share/Steam/steamapps/common/Fear & Hunger/www"
HOME=$H PATH="/usr/bin:/bin" FH_SAVES="$T/saves" sh ${REPO}/play.sh --no-browser --port=8547 > "$T/out" 2>&1 &
PLAY=$!
APP=http://localhost:8547/coop/app
for i in $(seq 1 240); do curl -fs -o /dev/null http://localhost:8547/ && break; sleep 0.5; done
T0=$(date +%s)
S=$(curl -s -m 90 -X POST -H 'x-fh-app: 1' -H 'content-type: application/json' -d '{"on":true,"private":true}' $APP/online)
while [ $(( $(date +%s) - T0 )) -lt 120 ] && echo "$S" | grep -q '"mode":"online"' && ! echo "$S" | grep -q '"ready":true'; do sleep 2; S=$(curl -s -H 'x-fh-app: 1' $APP); done
echo "READY_AFTER $(( $(date +%s) - T0 ))"
echo "STATE $S"
L=$(echo "$S" | grep -o 'https://[a-z0-9-]*\\.trycloudflare\\.com/?k=[0-9a-f]*')
ORIGIN=\${L%%/?k=*}; K=\${L##*k=}
[ -n "$L" ] && echo "HELLO $(curl -s -m 20 "$ORIGIN/coop/hello?k=$K")"
[ -n "$L" ] && echo "NOKEY $(curl -s -m 20 -o /dev/null -w '%{http_code}' "$ORIGIN/coop/hello")"
echo "STOPPED $(curl -s -X POST -H 'x-fh-app: 1' -H 'content-type: application/json' -d '{"on":false}' $APP/online)"
sleep 2
echo "LEFT $(pgrep -fc '[c]loudflared tunnel .*127.0.0.1:8547')"
# play.sh takes its server with it when it is stopped.
kill $PLAY; sleep 1
echo "--- server said"; cat "$T/out"; rm -rf "$T"`, 300000);
    const out = (r.stdout || '') + (r.stderr || '');
    const line = (k) => ((out.match(new RegExp('^' + k + ' (.*)$', 'm')) || [])[1] || '');
    let state = {}, hello = {};
    try { state = JSON.parse(line('STATE')); } catch (e) { /* checked below */ }
    try { hello = JSON.parse(line('HELLO')); } catch (e) { /* checked below */ }
    check('the host is online through a tunnel', /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/\?k=[0-9a-f]+$/.test(state.link || ''), line('STATE').slice(0, 200) || out.slice(-600));
    check('and its link is handed out as working within 2 minutes', state.ready === true, 'after ' + line('READY_AFTER') + ' s');
    check('a friend reaches this game through the link', hello.fh === 'together' && hello.hosting === true, line('HELLO').slice(0, 200));
    check('but not without its key', line('NOKEY') === '403', line('NOKEY'));
    check('Stop hosting goes back to just this PC', /"mode":"local"/.test(line('STOPPED')), line('STOPPED').slice(0, 200));
    check('and takes cloudflared with it', line('LEFT') === '0', line('LEFT'));
    if (!state.ready) console.log(out.slice(out.indexOf('--- server said')).slice(0, 2000));
}
process.exit(check.finish([]));
