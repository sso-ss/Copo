# CoPo

[English](README.md) | [한국어](README.ko.md)

**CoPo = Connection Point**

*“The connection point where tools meet models.”*

<img src="shell/ui/companion/artwork/cat-idle.png" alt="CoPo's cat mascot" width="120">

CoPo connects your AI tools to models through one local gateway. Today, it
connects Claude Code, Claude Desktop, and local Codex sessions through your
GitHub Copilot account, with tools, models, accounts, and usage managed in
one place.

Formerly **ModelRelay**, the app was renamed **CoPo** to reflect a broader
vision: a connection point that can grow beyond Copilot to support more
tools and model providers. GitHub Copilot is the current provider; broader
provider support is a direction for the project.

The **cat is CoPo's mascot** and your desktop companion. It works alongside
you, celebrates completed tasks, and reacts when something needs attention.
Warm neutral colors, rounded controls, and a companion you can personalize
make CoPo feel at home on your desktop.

**Status:** pre-alpha, version 0.1.0. Local task monitoring is implemented for
Claude Code and Codex; full live acceptance testing of the packaged app is
still in progress. See the [implementation notes](docs/dev/companion-implementation.md)
for current coverage and limitations.

## What CoPo does

- **Keeps you company.** The desktop cat reflects work, waiting, completion,
  and interruptions. Click it to open your connections, or drag it somewhere
  comfortable on your screen.
- **Connects your tools.** Settings → Apps detects supported installations and
  offers Configure and Disconnect, with installation help when an app is missing.
- **Keeps settings together.** Manage GitHub accounts, model routing, and API
  keys without switching between separate configuration files.
- **Shows usage.** Review Copilot allowances and recorded token usage in
  Settings → Usage and the Dashboard.
- **Feels at home.** Choose System, Light, or Dark appearance, adjust your
  buddy's size, and preview its poses and gestures in Personalization.
- **Works as a gateway.** Other compatible tools can use its Anthropic- and
  OpenAI-compatible endpoints with a CoPo API key.

CoPo runs locally; model requests are sent to GitHub Copilot. You need a
GitHub account with access to Copilot and the models you want to use.

## Get started

With a current CoPo desktop build:

1. Open **CoPo** and sign in with GitHub.
2. Open **Settings → Apps** and choose **Configure** beside your tool.
3. If the tool is missing, follow the installation help, then choose
   **Check again**. Claude Code has a copyable install command; Claude Desktop
   has a link to its official download page.
4. Restart the configured tool and start a fresh session. For Codex Desktop,
   create a new local chat so it picks up the CoPo provider.
5. Send a request. CoPo's connections panel will reflect the tool's activity.

**Configured** means CoPo saved the tool's configuration. Live request activity
provides the evidence that the connection is working. Use **Disconnect** to
remove CoPo's managed configuration when you want to stop routing that tool
through it.

Keep CoPo running while your tools use its gateway. After installing an updated
build, quit and reopen CoPo to load it.

### Supported tools

| Tool | Setup | Companion activity |
|---|---|---|
| Claude Code | Configure in Settings → Apps | Requests and local task starts, waits, completion, cancellation, and failure |
| Claude Desktop / Cowork | Configure its third-party inference profile | Request activity; whole-task completion is not yet supported |
| Codex CLI and Desktop | One shared configuration in Settings → Apps | Requests and local task lifecycle for sessions using CoPo's provider |
| Other compatible API clients | Create an API key and configure the client's base URL | Request activity attributed to that key |
| Copilot CLI | Coming soon | Not yet supported |

Codex CLI and Desktop share a connection and API key. Remote/cloud Codex
sessions are outside local task monitoring. Local task observers depend on
client record formats; unknown or missing completion records do not trigger
a celebration.

## Meet your companion

| Pose | When you will see it |
|---|---|
| Working | A request or supported task is running, including gaps between requests within a task |
| Relaxing | A connected tool is ready, or a supported task is waiting for your input |
| Happy | A supported task confirms completion, or a connection is first verified by a successful request |
| Surprised | A task fails or is cancelled, a request is interrupted, or the gateway connection has a problem |
| Hearts | You hover over the cat |
| Sleeping | No tools are ready, sign-in is needed, or activity is unavailable |

Happy holds for **10 seconds**, and surprised normally holds for **4 seconds**.
Ongoing work and gateway state take priority over reactions. Reopening the app
does not replay celebrations from old tasks.

In **Settings → Personalization → Try motions**, explore all ten poses and
gestures individually, use **Play all**, or pause playback. The preview is
separate from live task activity. With Reduce Motion enabled, the same poses
remain available as still images.

## Build from source

The desktop instructions below target macOS. Install the Bun version pinned in
[`.bun-version`](.bun-version), a Rust toolchain, and Xcode Command Line Tools.

From a checkout of this repository:

```sh
bun install
bun run app:setup
bun run app:dev
```

To build the macOS app and disk image:

```sh
bun run app:build
```

Tauri places the app and disk image under
`shell/src-tauri/target/release/bundle/`. The build bundles the gateway, UI,
fonts, and companion artwork.

See [development commands](docs/commands.md) for faster UI iteration and the
[release runbook](docs/release-runbook.md) for packaging and distribution.
The upstream `stuffbucket/tap/maximal` Homebrew formula installs Maximal;
it is not a CoPo installer.

### Run just the gateway

You can use the gateway without the desktop companion. After `bun install`,
authenticate once and start it from this checkout:

```sh
bun run ./src/main.ts auth
bun run ./src/main.ts start
```

The default port is **4141**. Open
[Settings](http://127.0.0.1:4141/ui/settings/) to configure your tools, or
[Dashboard](http://127.0.0.1:4141/ui/dashboard/) to view usage.

For clients you configure manually, use `http://127.0.0.1:4141` as the
Anthropic base URL or `http://127.0.0.1:4141/v1` as the OpenAI base URL,
together with an enabled key from **Settings → API keys** and a supported model.

When the CLI is installed, its name is `copo`. The `maximal` alias remains
available for compatibility. Useful commands include:

```sh
copo app list
copo app codex --enable
copo app codex --disable
copo check-usage
copo debug
copo start --help
```

When running from source, replace `copo` with `bun run ./src/main.ts`.

## Configuration and local data

Most everyday configuration is available in Settings. For command-line use:

| Setting | Option |
|---|---|
| Gateway port | `start --port 4141` |
| Copilot account type | `start --account-type individual`, `business`, or `enterprise` |
| GitHub Enterprise host | `COPILOT_API_ENTERPRISE_URL` |
| Custom data directory | `COPILOT_API_HOME` or `--api-home` |
| Optional hosted web search | `OLLAMA_API_KEY` |
| Troubleshooting output | `start --verbose` and `debug` |

CoPo stores configuration, account credentials, usage data, and logs in
`~/.local/share/copo` on macOS and Linux, or `%APPDATA%\copo` on Windows.
Provider secrets can be stored in the data directory's `secrets/` folder;
environment values take precedence. `copo debug` reports the effective
configuration and secret sources without printing secret values.

On upgrade, CoPo can migrate the legacy `maximal` data folder when no CoPo
folder exists. Quit the old instance first. Existing stores are never merged
or overwritten, and explicitly configured data directories are not migrated.
See [storage migration](docs/dev/storage-migration.md) for details.

Task monitoring reads local client lifecycle records. Its activity events
contain status metadata, not prompts or responses, and it creates no new
transcript store. This is separate from gateway request logging; see the
[architecture guide](docs/architecture.md) for logging and diagnostics.

The gateway also translates Anthropic server-side web tools into tool calls
Copilot can handle. Hosted search uses an optional Ollama API key; without it,
search reports unavailable and web fetching runs locally. See the
[web-tools specification](docs/spec/archive/web-tools.md) for details.

## Development and documentation

| Path | Contents |
|---|---|
| `src/` | Gateway, authentication, app integrations, and task monitoring |
| `shell/src/` and `shell/ui/` | Settings, Dashboard, and companion UI |
| `shell/src-tauri/` | Native desktop shell and gateway lifecycle |
| `tests/` | Automated test suites |
| `docs/` | Architecture, setup references, design guides, and implementation notes |
| `scripts/` | Development, build, and release helpers |

Read [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) before making changes.
Every interface follows the official [CoPo design style](DESIGN.md): warm
neutrals, rounded corners, clear typography, and consistent controls across
the companion, menus, Settings, and Dashboard.

- [Development commands and checks](docs/commands.md)
- [Architecture](docs/architecture.md)
- [Companion implementation and known limits](docs/dev/companion-implementation.md)
- [Codex integration](docs/dev/codex-integration.md)
- [Claude Desktop / Cowork configuration](docs/admin/claude-desktop-mdm.md)
- [Release process](docs/release-runbook.md)
- [Report an issue](https://github.com/sso-ss/ModelRelay/issues)

## Credits and license

CoPo is a fork of [Maximal](https://github.com/stuffbucket/maximal), building
on its GitHub Copilot gateway and client integrations. Some internal protocol
names, sidecar filenames, and the `com.sso-ss.modelrelay` bundle identifier
remain for compatibility.

Licensed under [MIT](LICENSE). See [THIRD-PARTY-LICENSE](THIRD-PARTY-LICENSE)
for bundled dependency and artwork attributions.
