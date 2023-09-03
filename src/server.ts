import express from 'express'

const server = express()

server.all('/', (req, res) => {
  console.log('Bot is running')
  res.send('Bot is running')
})

export const keepAlive = () => {
  server.listen(8080, () => {
    console.log('Server is ready!')
  })
}
