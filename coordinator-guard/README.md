# Coordinator Guard

An opt-in switch that keeps Claude Code's main agent a coordinator. While it is on, the main agent may read, search, run tests and git, and hire helpers, but it is refused when it tries to change a file itself and told to hire a helper with the Agent tool instead. Helpers are never held to it. It pairs with [Pixel Office](https://github.com/sb2403/pixel-office), which shows who is coordinating, but works on its own.

## Install

```
/plugin install coordinator-guard --marketplace sb2403/pixel-office
```

## How to use it

It is off until you switch it on, and the switch lasts for the session.

| Command | What it does |
| --- | --- |
| `/coordinator on` | The main agent is refused file changes and told to hire a helper. |
| `/coordinator off` | The main agent may edit again. |
| `/coordinator` or `/coordinator status` | Says whether it is on. |

While it is on, the main agent is refused `Edit`, `Write` and `NotebookEdit`, and shell commands that write a file: a redirect (`> out`, `>> log`), `tee`, an in-place edit (`sed -i`, `perl -i`), PowerShell's `Set-Content`, `Add-Content` and `Out-File`, and `git apply` or `patch`. Writing to its own memory, plans and scratch folders is still allowed. It cannot see what a script does, so `python script.py` that writes a file gets through. It is a nudge towards delegating, not a lock, and if the guard itself fails the call goes ahead.

## What it runs, reads, writes and sends

It is readable TypeScript event handlers (a Claude Code mod). It runs no commands, sends nothing over the network, writes no files and changes no settings. It reads the tool calls the main agent makes, to decide whether to refuse them, and keeps its on or off switch in memory for the session.

## License

MIT. See the [license](https://github.com/sb2403/pixel-office/blob/main/LICENSE).
