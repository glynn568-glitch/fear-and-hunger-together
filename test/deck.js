// The Linux start (play.sh) as a Steam Deck runs it, in WSL: SteamOS, the
// game in a Steam library on the SD card, Chrome as a Flatpak (as SteamOS
// installs it). The game is found, the game window opens full screen in the
// Flatpak with a profile it may write to, and closing it stops everything,
// so Steam sees the game has stopped. Skipped where there is no WSL.
const { spawnSync } = require('child_process');
const { checker } = require('./common');

const check = checker();
const wsl = (script) => spawnSync('wsl', ['-e', 'sh', '-c', script], { encoding: 'utf8', timeout: 120000 });
const probe = wsl('echo ok');
if (probe.error || !/ok/.test(probe.stdout || '')) {
    console.log('PASS no WSL on this PC: skipped');
    process.exit(0);
}

// This checkout, as WSL sees it (a worktree tests its own play.sh, not master's).
const REPO = '/mnt/' + require('path').resolve(__dirname, '..').replace(/^([A-Za-z]):/, (m, d) => d.toLowerCase()).replace(/\\/g, '/');
const GAME = '/mnt/d/SteamLibrary/steamapps/common/Fear & Hunger/www';
const script = `
set -e
T=$(mktemp -d)
H=$T/home
mkdir -p "$H/.local/share/Steam/steamapps" "$T/sd/steamapps/common/Fear & Hunger" "$T/bin" "$T/saves"
printf '"libraryfolders"\\n{\\n\\t"0"\\n\\t{\\n\\t\\t"path"\\t\\t"%s"\\n\\t}\\n\\t"1"\\n\\t{\\n\\t\\t"path"\\t\\t"%s"\\n\\t}\\n}\\n' "$H/.local/share/Steam" "$T/sd" > "$H/.local/share/Steam/steamapps/libraryfolders.vdf"
ln -s "${GAME}" "$T/sd/steamapps/common/Fear & Hunger/www"
printf 'NAME="SteamOS"\\nID=steamos\\n' > "$T/os-release"
# Chrome as a Flatpak: "run" keeps its arguments, loads the page, and is closed after 8 s.
cat > "$T/bin/flatpak" <<'EOF'
#!/bin/sh
case "$1" in
  info) [ "$2" = com.google.Chrome ] && exit 0; exit 1 ;;
  run) shift; echo "$@" > "$HOME/browser-args"
       for a in "$@"; do case "$a" in --app=*) curl -fs "\${a#--app=}" > "$HOME/page" ;; esac; done
       sleep 8; exit 0 ;;
esac
exit 1
EOF
chmod +x "$T/bin/flatpak"
echo "FOUND $(HOME=$H ${REPO}/tools/node-linux-x64/bin/node ${REPO}/tools/find-game.js)"
start=$(date +%s)
HOME=$H PATH="$T/bin:/usr/bin:/bin" OS_RELEASE="$T/os-release" FH_SAVES="$T/saves" sh ${REPO}/play.sh --port=8546 > "$T/out" 2>&1 || true
echo "TOOK $(( $(date +%s) - start ))"
echo "ARGS $(cat "$H/browser-args" 2>/dev/null)"
echo "PAGE $(grep -c '<title>' "$H/page" 2>/dev/null)"
sleep 1
if curl -fs -o /dev/null http://localhost:8546/; then echo "SERVER still up"; else echo "SERVER stopped"; fi
echo "HOME $H"
`;
const r = wsl(script);
const out = (r.stdout || '') + (r.stderr || '');
const line = (k) => ((out.match(new RegExp('^' + k + ' (.*)$', 'm')) || [])[1] || '');
const home = line('HOME');
check('the game is found in a Steam library on the SD card', line('FOUND').endsWith('/sd/steamapps/common/Fear & Hunger/www'), line('FOUND'));
const args = line('ARGS');
check('the game window opens in Chrome installed as a Flatpak', /--app=http:\/\/localhost:8546\//.test(args), args);
check('full screen on SteamOS', /--start-fullscreen/.test(args));
check('with a profile inside the Flatpak\'s own folder', args.includes('--user-data-dir=' + home + '/.var/app/com.google.Chrome/data/fh-together'));
check('the game page loads', line('PAGE') === '1', out.slice(-600));
check('closing the game window stops the server and the start, so Steam sees it stopped', line('SERVER') === 'stopped' && Number(line('TOOK')) < 30, 'took ' + line('TOOK') + ' s, server ' + line('SERVER'));

// The download: zipped on Windows the way tools/package.js does it, then unzipped on Linux.
{
    const fs = require('fs'), path = require('path');
    const dir = path.join(__dirname, 'out', 'deck-zip');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'FearAndHunger-Together'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', 'play.sh'), path.join(dir, 'FearAndHunger-Together', 'play.sh'));
    const zip = path.join(dir, 'game.zip');
    const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    spawnSync(TAR, ['-a', '-c', '-f', zip, 'FearAndHunger-Together'], { cwd: dir });
    const marked = require('../tools/zipmode').markRunnable(zip, (n) => /(^|\/)play\.sh$/.test(n));
    const unz = wsl(`T=$(mktemp -d); cd "$T" && unzip -q "${REPO}/test/out/deck-zip/game.zip" && [ -x FearAndHunger-Together/play.sh ] && echo RUNNABLE; sh -n FearAndHunger-Together/play.sh && echo PARSES`);
    check('unzipped on Linux, play.sh can be started as it is', marked.length === 1 && /RUNNABLE/.test(unz.stdout) && /PARSES/.test(unz.stdout), JSON.stringify(marked) + ' ' + (unz.stdout + unz.stderr).trim());
}

// The AI partner on a Deck: its own Chrome is the Flatpak one too (10/21: a Deck player could not call one in,
// "Chrome or Edge was not found"). A real Flatpak Chrome, run as a plain user, no model. Needs both in WSL.
{
    const user = spawnSync('wsl', ['-u', 'deck', '-e', 'sh', '-c', '[ -x /var/lib/flatpak/exports/bin/com.google.Chrome ] && echo ok'], { encoding: 'utf8', timeout: 30000 });
    if (!/ok/.test(user.stdout || '')) console.log('PASS no deck user with a Flatpak Chrome in WSL: partner check skipped');
    else {
        const p = spawnSync('wsl', ['-u', 'deck', '-e', 'sh', '-c', `
N=${REPO}/tools/node-linux-x64/bin/node; S=$(mktemp -d)
cd ${REPO}
FH_GAME="${GAME}" PORT=8548 FH_SAVES=$S FH_RELAY=0 PATH=/usr/bin:/bin $N server.js > $S/server.log 2>&1 &
SP=$!; sleep 4
PATH=/usr/bin:/bin ${process.env.FH_TWIN ? `FH_TWIN=${process.env.FH_TWIN} ` : ''}timeout 40 $N ${process.env.FH_TWIN ? '-r ' + REPO + '/test/twin-hook.js ' : ''}tools/bot.js http://localhost:8548/ --name Deckbot --brain none 2>&1 | grep -m1 -E 'waiting at the title|not found|Error'
kill $SP`], { encoding: 'utf8', timeout: 90000 });
        const said = ((p.stdout || '') + (p.stderr || '')).trim();
        check('the AI partner starts in a Flatpak Chrome and comes to the title', /waiting at the title/.test(said), said.slice(-400));
    }
}
process.exit(check.finish([]));
