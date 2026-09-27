import { settingsEventBus } from "~/lib/config/settings-events"
import { getClientActivitySnapshot } from "~/lib/http/client-activity"

import { TaskTracker } from "./task-tracker"

export const taskTracker = new TaskTracker(
  getClientActivitySnapshot().generation,
  Date.now(),
  {
    event: (event) => settingsEventBus.publish("tasks.event", event),
    snapshot: (snapshot) =>
      settingsEventBus.publish("tasks.snapshot", snapshot),
  },
)

settingsEventBus.subscribe("activity.snapshot", (snapshot) => {
  taskTracker.reset(snapshot.generation, Date.now())
})

export function getTaskSnapshot(): ReturnType<TaskTracker["snapshot"]> {
  const generation = getClientActivitySnapshot().generation
  if (generation !== taskTracker.generation)
    taskTracker.reset(generation, Date.now())
  return taskTracker.snapshot()
}
