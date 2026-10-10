export default defineEventHandler((event) => {
  if (event.path.startsWith('/api/') && !event.path.startsWith('/api/v1/public/')) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
  }
})
