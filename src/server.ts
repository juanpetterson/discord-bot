import express from 'express'

import { client } from './index'

const server = express()

server.all('/', (req, res) => {
  console.log('Bot is running: ' + new Date().toISOString())

  const currentTimeHours = new Date().getHours()
  const currentTimeMinutes = new Date().getMinutes()

  if (
    currentTimeHours === 11 &&
    currentTimeMinutes >= 0 &&
    currentTimeMinutes <= 5
  ) {
    const channel = client.channels.cache.get('1003668690052587623') as any

    if (!channel) return

    channel.send('🦧  <- jaque')
  }

  res.send('Bot is running')
})

export const keepAlive = () => {
  server.listen(8080, () => {
    console.log('Server is ready!')
  })
}
