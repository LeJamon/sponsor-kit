import assert from 'node:assert/strict'
import { createHash, createPublicKey } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DEFAULT_DEFINITIONS, encodeForMultisigning, encodeForSigning } from 'ripple-binary-codec'
import { deriveAddress, deriveKeypair, generateSeed, sign, verify } from 'ripple-keypairs'
import { XrplSponsorAdapter } from '../server/services/signer/xrpl-adapter.ts'
import { DEVNET_DEFINITIONS_HASH, SPONSOR_AMENDMENT_ID } from '../server/services/xrpl/definitions.ts'

// Offline compatibility probe. Provider keys and ledger state are test fixtures.
const { values } = parseArgs({ options: { 'sdk-dir': { type: 'string' } } })
assert.ok(values['sdk-dir'], 'Pass --sdk-dir pointing to the isolated SDK installation described in docs/custodian-integration.md')
const sdkRequire = createRequire(resolve(values['sdk-dir'], 'package.json'))
assert.equal(sdkRequire('simplexrpl/package.json').version, '0.2.0', 'Review compatibility before changing the SDK version')
const { AwsKmsSigner } = sdkRequire('simplexrpl/aws-kms')
const { ExternalSigner } = sdkRequire('simplexrpl')
const { secp256k1 } = sdkRequire('@noble/curves/secp256k1')

const adapter = new XrplSponsorAdapter({
  amendmentId: SPONSOR_AMENDMENT_ID,
  definitions: DEFAULT_DEFINITIONS,
  definitionsHash: DEVNET_DEFINITIONS_HASH,
  networkId: 2,
  serverVersion: 'offline-fixture',
  transactionTypes: ['Payment'],
  flags: { sponsorFee: 1, sponsorReserve: 2, transferEnd: 65536, transferCreate: 131072, transferReassign: 262144, sponsorCreatedAccount: 524288 }
})

function fixture(mode) {
  const sponsee = deriveKeypair(generateSeed({ algorithm: mode === 'secp256k1' ? 'ecdsa-secp256k1' : 'ed25519' }))
  const sponsor = deriveKeypair(generateSeed({ algorithm: 'ecdsa-secp256k1' }))
  const accountKey = mode === 'multi' ? deriveKeypair(generateSeed()) : sponsee
  const transaction = {
    TransactionType: 'Payment',
    Account: deriveAddress(accountKey.publicKey),
    Destination: deriveAddress(sponsor.publicKey),
    Amount: '1',
    Fee: mode === 'multi' ? '24' : '12',
    Sequence: 1,
    LastLedgerSequence: 100,
    NetworkID: 2,
    Sponsor: deriveAddress(sponsor.publicKey),
    SponsorFlags: 1,
    SigningPubKey: mode === 'multi' ? '' : sponsee.publicKey
  }
  if (mode === 'multi') {
    const account = deriveAddress(sponsee.publicKey)
    transaction.Signers = [{ Signer: {
      Account: account,
      SigningPubKey: sponsee.publicKey,
      TxnSignature: sign(encodeForMultisigning(transaction, account, DEFAULT_DEFINITIONS), sponsee.privateKey)
    } }]
  } else {
    transaction.TxnSignature = sign(encodeForSigning(transaction, DEFAULT_DEFINITIONS), sponsee.privateKey)
  }
  return { transaction, sponsor, sponsee }
}

function kmsFixture(sponsor, highS, expectedDigest) {
  const uncompressed = Buffer.from(secp256k1.getPublicKey(sponsor.privateKey.slice(2), false))
  const publicKey = createPublicKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'secp256k1', x: uncompressed.subarray(1, 33).toString('base64url'), y: uncompressed.subarray(33).toString('base64url') }
  }).export({ format: 'der', type: 'spki' })
  const calls = []
  const port = AwsKmsSigner.create({
    keyId: 'offline-sponsor-key',
    client: {
      async send(command) {
        calls.push(command.constructor.name)
        assert.equal(command.input.KeyId, 'offline-sponsor-key')
        if (command.constructor.name === 'GetPublicKeyCommand') {
          return { PublicKey: publicKey, KeySpec: 'ECC_SECG_P256K1', KeyUsage: 'SIGN_VERIFY', SigningAlgorithms: ['ECDSA_SHA_256'] }
        }
        assert.equal(command.constructor.name, 'SignCommand', 'Only public-key lookup and signing are permitted in this offline fixture')
        assert.equal(command.input.MessageType, 'DIGEST')
        assert.equal(command.input.SigningAlgorithm, 'ECDSA_SHA_256')
        assert.equal(command.input.Message.length, 32)
        assert.deepEqual(Buffer.from(command.input.Message), expectedDigest)
        const signature = secp256k1.sign(command.input.Message, sponsor.privateKey.slice(2), { prehash: false, lowS: true })
        const returned = highS ? new secp256k1.Signature(signature.r, secp256k1.CURVE.n - signature.s) : signature
        return { Signature: returned.toDERRawBytes() }
      }
    }
  })
  return { port, calls }
}

let passed = 0
for (const mode of ['ed25519', 'secp256k1', 'multi']) {
  for (const highS of [false, true]) {
    const { transaction, sponsor } = fixture(mode)
    const original = structuredClone(transaction)
    const prepared = await adapter.prepare({ transaction, sponsorAddress: transaction.Sponsor })
    const digest = createHash('sha512').update(Buffer.from(prepared.signingPayloadHex, 'hex')).digest().subarray(0, 32)
    assert.equal(digest.toString('hex').toUpperCase(), prepared.signingHash)
    const { port, calls } = kmsFixture(sponsor, highS, digest)
    const publicKey = await port.publicKey()
    assert.equal(publicKey, sponsor.publicKey)
    const { r, s } = await port.signDigest(digest)
    const signature = new secp256k1.Signature(r, s).normalizeS().toDERHex().toUpperCase()
    assert.equal(secp256k1.Signature.fromDER(signature).hasHighS(), false)
    const attached = await adapter.attach({ transaction, publicKey, signature })
    assert.deepEqual(transaction, original, 'The caller transaction must remain unchanged')
    const decoded = adapter.decode(attached.signedBlob)
    const { SponsorSignature, ...sponseeEnvelope } = decoded
    assert.deepEqual(sponseeEnvelope, original, 'All user-signed fields and signatures must survive unchanged')
    assert.deepEqual(SponsorSignature, { SigningPubKey: publicKey, TxnSignature: signature })
    assert.equal(verify(prepared.signingPayloadHex, signature, publicKey), true)
    assert.equal((await adapter.prepare({ transaction: decoded, sponsorAddress: transaction.Sponsor })).signingHash, prepared.signingHash)
    assert.deepEqual(calls, ['GetPublicKeyCommand', 'SignCommand'])
    passed++
    console.log(`PASS: ${mode} sponsee, ${highS ? 'high' : 'low'}-S provider signature; exact envelope preserved`)
  }
}

const { transaction, sponsor } = fixture('ed25519')
const ordinaryPayload = encodeForSigning({ ...transaction, SigningPubKey: sponsor.publicKey }, DEFAULT_DEFINITIONS)
const ordinaryDigest = createHash('sha512').update(Buffer.from(ordinaryPayload, 'hex')).digest().subarray(0, 32)
const { port } = kmsFixture(sponsor, false, ordinaryDigest)
const external = await ExternalSigner.create({ signer: port })
const envelope = await external.sign(transaction, { account: (await external.listAccounts())[0] })
const ordinary = adapter.decode(envelope.txBlob)
assert.equal(ordinary.SigningPubKey, sponsor.publicKey)
assert.notEqual(ordinary.TxnSignature, transaction.TxnSignature)
assert.equal(ordinary.SponsorSignature, undefined)
passed++
console.log('PASS: ExternalSigner.sign creates an ordinary signature, not the required sponsor co-signature')
console.log(`${passed} offline checks passed with simplexrpl 0.2.0. No AWS, custodian, or XRPL requests were made; live key policy, ledger authorization, and network acceptance remain unverified.`)
