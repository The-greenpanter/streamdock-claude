# Claude Sessions — StreamDock plugin

Launch and monitor [Claude Code](https://claude.com/claude-code) sessions from a
**Mirabox StreamDock** deck, and spread images or animated GIFs across its keys.

Built and tested on a **StreamDock 293SV3** (5×3 keys + a 3-slot sidebar), running
under the Node.js runtime that ships with the StreamDock app.

> Not affiliated with Mirabox or Anthropic.

![Button states](docs/preview-estados.png)

---

## Why this exists

Claude Code stores sessions per working directory. If several sessions share a folder
— which happens fast — `claude --continue` can only ever reopen the most recent one,
so a button per project is impossible. This plugin indexes sessions by their real id
and resumes exactly the one you picked.

While building it, a few things about the StreamDock plugin host turned out to be
undocumented. They are collected under
[Notes for other plugin authors](#notes-for-other-plugin-authors) — that section is
probably more useful than the rest of this file if you are writing your own plugin.

---

## Actions

### Launch Sessions

One action, four modes, chosen in the Property Inspector:

| Mode | What the key does |
|---|---|
| **All named sessions** | opens every session you have named, one Windows Terminal tab each |
| **A single session** | opens just that one; can be excluded from the group above |
| **Session picker** | runs `claude --resume` with no id — Claude's own interactive picker |
| **Custom command** | runs `claude` with whatever flags you type, in the folder you choose |

Sessions are stored **by id**, so renaming one does not break the button. If the id
ever disappears the plugin falls back to the saved name, and if that fails too it
opens Claude's picker instead of erroring out.

"All named sessions" means exactly that: name a session and it joins the group,
remove the name and it leaves. Sessions with their own key can be excluded with a
checkbox so they are not opened twice.

### Session Status

A live panel: one bar per named session, lit when it was touched in the last 24 h.
The title shows `3/6`. Works on a key, on the info board and on the sidebar.

### Wallpaper / GIF

Puts an image or an animated GIF on a key, or slices one image across several keys.

- **PNG, JPEG and animated GIF**, decoded in pure JavaScript — no native modules.
- Framing is explicit: `contain` / `cover` / `stretch` / `none` (1:1), plus zoom and
  X/Y offset. Nothing is cropped or shrunk by the plugin's own decision.
- All animated keys share one clock, so frames stay in sync across the deck.

**Known limitation:** spreading one image across many keys does not land reliably yet
— see [Known issues](#known-issues).

---

## Install

Requires the StreamDock app (this was developed against **3.10.203**) and
[Claude Code](https://claude.com/claude-code) on your `PATH`.

```bash
git clone https://github.com/The-greenpanter/streamdock-claude.git
cd streamdock-claude
npm install
```

Then copy it into the StreamDock plugins folder:

```powershell
.\scripts\deploy.ps1            # copy only
.\scripts\deploy.ps1 -Restart   # copy and restart StreamDock
```

`deploy.ps1` copies `com.greenpanter.claude.sdPlugin/` plus `node_modules/` into
`%APPDATA%\HotSpot\StreamDock\plugins\com.greenpanter.claude.sdPlugin\`.
A restart is not strictly required: the host retries every 60 s and re-reads the
manifest each time.

To reload only the plugin after an edit, kill its Node process — it is the most
recently started `node20`, the others belong to the stock plugins:

```powershell
Get-Process node20 | Sort-Object StartTime | Select-Object -Last 1 | Stop-Process -Force
```

### Configuration

Everything is set per key in the Property Inspector; there are no config files to
edit. The default folder for the *picker* and *custom* modes is resolved from your
home directory and can be overridden with the `CLAUDE_SD_CWD` environment variable.

---

## How it works

```
StreamDock.exe  ──spawns──>  node20.exe plugin/index.js -port N -pluginUUID … 
       │                              │
       └────── WebSocket 127.0.0.1:N ─┘
```

### Layout

```
com.greenpanter.claude.sdPlugin/   the deployable unit — this is what ships
├── manifest.json                  actions, icons, and the Nodejs runtime key
├── plugin/                        the Node process
├── propertyInspector/             per-key settings UI (runs in the app's CEF)
└── resources/                     action and category icons

tests/       six suites, run against a fake WebSocket host
tools/       read-only diagnostics for the live install
scripts/     deploy + icon and calibration image generators
docs/        images used by this README
```

The `<uuid>.sdPlugin` folder name follows the convention used by the
[official plugin repository](https://github.com/MiraboxSpace/StreamDock-Plugins).

| File | Role |
|---|---|
| `plugin/index.js` | events, button state, animation clock |
| `plugin/sd.js` | WebSocket client and StreamDock protocol |
| `plugin/sessions.js` | indexes `~/.claude/projects/**/*.jsonl`; id ↔ name resolution |
| `plugin/launcher.js` | builds the `wt.exe` command line |
| `plugin/wallpaper.js` | slices an image across keys |
| `plugin/image.js` | PNG/JPEG/GIF decoding, crop, scale, framing |
| `plugin/render.js` | software rasteriser for the button graphics |
| `plugin/png.js` | PNG encoder and decoder built on `zlib` |

### No native dependencies

Button graphics are drawn by a small rasteriser and encoded as PNG with Node's own
`zlib`. The stock plugins ship a 26 MB Skia binary for this; here it is about 280
lines of JavaScript. The only runtime dependencies are `ws`, `jpeg-js` and `omggif`,
all pure JS.

---

## Development

```powershell
$node = "C:\Program Files (x86)\StreamDock\node\node20.exe"

& $node tests/test-resolve.js    # session id -> name -> picker fallback
& $node tests/test-modos.js      # the four Launch modes, argument parsing
& $node tests/test-paths.js      # URL-encoded paths from the Property Inspector
& $node tests/test-harness.js    # fake host: launch + status actions
& $node tests/test-wallpaper.js  # 18 slots, synchronised animation
& $node tests/test-bandas.js     # image slicing lands on the right column

& $node tools/list-sessions.js   # what the session index sees
& $node tools/inspect-profile.js # which actions are in the active profile
```

`npm test` runs the suites that need no generated fixtures.

Run them with the bundled `node20.exe`, not your system Node, so you test the same
runtime the host uses.

> **A caveat worth repeating:** these tests spawn Node directly and therefore skip
> the host's own decision about *whether to start the plugin at all*. Green tests do
> not prove the plugin loads on the device — always deploy and check
> `log/plugin.log` before believing a change works.

The plugin writes its own log to `log/plugin.log` inside the installed folder,
because the host does not record plugin `logMessage` events anywhere.

---

## Known issues

- **Spreading one image across multiple keys is unreliable.** Each key renders the
  correct slice — verified locally with an 18-colour test pattern — but the slices do
  not always land on the matching physical key. An ordering fix was tried and
  reverted; it was based on a single experiment and broke as soon as several images
  and modes were mixed. Single-key images and GIFs work fine.
- The sidebar width ratio (`LAYOUT.sidebarWidthRatio`) is an estimate, not a measured
  value from the manufacturer.
- Windows only. The launcher shells out to `wt.exe` (Windows Terminal).

---

## Notes for other plugin authors

These are empirical findings from this device and app version, not official
documentation. Verify before relying on them.

- **`"Nodejs": { "Version": "20" }` in `manifest.json` is what makes the host start a
  Node process for a raw `.js` entry point.** Without it the manifest still loads —
  icons and settings appear — but no process is ever spawned, and the host silently
  retries every 60 seconds. The official Node template compiles to an `.exe` instead,
  so this path is not covered by it, though every stock Node plugin uses it.
- Argument order is the real contract: the stock plugins read `process.argv[3]`
  (port), `[5]` (uuid), `[7]` (registerEvent), `[9]` (info) positionally rather than
  parsing flag names.
- The host does **not** log plugin `logMessage` events. Write your own log file.
- The `.sdProfile` on disk lags behind the app's in-memory state. Do not diagnose
  layout problems from it; use the coordinates delivered in `willAppear`.
- Do not wipe the destination folder when deploying: the running Node process has it
  as its working directory, so the delete fails halfway and leaves a broken install.
- `wt.exe` launches tab commands with `CreateProcess`, which does **not** apply
  `PATHEXT`. A `.cmd` shim on `PATH` will not resolve; pass a real executable path.

---

## Related

- [StreamDock Plugin SDK](https://github.com/MiraboxSpace/StreamDock-Plugin-SDK) — official templates (JavaScript, Vue, Node.js, C++, Qt, Python)
- [StreamDock Plugins](https://github.com/MiraboxSpace/StreamDock-Plugins) — official example plugins
- [SDK documentation](https://sdk.key123.vip/en/)
- [Space Platform](https://space.key123.vip/) — the StreamDock plugin marketplace

## How this was built

Written by [Claude Code](https://claude.com/claude-code) working with the author —
including the reverse engineering of the undocumented host behaviour listed above,
which came out of reading the stock plugins and instrumenting the running process.

Every claim in this README about how the host behaves was verified against the
actual device and application, not inferred. Where something is an assumption it is
labelled as one.

## License

[MIT](LICENSE) © Juan Diego Peña Castillo
