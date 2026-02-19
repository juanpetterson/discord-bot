import { Message, EmbedBuilder } from 'discord.js'
import fs from 'fs'
import path from 'path'
import { t } from '../i18n'

const QUOTES_FILE = './src/assets/data/quotes.json'

interface Quote {
  text: string
  author: string
  addedBy: string
  date: string
  id: number
}

function loadQuotes(): Quote[] {
  try {
    if (!fs.existsSync(QUOTES_FILE)) {
      fs.writeFileSync(QUOTES_FILE, '[]')
      return []
    }
    const data = fs.readFileSync(QUOTES_FILE, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    console.error('Error loading quotes:', error)
    return []
  }
}

function saveQuotes(quotes: Quote[]) {
  try {
    fs.writeFileSync(QUOTES_FILE, JSON.stringify(quotes, null, 2))
  } catch (error) {
    console.error('Error saving quotes:', error)
  }
}

export class QuoteHandler {
  static addQuote(message: Message, args: string) {
    // Expected format: !addquote "text" @user or !addquote "text" username
    // Also accept: !addquote text - author

    let text = ''
    let author = ''

    // Try format: "text" @mention or "text" name
    const quotedMatch = args.match(/^"(.+?)"\s+(.+)$/s)
    // Try format: text - author
    const dashMatch = args.match(/^(.+?)\s*-\s*(.+)$/s)

    if (quotedMatch) {
      text = quotedMatch[1].trim()
      const mention = message.mentions.users.first()
      author = mention ? mention.displayName || mention.username : quotedMatch[2].trim()
    } else if (dashMatch) {
      text = dashMatch[1].trim()
      const mention = message.mentions.users.first()
      author = mention ? mention.displayName || mention.username : dashMatch[2].trim()
    } else {
      message.reply(t('quote.usage'))
      return
    }

    if (!text || !author) {
      message.reply(t('quote.usage'))
      return
    }

    const quotes = loadQuotes()
    const newQuote: Quote = {
      text,
      author,
      addedBy: message.author.username,
      date: new Date().toISOString(),
      id: quotes.length + 1,
    }

    quotes.push(newQuote)
    saveQuotes(quotes)

    message.channel.send(t('quote.added', { id: newQuote.id, text, author }))
  }

  static getRandomQuote(message: Message) {
    const quotes = loadQuotes()

    if (quotes.length === 0) {
      message.reply('No quotes saved yet! Add one with `!addquote "text" author`')
      return
    }

    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)]

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setDescription(`> "${randomQuote.text}"`)
      .setFooter({ text: t('quote.footer', { author: randomQuote.author, id: randomQuote.id, addedBy: randomQuote.addedBy }) })

    message.channel.send({ embeds: [embed] })
  }

  static listQuotes(message: Message) {
    const quotes = loadQuotes()

    if (quotes.length === 0) {
      message.reply(t('quote.empty'))
      return
    }

    const quoteList = quotes
      .slice(-10) // Show last 10
      .map((q) => `**#${q.id}** "${q.text}" — *${q.author}*`)
      .join('\n')

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(t('quote.listTitle'))
      .setDescription(quoteList)
      .setFooter({ text: `Total: ${quotes.length}` })

    message.channel.send({ embeds: [embed] })
  }

  static deleteQuote(message: Message, quoteId: string) {
    const id = parseInt(quoteId)
    if (isNaN(id)) {
      message.reply('Usage: `!delquote <id>`')
      return
    }

    const quotes = loadQuotes()
    const index = quotes.findIndex((q) => q.id === id)

    if (index === -1) {
      message.reply(t('quote.deleteNotFound', { id }))
      return
    }

    const removed = quotes.splice(index, 1)[0]
    saveQuotes(quotes)

    message.channel.send(t('quote.deleteSuccess', { id }))
  }
}
