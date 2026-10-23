# Fear & Hunger: Together

Co-op for Fear & Hunger (the first game), played in the browser. Up to four players share one dungeon as separate characters: split up or stick together, fight side by side, and drag each other back from death at the ritual circles. Made for playing with friends. If you want one, an AI partner drops in with one key and plays by the same rules a person does.

This is a fan mod, not made or endorsed by Miro Haverinen. None of the game's files are included: every player plays from their own copy, which they need to own. Nothing in the game's folder is changed. Fear & Hunger and everything in it belong to Miro Haverinen.

Folders named below are inside the download's `app` folder (in the source code, the top folder).

## What you need

- **Fear & Hunger** from Steam or itch, for every player (Windows, Steam Deck or Linux). The mod finds it through Steam or the itch app; if it can't, it asks you for the folder once. Everyone needs the same version of the game: the mod checks, and says so if not.
- **This mod**, for every player, the same version.
- **Chrome, Edge, Opera or Brave** to play in.
- For an AI partner that talks and thinks, any one of: **Claude Code**, **Codex** (the ChatGPT/Codex app or CLI, ChatGPT login) or **Grok Build** signed in on this PC, an API key from **Anthropic, xAI (Grok), OpenAI, Google (Gemini) or OpenRouter** (paste it when F8 asks), **Hermes Agent** signed in (its proxy, for your SuperGrok or Nous Portal plan), or a local model in **Ollama** or **LM Studio**. The partner finds whichever you have, and **How it thinks** in the Together panel picks another. Without any, it still follows, fights and takes orders typed in plain words; it just doesn't talk back much.

Everything else comes in the box, except one thing: the first time you host online, the mod downloads Cloudflare's tunnel program (cloudflared, about 55 MB) from Cloudflare's official releases and checks it against their published checksum.

## Starting

1. Unzip anywhere (or install it with the itch app and press Launch).
2. Double-click **Fear & Hunger Together**. The game opens in its own window. Close the window to quit.
3. Type a name (bottom left), then New Game or Continue.

**Together** on the title screen does the rest:

- **Host online**: you get a link (already copied). Send it to your friends.
- **Join a friend**: paste their link. Or just click the link they sent: it opens the game and offers to join.
- **AI partner**: call one in, or send it home. F8 does the same in the game.

Up to four players. Each friend needs the game and this mod. Opening a link in a plain browser only shows how to join: the game always comes from your own copy.

The first time, Windows may say "Windows protected your PC" because the program isn't signed. Click **More info**, then **Run anyway**.

For tinkerers, `app\Play.cmd` still starts it from a console with the old menu.

### Steam Deck and Linux

1. Fear & Hunger installed through Steam (the Windows version; Steam installs it with Proton). On a Deck it may be on the SD card.
2. Chrome (or Chromium, Edge, Brave). On a Deck: Desktop Mode, **Discover**, install **Google Chrome**.
3. Unzip this mod anywhere, for example into Downloads.
4. Start **play.sh**. On a Deck, to play it from Game Mode: in Steam, **Games > Add a Non-Steam Game**, Browse, pick `play.sh`. It opens full screen; closing it quits. If the buttons do nothing in the game, pick the **Gamepad** layout in its controller settings.

The first start fetches its own copy of Node.js (about 30 MB, checked against nodejs.org's checksums). Online hosting fetches Cloudflare's tunnel program the same way.

## Playing together

| Key | Controller | |
|---|---|---|
| **Y** | Start | Talk to everyone. An AI partner takes orders this way. On a Deck, Steam + X brings up the keyboard. |
| **F8** | | Call an AI partner in, or send it home (host only). **Shift+F8** calls another. |
| **Enter**, facing a partner | A | Join their party, hand them something, use an item on them (a bandage, food), cast a skill on them (a healing prayer), or join their fight. |
| **F** | R3 | Follow a partner who just went through a door. |
| **Tab** (hold) | LT (hold) | Everyone's character: health, hunger, what they wear and carry. |
| **F1** | View | How playing together works. |
| **F9** | | Lag meter. |
| **R** at the title | RT | Carry on after a crash or a dropped connection. |
| **Ctrl+Shift+U** | View + Start (hold) | Unstuck, if the game's own scripts trap you. |
| **Ctrl+Shift+B** | | Copy a bug report (also in the Together panel). |

On a controller the game's own keys are on buttons too: **RT** lights the torch (T), **L3** is phase (C). The Together panel works with the D-pad, A and B. Hold **B** where it says hold Esc.

- **Fights.** Whoever touches the enemy starts the fight and keeps what it drops. Anyone nearby is pulled in. Each player commands their own character.
- **Bags** are your own. An emptied chest is empty for everyone.
- **Party.** Four characters between all of you. Join someone's party (Enter, facing them) and you walk in their line: through every door they take and into every fight they start, from anywhere on the map. You still run your own character and menu, and their characters show in your menu lineup, where you can look at their gear but not change it. Hold a direction to step out of line.
- **Death.** You watch through a living partner's eyes. They can call you back at a ritual circle, which spends the circle. If everyone is dead, the run is over. Hold Esc to let your character go: what you carried passes to a partner, and you can start someone new.
- **Saves.** Sleeping in a bed saves everyone. Another day, everyone presses Continue and lands on their save from that night. Any of you can host that other day: each player's PC keeps its own copy of their saves and of the run, so nobody waits on the first night's host.

## The AI partner

It joins as whichever character nobody has taken, and plays them: it walks with you, fights its own turns, talks in that character's voice, and lives under the same rules you do.

- **Fights.** It sees the fight the way you do (the enemy's wounds in words, never numbers; its own side's health as the numbers on the battle screen) and picks its own attack, target, skill or item.
- **Talking.** Press Y and talk to it normally. It understands "wait here", "follow me", "join my party", "be quiet", "you can talk again", "give me your torch", "eat something", "go home". If it is dead and you tell it to let go, it gives the character up and you get its bag.
- **Wounds.** It binds its own bleeding, treats infection and poison, and heals when it is close to death, with what it carries. When it has nothing for it, it asks you.
- **Fights you are in.** If you are fighting close by, it comes in. It is told plainly how a fight ended, so it won't claim a kill that got away.
- **Hunger.** It gets hungry, eats from its own bag, and asks you when it has nothing. It doesn't scavenge: it eats what you hand it and what its own fights drop. Hand it food by facing it and pressing Enter.
- **Death.** If you die, it walks to the nearest ritual circle that still works, through the doors and whatever is in the way, and calls you back. If it can't find one, it says so in the chat. If it dies, you can call it back the same way.
- **Doors.** When you go through a door it walks after you. If it can't find the way within a minute, it catches up the quick way.
- **Coming back.** At a bed it saves with you, and when you Continue another day it loads its own save from that night. If the partner itself crashes or loses its connection, starting it again within 20 minutes carries on from where it was. Otherwise it joins as someone new.
- **Food.** It eats clean food first and only touches rotten meat and the like when it is starving.

### What runs it

Pick it in the game: **How it thinks** in the Together panel (F8 opens the same panel when nothing is found). Choose one, paste a key if it needs one, and the model list fills from the service itself, fastest first; the key and model are checked with one short question before anything is kept. The pick and the keys stay on this PC in `app\data\partner-mind.json`.

| Choice | What it needs | Speed and cost |
|---|---|---|
| Claude Code | Claude Code installed and signed in (https://claude.com/claude-code) | About 1-3 s a decision. Counts against your Claude plan. |
| Codex | The ChatGPT/Codex app or the Codex CLI, signed in with ChatGPT | About 1-3 s a decision. Counts against your ChatGPT plan. Runs from a Codex folder of its own: your AGENTS.md, settings and plugins stay out of it. |
| Grok Build | Grok Build installed and signed in (`grok login`) | About 5 s to answer, 10-25 s a fight turn; a partner that slow fights by the same rules a careful player uses (instantly) and keeps the model for talking. Counts against your Grok plan. |
| Anthropic, xAI Grok, OpenAI, Google Gemini, OpenRouter | An API key from that service | About 1-2 s on the fast models. Paid by use; the small models cost far less. |
| Hermes | Hermes Agent installed and signed in to Grok (SuperGrok) or Nous Portal (`hermes model`) | Under 1 s a decision on Grok's fast model. The mod starts Hermes's proxy itself, a plain relay with no agent tools. Counts against that plan. |
| Ollama, LM Studio | The program running on this PC with a model loaded | Free. Speed depends on your graphics card; small models play worse. |
| Other | Any service that speaks the OpenAI chat API: its address, key and model | Depends on the service. |
| No model | Nothing | Free. Follows, fights by the rules a careful player uses, takes orders typed in plain words. |

Without a pick it finds its own: Claude Code, else an Anthropic key, else a key in `XAI_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) or `OPENROUTER_API_KEY`, else Codex, else Grok Build, else Ollama, else LM Studio, else Hermes's proxy if it is already running, else none. `app\settings.json` under `"partner"` overrides all of that. Leave a field empty for the default.

| Field | Meaning |
|---|---|
| `brain` | `claude` (Claude Code), `codex-cli` (Codex), `grok-cli` (Grok Build), `anthropic`, `xai`, `openai`, `gemini`, `openrouter` (those services' APIs), `ollama`, `lmstudio` (a model on this PC), `hermes` (Hermes Agent's proxy), `openai` with a `url` (any other OpenAI-style service), or `none`. |
| `model` | For Claude Code: `sonnet` (default, about 1 second a decision), `opus` (2 to 3 seconds, a little sharper, uses more of your plan), or `haiku` (cheapest, but slower and weaker in fights). For the Anthropic API the same short names work, or a full model name (default `claude-sonnet-5-5`). For the other services: a model name from their list; left empty, the fastest one in the service's own list is taken. |
| `effort` | How hard the model thinks: `low` (default) to `high`. Higher is slower. Services that don't take it are asked without it. |
| `url`, `key` | `key`: the service's key (a key pasted at F8 is kept apart, in `app\data\partner-mind.json`). `url`: for `openai`, another service's address. |
| `name` | What it is called in the game. Default `Claude`. |
| `character` | `knight`, `mercenary`, `priest` or `outlander`, if it is free. |
| `follow` | The name of the player it sticks with, when there are several of you. |

The same options work on the command line, which overrides the file: `node tools/bot.js --model sonnet --char priest`.

**Cost.** Every decision and every reply is one request to the model. With Claude Code this counts against your Claude plan's usage. With Grok Build, against your Grok plan. With an API key you pay per request; the small fast models cost far less than the big ones. A local model costs nothing but plays worse.

**What it sends.** The model is told what the partner sees: the fight, what is said in the chat, dialogue it overhears, its bag and yours as far as you mention them. Nothing else from your PC.

## Settings

`app\settings.json`:

```json
{
    "game": "",
    "partner": { "name": "Claude", "brain": "", "model": "", "effort": "low", "character": "", "follow": "", "url": "", "key": "" }
}
```

`game` is only needed if the game isn't found: the game's folder, for example `D:\\SteamLibrary\\steamapps\\common\\Fear & Hunger` (with doubled backslashes).

## Good to know

- Each player's clock runs on their own machine: hunger and timed events tick for each of you separately.
- Some special enemies (the Crow Mauler, the red man, the harvestmen, the yellow mage) and some puzzles are each player's own, not shared.
- If the game's own scripts get you stuck, Ctrl+Shift+U frees you.
- Hosting online uses a free Cloudflare quick tunnel. The link changes every time and dies when you close the game. **Hide my IP address** is on by default: everything goes through the tunnel, fight video included (60 pictures a second, at most 1.5 Mbit/s of upload for each player watching, less on a slow line). Turn it off and the players' browsers connect to each other directly, asking public address servers (Google's and Cloudflare's STUN servers) for a route; each player's IP address is then visible to the others.
- Saves live in `app\data\saves` on the host's PC (a friend's saves too), not in the game's own save folder.
- Found a bug? Press Ctrl+Shift+B (or **Copy a bug report** in the Together panel) and paste what it copies into your report: the versions, the end of this PC's logs and what the game was doing. Link keys, API keys and your Windows user name are left out. The full logs are `app\data\server-8420.log` and `app\data\launcher.log`.
- API keys pasted at F8 sit in `app\data\partner-mind.json` in plain text. Delete that file to forget them; don't share it.

## For tinkerers

`npm test` runs the whole test suite with headless Chrome. `node test/ai-live.js` runs the AI partner against the real model (it spends model calls). `node tools/package.js` builds the zip for itch, Node and the launcher included (`node tools/build-launcher.js` builds the launcher alone, with the C# compiler Windows ships). `node test/tour.js` walks two players through every map in the game.

Without the zip, from the source: `Play.cmd` fetches a private copy of Node.js the first time if it isn't installed, and installs the rest with npm.

