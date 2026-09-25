# Codex CLI routing

Settings → Apps → Codex CLI detects the CLI on PATH and in common install
locations. Install a current Codex CLI and connect your account in Maximal
before switching routing on. Apps uses the model saved in your Codex
configuration without displaying or changing it. If that model is missing or
unsupported, configure a supported model in Codex and try again.

Enable checks the command-backed key helper and sends a short, non-stored
Responses request through `http://127.0.0.1:4141/v1`. This request can consume
account quota. Only a completed response allows the config write. Failure
leaves Codex's config unchanged. Start a new Codex session after toggling;
running sessions retain their configuration.

The integration is also registered as `maximal app codex` (status),
`maximal app codex --enable`, and `maximal app codex --disable`. CLI enable
uses the configured model and the same verification as Settings. Uninstall
calls the same ownership-aware removal. Routing remains configured while
Maximal is stopped; switch it off before using Codex without Maximal.

## Configuration and ownership

- Respects `CODEX_HOME`, falling back to `~/.codex/config.toml`.
- Sets the effective `model_provider` to an available managed provider name,
  starting with `maximal-app` and using a numbered suffix when necessary.
  Existing provider definitions and references are preserved. If the default profile
  explicitly selects a provider, that profile's setting is changed; otherwise
  the root setting is changed. Other profiles are preserved. Explicit CLI
  overrides, alternate profiles, and project/admin configuration can still
  override the user configuration; the check verifies the user-level route.
- Settings and CLI toggles leave `model` untouched. The API also accepts an
  explicit model override; those changes use the same reversible edits.
- Adds a marked provider section with `wire_api = "responses"` and
  command-backed `auth`. A manually configured `model_providers.maximal`
  can coexist with the integration. Disabling restores the prior provider
  selection; it may still route through Maximal if that was the prior setup.
  Earlier marked integrations using the `maximal` name remain reversible.
- The helper invokes the current Maximal executable with `api codex` and an
  explicit `--api-home` after the client subcommand (`api codex --api-home …`).
  Stable symlinks to that executable are preferred;
  development launches include the absolute Bun entrypoint. Keys stay in
  Maximal's key store and travel through captured stdout to Codex. No API key
  or environment-variable requirement is written into Codex configuration.
- The marked block contains restoration metadata for only the changed scalar
  statements. Comments, whitespace, unrelated tables, and credentials remain
  outside these edits. Writes use a private temporary file and atomic rename,
  with a reread immediately before committing to reject concurrent edits.
- Disable restores a scalar only if its current statement exactly matches
  the one Maximal wrote. Later user edits survive. The provider is removed
  only if it is unchanged and no remaining profile references it; otherwise
  its content is preserved and ownership markers are removed. When routing
  has drifted, Apps offers “Remove Maximal settings” for cleanup.
- Invalid TOML, damaged ownership metadata, symlinked config files, and
  layouts that cannot be edited without changing unrelated parsed values
  fail without rewriting the file. Ordinary root keys and profile tables,
  including multiline TOML elsewhere in the document, are supported.

The toggle is serialized within the Maximal process. Repeated enable/disable
does not duplicate config or replace the original restoration metadata. An
already-enabled, unchanged selection does not send another verification request.

## Authentication reference

Codex's [official configuration reference](https://developers.openai.com/codex/config-reference/)
documents `model_providers.<id>.auth.command`, `auth.args`, `auth.timeout_ms`,
and `auth.refresh_interval_ms`. Command auth must not be combined with
`env_key`, `experimental_bearer_token`, or `requires_openai_auth`. The
integration writes none of these competing authentication settings.

## Validation scope

No tests were added or run for this change. The routing check is implemented
as part of enabling the integration; development checks do not invoke it or
change the developer's Codex configuration.
