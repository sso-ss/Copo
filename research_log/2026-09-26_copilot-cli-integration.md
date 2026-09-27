# Copilot CLI integration investigation

Date: 2026-09-26

Status: CoPo-side audit complete; upstream compatibility and live acceptance
remain unverified. This document does not establish Copilot CLI support.

## Confirmed in CoPo

- `src/apps/copilot-cli/index.ts` registers only a coming-soon placeholder.
  Its shared implementation cannot enable the app and exposes no API key.
- `src/apps/index.ts` defines enabling an app as configuring proxy routing.
  A connection that only monitors native Copilot activity needs an explicit
  capability distinction; it must not claim its requests pass through CoPo.
- `src/lib/companion/task-types.ts` already represents running, waiting,
  completed, cancelled, failed, and unavailable tasks.
- `src/lib/companion/task-monitor.ts` accepts only Claude Code and Codex
  sources and reads their JSONL records. A Copilot source needs its own
  verified event adapter; another client's record format cannot be assumed.
- `src/lib/companion/task-service.ts` enables observation only for configured
  proxy clients and a signed-in companion account. Native Copilot monitoring
  would require its own explicit enablement condition.
- `src/routes/settings/companion.ts` associates app connections with API keys.
  Native activity must be displayed without inventing a gateway key or usage.
- Existing task tracking, event delivery, and cat states are reusable once
  reliable Copilot task observations are available.

## Local evidence and limits

The `copilot` executable was not found on this shell's PATH. A `.copilot`
configuration directory exists, but its presence does not establish a working
CLI installation, version, authentication state, or event format. Credentials
and conversation contents were not inspected.

The official GitHub documentation lookup did not execute: automatic approval
review failed with a model/Responses-endpoint compatibility error. No current
provider variables, endpoint overrides, hook names, or event schemas were
verified. Existing repository notes about MCP are historical references;
support for MCP does not establish lifecycle notification or custom inference
provider support.

Reference to verify:
https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference

## Recommended implementation order

1. Identify the installed or target CLI version. Verify official custom-provider
   configuration and lifecycle interfaces for that version, distinguishing
   ordinary interactive CLI sessions from sessions launched through an SDK.
2. Run a controlled session to establish actual signals for task start, user
   input or permission waits, final completion, cancellation, and failure.
   Distinguish a finished model request from a finished user task.
3. Choose supported gateway routing, native activity monitoring, or both based
   on the evidence. Describe those capabilities accurately in Settings.
4. Replace the placeholder with installation detection, explicit configuration,
   verification, and ownership-scoped disconnect behavior. Preserve the user's
   existing provider settings and authentication.
5. Add a Copilot adapter to the shared task tracker. Prefer a documented event
   interface; if only local records are available, validate their format and
   treat unrecognized or missing signals as unavailable rather than success.
6. Validate start/wait/resume/completion/cancellation/failure, concurrent and
   child tasks, restart, duplicate events, disconnect, and lost observation.
   Cat celebration must require a confirmed successful task completion.

Gateway routing additionally needs verified model discovery, inference,
streaming, tool calls, authentication failures, and cancellation against CoPo.
Only then should the README and app advertise Copilot CLI as supported.

## Scope of this investigation

No application behavior, user configuration, or credentials were changed.
No CLI was installed and no integration or live inference test was run.
