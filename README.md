# Pixel Office

A Claude Code mod that draws a live pixel-art office in the Claude desktop app. Every agent in the session is a character: Main works from the corner office, subagents arrive by elevator, get briefed in the meeting room, walk to the station that matches the tool they are using, hand their report back and leave.

## Stations

| Zone | Stands for |
|---|---|
| Corner office | Main's home base; thinking between tools |
| Desks | Edit, Write, NotebookEdit |
| Records library | Read, Grep, Glob, LSP, Skill, ToolSearch |
| Phone booths | WebFetch, WebSearch |
| Mailroom | Outside services (`mcp__` tools) |
| Server room | Bash, PowerShell, background shells |
| Meeting room | Briefings, SendMessage |
| Task board | TodoWrite, Task tools, plan updates |
| Reception | Waiting on you: questions, permissions, plan approval |
| Elevator | Agents arrive and leave |
| Break room | Idle agents, and Main between turns after a while |

Below the office: a plain-English feed of what just happened, an org chart of who reports to whom (each helper's job sits under its name), and a legend. Click a name in the org chart to see its task, current tool, who it reports to and time on the job.

## Requirements

- Claude Code 2.1.295 or newer. Older versions report that the mod failed to load.
- The Claude desktop app for the pixel picture. In a terminal you get a text version of the same office.

## Install

From a terminal Claude Code session:

```
/plugin install pixel-office --marketplace sb2403/pixel-office
```

Answer `y` when it asks, and choose user scope. After that the mod loads in desktop sessions too. Start a new session: the office opens the first time a subagent is hired, or any time with `/office`.

## Options

`autoOpen` decides when the office opens by itself:

- `on-first-subagent` (default): the first time a subagent is hired.
- `session-start`: as soon as a session starts.
- `never`: only when you run `/office`.

Set it while installing:

```bash
claude plugin install pixel-office --marketplace sb2403/pixel-office --config autoOpen=session-start
```

or change it later from the plugin's options (`claude plugin configure pixel-office` lists them).

## Updating

Installed sessions run the installed copy of the mod, not the files in this repository, so a change only reaches them once it is published as a new version. After changing the mod, raise `version` in `pixel-office/.claude-plugin/plugin.json`, then:

```bash
claude plugin marketplace update pixel-office
claude plugin update pixel-office@pixel-office
```

and start a new session. (`pixel-office` is the name this marketplace registers under, however it was added.)

## Good to know

- It is built on an early-access mod API that may change between Claude Code releases, so a new release can need a new version of this mod.
- An organization policy can disable mods. If yours does, the office will not load.
- Cost: it uses no model tokens. The only thing that enters your conversation is the one-line reply to `/office`.
- Privacy: it reads tool names, file names and commands inside your own Claude Code in order to draw them. It sends nothing anywhere.

## Develop

From the repository root:

```bash
claude plugin test pixel-office
claude plugin validate .
claude plugin validate --strict pixel-office
```

`plugin test` needs Claude Code 2.1.295 or newer. `validate .` checks the marketplace file. `validate --strict` checks the mod and treats warnings as errors; it passes on this tree.

Licensed under the MIT License.
