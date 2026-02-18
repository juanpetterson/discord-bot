import { Message, GuildMember, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js'

// Dota 2 roles per slot index (0-4 = team A, 5-9 = team B)
const ROLES = ['Hard Carry', 'Mid Lane', 'Offlane', 'Soft Support', 'Hard Support']

export interface Group {
  size: 2 | 4 | 5
  creatorId: string
  creatorName: string
  members: { id: string; name: string }[]
  channelId: string
  messageId?: string
}

// One active group per guild channel (keyed by channelId)
const activeGroups = new Map<string, Group>()

// Stores the last randomized teams per channel — used by the Move/Assign-Heroes buttons
interface StoredTeams {
  teamA: { id: string; name: string }[]
  teamB: { id: string; name: string }[]
}
const lastTeams = new Map<string, StoredTeams>()

export class GroupHandler {
  // ─── !x2 / !x4 / !x5 ────────────────────────────────────────────────────
  static async startOrJoin(message: Message, size: 2 | 4 | 5) {
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
      creatorName: message.member?.displayName ?? message.author.username,
      members: [{ id: message.author.id, name: message.member?.displayName ?? message.author.username }],
      channelId,
    }
    activeGroups.set(channelId, group)
    console.log(`[GroupHandler] New x${size} group created by ${group.creatorName}`)
    await GroupHandler._sendGroupStatus(message.channel, group)
  }

  // ─── join an existing group ───────────────────────────────────────────────
  private static async _addMember(message: Message, group: Group) {
    const totalSlots = group.size * 2
    const alreadyIn = group.members.some((m) => m.id === message.author.id)
    if (alreadyIn) {
      message.reply('You are already in this group!')
      return
    }
    if (group.members.length >= totalSlots) {
      message.reply('This group is already full!')
      return
    }
    const displayName = message.member?.displayName ?? message.author.username
    group.members.push({ id: message.author.id, name: displayName })
    console.log(`[GroupHandler] ${displayName} joined x${group.size} group`)

    if (group.members.length === totalSlots) {
      await GroupHandler._sendFullGroup(message.channel, group)
    } else {
      await GroupHandler._sendGroupStatus(message.channel, group)
    }
  }

  // ─── !x2leave / !x4leave / !x5leave ────────────────────────────────────────
  static async leave(message: Message) {
    const group = activeGroups.get(message.channel.id)
    if (!group) {
      message.reply('No active group in this channel.')
      return
    }

    const idx = group.members.findIndex((m) => m.id === message.author.id)
    if (idx === -1) {
      message.reply('You are not in this group.')
      return
    }

    const leaving = group.members[idx]
    group.members.splice(idx, 1)

    if (group.members.length === 0) {
      activeGroups.delete(message.channel.id)
      message.channel.send('🚫 Group disbanded (no members left).')
      return
    }

    // If creator left, promote the next member
    let creatorNote = ''
    if (group.creatorId === leaving.id) {
      group.creatorId = group.members[0].id
      group.creatorName = group.members[0].name
      creatorNote = ` New creator: **${group.creatorName}**.`
    }

    console.log(`[GroupHandler] ${leaving.name} left x${group.size} group`)
    await message.channel.send(`👋 **${leaving.name}** left the group.${creatorNote}`)
    await GroupHandler._sendGroupStatus(message.channel, group)
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
    await GroupHandler._sendGroupStatus(message.channel, group)
  }

  // ─── Button interactions ──────────────────────────────────────────────────
  static async handleButton(interaction: any) {
    const channelId = interaction.channel?.id
    if (!channelId) return

    if (interaction.customId === 'group_join') {
      const group = activeGroups.get(channelId)
      if (!group) {
        await interaction.reply({ content: '❌ The group no longer exists.', ephemeral: true })
        return
      }
      const totalSlots = group.size * 2
      if (group.members.some((m) => m.id === interaction.user.id)) {
        await interaction.reply({ content: 'You are already in this group!', ephemeral: true })
        return
      }
      if (group.members.length >= totalSlots) {
        await interaction.reply({ content: 'This group is already full!', ephemeral: true })
        return
      }
      const displayName = interaction.member?.displayName ?? interaction.user.username
      group.members.push({ id: interaction.user.id, name: displayName })
      console.log(`[GroupHandler] ${displayName} joined x${group.size} group via button`)
      await interaction.deferUpdate()
      if (group.members.length === totalSlots) {
        await GroupHandler._sendFullGroup(interaction.channel, group)
      } else {
        await GroupHandler._sendGroupStatus(interaction.channel, group)
      }
      return
    }

    if (interaction.customId === 'group_random_teams') {
      const group = activeGroups.get(channelId)
      if (!group) {
        interaction.reply({ content: 'No active group found.', ephemeral: true })
        return
      }
      await interaction.deferUpdate()
      await GroupHandler._randomTeams(interaction, group)
      return
    }

    if (interaction.customId === 'group_random_teams_heroes') {
      const group = activeGroups.get(channelId)
      if (!group) {
        interaction.reply({ content: 'No active group found.', ephemeral: true })
        return
      }
      await interaction.deferUpdate()
      await GroupHandler._randomTeamsHeroes(interaction, group)
      return
    }

    if (interaction.customId === 'group_assign_heroes') {
      const stored = lastTeams.get(channelId)
      if (!stored) {
        interaction.reply({ content: 'No team data found — run the auto command again.', ephemeral: true })
        return
      }
      await interaction.deferUpdate()
      await GroupHandler._assignHeroesToTeams(interaction, stored.teamA, stored.teamB)
      return
    }

    if (interaction.customId === 'group_split_channels') {
      const stored = lastTeams.get(channelId)
      if (!stored) {
        interaction.reply({ content: 'No team data found — randomize teams first.', ephemeral: true })
        return
      }
      await interaction.deferUpdate()
      await GroupHandler._splitVoiceChannels(interaction, stored.teamA, stored.teamB)
      return
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private static async _sendGroupStatus(channel: any, group: Group) {
    const totalSlots = group.size * 2
    const spots = totalSlots - group.members.length
    const memberList = group.members.map((m, i) => `${i + 1}. ${m.name}`).join('\n')

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🎮 x${group.size} Group (${group.size}v${group.size}) — ${group.members.length}/${totalSlots}`)
      .setDescription(memberList || 'No members yet.')
      .setFooter({ text: `${spots} spot(s) remaining | click the button or type !x${group.size} to join` })

    const joinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('group_join')
        .setLabel('➕ Join Group')
        .setStyle(ButtonStyle.Primary)
    )

    await channel.send({ embeds: [embed], components: [joinRow] })
  }

  private static async _sendFullGroup(channel: any, group: Group) {
    const memberList = group.members.map((m, i) => `${i + 1}. ${m.name}`).join('\n')

    const embed = new EmbedBuilder()
      .setColor(0x00ff99)
      .setTitle(`✅ x${group.size} Group (${group.size}v${group.size}) — FULL!`)
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

    await channel.send({ embeds: [embed], components: [row] })
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
    const half = group.size  // exactly size players per team
    const teamA = shuffled.slice(0, half)
    const teamB = shuffled.slice(half)

    // Persist for the move-to-channels button
    lastTeams.set(interaction.channel.id, { teamA, teamB })

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

    const moveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('group_split_channels')
        .setLabel('🔀 Move to Channels')
        .setStyle(ButtonStyle.Secondary)
    )

    await interaction.channel.send({ embeds: [embed], components: [moveRow] })
  }

  private static async _randomTeamsHeroes(interaction: any, group: Group) {
    const shuffledMembers = GroupHandler._shuffle(group.members)
    const half = group.size
    const teamA = shuffledMembers.slice(0, half)
    const teamB = shuffledMembers.slice(half)
    // Persist for the move-to-channels button
    lastTeams.set(interaction.channel.id, { teamA, teamB })
    await GroupHandler._assignHeroesToTeams(interaction, teamA, teamB)
  }

  private static async _assignHeroesToTeams(
    interaction: any,
    teamA: { id: string; name: string }[],
    teamB: { id: string; name: string }[]
  ) {
    const heroes: any[] = require('../assets/data/heroes.json')
    const usedHeroIds = new Set<number>()

    function pickHero() {
      const available = heroes.filter((h: any) => !usedHeroIds.has(h.id))
      const hero = available[Math.floor(Math.random() * available.length)]
      usedHeroIds.add(hero.id)
      return hero
    }

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

    const moveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('group_split_channels')
        .setLabel('🔀 Move to Channels')
        .setStyle(ButtonStyle.Secondary)
    )

    await interaction.channel.send({ embeds: [embed], components: [moveRow] })
  }

  // ─── Voice channel splitter ───────────────────────────────────────────────
  /**
   * After teams are decided, move Team A to a second voice channel.
   * Team B (and any extra spectators) stays in the home channel.
   * If all members are offline/not in voice, silently skips.
   */
  private static async _splitVoiceChannels(
    interaction: any,
    teamA: { id: string; name: string }[],
    teamB: { id: string; name: string }[]
  ) {
    const guild = interaction.guild
    if (!guild) return

    // Count how many group members are in each voice channel to find the "lobby"
    const channelCounts = new Map<string, number>()
    const allMembers = [...teamA, ...teamB]
    for (const m of allMembers) {
      const guildMember = guild.members.cache.get(m.id)
      const vcId = guildMember?.voice?.channelId
      if (vcId) channelCounts.set(vcId, (channelCounts.get(vcId) || 0) + 1)
    }

    if (channelCounts.size === 0) return // nobody in a voice channel — skip silently

    // The channel with the most group members is the "home" channel
    let homeChannelId = ''
    let maxCount = 0
    for (const [id, count] of channelCounts) {
      if (count > maxCount) { maxCount = count; homeChannelId = id }
    }

    const homeChannel = guild.channels.cache.get(homeChannelId) as any
    if (!homeChannel) return

    // Find another voice channel in the same guild (any, as long as it isn't the home)
    const otherChannel = guild.channels.cache.find(
      (ch: any) => ch.type === ChannelType.GuildVoice && ch.id !== homeChannelId
    ) as any

    if (!otherChannel) {
      await interaction.channel.send('⚠️ No second voice channel found — please split teams manually.')
      return
    }

    // Move Team A to the other channel; Team B + spectators stay in home channel
    const moved: string[] = []
    const failed: string[] = []
    for (const m of teamA) {
      try {
        const guildMember = guild.members.cache.get(m.id)
        if (guildMember?.voice?.channelId) {
          await guildMember.voice.setChannel(otherChannel)
          moved.push(m.name)
        }
      } catch {
        failed.push(m.name)
      }
    }

    if (moved.length === 0 && failed.length === 0) return // nobody was in voice

    const lines = [
      `🔵 **Team A** → moved to **${otherChannel.name}**`,
      `🔴 **Team B** → stays in **${homeChannel.name}**`,
    ]
    if (failed.length) lines.push(`⚠️ Could not move: ${failed.join(', ')}`)

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🔀 Voice Channels Split')
      .setDescription(lines.join('\n'))

    await interaction.channel.send({ embeds: [embed] })
  }

  static getActive(channelId: string): Group | undefined {
    return activeGroups.get(channelId)
  }

  // ─── !autox2 / !autox4 / !autox5 ─────────────────────────────────────────
  /**
   * Reads the caller's voice channel, excludes any @mentioned users,
   * picks exactly (size * 2) players, randomizes teams immediately,
   * and posts the result with [⚔️ Assign Heroes] and [🔀 Move to Channels] buttons.
   */
  static async autoGroup(message: Message, size: 2 | 4 | 5) {
    const totalSlots = size * 2
    const voiceMember = message.member

    if (!voiceMember?.voice?.channel) {
      message.reply('You need to be in a voice channel to use `!autox`!')
      return
    }

    const voiceChannel = voiceMember.voice.channel
    const excludedIds = new Set(message.mentions.users.map((u) => u.id))

    const candidates = voiceChannel.members
      .filter((m: GuildMember) => !m.user.bot && !excludedIds.has(m.id))
      .map((m: GuildMember) => ({ id: m.id, name: m.displayName }))

    if (candidates.length < totalSlots) {
      const excludedList = excludedIds.size ? ` (after excluding ${excludedIds.size} player(s))` : ''
      message.reply(
        `Need at least **${totalSlots}** eligible players in the voice channel${excludedList}. ` +
        `Found **${candidates.length}**.`
      )
      return
    }

    const shuffled = GroupHandler._shuffle(candidates).slice(0, totalSlots)
    const teamA = shuffled.slice(0, size)
    const teamB = shuffled.slice(size)

    // Register the group and persist teams
    const channelId = message.channel.id
    const group: Group = {
      size,
      creatorId: message.author.id,
      creatorName: message.author.username,
      members: shuffled,
      channelId,
    }
    activeGroups.set(channelId, group)
    lastTeams.set(channelId, { teamA, teamB })

    const teamsEmbed = new EmbedBuilder()
      .setColor(0x3071f7)
      .setTitle(`🤖 Auto x${size} — Teams Randomized`)
      .addFields(
        { name: '🔵 Team A', value: teamA.map((m, i) => `${i + 1}. ${m.name}`).join('\n'), inline: true },
        { name: '🔴 Team B', value: teamB.map((m, i) => `${i + 1}. ${m.name}`).join('\n'), inline: true }
      )
      .setFooter({ text: `!x${size}cancel to disband | !x${size}kick <nick> to remove a player` })

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('group_assign_heroes')
        .setLabel('⚔️ Assign Heroes')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('group_split_channels')
        .setLabel('🔀 Move to Channels')
        .setStyle(ButtonStyle.Secondary)
    )

    await message.channel.send({ embeds: [teamsEmbed], components: [row] })
  }

  /**
   * Called from the VoiceStateUpdate event when a user fully disconnects from voice.
   * Always removes the member; if they were creator, promotes the next member.
   */
  static async handleVoiceLeave(userId: string, client: any) {
    for (const [channelId, group] of activeGroups.entries()) {
      const memberIndex = group.members.findIndex((m) => m.id === userId)
      if (memberIndex === -1) continue

      const member = group.members[memberIndex]
      const textChannel = client.channels.cache.get(channelId) as any

      group.members.splice(memberIndex, 1)

      if (group.members.length === 0) {
        activeGroups.delete(channelId)
        console.log(`[GroupHandler] ${member.name} left voice — group empty, disbanded`)
        if (textChannel) await textChannel.send(`🚫 **${member.name}** left — group disbanded (no members left).`)
        break
      }

      const wasCreator = group.creatorId === userId
      let creatorNote = ''
      if (wasCreator) {
        group.creatorId = group.members[0].id
        group.creatorName = group.members[0].name
        creatorNote = ` New creator: **${group.creatorName}**.`
      }

      console.log(`[GroupHandler] ${member.name} left voice — removed from x${group.size} group`)
      if (textChannel) {
        const totalSlots = group.size * 2
        await textChannel.send(
          `👋 **${member.name}** left the voice channel and was removed from the x${group.size} group. ` +
          `(${group.members.length}/${totalSlots})${creatorNote}`
        )
      }
      break
    }
  }
}
