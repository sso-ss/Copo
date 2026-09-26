import type { TaskSnapshot } from "../companion/task-types"
import type { ClientActivitySnapshot } from "../http/client-activity-types"

export interface CompanionConnection {
  id: string
  name: string
  apiKeyId: string | null
  configured: boolean
  shared: boolean
  section: "apps" | "api-clients"
}

/** Display metadata only. The companion never receives API-key values. */
export interface CompanionData {
  gateway: "ready" | "sign-in-required" | "upstream-error"
  account: { login: string; host: string; avatarUrl: string | null } | null
  connections: Array<CompanionConnection>
  availableToolIds: Array<string>
  activity: ClientActivitySnapshot
  tasks?: TaskSnapshot
}
