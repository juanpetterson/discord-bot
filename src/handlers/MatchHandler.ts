import axios from 'axios'
import { Message, EmbedBuilder } from 'discord.js'

const OPENDOTA_API = 'https://api.opendota.com/api'

interface MatchPlayer {
  account_id: number
  player_slot: number
  hero_id: number
  kills: number
  deaths: number
  assists: number
  last_hits: number
  denies: number
  gold_per_min: number
  xp_per_min: number
  hero_damage: number
  tower_damage: number
  hero_healing: number
  level: number
  personaname: string
  win: number
}

interface MatchData {
  match_id: number
  duration: number
  radiant_win: boolean
  radiant_score: number
  dire_score: number
  game_mode: number
  start_time: number
  players: MatchPlayer[]
}

const GAME_MODES: Record<number, string> = {
  0: 'Unknown',
  1: 'All Pick',
  2: 'Captain\'s Mode',
  3: 'Random Draft',
  4: 'Single Draft',
  5: 'All Random',
  22: 'Ranked All Pick',
  23: 'Turbo',
}

// Hero ID to name mapping will be fetched from OpenDota
let heroMap: Record<number, string> = {}

async function loadHeroMap() {
  if (Object.keys(heroMap).length > 0) return
  try {
    const response = await axios.get(`${OPENDOTA_API}/heroes`)
    for (const hero of response.data) {
      heroMap[hero.id] = hero.localized_name
    }
  } catch (error) {
    console.error('Failed to load hero map from OpenDota:', error)
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function getPerformanceComment(kills: number, deaths: number, assists: number): string {
  const kda = deaths === 0 ? kills + assists : (kills + assists) / deaths

  if (deaths === 0 && kills >= 10) return '🔥 GODLIKE! Zero deaths!'
  if (kda >= 8) return '🌟 Absolutely dominated!'
  if (kda >= 5) return '💪 Solid performance!'
  if (kda >= 3) return '👍 Decent game'
  if (kda >= 1.5) return '😐 Could be better...'
  if (kda >= 0.8) return '😬 Rough game'
  if (deaths >= 15) return '💀 Were you feeding on purpose?'
  return '🪦 RIP... maybe try another hero?'
}

export class MatchHandler {
  static async getLastMatch(message: Message, steamId: string) {
    try {
      await loadHeroMap()

      // Convert Steam ID to account ID if needed (Steam32 ID)
      let accountId = steamId
      // If it's a Steam64 ID (17 digits), convert to Steam32
      if (steamId.length >= 17) {
        const steam64 = BigInt(steamId)
        accountId = (steam64 - BigInt('76561197960265728')).toString()
      }

      // Fetch recent matches
      const recentResponse = await axios.get(`${OPENDOTA_API}/players/${accountId}/recentMatches`)
      
      if (!recentResponse.data || recentResponse.data.length === 0) {
        message.reply('No recent matches found for this player. Make sure the profile is public!')
        return
      }

      const recentMatch = recentResponse.data[0]
      const matchId = recentMatch.match_id

      // Fetch full match details
      const matchResponse = await axios.get(`${OPENDOTA_API}/matches/${matchId}`)
      const match: MatchData = matchResponse.data

      // Find the player in the match
      const player = match.players.find((p) => p.account_id === parseInt(accountId))

      if (!player) {
        message.reply('Could not find player in the match data.')
        return
      }

      const isRadiant = player.player_slot < 128
      const won = (isRadiant && match.radiant_win) || (!isRadiant && !match.radiant_win)
      const heroName = heroMap[recentMatch.hero_id] || `Hero #${recentMatch.hero_id}`
      const gameMode = GAME_MODES[match.game_mode] || 'Unknown'
      const comment = getPerformanceComment(player.kills, player.deaths, player.assists)

      const embed = new EmbedBuilder()
        .setColor(won ? 0x00ff00 : 0xff0000)
        .setTitle(`${won ? '🏆 VICTORY' : '💀 DEFEAT'} — ${heroName}`)
        .setThumbnail(
          `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${recentMatch.hero_id}.png`
        )
        .setDescription(`${comment}\n\n**Match ID:** ${matchId}\n**Mode:** ${gameMode}\n**Duration:** ${formatDuration(match.duration)}`)
        .addFields(
          { name: '⚔️ KDA', value: `${player.kills}/${player.deaths}/${player.assists}`, inline: true },
          { name: '💰 GPM', value: `${player.gold_per_min}`, inline: true },
          { name: '📈 XPM', value: `${player.xp_per_min}`, inline: true },
          { name: '🗡️ Last Hits', value: `${player.last_hits}`, inline: true },
          { name: '🚫 Denies', value: `${player.denies}`, inline: true },
          { name: '🎯 Hero Damage', value: `${player.hero_damage?.toLocaleString() || 'N/A'}`, inline: true },
          { name: '🏗️ Tower Damage', value: `${player.tower_damage?.toLocaleString() || 'N/A'}`, inline: true },
          { name: '💚 Hero Healing', value: `${player.hero_healing?.toLocaleString() || 'N/A'}`, inline: true },
          { name: '📊 Level', value: `${player.level}`, inline: true },
        )
        .addFields(
          { name: 'Score', value: `Radiant ${match.radiant_score} — ${match.dire_score} Dire`, inline: false }
        )
        .setFooter({ text: `Player: ${player.personaname || 'Unknown'} | ${new Date(match.start_time * 1000).toLocaleDateString()}` })

      message.channel.send({ embeds: [embed] })
    } catch (error: any) {
      console.error('Error fetching match:', error.message)
      if (error.response?.status === 404) {
        message.reply('Player not found. Make sure the Steam ID is correct and the profile is public.')
      } else {
        message.reply('Error fetching match data. Try again later!')
      }
    }
  }
}
