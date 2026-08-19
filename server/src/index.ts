import { serve } from '@hono/node-server'
import { app } from './app'

const PORT = 3737
const HOST = '127.0.0.1'

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`server listening on http://${HOST}:${info.port}`)
})
