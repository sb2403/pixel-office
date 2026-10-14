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

Answer `y` when it asks, and choose user scope. The install also shows an options screen for `autoOpen` (when the office opens by itself: `on-first-subagent`, `session-start` or `never`; see Options below), so pick one there or keep the default. To skip the screen, set it on the command line with `--config autoOpen=…`. After that the mod loads in desktop sessions too. Start a new session: the office opens the first time a subagent is hired, or any time with `/office`.

## Options

`autoOpen` decides when the office opens by itself:

- `on-first-subagent` (default): the first time a subagent is hired.
- `session-start`: as soon as a session starts.
- `never`: only when you run `/office`.

Set it while installing, instead of answering the options screen:

```bash
claude plugin install pixel-office --marketplace sb2403/pixel-office --config autoOpen=session-start
```

To change it later, run `/plugin configure pixel-office@pixel-office` inside Claude Code, or save the value from a terminal by piping a JSON object to `configure`:

```bash
echo '{"autoOpen":"never"}' | claude plugin configure pixel-office@pixel-office --values-stdin
```

Either way the new value applies to sessions you start afterwards. `claude plugin configure pixel-office@pixel-office` on its own only shows the options and whether each is set; it changes nothing.

## Updating (users)

Installed sessions run the installed copy of the mod, not the files in this repository, so a change only reaches you once the maintainer has published a new version. To get it:

```bash
claude plugin marketplace update pixel-office
claude plugin update pixel-office@pixel-office
```

Then start a new session. (`pixel-office` is the name this marketplace registers under, however it was added.)

## Releasing a change (maintainers)

Raise `version` in `pixel-office/.claude-plugin/plugin.json`, commit, and push. Without a new version, installed copies do not pick up the change. Users then follow Updating (users) above.

## Good to know

- It is built on an early-access mod API that may change between Claude Code releases, so a new release can need a new version of this mod.
- An organization policy can disable mods. If yours does, the office will not load.
- Cost: it uses no model tokens. The only thing that enters your conversation is the one-line reply to `/office`.
- Privacy: it reads tool names, file names, commands, search patterns, web hosts and the short task descriptions helpers are given, inside your own Claude Code, only to draw the office. It sends nothing anywhere.

## Develop

From the repository root:

```bash
claude plugin test pixel-office
claude plugin validate .
claude plugin validate --strict pixel-office
```

`plugin test` needs Claude Code 2.1.295 or newer. `validate .` checks the marketplace file. `validate --strict` checks the mod and treats warnings as errors; it passes on this tree.

Licensed under the MIT License.
