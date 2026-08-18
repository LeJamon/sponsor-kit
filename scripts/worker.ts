import { createWorkerInstanceId, processOneIntentEvent, reconcileOneReserveObligation, recordWorkerHeartbeat } from '../server/services/intent-worker'

const instanceId = createWorkerInstanceId()
let stopping = false

async function stop() {
  stopping = true
  await recordWorkerHeartbeat(instanceId, 'stopping')
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)

await recordWorkerHeartbeat(instanceId, 'running', { pid: process.pid })
let lastHeartbeat = Date.now()
let lastReserveReconciliation = 0
while (!stopping) {
  const processed = await processOneIntentEvent(instanceId)
  if (Date.now() - lastReserveReconciliation >= 5_000) {
    await reconcileOneReserveObligation()
    lastReserveReconciliation = Date.now()
  }
  if (Date.now() - lastHeartbeat >= 10_000) {
    await recordWorkerHeartbeat(instanceId, 'running', { pid: process.pid })
    lastHeartbeat = Date.now()
  }
  if (!processed) await new Promise(resolve => setTimeout(resolve, 500))
}
