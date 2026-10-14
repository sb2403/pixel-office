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
| Break room | Idle agents |

Below the office: a plain-English feed of what just happened, an org chart of who reports to whom, and a legend. Click a name in the org chart to see its task, current tool, who it reports to and time on the job.

## Install

From a terminal, once:

```bash
claude plugin marketplace add "D:\Claude\Pixel Office"
claude plugin install pixel-office@pixel-office-local
```

Then start a new session. The office opens the first time a subagent is hired, or any time with `/office`.

## Options

`autoOpen`: `on-first-subagent` (default), `session-start`, or `never`. Change it in `/config`.

## Develop

```bash
claude plugin test pixel-office
claude plugin validate --strict pixel-office
```

Use Claude Code 2.1.295 or newer for `plugin test`. Because the marketplace is this folder, edits reach new sessions without reinstalling; run `/reload-plugins` in a terminal session to pick them up there.
