# Code signing policy

**Status:** not signed. An application to SignPath Foundation was declined in October 2026 (the project was new); releases are not signed, and Windows may say "Windows protected your PC" the first time (click **More info**, then **Run anyway**).

The rest of this page is the policy that would apply if signing is set up later (free code signing by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org)).

Only one file in a release is signed: the launcher, `Fear & Hunger Together.exe`. The rest of the release zip is JavaScript source, data, and an unmodified Node.js runtime downloaded from nodejs.org (signed by the Node.js project, not by us).

## How the signed file is made

- The launcher is built from `tools/launcher/Launcher.cs` in this public repository, by the GitHub Actions workflow `.github/workflows/build-launcher.yml`, on GitHub-hosted runners, with the C# compiler that ships with Windows.
- Only that workflow's output is submitted for signing. Nothing built on a personal machine is signed.
- SignPath verifies that the submitted binary was built by that workflow from this repository.
- The signing key is held by SignPath; the project never has it.
- Each signing request is manually approved by the approver below.

## Team roles

- Authors and reviewers: [glynn568-glitch](https://github.com/glynn568-glitch)
- Approvers: [glynn568-glitch](https://github.com/glynn568-glitch)

This is a single-maintainer project, so one person holds every role. Multi-factor authentication is required on every team member's GitHub and SignPath account.

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

The authors receive nothing from the program: no telemetry, no analytics, no crash reports. The launcher starts the local game server and opens a browser window to `http://localhost`. Any other network use is the player's choice, as described in the [README](../README.md): hosting online through a Cloudflare tunnel, direct connections between players (which use public STUN servers when "Hide my IP address" is off), and the optional AI partner, which talks to the service the player configures (Claude Code, the Anthropic API, an OpenAI-style service, or a local model).

## What is in this repository

Fear & Hunger Together is a free, MIT-licensed fan mod. It contains no files from Fear & Hunger; players need their own copy of the game.

Wording sources: the attribution line and privacy sentence are from SignPath Foundation's terms, https://signpath.org/terms.
