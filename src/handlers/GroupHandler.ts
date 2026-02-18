import { Message, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'

// Dota 2 roles per slot index (0-4 = team A, 5-9 = team B)
const ROLES = ['Hard Carry', 'Mid Lane', 'Offlane', 'Soft Support', 'Hard Support']

export interface Group {
  size: 4 | 5
  creatorId: string
  creatorName: string
  members: { id: string; name: string }[]
  channelId: string
  messageId?: string
}

// One active group per guild channel (keyed by channelId)
const activeGroups = new Map<string, Group>()

export class GroupHandler {
  // ─── !x4 / !x5 ───────────────────────────────────────────────────────────
  static async startOrJoin(message: Message, size: 4 | 5) {
    const channelId = message.channel.id
    const existing = activeGroups.get(channelId)

    if (existing) {
      // Trying same size → join
      if (existing.size !== size) {
        message.reply(
          `There is already an active **!x${existing.size}** group. Use \`!x${existing.size}\` to join it or wait until it ends.`
        )
        return
      }
      return GroupHandler._addMember(message, existing)
    }

    // Create new group
    const group: Group = {
      size,
      creatorId: message.author.id,
      creatorName: message.author.username,
      members: [{ id: message.author.id, name: message.author.username }],
      channelId,
    }
    activeGroups.set(channelId, group)
    console.log(`[GroupHandler] New x${size} group created by ${message.author.username}`)
    await GroupHandler._sendGroupStatus(message, group)
  }

  // ─── join an existing group ───────────────────────────────────────────────
  private static async _addMember(message: Message, group: Group) {
    const alreadyIn = group.members.some((m) => m.id === message.author.id)
    if (alreadyIn) {
      message.reply('You are already in this group!')
      return
    }
    if (group.members.length >= group.size) {
      message.reply('This group is already full!')
      return
    }
    group.members.push({ id: message.author.id, name: message.author.username })
    console.log(`[GroupHandler] ${message.author.username} joined x${group.size} group`)

    if (group.members.length === group.size) {
      // Group is full → show action buttons
      await GroupHandler._sendFullGroup(message, group)
    } else {
      await GroupHandler._sendGroupStatus(message, group)
    }
  }

  // ─── !x4leave / !x5leave ─────────────────────────────────────────────────
  static async leave(message: Message) {
    const group = activeGroups.get(message.channel.id)
    if (!group) {
      message.reply('No active group in this channel.')
      return
    }

    // Creator leaving = cancel
    if (group.creatorId === message.author.id) {
      activeGroups.delete(message.channel.id)
      message.channel.send(`🚫 **${message.author.username}** (creator) left — group disbanded.`)
      return
    }

    const before = group.members.length
    group.members = group.members.filter((m) => m.id !== message.author.id)
    if (group.members.length === before) {
      message.reply("You are not in this group.")
      return
    }
    console.log(`[GroupHandler] ${message.author.username} left x${group.size} group`)
    await GroupHandler._sendGroupStatus(message, group)
  }

  // ─── !x4cancel / !x5cancel ───────────────────────────────────────────────
  static cancel(message: Message) {
    const group = activeGroups.get(message.channel.id)
    if (!group) {
      message.reply('No active group in this channel.')
      return
    }
    if (group.creatorId !== message.author.id) {
      message.reply('Only the group creator can cancel it.')
      return
    }
    activeGroups.delete(message.channel.id)
    console.log(`[GroupHandler] x${group.size} group cancelled by ${message.author.username}`)
    message.channel.send('🚫 Group cancelled.')
  }

  // ─── !x4kick / !x5kick <nickname> ────────────────────────────────────────
  static async kick(message: Message, partialName: string) {
    const group = activeGroups.get(message.channel.id)
    if (!group) {
      message.reply('No active group in this channel.')
      return
    }
    if (group.creatorId !== message.author.id) {
      message.reply('Only the group creator can kick members.')
      return
    }
    // Fuzzy match
    const lower = partialName.toLowerCase()
    const target = group.members.find(
      (m) => m.id !== group.creatorId && m.name.toLowerCase().includes(lower)
    )
    if (!target) {
      message.reply(`Could not find a member matching **${partialName}**.`)
      return
    }
    group.members = group.members.filter((m) => m.id !== target.id)
    console.log(`[GroupHandler] ${target.name} kicked from x${group.size} group by creator`)
    message.channel.send(`👢 **${target.name}** was kicked from the group.`)
    await GroupHandler._sendGroupStatus(message, group)
  }

  // ─── Button interactions ──────────────────────────────────────────────────
  static async handleButton(interaction: any) {
    const channelId = interaction.channel?.id
    if (!channelId) return

    if (interaction.customId === 'group_random_teams') {
      const group = activeGroups.get(channelId)
      if (!group) {
        interaction.reply({ content: 'No active group found.', ephemeral: true })
        return
      }
      await interaction.deferUpdate()
      await GroupHandler._randomTeams(interaction, group)
    }

    if (interaction.customId === 'group_random_teams_heroes') {
      const group = activeGroups.get(channelId)
      if (!group) {
        interaction.reply({ content: 'No active group found.', ephemeral: true })
        return
      }
      await interaction.deferUpdate()
      await GroupHandler._randomTeamsHeroes(interaction, group)
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private static async _sendGroupStatus(message: Message, group: Group) {
    const spots = group.size - group.members.length
    const memberList = group.members.map((m, i) => `${i + 1}. ${m.name}`).join('\n')

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🎮 x${group.size} Group — ${group.members.length}/${group.size}`)
      .setDescription(memberList || 'No members yet.')
      .setFooter({ text: `${spots} spot(s) remaining | type !x${group.size} to join` })

    await message.channel.send({ embeds: [embed] })
  }

  private static async _sendFullGroup(message: Message, group: Group) {
    const memberList = group.members.map((m, i) => `${i + 1}. ${m.name}`).join('\n')

    const embed = new EmbedBuilder()
      .setColor(0x00ff99)
      .setTitle(`✅ x${group.size} Group — FULL!`)
      .setDescription(memberList)
      .setFooter({ text: 'Choose an action below' })

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('group_random_teams')
        .setLabel('🎲 Random Teams')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('group_random_teams_heroes')
        .setLabel('⚔️ Random Teams + Heroes')
        .setStyle(ButtonStyle.Success)
    )

    await message.channel.send({ embeds: [embed], components: [row] })
  }

  private static _shuffle<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  private static async _randomTeams(interaction: any, group: Group) {
    const shuffled = GroupHandler._shuffle(group.members)
    const half = Math.ceil(shuffled.length / 2)
    const teamA = shuffled.slice(0, half)
    const teamB = shuffled.slice(half)

    const embed = new EmbedBuilder()
      .setColor(0x3071f7)
      .setTitle('🎲 Random Teams')
      .addFields(
        {
          name: '🔵 Team A',
          value: teamA.map((m, i) => `${i + 1}. ${m.name}`).join('\n'),
          inline: true,
        },
        {
          name: '🔴 Team B',
          value: teamB.map((m, i) => `${i + 1}. ${m.name}`).join('\n'),
          inline: true,
        }
      )

    await interaction.channel.send({ embeds: [embed] })
  }

  private static async _randomTeamsHeroes(interaction: any, group: Group) {
    // Import heroes lazily to avoid circular deps
    const heroes: any[] = require('../assets/data/heroes.json')

    const shuffledMembers = GroupHandler._shuffle(group.members)
    const half = Math.ceil(shuffledMembers.length / 2)
    const teamA = shuffledMembers.slice(0, half)
    const teamB = shuffledMembers.slice(half)

    const usedHeroIds = new Set<number>()

    function pickHero() {
      const available = heroes.filter((h: any) => !usedHeroIds.has(h.id))
      const hero = available[Math.floor(Math.random() * available.length)]
      usedHeroIds.add(hero.id)
      return hero
    }

    // Assign heroes by role order
    const rolesA = [...ROLES].slice(0, teamA.length)
    const rolesB = [...ROLES].slice(0, teamB.length)

    const assignA = teamA.map((m, i) => ({ member: m, role: rolesA[i], hero: pickHero() }))
    const assignB = teamB.map((m, i) => ({ member: m, role: rolesB[i], hero: pickHero() }))

    function teamValue(assignments: typeof assignA) {
      return assignments
        .map(
          (a) =>
            `**${a.role}** — ${a.member.name}\n` +
            `↳ [${a.hero.localized_name}](https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${a.hero.name}.png)`
        )
        .join('\n\n')
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff99)
      .setTitle('⚔️ Random Teams + Heroes')
      .addFields(
        { name: '🔵 Team A', value: teamValue(assignA), inline: true },
        { name: '🔴 Team B', value: teamValue(assignB), inline: true }
      )

    await interaction.channel.send({ embeds: [embed] })
  }

  static getActive(channelId: string): Group | undefined {
    return activeGroups.get(channelId)
  }
}
