export const intentStates = ['created', 'awaiting_user_signature', 'user_signature_received', 'verified', 'awaiting_sponsor_signature', 'submitting', 'submitted', 'validated', 'failed', 'rejected', 'expired', 'cancelled', 'superseded'] as const
export type IntentState = typeof intentStates[number]

const transitions: Record<IntentState, readonly IntentState[]> = {
  created: ['awaiting_user_signature', 'rejected', 'expired', 'cancelled'],
  awaiting_user_signature: ['user_signature_received', 'expired', 'cancelled', 'superseded'],
  user_signature_received: ['verified', 'rejected', 'expired'],
  verified: ['awaiting_sponsor_signature', 'submitting', 'rejected', 'expired'],
  awaiting_sponsor_signature: ['submitting', 'failed', 'expired'],
  submitting: ['submitted', 'failed', 'expired'],
  submitted: ['validated', 'failed', 'expired'],
  validated: [], failed: [], rejected: [], expired: [], cancelled: [], superseded: []
}

export function canTransition(from: IntentState, to: IntentState): boolean {
  return transitions[from].includes(to)
}

export function assertTransition(from: IntentState, to: IntentState): void {
  if (!canTransition(from, to)) throw new Error(`Illegal intent transition: ${from} -> ${to}`)
}
