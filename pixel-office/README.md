# Pixel Office

A live pixel-art office for Claude Code that shows what every agent in your session is doing. Main, the agent you talk to, sits in the corner office. Each helper it hires arrives by elevator, gets briefed in the meeting room, walks to the station that matches the tool it is using (the library for reading and searching, the server room for commands, the desks for edits, the phone booths for the web) and carries its report back to whoever hired it. Beside the picture, a plain-English feed and an org chart say who is doing what, who is waiting on whom, and who is waiting on you.

Pictures, a full tour and the troubleshooting guide are on the [project page](https://github.com/sb2403/pixel-office).

## Install

In Claude Code 2.1.295 or newer:

```
/plugin install pixel-office --marketplace sb2403/pixel-office
```

Then start a new session.

## How to use it

Start a session. The office opens by itself the first time a helper is hired, or at any time with `/office`.

- **`/office`** shows or hides the office.
- **`/office settings`** lists the settings and their values, and **`/office set <name> <value>`** changes one. The **Settings** button under the picture and Claude Code's `/config` do the same.
- Click a name in the panel to see that agent's job, the start of its brief and report, its tokens and how long it has been working.
- **Show this job** opens a recap of the current job: how long it took, how many helpers worked at once, and what it cost in tokens.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `autoOpen` | `on-first-subagent` | When the office opens by itself: `on-first-subagent`, `session-start` or `never`. |
| `history` | `off` | `last-20` keeps a short record of your newest 20 jobs so the recap can list earlier ones. |
| `notify` | `off` | `after-30s` reminds you once, with a toast and a notification, when an agent has waited 30 seconds on you. |
| `otherSessions` | `off` | `on` lists your other Claude Code sessions on this computer that also have it on. |
| `debug` | `off` | `on` writes a troubleshooting log. |

## Where it works

- The picture shows in the Code tab of the Claude desktop app. In a terminal you get the same feed and team as text.
- Requires Claude Code 2.1.295 or newer.
- Panes are not drawn in the VS Code chat panel, `claude -p` or cloud sessions, so the office does not appear there.

## What it runs, reads, writes and sends

Pixel Office is readable TypeScript event handlers (a Claude Code mod). It runs no commands, installs no packages and starts no servers.

- **Sends:** nothing. It makes no network requests and sends no data anywhere.
- **Reads:** the events Claude Code reports for your session (which agent started, which tool it used, its brief, report and token counts), the settings below, and the environment variables `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE`, only to find your Claude config folder.
- **Writes, only when you turn a setting on:**
  - `history` set to `last-20`: the newest 20 jobs in the mod's own plugin store on this computer. Each entry holds the first 120 characters of the message that began the job, when it started, how long it took, how many helpers and the token counts.
  - `otherSessions` set to `on`: one small file per session in `pixel-office/sessions` under your Claude config folder, rewritten every few seconds. It holds the project folder's name (not its path), the session's status, the kind of work in a few fixed words, the first 60 characters of the message it is working on, and its agents' kinds and positions. No brief, report, tool, file name or command goes in it.
  - `debug` set to `on`: `debug/log.jsonl` inside the plugin's own folder, capped at 3000 lines. It holds event kinds, agent ids, tool names, counts and timings, never commands, file names or your text.
- **Settings:** changing a setting from the office or with `/office set` writes that option under `pluginConfigs` in your Claude Code `settings.json`, the same place `/config` writes it. It never touches permissions or any other setting.
- **Notifications:** with `notify` on, it shows a toast and raises a notification through your own notification setting.
- **Your conversation:** the replies to `/office` commands are the only text it ever adds.

All data stays on your computer. Turning a setting back to `off` stops the writing.

## License

MIT. See the [license](https://github.com/sb2403/pixel-office/blob/main/LICENSE).
