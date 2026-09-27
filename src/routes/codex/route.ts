import { Hono } from "hono"

import {
  apiKeyAllowed,
  getConfiguredApiKeys,
  requireGithubAuth,
} from "~/lib/auth/request-auth"
import { forwardError } from "~/lib/errors/error"
import { handleResponses } from "~/routes/responses/handler"
import { forwardCodexReview } from "~/services/providers/codex-review"

/** Separate surface for Codex's two credentials. The normal Responses route
 * never interprets a caller's bearer as an upstream credential. */
export function createCodexRoutes(
  options: { getApiKeys?: () => Array<string> } = {},
): Hono {
  const routes = new Hono()
  routes.use("*", async (c, next) => {
    const key = c.req.header("x-api-key")?.trim() ?? ""
    if (!apiKeyAllowed((options.getApiKeys ?? getConfiguredApiKeys)(), key)) {
      return c.json(
        {
          error: {
            code: "invalid_copo_key",
            message:
              "Configure Codex in CoPo Settings → Apps to refresh its local key.",
          },
        },
        401,
      )
    }
    return next()
  })
  routes.get("/models", (c) => forwardCodexReview(c, "models"))
  routes.post("/responses", async (c) => {
    let payload: unknown
    try {
      payload = await c.req.json()
    } catch {
      return c.json({ error: { code: "invalid_json" } }, 400)
    }
    // Match before normalization, logging, tool rewriting, or Copilot usage.
    if (
      typeof payload === "object"
      && payload !== null
      && "model" in payload
      && payload.model === "codex-auto-review"
    ) {
      return forwardCodexReview(c, "responses")
    }
    const blocked = await requireGithubAuth(c, () => Promise.resolve())
    if (blocked) return blocked
    try {
      return await handleResponses(c)
    } catch (error) {
      return await forwardError(c, error)
    }
  })
  return routes
}
