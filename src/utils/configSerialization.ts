import type { AppConfig } from '../../shared/types'

export function prepareConfigForIpc(config: AppConfig): AppConfig {
  // AppConfig is persisted as JSON. Round-tripping it here also removes Vue's
  // nested reactive proxies, which Electron cannot clone across contextBridge.
  return JSON.parse(JSON.stringify(config)) as AppConfig
}
