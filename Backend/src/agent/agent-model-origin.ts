import type { AgentModelPort } from './agent-model-port.js'

const externalAgentModels = new WeakSet<AgentModelPort>()

export function registerExternalAgentModel<T extends AgentModelPort>(
  model: T,
): T {
  externalAgentModels.add(model)
  return model
}

export function isRegisteredExternalAgentModel(
  model: AgentModelPort,
) {
  return externalAgentModels.has(model)
}
