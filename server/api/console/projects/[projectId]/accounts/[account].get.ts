import { xrplAccountSchema } from '~~/server/utils/intent-request'
import { requireProjectMember } from '~~/server/utils/project-member'
import { xrplRpc, XrplRpcError } from '~~/server/utils/xrpl-rpc'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectMember(event, getRouterParam(event, 'projectId'))
  const parsed = xrplAccountSchema.safeParse(getRouterParam(event, 'account'))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'A valid account address is required' })
  try {
    const result = await xrplRpc<{ account_data: { Balance: string }, ledger_index: number }>(project.rpcUrl, 'account_info', { account: parsed.data, ledger_index: 'validated', strict: true }, { retries: 0 })
    return { account: parsed.data, funded: true, balanceDrops: result.account_data.Balance, ledgerIndex: result.ledger_index }
  } catch (error) {
    if (error instanceof XrplRpcError && error.code === 'actNotFound') return { account: parsed.data, funded: false, balanceDrops: '0', ledgerIndex: null }
    throw createError({ statusCode: 503, statusMessage: 'Unable to check the account on Devnet. Please retry.' })
  }
})
