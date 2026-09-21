# Security

## What this plugin does on your machine

It runs as a Node process started by the StreamDock app, and:

- **Reads** `~/.claude/projects/**/*.jsonl` — only the first and last chunk of each
  file, to extract the session id, its working directory and its name. Conversation
  content is never parsed, stored or transmitted.
- **Reads** image files you explicitly pick in the Property Inspector.
- **Spawns** `wt.exe` (Windows Terminal) with a `claude` command line.
- **Writes** `log/plugin.log` inside its own installed folder.

## What it does not do

- No network access beyond the local WebSocket to the StreamDock host on
  `127.0.0.1`, which is how every plugin talks to the app.
- No telemetry, analytics or crash reporting.
- No credentials are read, stored or requested.
- No native binaries, no postinstall scripts, no code downloaded at runtime.

## Things worth knowing before you install

**The custom-command mode runs what you type.** Whatever you put in the *Parameters*
field is passed to the `claude` executable as arguments. That is the point of the
feature, but it means a key can run any flag Claude accepts. Only the local user can
edit those fields.

**Session names and paths reach the device.** Button titles show session names, so
whatever you named a session is visible on the deck and in `log/plugin.log`.

**The log records file paths.** Failures include the image path that failed. Keep that
in mind before sharing the log in a bug report.

## Dependencies

Three, all pure JavaScript, no build step and no postinstall:

| Package | Why |
|---|---|
| `ws` | WebSocket client for the plugin protocol |
| `jpeg-js` | JPEG decoding |
| `omggif` | GIF decoding |

Everything else — PNG encode and decode, rasterising, scaling — is implemented in
this repository on top of Node's `zlib`.

## Reporting a vulnerability

Open a GitHub issue for anything non-sensitive. For something you would rather not
post publicly, use GitHub's private vulnerability reporting on this repository.

This is a hobby project maintained in spare time; there is no SLA.
