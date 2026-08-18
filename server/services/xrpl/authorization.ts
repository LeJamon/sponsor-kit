import { encodeForMultisigning, encodeForSigning, type XrplDefinitionsBase } from 'ripple-binary-codec'
import { deriveAddress, verify } from 'ripple-keypairs'
import { xrplRpc } from '../../utils/xrpl-rpc'
import type { XrplTransaction } from '../signer/types'

const lsfDisableMaster = 0x00100000

type AccountData = {
  Account: string
  Flags: number
  RegularKey?: string
  Sequence: number
}

async function keyIsAuthorized(rpcUrl: string, account: string, publicKey: string): Promise<boolean> {
  const signerAddress = deriveAddress(publicKey)
  const result = await xrplRpc<{ account_data: AccountData }>(rpcUrl, 'account_info', { account, ledger_index: 'validated', strict: true })
  if (result.account_data.RegularKey === signerAddress) return true
  return signerAddress === account && (result.account_data.Flags & lsfDisableMaster) === 0
}

export async function verifySponseeLedgerAuthorization(input: {
  rpcUrl: string
  transaction: XrplTransaction
  definitions: XrplDefinitionsBase
}) {
  const account = input.transaction.Account
  const signingPubKey = input.transaction.SigningPubKey
  const transactionSignature = input.transaction.TxnSignature
  if (typeof signingPubKey === 'string' && signingPubKey && typeof transactionSignature === 'string') {
    if (!verify(encodeForSigning(input.transaction, input.definitions), transactionSignature, signingPubKey)) throw new Error('SPONSEE_SIGNATURE_INVALID')
    if (!await keyIsAuthorized(input.rpcUrl, account, signingPubKey)) throw new Error('SPONSEE_KEY_NOT_AUTHORIZED')
    return
  }

  const signers = input.transaction.Signers
  if (signingPubKey !== '' || !Array.isArray(signers) || transactionSignature) throw new Error('SPONSEE_SIGNATURE_REQUIRED')
  const owner = await xrplRpc<{
    account_data: AccountData
    signer_lists?: Array<{ SignerQuorum: number, SignerEntries: Array<{ SignerEntry: { Account: string, SignerWeight: number } }> }>
  }>(input.rpcUrl, 'account_info', { account, ledger_index: 'validated', strict: true, signer_lists: true })
  const signerList = owner.signer_lists?.[0]
  if (!signerList) throw new Error('SPONSEE_SIGNER_LIST_NOT_FOUND')
  const weights = new Map(signerList.SignerEntries.map(entry => [entry.SignerEntry.Account, entry.SignerEntry.SignerWeight]))
  let totalWeight = 0
  const seen = new Set<string>()
  for (const entry of signers) {
    const signer = (entry as { Signer?: Record<string, unknown> }).Signer
    const signerAccount = signer?.Account
    const publicKey = signer?.SigningPubKey
    const signature = signer?.TxnSignature
    if (typeof signerAccount !== 'string' || typeof publicKey !== 'string' || typeof signature !== 'string' || seen.has(signerAccount)) throw new Error('SPONSEE_MULTISIGNER_INVALID')
    const weight = weights.get(signerAccount)
    if (!weight) throw new Error('SPONSEE_MULTISIGNER_NOT_AUTHORIZED')
    if (!verify(encodeForMultisigning(input.transaction, signerAccount, input.definitions), signature, publicKey)) throw new Error('SPONSEE_SIGNATURE_INVALID')
    if (!await keyIsAuthorized(input.rpcUrl, signerAccount, publicKey)) throw new Error('SPONSEE_MULTISIGNER_KEY_NOT_AUTHORIZED')
    seen.add(signerAccount)
    totalWeight += weight
  }
  if (totalWeight < signerList.SignerQuorum) throw new Error('SPONSEE_SIGNER_QUORUM_NOT_MET')
}
