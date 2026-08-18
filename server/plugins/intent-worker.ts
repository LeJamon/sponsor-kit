import { createWorkerInstanceId, processOneIntentEvent, reconcileOneReserveObligation, recordWorkerHeartbeat } from '../services/intent-worker'

export default defineNitroPlugin((nitroApp) => {
  if (process.env.ACME_EMBEDDED_WORKER === 'false') return
  const instanceId = createWorkerInstanceId()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let lastReserveReconciliation = 0

  const run = async () => {
    if (stopped) return
    try {
      await recordWorkerHeartbeat(instanceId, 'running', { mode: 'embedded' })
      const processed = await processOneIntentEvent(instanceId)
      if (Date.now() - lastReserveReconciliation >= 5_000) {
        await reconcileOneReserveObligation()
        lastReserveReconciliation = Date.now()
      }
      timer = setTimeout(run, processed ? 50 : 500)
    } catch (error) {
      console.error('[intent-worker]', error)
      timer = setTimeout(run, 1_000)
    }
  }

  nitroApp.hooks.hook('close', async () => {
    stopped = true
    if (timer) clearTimeout(timer)
    await recordWorkerHeartbeat(instanceId, 'stopping', { mode: 'embedded' })
  })
  void run()
})
