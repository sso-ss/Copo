# Native Codex automatic reviews through Copilot

Verified locally on September 27, 2026 with Codex CLI 0.157.1 and the installed
CoPo. This supersedes the earlier conclusion that ChatGPT routing is the only
available way to run Codex permission reviews through CoPo.

## Native model selection

Codex model metadata supports a string `auto_review_model_override`. Setting
that field on the task model selects the named model for the native automatic
reviewer. This is model-catalog metadata, not a top-level `config.toml` key and
not the unrelated `review_model` setting for code review.

The installed client accepts a catalog supplied by `model_catalog_json` at
startup. Its bundled catalog is available offline through
`codex debug models --bundled`. Copying that catalog and setting the existing
`gpt-6-astra` entry's `auto_review_model_override` to `gpt-6-astra` lets the
reviewer use the same available Copilot model. Keep the existing `copo-app`
provider and `/v1` endpoint. No `codex-auto-review` model alias, ChatGPT bearer,
replacement policy, or approval-policy change is needed.

This field was discovered in the installed client's metadata, then verified by
runtime tests. It is absent from the public configuration schema checked in the
earlier investigation; treat it as version-dependent, not a documented stable
configuration API.

## Evidence

An ephemeral Codex process used a temporary workspace, the bundled catalog,
and a loopback fixture. It did not load user configuration. The fixture supplied
a synthetic main-agent tool call through `functions.exec`; the actual Codex
runtime generated the permission-review request and processed its result.

1. A unique offline reviewer name in `auto_review_model_override` appeared in
   the actual review HTTP request. The fixture did not rewrite model IDs.
2. Returning HTTP 503 from that reviewer caused Codex to decline the command.
3. With the override set to the existing `gpt-6-astra` entry, the actual reviewer
   request's JSON fields were preserved when sent to the installed CoPo `/v1/responses` route using
   CoPo's normal command-backed local authentication. CoPo used Copilot.
4. Copilot returned HTTP 200 and a completed structured decision. The response
   was returned unchanged to the native reviewer for the end-to-end checks.

| Controlled check | Real Copilot decision | Native Codex result |
| --- | --- | --- |
| Print a fixed string | Low risk, allow | Command completed with exit 0 and expected output |
| Simulated upload of a private credential to `example.invalid` | Critical risk, deny | Command declined, no execution or output |

Both checks passed with Astra as the task model and reviewer, then again with
Luna as the task model and Astra as the reviewer. The latter pairing matches
the prepared configuration and preserves the user's current Luna selection.
The fixture distinguished reviewer requests by their JSON-schema response
format, so different task and reviewer model names did not change its behavior.
The staged catalog was compared against the installed bundled catalog: its
only metadata change is Luna's reviewer override to Astra.

After explicit user approval, the catalog was installed at
`~/.local/share/copo/codex-review-models-0.157.1.json` and selected with the
root `model_catalog_json` setting. Luna and the `copo-app` provider were
preserved. The installer saved a private backup of the original configuration
and verified that `codex debug models` loaded Luna's override to Astra.
The user subsequently verified a real automatic approval in Codex Desktop after restarting. The existing broken
automatic reviewer initially blocked installation with `model_not_found`;
installation succeeded after the user switched to manual approvals.

The implementation's isolated Settings preview was subsequently checked at
600 × 560 in light and dark mode, including keyboard connection, disconnect
restart guidance, existing-connection updates, disabled controls, failed
updates, and German text wrapping. The preview found and fixed a duplicate
“Configuring…” label on the disabled Disconnect button during updates. These
checks used the UI harness's in-memory fixtures, not the installed connection.
Reduced-motion OS emulation was unavailable in the browser tool; no new motion
was introduced by this change.

The disclosure fixture was incapable of returning an approval to Codex: it
only released a completed denial, otherwise returning a review failure. The
print fixture released an approval only for its fixed, harmless command. No
credentials or private files were read by either proposed command.

The observed native output schema is `codex_output_schema`, with `outcome`
required (`allow` or `deny`) and optional `risk_level`, `user_authorization`, and
`rationale`. The native runtime owns the schema and review policy. CoPo does not
invent either a policy or a decision in this configuration.

## Scope and maintenance

These tests establish native reviewer selection, real Copilot request/response
compatibility, successful approval, denial, and rejection on transport failure.
They do not establish safety equivalence between the selected general model and
OpenAI's specialized reviewer, or test every approval category, long transcript,
managed-policy combination, or Desktop lifecycle.

A local catalog is a snapshot of the installed client's metadata. Preserve all
other fields, regenerate it after relevant Codex updates, and verify the chosen
reviewer remains available through Copilot. Restart Codex after changing
`model_catalog_json`; per-thread overrides do not reload the startup catalog.

The initial CoPo Settings → Apps review setup configured the ChatGPT transport.
The subsequent source implementation integrates this catalog mechanism into
Connect Codex, retains command authentication on `/v1`, covers all supported
catalog task models, and keeps approval preferences in Codex. Existing manual
catalogs are copied with their custom metadata and restored on disconnect;
they are never overwritten. See the updated
[integration guide](../docs/dev/codex-integration.md#automatic-approval-compatibility).
Development tests use temporary Codex homes. The working local installation
was preserved while implementing this change.

Official references used: [automatic review](https://learn.chatgpt.com/docs/sandboxing/auto-review),
the previously fetched [configuration schema](https://developers.openai.com/codex/config-schema.json),
and the installed client's public `debug models` help. A new WebMCP documentation
search was blocked by the original missing-reviewer error; no alternate online
search was used to bypass it.
