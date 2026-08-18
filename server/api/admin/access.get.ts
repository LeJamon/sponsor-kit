import { requirePlatformAdmin } from '~~/server/utils/admin'

export default defineEventHandler(async event => ({ allowed: true, user: (await requirePlatformAdmin(event)).user }))
