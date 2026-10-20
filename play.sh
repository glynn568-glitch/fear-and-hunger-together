#!/bin/sh
# Fear & Hunger: Together on Linux and macOS:   sh play.sh
# Starts the co-op server and opens the game. Hosting online, joining a friend
# and AI partners are all in the game: Together, on the title screen.
#   --no-browser   only start the server     --port=8420   another port
set -e
if ! command -v curl >/dev/null 2>&1; then echo "This needs curl. Install it (sudo apt install curl, or your system's way), then run this again."; exit 1; fi
HERE=$(cd "$(dirname "$0")" && pwd)
# The download keeps everything in app/; a source checkout has it right here.
if [ -f "$HERE/app/server.js" ]; then ROOT="$HERE/app"; else ROOT="$HERE"; fi
PORT=${PORT:-8420}
OPEN=1
for a in "$@"; do
    case "$a" in
        --no-browser) OPEN=0 ;;
        --port=*) PORT=${a#--port=} ;;
    esac
done

#--- Node.js: the one installed (18 or newer), or a private copy beside the mod ---
NODE_VERSION=v24.12.0
case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) PLAT=linux-x64; EXT=tar.xz ;;
    Linux-aarch64 | Linux-arm64) PLAT=linux-arm64; EXT=tar.xz ;;
    Darwin-x86_64) PLAT=darwin-x64; EXT=tar.gz ;;
    Darwin-arm64) PLAT=darwin-arm64; EXT=tar.gz ;;
    *) PLAT='' ;;
esac
NODE="$ROOT/tools/node-$PLAT/bin/node"
if [ ! -x "$NODE" ]; then
    if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then
        NODE=$(command -v node)
    elif [ -z "$PLAT" ]; then
        echo "There is no Node.js download for $(uname -sm). Install Node.js 18 or newer, then run this again."
        exit 1
    else
        FILE="node-$NODE_VERSION-$PLAT.$EXT"
        echo "Node.js is not installed. Fetching a private copy ($NODE_VERSION, from nodejs.org) into tools/node-$PLAT..."
        TMP=$(mktemp -d)
        curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$FILE" -o "$TMP/$FILE"
        curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" | grep " $FILE\$" > "$TMP/sum"
        if command -v sha256sum >/dev/null 2>&1; then CHECK="sha256sum -c sum"; else CHECK="shasum -a 256 -c sum"; fi
        if ! (cd "$TMP" && $CHECK >/dev/null 2>&1); then
            rm -rf "$TMP"
            echo "The Node.js download did not match the checksum nodejs.org publishes. Try again."
            exit 1
        fi
        tar -xf "$TMP/$FILE" -C "$TMP"
        rm -rf "$ROOT/tools/node-$PLAT"
        mv "$TMP/node-$NODE_VERSION-$PLAT" "$ROOT/tools/node-$PLAT"
        rm -rf "$TMP"
    fi
fi
# The server's AI partners run on the same Node.
PATH="$(dirname "$NODE"):$PATH"
export PATH

# The download comes with its packages; a source checkout fetches them once.
if [ ! -d "$ROOT/node_modules/ws" ] || [ ! -d "$ROOT/node_modules/puppeteer-core" ]; then
    echo "Installing dependencies (first run only)..."
    PUPPETEER_SKIP_DOWNLOAD=1 npm install --prefix "$ROOT" --omit=dev >/dev/null
fi

#--- the game: found through Steam or the itch app, or told once and remembered ---
GAME=$("$NODE" "$ROOT/tools/find-game.js")
while [ -z "$GAME" ]; do
    echo "Fear & Hunger was not found in Steam or the itch app."
    printf "Type its folder, or drag the folder into this window, then press Enter: "
    read -r DIR || exit 1
    # A dragged folder arrives quoted ('...') or with its spaces escaped.
    DIR=$(printf '%s' "$DIR" | sed -e "s/^ *'//" -e "s/' *\$//" -e 's/\\\(.\)/\1/g')
    [ -n "$DIR" ] || exit 1
    "$NODE" "$ROOT/tools/find-game.js" --set "$DIR"
    GAME=$("$NODE" "$ROOT/tools/find-game.js")
    [ -n "$GAME" ] || echo "That folder does not hold the game (it is the one with Game.exe and a www folder in it)."
done

#--- the browser: Chrome, Chromium, Edge, Opera or Brave in a window of its own ---
browser() {
    for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge microsoft-edge-stable opera brave-browser; do
        if command -v "$b" >/dev/null 2>&1; then command -v "$b"; return; fi
    done
    for app in "Google Chrome" "Microsoft Edge" "Chromium" "Opera" "Brave Browser"; do
        bin="/Applications/$app.app/Contents/MacOS/$app"
        if [ -x "$bin" ]; then echo "$bin"; return; fi
    done
}
# SteamOS (a Steam Deck) installs browsers as Flatpaks, which are not on the PATH.
flatpak_browser() {
    command -v flatpak >/dev/null 2>&1 || return 0
    for id in com.google.Chrome org.chromium.Chromium com.microsoft.Edge com.brave.Browser com.opera.Opera; do
        if flatpak info "$id" >/dev/null 2>&1; then echo "$id"; return; fi
    done
}
BROWSER_PID=''
open_game() {
    [ "$OPEN" = 1 ] || return 0
    URL="http://localhost:$PORT/"
    i=0
    until curl -fs -o /dev/null "$URL"; do
        i=$((i + 1)); [ $i -lt 60 ] || return 0
        sleep 0.25
    done
    # Its own profile, as on Windows: no sync, no extensions in the game window.
    ARGS="--app=$URL --no-first-run --no-default-browser-check --disable-extensions --disable-sync --autoplay-policy=no-user-gesture-required"
    # A Steam Deck plays it full screen.
    if grep -qs '^ID=steamos' "${OS_RELEASE:-/etc/os-release}"; then ARGS="$ARGS --start-fullscreen"; fi
    B=$(browser)
    F=$(flatpak_browser)
    if [ -n "$B" ]; then
        "$B" $ARGS --user-data-dir="$ROOT/data/game-window" >/dev/null 2>&1 &
        BROWSER_PID=$!
    elif [ -n "$F" ]; then
        # A Flatpak browser keeps the profile in its own folder, the one it may always write to.
        flatpak run "$F" $ARGS --user-data-dir="$HOME/.var/app/$F/data/fh-together" >/dev/null 2>&1 &
        BROWSER_PID=$!
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then open "$URL"
    fi
}

PORT=$PORT "$NODE" "$ROOT/server.js" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' INT TERM EXIT
open_game
echo ""
echo "The game is at http://localhost:$PORT/  (Chrome, Edge, Opera or Brave)."
echo "Together, on the title screen, hosts online or joins a friend. F8 in the game calls an AI partner in."
if [ -n "$BROWSER_PID" ]; then
    # Closing the game window ends it all, so Steam sees the game has stopped.
    echo "Close the game window to stop."
    OPENED=$(date +%s)
    wait $BROWSER_PID 2>/dev/null || true
    # Gone at once: it handed the page to a game window already open. Then that one is closed by hand.
    if [ $(( $(date +%s) - OPENED )) -lt 5 ]; then
        echo "The game window was already open; it plays there. Press Ctrl+C to stop."
        wait $SERVER
        exit 0
    fi
    kill $SERVER 2>/dev/null
    wait $SERVER 2>/dev/null || true
    exit 0
fi
echo "Press Ctrl+C to stop."
wait $SERVER
