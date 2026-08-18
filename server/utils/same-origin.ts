import type { H3Event } from 'h3'

export function requireSameOrigin(event: H3Event) {
  const origin = getHeader(event, 'origin')
  const configured = process.env.NUXT_PUBLIC_APP_URL || 'http://localhost:3000'
  let expectedOrigin: string
  try {
    expectedOrigin = new URL(configured).origin
  } catch {
    throw createError({ statusCode: 500, statusMessage: 'Application URL is invalid' })
  }
  if (!origin || origin !== expectedOrigin) throw createError({ statusCode: 403, statusMessage: 'Cross-origin mutation rejected' })
}
