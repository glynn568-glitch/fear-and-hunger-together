# Fear & Hunger: Together

Co-op for Fear & Hunger (the first game), played in the browser. Up to four players share one dungeon as separate characters: split up or stick together, fight side by side, and drag each other back from death at the ritual circles. Friends, AI partners, or both: an AI partner drops in with one key and plays by the same rules a person does.

This is a fan mod, not made or endorsed by Miro Haverinen. None of the game's files are included: every player plays from their own copy, which they need to own. Nothing in the game's folder is changed. Fear & Hunger and everything in it belong to Miro Haverinen.

Folders named below are inside the download's `app` folder (in the source code, the top folder).

## What you need

- **Fear & Hunger** from Steam or itch (Windows), for every player. The mod finds it through Steam or the itch app; if it can't, it asks you for the folder once. Everyone needs the same version of the game: the mod checks, and says so if not.
- **This mod**, for every player, the same version.
- **Chrome, Edge or Opera** to play in.
- For an AI partner that talks and thinks, any one of: **Claude Code** signed in on this PC (https://claude.com/claude-code), an **Anthropic API key** (paste it when F8 asks), or **Ollama** running a local model. The partner finds whichever you have. Without any, it still follows and fights, silently.

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

## Playing together

| Key | |
|---|---|
| **Y** | Talk to everyone. An AI partner takes orders this way. |
| **F8** | Call an AI partner in, or send it home (host only). **Shift+F8** calls another. |
| **Enter**, facing a partner | Hand them something, use an item on them (a bandage, food), cast a skill on them (a healing prayer), or join their fight. |
| **F** | Follow a partner who just went through a door. |
| **Tab** (hold) | Everyone's character: health, hunger, what they wear and carry. |
| **F1** | How playing together works. |
| **F9** | Lag meter. |
| **R** at the title | Carry on after a crash or a dropped connection. |
| **Ctrl+Shift+U** | Unstuck, if the game's own scripts trap you. |
| **Ctrl+Shift+B** | Copy a bug report (also in the Together panel). |

- **Fights.** Whoever touches the enemy starts the fight and keeps what it drops. Anyone nearby is pulled in. Each player commands their own character.
- **Bags** are your own. An emptied chest is empty for everyone.
- **Party.** Four characters between all of you.
- **Death.** You watch through a living partner's eyes. They can call you back at a ritual circle, which spends the circle. If everyone is dead, the run is over. Hold Esc to let your character go: what you carried passes to a partner, and you can start someone new.
- **Saves.** Sleeping in a bed saves everyone. Another day, everyone presses Continue and lands on their save from that night.

## The AI partner

It joins as whichever character nobody has taken, and plays them: it walks with you, fights its own turns, talks in that character's voice, and lives under the same rules you do.

- **Fights.** It sees the fight the way you do (the enemy's wounds in words, never numbers; its own side's health as the numbers on the battle screen) and picks its own attack, target, skill or item.
- **Talking.** Press Y and talk to it normally. It understands "wait here", "follow me", "be quiet", "you can talk again", "give me your torch", "eat something", "go home". If it is dead and you tell it to let go, it gives the character up and you get its bag.
- **Wounds.** It binds its own bleeding, treats infection and poison, and heals when it is close to death, with what it carries. When it has nothing for it, it asks you.
- **Fights you are in.** If you are fighting close by, it comes in. It is told plainly how a fight ended, so it won't claim a kill that got away.
- **Hunger.** It gets hungry, eats from its own bag, and asks you when it has nothing. It doesn't scavenge: it eats what you hand it and what its own fights drop. Hand it food by facing it and pressing Enter.
- **Death.** If you die, it walks to the nearest ritual circle that still works, through the doors and whatever is in the way, and calls you back. If it can't find one, it says so in the chat. If it dies, you can call it back the same way.
- **Doors.** When you go through a door it walks after you. If it can't find the way within a minute, it catches up the quick way.
- **Coming back.** At a bed it saves with you, and when you Continue another day it loads its own save from that night. If the partner itself crashes or loses its connection, starting it again within 20 minutes carries on from where it was. Otherwise it joins as someone new.
- **Food.** It eats clean food first and only touches rotten meat and the like when it is starving.

### What runs it

It finds its own: Claude Code if it is installed, else an Anthropic key (pasted at F8 and kept in `app\data\partner-key.txt`, the `key` field, or `ANTHROPIC_API_KEY`), else a local Ollama, else none. To pick one yourself, set it in `app\settings.json` under `"partner"`. Leave a field empty for the default.

| Field | Meaning |
|---|---|
| `brain` | `claude` (Claude Code on this PC, signed in with your Claude account; the default when installed), `anthropic` (the Anthropic API, with `key` or `ANTHROPIC_API_KEY`), `openai` (any OpenAI-style service: OpenAI, Grok at `https://api.x.ai/v1`, or a local model in Ollama or LM Studio), or `none` (follows and fights by rule of thumb, never talks). |
| `model` | For Claude Code: `sonnet` (default, about 1 second a decision), `opus` (2 to 3 seconds, a little sharper, uses more of your plan), or `haiku` (cheapest, but slower and weaker in fights). For the Anthropic API the same short names work, or a full model name (default `claude-sonnet-5-5`). For other services: their model name, for example `llama3.1`. |
| `effort` | How hard Claude thinks: `low` (default) to `high`. Higher is slower. |
| `url`, `key` | `key`: your Anthropic key, or for `openai` the service's key (or set `OPENAI_API_KEY` / `XAI_API_KEY`). `url`: for `openai`, the service address. A local Ollama is found on its own. |
| `name` | What it is called in the game. Default `Claude`. |
| `character` | `knight`, `mercenary`, `priest` or `outlander`, if it is free. |
| `follow` | The name of the player it sticks with, when there are several of you. |

The same options work on the command line, which overrides the file: `node tools/bot.js --model sonnet --char priest`.

**Cost.** Every decision and every reply is one request to the model. With Claude Code this counts against your Claude plan's usage. With an API key you pay per request; Sonnet and Haiku cost far less than Opus. A local model through Ollama costs nothing but plays worse.

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
- Hosting online uses a free Cloudflare quick tunnel. The link changes every time and dies when you close the game. Without **Hide my IP address**, the players' browsers connect to each other directly for live fight video, and ask public address servers (Google's and Cloudflare's STUN servers) for a route; each player's IP address is then visible to the others. With it, everything goes through the tunnel and watching a partner's fight is a little rougher.
- Saves live in `app\data\saves` on the host's PC (a friend's saves too), not in the game's own save folder.
- Found a bug? Press Ctrl+Shift+B (or **Copy a bug report** in the Together panel) and paste what it copies into your report: the versions, the end of this PC's logs and what the game was doing. Link keys, API keys and your Windows user name are left out. The full logs are `app\data\server-8420.log` and `app\data\launcher.log`.
- An API key pasted at F8 sits in `app\data\partner-key.txt` in plain text. Delete that file to forget it; don't share it.

## For tinkerers

`npm test` runs the whole test suite with headless Chrome. `node test/ai-live.js` runs the AI partner against the real model (it spends model calls). `node tools/package.js` builds the zip for itch, Node and the launcher included (`node tools/build-launcher.js` builds the launcher alone, with the C# compiler Windows ships). `node test/tour.js` walks two players through every map in the game.

Without the zip, from the source: `Play.cmd` fetches a private copy of Node.js the first time if it isn't installed, and installs the rest with npm.
