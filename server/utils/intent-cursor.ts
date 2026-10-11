import { z } from 'zod'

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() })

export function encodeIntentCursor(row: { createdAt: string, id: string }) {
  return Buffer.from(JSON.stringify(row)).toString('base64url')
}

export function decodeIntentCursor(value: string) {
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    return cursor
  } catch {
    return null
  }
}
