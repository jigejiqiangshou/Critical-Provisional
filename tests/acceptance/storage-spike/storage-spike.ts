import type { StorageSpikeCommand, StorageSpikeMessage } from '../../../src/deck-catalog/sqlite.worker'

const worker = new Worker(new URL('../../../src/deck-catalog/sqlite.worker.ts', import.meta.url), { type: 'module' })
const status = document.querySelector<HTMLParagraphElement>('#database-status')!
const records = document.querySelector<HTMLParagraphElement>('#records')!
const offline = document.querySelector<HTMLParagraphElement>('#offline-status')!
const displayMode = document.querySelector<HTMLParagraphElement>('#display-mode')!
const retry = document.querySelector<HTMLButtonElement>('#retry')!
const write = document.querySelector<HTMLButtonElement>('#write')!
const rollback = document.querySelector<HTMLButtonElement>('#rollback')!
const interrupt = document.querySelector<HTMLButtonElement>('#interrupt')!
const persist = document.querySelector<HTMLButtonElement>('#persist')!
const persistStatus = document.querySelector<HTMLOutputElement>('#persist-status')!

const standalone = matchMedia('(display-mode: standalone)').matches
  || (navigator as Navigator & { standalone?: boolean }).standalone === true
displayMode.dataset.mode = standalone ? 'standalone' : 'browser'
displayMode.textContent = standalone ? '安装模式' : '浏览器页面模式'

const messageText = {
  ready: '已取得存储',
  occupied: '存储已被另一个实例占用',
  written: '记录已提交',
  'rolled-back': '约束错误已回滚',
  uncommitted: '事务尚未提交，现在可关闭应用',
}

function setWritesEnabled(enabled: boolean) {
  write.disabled = !enabled
  rollback.disabled = !enabled
  interrupt.disabled = !enabled
}

function send(command: StorageSpikeCommand) {
  setWritesEnabled(false)
  retry.disabled = true
  status.dataset.status = 'pending'
  status.textContent = '等待存储响应'
  worker.postMessage(command)
}

worker.onmessage = ({ data }: MessageEvent<StorageSpikeMessage>) => {
  status.dataset.status = data.status
  if (data.status === 'error') {
    status.textContent = `存储错误：${data.detail}`
    setWritesEnabled(false)
    return
  }
  status.textContent = messageText[data.status]
  retry.disabled = data.status !== 'occupied'
  if ('count' in data) {
    records.dataset.count = String(data.count)
    records.textContent = `SQLite ${data.version} · ${data.status === 'uncommitted' ? '未提交' : '已提交'}记录数 ${data.count}`
  }
  setWritesEnabled(data.status !== 'occupied' && data.status !== 'uncommitted')
}

worker.onerror = () => {
  status.dataset.status = 'error'
  status.textContent = '存储线程启动失败'
}

write.onclick = () => send('write')
rollback.onclick = () => send('rollback')
interrupt.onclick = () => send('interrupt')
retry.onclick = () => send('open')
persist.onclick = async () => {
  try {
    const granted = await navigator.storage.persist()
    persistStatus.value = granted ? '已取得持久存储' : '浏览器未授予持久存储'
  } catch {
    persistStatus.value = '持久存储申请失败'
  }
}

async function prepareOffline() {
  try {
    const serviceWorkers = navigator.serviceWorker
    if (!serviceWorkers.controller) {
      const registration = await serviceWorkers.register('./storage-spike-sw.js')
      const candidate = registration.installing ?? registration.waiting ?? registration.active
      await new Promise<void>((resolve, reject) => {
        function observe() {
          if (!serviceWorkers.controller && candidate && candidate.state !== 'redundant') return
          serviceWorkers.removeEventListener('controllerchange', observe)
          candidate?.removeEventListener('statechange', observe)
          if (serviceWorkers.controller) resolve()
          else reject(new Error('离线资源未安装'))
        }
        serviceWorkers.addEventListener('controllerchange', observe)
        candidate?.addEventListener('statechange', observe)
        observe()
      })
    }
    offline.dataset.status = 'ready'
    offline.textContent = '离线资源已就绪'
  } catch {
    offline.dataset.status = 'error'
    offline.textContent = '离线资源准备失败'
  }
}

send('open')
void prepareOffline()
