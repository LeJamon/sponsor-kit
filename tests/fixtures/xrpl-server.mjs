import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { decode, encodeForSigning, encodeForSigningSponsor, XrplDefinitions } from 'ripple-binary-codec'
import { verify } from 'ripple-keypairs'
import definitions from './devnet-definitions.json' with { type: 'json' }

// Test-only loopback RPC. No transaction leaves this process.
const codec = new XrplDefinitions(definitions)
const transactions = new Map()
const sequences = new Map()
const sponsors = new Map()
const amendment = 'BE1F90581635DBCEBFC4678C4B54FEDDC1A17B50FD02CFE765A4132A342126AC'
let ledger = 900_000

function execute(method, params) {
  if (method === 'server_definitions') return definitions
  if (method === 'feature') return { features: { [amendment]: { name: 'Sponsor', enabled: true, supported: true }, '98433DD001A5737F773D74F8CA2A25A065089C73B2E611C760BAF369E4FECA76': { name: 'fixCleanup3_4_0', enabled: true, supported: true } } }
  if (method === 'server_info') return { info: { network_id: 2, build_version: 'test-fixture', validated_ledger: { seq: ledger } } }
  if (method === 'server_state') return { state: { validated_ledger: { seq: ledger, base_fee: 10, reserve_base: 1_000_000, reserve_inc: 200_000 } } }
  if (method === 'fee') return { drops: { base_fee: '10', open_ledger_fee: '10' } }
  if (method === 'account_info') return {
    account_data: { Account: params.account, Balance: '10000000000', Sequence: sequences.get(params.account) || 1, OwnerCount: 0, Flags: 0, ...(sponsors.has(params.account) ? { Sponsor: sponsors.get(params.account) } : {}) },
    ledger_index: ledger, ledger_hash: 'A'.repeat(64), validated: true
  }
  if (method === 'account_objects') return { account_objects: [], ledger_index: ledger, ledger_hash: 'A'.repeat(64), validated: true }
  if (method === 'simulate') {
    const transfer = params.tx_json?.TransactionType === 'SponsorshipTransfer'
    const affected = transfer
      ? [{ ModifiedNode: { LedgerEntryType: 'AccountRoot', FinalFields: { Account: params.tx_json.Sponsor, SponsoringAccountCount: 1 }, PreviousFields: { SponsoringAccountCount: 0 } } }]
      : []
    return { engine_result: 'tesSUCCESS', ledger_index: ledger, meta: { AffectedNodes: affected } }
  }
  if (method === 'submit') {
    const transaction = decode(params.tx_blob, codec)
    if (!verify(encodeForSigning(transaction, codec), transaction.TxnSignature, transaction.SigningPubKey) || !verify(encodeForSigningSponsor(transaction, codec), transaction.SponsorSignature.TxnSignature, transaction.SponsorSignature.SigningPubKey)) return { error: 'invalidTransaction' }
    const hash = createHash('sha512').update(Buffer.from(`54584E00${params.tx_blob}`, 'hex')).digest('hex').slice(0, 64).toUpperCase()
    if (!transactions.has(hash)) {
      ledger += 1
      sequences.set(transaction.Account, Number(transaction.Sequence) + 1)
      if (transaction.TransactionType === 'SponsorshipTransfer') sponsors.set(transaction.Account, transaction.Sponsor)
      transactions.set(hash, { validated: true, ledger_index: ledger, tx_json: transaction, meta: { TransactionResult: 'tesSUCCESS', AffectedNodes: [] } })
    }
    return { engine_result: 'tesSUCCESS', tx_json: { ...transaction, hash } }
  }
  if (method === 'tx') return transactions.get(params.transaction) || { error: 'txnNotFound', searched_all: false }
  if (method === 'ledger_entry') return { error: 'entryNotFound' }
  return { error: 'unknownCmd' }
}

createServer(async (request, response) => {
  if (request.method === 'GET') {
    response.end('test fixture ready')
    return
  }
  try {
    let body = ''
    for await (const chunk of request) {
      body += chunk
      if (body.length > 1_000_000) throw new Error('Body limit')
    }
    const data = JSON.parse(body)
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ result: execute(data.method, data.params?.[0] || {}) }))
  } catch {
    response.writeHead(400).end('Invalid fixture request')
  }
}).listen(5199, '127.0.0.1', () => console.log('Test-only XRPL fixture listening on 127.0.0.1:5199'))
