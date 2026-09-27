# Codex automatic reviews through CoPo

Local investigation, September 26, 2026. Not submitted externally.

## Root cause

Codex CLI 0.157.1 sends permission reviews through the task's selected provider,
using `codex-auto-review`. Copilot's catalog lacks that model. The previous
“unsupported endpoint” error therefore described a missing review service,
not a rejection of the proposed action by a reviewer.

## Verified official documentation

After temporarily using manual approval for this chat, official documentation
could be fetched successfully. Earlier DNS and automatic-review failures were
limitations of the investigation environment, not evidence against proxy routing.

- [Authentication](https://developers.openai.com/codex/auth/):
  `requires_openai_auth = true` supports normal Codex authentication through an
  LLM proxy.
- [Configuration schema](https://developers.openai.com/codex/config-schema.json):
  custom model catalogs and provider headers are available. Command auth cannot
  be combined with `requires_openai_auth`. `review_model` is for code review;
  `[auto_review]` has policy text settings, not a provider override.
- [Automatic review](https://developers.openai.com/codex/sandboxing/auto-review):
  review requests can consume Codex usage.

No dedicated automatic-review provider setting was found. CoPo can instead
separate routing at its gateway without changing the requested model or policy.

## Live evidence

A temporary loopback proxy asked `codex debug models` to use its normal ChatGPT
login through the documented proxy flow. No private login files were opened,
no saved provider was changed, and no credentials or response text were printed.

The catalog returned HTTP 200 and included the hidden `codex-auto-review` entry.
A minimal connectivity request to that exact model returned HTTP 200 and
`response.completed` with a completed response. Codex exited successfully.

The backend `https://chatgpt.com/backend-api/codex` was verified from the installed
client and this live test. Official docs establish the proxy authentication
mechanism; they do not establish this backend as a public Platform API contract.

## Implementation

See [integration details](../docs/dev/codex-integration.md#automatic-approval-compatibility).

- Optional Apps setup changes only the managed provider and preserves its
  original restore point. Ordinary Configure retains command authentication.
- The optional provider uses a dedicated `/codex/v1` route, separate local key
  and ChatGPT bearer, and the genuine Codex model catalog.
- The exact reviewer request is forwarded before Copilot transformations and
  accounting. Payloads, denials, and errors are preserved; no model fallback or
  fabricated approval is possible in this transport.
- A live catalog plus completed reviewer connectivity check and a completed
  selected-model request are required before configuration is saved.
- Review mode stores a CoPo local key in the private Codex configuration. Codex
  manages ChatGPT authentication; CoPo handles it only in memory. Review context
  goes to OpenAI and can consume Codex quota, as explained before setup.

## Verification boundary

Automated tests cover local authentication even with generic enforcement off,
credential separation, exact model matching, unchanged policy/tool fields,
catalog preservation, HTTP and stream errors, denial preservation, cancellation,
ordinary Copilot routing, and reversible mode changes.

A successful model connection is not a real automatic permission decision.
Installation/restart and an end-to-end desktop approval test remain required
before calling the user's full workflow fixed. No approval preference or policy
was changed by the implementation.


## Final source validation

A second live probe exercised the new source route with the actual Codex CLI:
model catalog HTTP 200, reviewer HTTP 200, completed reviewer response, and
unchanged saved Codex configuration. This was a connectivity request, not a
permission decision.

The full suite passed 1,675 tests (one optional build test skipped) with local
network permission and an isolated `CLAUDE_CONFIG_DIR`. Initial restricted runs
failed because local test servers could not bind; a pre-existing companion test
also read the developer's installed Claude configuration. Isolating that path
resolved it without changing product behavior. Additional configuration tests
cover preserving user comments when switching review mode.

Type, lint, token, unused-code, UI-build, and sidecar-build checks passed.
The Apps setup and configured states were reviewed in a mock browser preview;
the dialog fits the 600 × 560 minimum window in light and dark appearance,
including longer German text, and preserves keyboard focus and disabled controls.
The preview never changed the running app. No reduced-motion-specific animation
was added. Translation wording still needs the repository's named i18n reviewer
before landing these changes.

The built sidecar includes the new source and UI. The user chose to retain the
built update without installing, restarting, or activating it. A real automatic
permission review in a fresh Codex chat remains untested.
