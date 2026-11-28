import { getOfflineReadiness, registerHostWorker } from './offline-ready'

const status = document.querySelector<HTMLOutputElement>('#offline-status')!

const messages = {
  ready: '主体已可离线使用',
  uncontrolled: '主体离线资源尚未就绪',
  'host-version-mismatch': '页面与离线资源版本不同，请关闭后重新打开',
  'host-cache-incomplete': '主体离线资源不完整',
  'initial-release-pending': '等待首个官方卡池发行版',
  'initial-release-unavailable': '无法读取首个官方卡池发行版',
}

function showStatus(state: keyof typeof messages) {
  status.value = messages[state]
  status.dataset.state = state
}

async function refreshReadiness() {
  const readiness = await getOfflineReadiness()
  showStatus(readiness.ready ? 'ready' : readiness.reason)
}

async function start() {
  if (import.meta.env.DEV || !navigator.serviceWorker) {
    showStatus('uncontrolled')
    return
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => void refreshReadiness())
  try {
    await registerHostWorker()
    await refreshReadiness()
  } catch {
    showStatus('uncontrolled')
  }
}

void start()
