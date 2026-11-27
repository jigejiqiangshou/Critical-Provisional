export function packageClient(label: string, mode: 'normal' | 'reject-protocol' | 'wrong-handshake' = 'normal') {
  return `<!doctype html><meta charset="utf-8"><title>${label}</title>
<p id="version">${label}</p>
<output id="isolation"></output><output id="state"></output><output id="result"></output>
<button id="query">Query view</button><button id="respond">Respond</button>
<button id="navigate">Navigate away</button>
<script>
(() => {
  const parameters = new URL(location.href).searchParams;
  const token = parameters.get('instance');
  const sessionId = 'installer-test-match';
  let port;
  let basis;
  function denied(read) {
    try { read(); return false; } catch (error) { return error.name === 'SecurityError'; }
  }
  document.querySelector('#isolation').value = JSON.stringify({
    hostDom: denied(() => parent.document.querySelector('#installer-test-marker')),
    localStorage: denied(() => localStorage.getItem('installer-test-marker')),
    indexedDb: denied(() => indexedDB.open('installer-test-marker')),
    serviceWorker: denied(() => navigator.serviceWorker) || !('serviceWorker' in navigator),
    opaqueOrigin: self.origin === 'null'
  });
  const query = () => port?.postMessage({
    type:'request', interaction:'M03', sessionId, requestId:'view',
  });
  document.querySelector('#query').onclick = query;
  document.querySelector('#respond').onclick = () => port?.postMessage({
    type:'request', interaction:'M02', sessionId, requestId:'choose', commandId:'choose',
    seatId:'first', basis,
    action:{ type:'respond', decisionId:'original-decision', choice:{type:'select',targetIds:['original-candidate']} }
  });
  document.querySelector('#navigate').onclick = () => { location.href = '/installer-navigation-target'; };
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'critical.frontend-connect' || event.data.instance !== token) return;
    port = event.ports[0];
    port.addEventListener('close', () => { document.querySelector('#state').value = 'closed'; });
    port.onmessage = ({data}) => {
      if (data.type === 'welcome') {
        document.querySelector('#state').value = 'welcomed';
      }
      if (data.type === 'handshake-rejected') {
        document.querySelector('#state').value = data.reason;
      }
      if (data.type === 'response') {
        if (data.result.view) basis = data.result.view.basis;
        document.querySelector('#result').value = JSON.stringify(data.result);
      }
    };
    port.postMessage({type:'hello',versions: {
      major:${mode === 'reject-protocol' ? 42 : 1}, minMinor:0, maxMinor:0
    }});
  });
  parent.postMessage({type:'critical.frontend-ready',instance:${mode === 'wrong-handshake' ? "'wrong-instance'" : 'token'}},'*');
})();
</script>`
}
