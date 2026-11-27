import { frontendEntryPath, isFrontendEntryToken } from './frontend-entry'

export type OfflineReadiness =
  | { ready: true; version: string }
  | {
    ready: false
    reason: 'uncontrolled' | 'host-version-mismatch' | 'host-cache-incomplete' | 'initial-release-pending' | 'initial-release-unavailable'
  }

interface WorkerStatus {
  version: string
  complete: boolean
}

function hostScope(): URL {
  return new URL('./', document.baseURI)
}

function workerUrl(scope: URL): URL {
  return new URL('service-worker.js', scope)
}

export function frontendEntryUrl(key: string, instance: string, scope = hostScope()): URL {
  if (!isFrontendEntryToken(key) || !isFrontendEntryToken(instance)) throw new TypeError('Invalid frontend entry or instance key')
  const url = new URL(frontendEntryPath, scope)
  url.searchParams.set('key', key)
  url.searchParams.set('instance', instance)
  return url
}

export function registerHostWorker(scope = hostScope()): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(workerUrl(scope), { type: 'module', scope: scope.href, updateViaCache: 'none' })
}

function readWorkerStatus(controller: ServiceWorker): Promise<WorkerStatus | undefined> {
  return new Promise(resolve => {
    const channel = new MessageChannel()
    const finish = (status?: WorkerStatus) => {
      window.clearTimeout(timeout)
      channel.port1.close()
      resolve(status)
    }
    const timeout = window.setTimeout(finish, 3_000)
    channel.port1.onmessage = ({ data }) => finish(
      typeof data?.version === 'string' && typeof data.complete === 'boolean' ? data : undefined,
    )
    try {
      controller.postMessage({ type: 'critical.host-cache-status' }, [channel.port2])
    } catch {
      channel.port2.close()
      finish()
    }
  })
}

/**
 * The initial-release query reports whether the official version has been
 * validated and committed locally. An omitted query leaves the host pending.
 */
export async function getOfflineReadiness(
  initialReleaseReady?: () => boolean | Promise<boolean>,
  scope = hostScope(),
): Promise<OfflineReadiness> {
  const container = navigator.serviceWorker
  const controller = container?.controller
  if (!controller || controller.scriptURL !== workerUrl(scope).href) return { ready: false, reason: 'uncontrolled' }

  const buildVersion = document.querySelector<HTMLMetaElement>('meta[name="critical-host-build"]')?.content
  const status = await readWorkerStatus(controller)
  if (!status) return { ready: false, reason: 'host-cache-incomplete' }
  if (!buildVersion || status.version !== buildVersion || container.controller !== controller) {
    return { ready: false, reason: 'host-version-mismatch' }
  }
  if (!status.complete) return { ready: false, reason: 'host-cache-incomplete' }

  try {
    const releaseReady = await initialReleaseReady?.()
    if (container.controller !== controller) return { ready: false, reason: 'host-version-mismatch' }
    return releaseReady ? { ready: true, version: buildVersion } : { ready: false, reason: 'initial-release-pending' }
  } catch {
    return { ready: false, reason: 'initial-release-unavailable' }
  }
}
