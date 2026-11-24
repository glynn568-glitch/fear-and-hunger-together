# Starts the co-op server. Everything it needs, it finds or fetches itself.
#   .\start.ps1 -Menu      ask what to do (Play.cmd does this)
#   .\start.ps1            play on this PC only  (http://localhost:8420)
#   .\start.ps1 -Online    get a link for a friend
#   .\start.ps1 -Online -Private    the same, and your friend's browser never learns your IP address
#   .\start.ps1 -Join <link>        play in a friend's game, from your own copy
#   add -Partner to any of these: an AI partner joins you (settings.json, "partner")
#   -NoBrowser: do not open the game in the browser
param(
    [switch]$Menu,
    [switch]$Online,
    [switch]$Private,
    [switch]$Partner,
    [switch]$NoBrowser,
    [string]$Join = '',
    [int]$Port = 8420
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell's progress bar slows downloads to a crawl.
$ProgressPreference = 'SilentlyContinue'
$root = $PSScriptRoot

if ($Menu) {
    Write-Host ''
    Write-Host '  Fear & Hunger: Together'
    Write-Host ''
    Write-Host '  1  Play with an AI partner'
    Write-Host '  2  Host for a friend (a link to send them)'
    Write-Host '  3  Host for a friend, with an AI partner too'
    Write-Host '  4  Join a friend (paste the link they sent)'
    Write-Host '  5  Just this PC'
    Write-Host ''
    Write-Host '  When you host, F8 in the game calls an AI partner in or sends it home.'
    Write-Host ''
    $pick = Read-Host '  Pick 1-5'
    switch ($pick) {
        '1' { $Partner = $true }
        '2' { $Online = $true }
        '3' { $Online = $true; $Partner = $true }
        '4' { $Join = Read-Host '  Paste the link' }
        default { }
    }
}

#--- Node.js: the one installed, or a private copy in tools\node ---------------
$NodeVersion = 'v24.12.0'
$node = "$root\tools\node\node.exe"
if (-not (Test-Path $node)) {
    $found = Get-Command node -ErrorAction SilentlyContinue
    if ($found) { $node = $found.Source }
    else {
        Write-Host "Node.js is not installed. Fetching a private copy ($NodeVersion, from nodejs.org) into tools\node..."
        $zip = Join-Path $env:TEMP "node-$NodeVersion-win-x64.zip"
        Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" -OutFile $zip -UseBasicParsing
        $unpacked = Join-Path $env:TEMP "node-$NodeVersion-unpacked"
        if (Test-Path $unpacked) { Remove-Item $unpacked -Recurse -Force }
        Expand-Archive $zip -DestinationPath $unpacked
        # Whatever a broken earlier attempt left there would swallow the new copy.
        if (Test-Path "$root\tools\node") { Remove-Item "$root\tools\node" -Recurse -Force }
        Move-Item (Join-Path $unpacked "node-$NodeVersion-win-x64") "$root\tools\node"
        Remove-Item $zip, $unpacked -Recurse -Force -ErrorAction SilentlyContinue
        $node = "$root\tools\node\node.exe"
    }
}
# Child processes (the server's AI partners) use the same Node.
$env:PATH = (Split-Path $node) + ';' + $env:PATH

if (-not (Test-Path "$root\node_modules\ws") -or -not (Test-Path "$root\node_modules\puppeteer-core") -or -not (Test-Path "$root\node_modules\@anthropic-ai\sdk")) {
    Write-Host 'Installing dependencies (first run only)...'
    $env:PUPPETEER_SKIP_DOWNLOAD = '1'
    $npm = Join-Path (Split-Path $node) 'npm.cmd'
    if (-not (Test-Path $npm)) { $npm = 'npm' }
    & $npm install --prefix $root --omit=dev | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Installing the dependencies failed. Check the internet connection and run this again.' }
}

#--- the game: found through Steam, or picked once and remembered ------------
$game = & $node "$root\tools\find-game.js"
if (-not $game) {
    Write-Host 'Fear & Hunger was not found in Steam or the itch app. Pick its folder (the one with Game.exe in it).'
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'The Fear & Hunger folder (with Game.exe in it)'
    if ($dialog.ShowDialog() -ne 'OK') { throw 'No game folder picked.' }
    & $node "$root\tools\find-game.js" --set $dialog.SelectedPath
    $game = & $node "$root\tools\find-game.js"
    if (-not $game) { throw "That folder does not hold the game: $($dialog.SelectedPath)" }
}

$env:PORT = "$Port"
if ($Private) { $env:FH_RELAY = '1' } else { Remove-Item Env:FH_RELAY -ErrorAction SilentlyContinue }
if ($Partner) { $env:FH_PARTNER = '1' } else { Remove-Item Env:FH_PARTNER -ErrorAction SilentlyContinue }
# Joining: this PC serves its own copy of the game; only the co-op traffic goes to the host.
$Join = $Join.Trim()
if ($Join) {
    if ($Join -notmatch '^https?://') { throw "That is not a link from a host: $Join" }
    if ($Online) { throw 'Joining and hosting at once is not possible: pick one.' }
    $env:FH_JOIN = $Join
} else { Remove-Item Env:FH_JOIN -ErrorAction SilentlyContinue }

# Opens the game in the browser once the server answers.
function Open-Game {
    if ($NoBrowser) { return }
    # Chrome or Edge, which the game is tested in; the default browser only if neither is there.
    $browser = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    foreach ($i in 1..40) {
        try { Invoke-WebRequest "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 2 | Out-Null } catch { Start-Sleep -Milliseconds 250; continue }
        if ($browser) { Start-Process $browser "http://localhost:$Port/" } else { Start-Process "http://localhost:$Port/" }
        return
    }
}

function Get-Hello {
    try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/coop/hello" -TimeoutSec 2 }
    catch { return $null }
}

# The server opens the one tunnel (the same path as Together's Host online). A tunnel
# this script used to start left the game on "just this PC", and Host online then
# replaced the key, so the link in this window died (11/22).
function Get-OnlineState {
    $state = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/coop/app/online" -Method Post -Headers @{ 'x-fh-app' = '1' } -ContentType 'application/json' -Body (@{ on = $true; private = ($env:FH_RELAY -ne '0') } | ConvertTo-Json) -TimeoutSec 90
    if ($state.error) { throw $state.error }
    return $state
}

function Show-Link($state) {
    $link = [string]$state.link
    if (-not $link) { throw 'No link for a friend.' }
    try { Set-Clipboard $link } catch { }
    Write-Host ''
    Write-Host "You:         http://localhost:$Port/"
    Write-Host "Your friend: $link   (copied to the clipboard)"
    Write-Host '             They need the game too, and this mod: Play.cmd, "Join a friend", paste the link.'
    if ($Private) { Write-Host 'Private: your friend''s browser never learns your IP address.' }
    return $link
}

# A second Play while the server is up used to open another window: a second
# player from one PC (11/22). Bring the one already open forward, or say so.
function Show-Already([string]$link) {
    $raised = $false
    try {
        Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction Stop
        [Microsoft.VisualBasic.Interaction]::AppActivate('Fear & Hunger') | Out-Null
        $raised = $true
    } catch { }
    if ($raised) {
        Write-Host 'Fear & Hunger Together is already running. Its window is in front.'
        return
    }
    $msg = 'Fear & Hunger Together is already running. Switch to its window.'
    if ($link) { $msg += " Your friend's link: $link" }
    Write-Host $msg
    if (-not $NoBrowser) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($msg, 'Fear & Hunger: Together') | Out-Null
    }
}

if ((Get-Hello).fh -eq 'together') {
    $link = ''
    if ($Online) { $link = Show-Link (Get-OnlineState) }
    Show-Already $link
    return
}

Remove-Item Env:FH_KEY -ErrorAction SilentlyContinue
$server = Start-Process $node -ArgumentList "`"$root\server.js`"" -NoNewWindow -PassThru
try {
    $up = $false
    foreach ($i in 1..40) {
        $hello = Get-Hello
        if ($hello -and $hello.fh -eq 'together') { $up = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $up) { throw 'The game did not start. Close this window and run it again.' }
    if ($Online) { Show-Link (Get-OnlineState) | Out-Null }
    Open-Game
    Write-Host ''
    if (-not $Online) { Write-Host "The game is at http://localhost:$Port/  (use Chrome, Edge or Opera)." }
    if ($Join) { Write-Host "Joined $Join, playing from your own copy of the game." }
    elseif ($Online -and $Partner) { Write-Host 'Your AI partner joins once you are in the dungeon. Y talks to it, F8 sends it home.' }
    elseif ($Online) { Write-Host 'F8 in the game (on your PC) calls an AI partner in.' }
    elseif ($Partner) { Write-Host 'Your AI partner joins once you are in the dungeon. Y talks to it, F8 sends it home.' }
    else { Write-Host 'F8 in the game calls an AI partner in.' }
    if ($Online) { Write-Host 'Both of you: use Chrome, Edge or Opera. Close this window, or press Ctrl+C, to stop; the link dies with it.' }
    else { Write-Host 'Close this window, or press Ctrl+C, to stop.' }
    Wait-Process -Id $server.Id
} finally {
    # A hard kill skips the tunnel's own exit. Ask the server to stop, then force it (11/22).
    if ($server -and -not $server.HasExited) {
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:$Port/coop/app/quit" -Method Post -Headers @{ 'x-fh-app' = '1' } -ContentType 'application/json' -Body '{}' -TimeoutSec 3 -UseBasicParsing | Out-Null
        } catch { }
        if (-not $server.WaitForExit(4000)) { Stop-Process -Id $server.Id -Force }
    }
}
