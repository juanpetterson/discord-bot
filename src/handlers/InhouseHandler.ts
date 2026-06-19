import { Message, EmbedBuilder } from 'discord.js'
import fs from 'fs'
import https from 'https'
import { t } from '../i18n'
import { DISCORD_TO_STEAM, fetchDotaNick } from './PlayerData'

const INHOUSE_FILE = './src/assets/data/inhouse.json'

interface PlayerStats {
  elo: number
  wins: number
  losses: number
  name: string
}

interface InhouseData {
  leaderboard: Record<string, PlayerStats>
  history: {
    matchId: string
    timestamp: string
    teamA: string[]
    teamB: string[]
    winner: 'Team A' | 'Team B'
    eloChange: number
  }[]
}

function loadInhouse(): InhouseData {
  try {
    if (!fs.existsSync(INHOUSE_FILE)) {
      const initial: InhouseData = { leaderboard: {}, history: [] }
      fs.writeFileSync(INHOUSE_FILE, JSON.stringify(initial, null, 2))
      return initial
    }
    return JSON.parse(fs.readFileSync(INHOUSE_FILE, 'utf-8'))
  } catch {
    return { leaderboard: {}, history: [] }
  }
}

function saveInhouse(data: InhouseData) {
  fs.writeFileSync(INHOUSE_FILE, JSON.stringify(data, null, 2))
}

function ensurePlayer(data: InhouseData, id: string, name: string): PlayerStats {
  if (!data.leaderboard[id]) {
    data.leaderboard[id] = { elo: 1000, wins: 0, losses: 0, name }
  } else {
    data.leaderboard[id].name = name
  }
  return data.leaderboard[id]
}

function fetchMatch(matchId: string): Promise<any> {
  return new Promise((resolve) => {
    const url = `https://api.opendota.com/api/matches/${matchId}`
    https
      .get(url, { headers: { 'User-Agent': 'discord-bot/1.0' } }, (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          try { resolve(JSON.parse(body)) } catch { resolve(null) }
        })
      })
      .on('error', () => resolve(null))
  })
}

export class InhouseHandler {
  static async resolveInhouse(message: Message, matchId: string) {
    if (!matchId || isNaN(Number(matchId))) {
      message.reply(t('inhouse.winUsage'))
      return
    }

    await message.channel.send(t('inhouse.resolveStart', { id: matchId }))

    const match = await fetchMatch(matchId)
    if (!match || !match.players) {
      message.reply(t('bet.resolveFailed', { id: matchId }))
      return
    }

    const data = loadInhouse()
    
    // Check if match was already resolved
    if (data.history.some(h => h.matchId === matchId)) {
      message.reply(t('inhouse.alreadyResolved', { id: matchId }))
      return
    }

    const teamAPlayers: { id: string; name: string; stats: PlayerStats }[] = []
    const teamBPlayers: { id: string; name: string; stats: PlayerStats }[] = []

    for (const [discordName, steamId] of Object.entries(DISCORD_TO_STEAM)) {
      const accountId32 = parseInt(steamId, 10)
      const player = match.players.find((p: any) => p.account_id === accountId32)
      if (player) {
        // Resolve user in guild members
        const member = message.guild?.members.cache.find(m => m.user.username === discordName)
        const name = member?.displayName ?? discordName
        const id = member?.id ?? discordName // fallback to username if not in guild cache

        const stats = ensurePlayer(data, id, name)
        const isRadiant = player.player_slot < 128
        if (isRadiant) {
          teamAPlayers.push({ id, name, stats })
        } else {
          teamBPlayers.push({ id, name, stats })
        }
      }
    }

    if (teamAPlayers.length === 0 && teamBPlayers.length === 0) {
      message.reply(t('inhouse.noPlayers'))
      return
    }

    const avgEloA = teamAPlayers.length > 0 ? teamAPlayers.reduce((s, p) => s + p.stats.elo, 0) / teamAPlayers.length : 1000
    const avgEloB = teamBPlayers.length > 0 ? teamBPlayers.reduce((s, p) => s + p.stats.elo, 0) / teamBPlayers.length : 1000

    const expectedA = 1 / (1 + Math.pow(10, (avgEloB - avgEloA) / 400))
    const expectedB = 1 - expectedA

    const radiantWin = match.radiant_win
    const actualA = radiantWin ? 1 : 0
    const actualB = radiantWin ? 0 : 1

    const K = 32
    const eloChangeA = Math.round(K * (actualA - expectedA))
    const eloChangeB = Math.round(K * (actualB - expectedB))

    // Update ELOs
    const playersDiffs: string[] = []
    for (const p of teamAPlayers) {
      const oldElo = p.stats.elo
      p.stats.elo += eloChangeA
      if (radiantWin) p.stats.wins++; else p.stats.losses++
      playersDiffs.push(`🔵 **${p.name}**: ${oldElo} ➔ ${p.stats.elo} (${eloChangeA > 0 ? '+' : ''}${eloChangeA})`)
    }
    for (const p of teamBPlayers) {
      const oldElo = p.stats.elo
      p.stats.elo += eloChangeB
      if (!radiantWin) p.stats.wins++; else p.stats.losses++
      playersDiffs.push(`🔴 **${p.name}**: ${oldElo} ➔ ${p.stats.elo} (${eloChangeB > 0 ? '+' : ''}${eloChangeB})`)
    }

    data.history.push({
      matchId,
      timestamp: new Date().toISOString(),
      teamA: teamAPlayers.map(p => p.name),
      teamB: teamBPlayers.map(p => p.name),
      winner: radiantWin ? 'Team A' : 'Team B',
      eloChange: radiantWin ? eloChangeA : eloChangeB
    })

    saveInhouse(data)

    const embed = new EmbedBuilder()
      .setColor(0x00d2ff)
      .setTitle(t('inhouse.resultsTitle', { id: matchId }))
      .setDescription(t('inhouse.resultsDesc', { winner: radiantWin ? 'Radiant (Team A)' : 'Dire (Team B)' }) + '\n\n' + playersDiffs.join('\n'))
      .setFooter({ text: `ELO calculation with K-factor 32` })
      .setTimestamp()

    message.channel.send({ embeds: [embed] })
  }

  static showLeaderboard(message: Message) {
    const data = loadInhouse()
    const entries = Object.entries(data.leaderboard)

    if (entries.length === 0) {
      message.reply(t('inhouse.leaderboardNoData'))
      return
    }

    const sorted = entries.sort(([, a], [, b]) => b.elo - a.elo)
    const medals = ['🥇', '🥈', '🥉']

    const leaderboardText = sorted
      .slice(0, 15)
      .map(([, stats], index) => {
        const medal = medals[index] || `**${index + 1}.**`
        return `${medal} ${stats.name} — **${stats.elo}** ELO (${stats.wins}W/${stats.losses}L)`
      })
      .join('\n')

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(t('inhouse.leaderboardTitle'))
      .setDescription(leaderboardText)
      .setFooter({ text: t('inhouse.leaderboardFooter') })

    message.channel.send({ embeds: [embed] })
  }
}
