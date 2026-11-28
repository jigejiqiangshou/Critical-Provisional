// T004 prototype. The host exposes only this experiment's handshake and ping.
const officialId = 'critical.probe.official-3d'
const thirdPartyId = 'third.party.frontend-probe'
const cacheName = 'critical-t004-packages-v1'
const scope = new URL('./', location.href)
const workerUrl = new URL('service-worker.js', scope)
const entryUrl = new URL('__t004__/entry', scope)
const navigationProbeUrl = new URL('navigation-target.html', scope)
const viewport = document.querySelector<HTMLDivElement>('#viewport')!
const evidence = document.querySelector<HTMLPreElement>('#evidence')!
const hostStatus = document.querySelector<HTMLOutputElement>('#host-status')!
const packageStatus = document.querySelector<HTMLOutputElement>('#package-status')!
const prepare = document.querySelector<HTMLButtonElement>('#prepare')!
const localFile = document.querySelector<HTMLInputElement>('#import')!
const openOfficial = document.querySelector<HTMLButtonElement>('#open-official')!
const openLocal = document.querySelector<HTMLButtonElement>('#open-local')!
const ping = document.querySelector<HTMLButtonElement>('#ping')!
const closeFrame = document.querySelector<HTMLButtonElement>('#close-frame')!

interface ProbePackage {
  formatVersion: 1
  id: string
  version: string
  name: string
  protocolMajor: 1
  protocolMinMinor: 0
  entryHtml: string
}

interface FrameInstance {
  iframe: HTMLIFrameElement
  port: MessagePort
  mark: string
  pendingPort?: MessagePort
  opaqueReady: boolean
  loaded: boolean
  connected: boolean
  timer: number
}

let cache: Cache
let active: FrameInstance | undefined
const recorded: Record<string, unknown> = {}

function report(key: string, value: unknown) {
  recorded[key] = value
  evidence.textContent = JSON.stringify(recorded, null, 2)
}

function packageKey(id: string) {
  return new URL(`__t004__/stored/${id}`, scope)
}

function parsePackage(contents: string, expectedId: string): ProbePackage {
  const data: Partial<ProbePackage> | null = JSON.parse(contents)
  if (
    !data || data.formatVersion !== 1 || data.id !== expectedId ||
    typeof data.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(data.version) ||
    typeof data.name !== 'string' || !data.name ||
    data.protocolMajor !== 1 || data.protocolMinMinor !== 0 ||
    typeof data.entryHtml !== 'string' || !data.entryHtml
  ) {
    throw new Error('前端样本格式、ID 或协议版本不兼容')
  }
  return data as ProbePackage
}

async function refreshOpenButtons() {
  openOfficial.disabled = !(await cache.match(packageKey(officialId)))
  openLocal.disabled = !(await cache.match(packageKey(thirdPartyId)))
}

async function preparePackage(source: Blob, id: string) {
  const started = performance.now()
  const data = parsePackage(await source.text(), id)
  const readMs = Math.round(performance.now() - started)
  await cache.put(packageKey(id), new Response(data.entryHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
  report('package', {
    id: data.id, bytes: source.size, readMs, cachedMs: Math.round(performance.now() - started),
  })
  if (navigator.storage?.estimate) {
    try { report('storage', await navigator.storage.estimate()) }
    catch { report('storage', '无法读取配额估计') }
  }
  await refreshOpenButtons()
  openFrame(data.id)
}

function revokeFrame(reason: string) {
  if (!active) return
  clearTimeout(active.timer)
  active.port.close()
  active.pendingPort?.close()
  active.iframe.remove()
  active = undefined
  ping.disabled = true
  closeFrame.disabled = true
  report('port', reason)
  packageStatus.value = reason
}

function isControlled() {
  return navigator.serviceWorker.controller?.scriptURL === workerUrl.href
}

function connectFrame(instance: FrameInstance) {
  const { iframe, mark, pendingPort } = instance
  if (!instance.loaded || !instance.opaqueReady || !pendingPort) return
  if (!isControlled() || !iframe.contentWindow) {
    revokeFrame('受控入口不可用，端口未发放')
    return
  }
  iframe.contentWindow.postMessage({ type: 't004-connect', instance: mark }, '*', [pendingPort])
  instance.pendingPort = undefined
}

window.addEventListener('message', event => {
  const instance = active
  if (
    !instance || instance.opaqueReady || event.origin !== 'null' || event.source !== instance.iframe.contentWindow ||
    event.data?.type !== 't004-ready' || event.data.instance !== instance.mark
  ) return
  instance.opaqueReady = true
  connectFrame(instance)
})

function openFrame(id: string) {
  revokeFrame('上一实例端口已关闭')
  if (!isControlled()) {
    showError(new Error('受控入口不可用，端口未发放'))
    return
  }
  const iframe = document.createElement('iframe')
  iframe.title = '受控前端样本'
  iframe.referrerPolicy = 'no-referrer'
  // Chromium requires a same-origin navigation request for SW interception.
  // The SW response's separate CSP sandbox omits allow-same-origin before entry code runs.
  iframe.sandbox.add('allow-scripts', 'allow-same-origin')
  const mark = crypto.randomUUID()
  const channel = new MessageChannel()
  const entry = new URL(entryUrl)
  entry.searchParams.set('id', id)
  entry.searchParams.set('instance', mark)
  iframe.src = entry.href
  const instance: FrameInstance = {
    iframe, port: channel.port1, mark, pendingPort: channel.port2, opaqueReady: false, loaded: false, connected: false,
    timer: window.setTimeout(() => revokeFrame('握手超时，端口已关闭'), 10_000),
  }
  active = instance
  channel.port1.onmessage = ({ data }) => {
    if (active !== instance || !data || data.instance !== instance.mark) return
    if (data.type === 'hello' && !instance.connected && data.protocolMajor === 1 && data.protocolMinor === 0) {
      clearTimeout(instance.timer)
      instance.connected = true
      ping.disabled = false
      packageStatus.value = '专用端口已连接'
      report('port', { connected: true, protocol: '1.0', mark })
    } else if (instance.connected && data.type === 'evidence') {
      report('isolation', data.isolation)
      report('render', data.render)
      packageStatus.value = '样本已打开，验证记录已更新'
    } else if (instance.connected && data.type === 'pong') {
      report('ping', { replied: true, mark })
    } else if (instance.connected && data.type === 'error') {
      packageStatus.value = '验证失败'
      report('error', data.message)
    }
  }

  iframe.addEventListener('load', () => {
    if (active !== instance) return
    if (instance.loaded) {
      revokeFrame('入口已导航，专用端口已撤销')
      return
    }
    instance.loaded = true
    // The entry document is already sandboxed by its response. Future navigations
    // must also inherit the iframe's opaque sandbox.
    iframe.sandbox.remove('allow-same-origin')
    connectFrame(instance)
  })
  report('render', null)
  report('isolation', null)
  report('ping', null)
  report('error', null)
  closeFrame.disabled = false
  packageStatus.value = '正在启动受控入口'
  viewport.replaceChildren(iframe)
}

function waitForControl() {
  if (isControlled()) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const onControl = () => {
      if (!isControlled()) return
      navigator.serviceWorker.removeEventListener('controllerchange', onControl)
      clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControl)
      reject(new Error('Service Worker 未取得宿主控制'))
    }, 10_000)
    navigator.serviceWorker.addEventListener('controllerchange', onControl)
  })
}

function seedHostStorage() {
  localStorage.setItem('critical-t004-probe', 'host-only')
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('critical-t004-probe', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('sentinel')
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('sentinel', 'readwrite')
      transaction.objectStore('sentinel').put('host-only', 'probe')
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onabort = () => { database.close(); reject(transaction.error) }
    }
    request.onerror = () => reject(request.error)
  })
}

async function initialize() {
  if (!isSecureContext || !('serviceWorker' in navigator)) throw new Error('需要 HTTPS 安装环境')
  const framePolicy = document.createElement('meta')
  framePolicy.httpEquiv = 'Content-Security-Policy'
  framePolicy.content = `frame-src ${entryUrl.href} ${navigationProbeUrl.href}`
  document.head.append(framePolicy)
  await navigator.serviceWorker.register(workerUrl)
  await waitForControl()
  await seedHostStorage()
  cache = await caches.open(cacheName)
  await refreshOpenButtons()
  prepare.disabled = false
  localFile.disabled = false
  hostStatus.value = '宿主离线资源已准备'
  report('host', {
    controlled: true,
    online: navigator.onLine,
    standalone: matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  })
}

function showError(error: unknown) {
  packageStatus.value = '验证失败'
  report('error', error instanceof Error ? error.message : String(error))
}

prepare.addEventListener('click', async () => {
  prepare.disabled = true
  try {
    const response = await fetch(new URL('official-3d.critical-ui', scope))
    if (!response.ok) throw new Error(`官方样本请求失败 HTTP ${response.status}`)
    await preparePackage(await response.blob(), officialId)
  } catch (error) {
    showError(error)
  } finally {
    prepare.disabled = false
  }
})
localFile.addEventListener('change', async () => {
  const file = localFile.files?.[0]
  if (!file) return
  localFile.disabled = true
  try {
    await preparePackage(file, thirdPartyId)
  } catch (error) {
    showError(error)
  } finally {
    localFile.value = ''
    localFile.disabled = false
  }
})
openOfficial.addEventListener('click', () => openFrame(officialId))
openLocal.addEventListener('click', () => openFrame(thirdPartyId))
ping.addEventListener('click', () => active?.port.postMessage({ type: 'ping' }))
closeFrame.addEventListener('click', () => revokeFrame('实例已关闭，专用端口已撤销'))
window.addEventListener('pagehide', () => revokeFrame('宿主已离开，专用端口已撤销'))
void initialize().catch(error => {
  hostStatus.value = '宿主准备失败'
  showError(error)
})
