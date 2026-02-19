import { Message, GuildMember, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js'
import { t } from '../i18n'
import { askAI, heroPickPrompt } from '../ai'

// Dota 2 roles per slot index (0-4 = team A, 5-9 = team B)
const ROLES = ['Hard Carry', 'Mid Lane', 'Offlane', 'Soft Support', 'Hard Support']

// Hero roles preferred for each Dota 2 position (in priority order)
const ROLE_PREFERRED_HERO_ROLES: Record<string, string[]> = {
  'Hard Carry':   ['Carry'],
  'Mid Lane':     ['Carry', 'Nuker', 'Escape'],
  'Offlane':      ['Durable', 'Initiator', 'Disabler'],
  'Soft Support': ['Support', 'Disabler', 'Initiator'],
  'Hard Support': ['Support'],
}

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
        message.reply(t('group.alreadyExists', { size: existing.size }))
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
      message.reply(t('group.alreadyIn'))
      return
    }
    if (group.members.length >= totalSlots) {
      message.reply(t('group.groupFull'))
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
      message.reply(t('group.noGroup'))
      return
    }

    const idx = group.members.findIndex((m) => m.id === message.author.id)
    if (idx === -1) {
      message.reply(t('group.alreadyIn'))
      return
    }

    const leaving = group.members[idx]
    group.members.splice(idx, 1)

    if (group.members.length === 0) {
      activeGroups.delete(message.channel.id)
      message.channel.send(t('group.disbanded.empty'))
      return
    }

    // If creator left, promote the next member
    let creatorNote = ''
    if (group.creatorId === leaving.id) {
      group.creatorId = group.members[0].id
      group.creatorName = group.members[0].name
      creatorNote = ' ' + t('group.promoted', { name: group.creatorName })
    }

    console.log(`[GroupHandler] ${leaving.name} left x${group.size} group`)
    await message.channel.send(t('group.left', { name: leaving.name }) + creatorNote)
    await GroupHandler._sendGroupStatus(message.channel, group)
  }

  // ─── !x4cancel / !x5cancel ───────────────────────────────────────────────
  static cancel(message: Message) {
    const group = activeGroups.get(message.channel.id)
    if (!group) {
      message.reply(t('group.noGroup'))
      return
    }
    if (group.creatorId !== message.author.id) {
      message.reply(t('group.notCreator'))
      return
    }
    activeGroups.delete(message.channel.id)
    console.log(`[GroupHandler] x${group.size} group cancelled by ${message.author.username}`)
    message.channel.send(t('group.cancelled', { name: message.member?.displayName ?? message.author.username }))
  }

  // ─── !x4kick / !x5kick <nickname> ────────────────────────────────────────
  static async kick(message: Message, partialName: string) {
    const group = activeGroups.get(message.channel.id)
    if (!group) {
      message.reply(t('group.noGroup'))
      return
    }
    if (group.creatorId !== message.author.id) {
      message.reply(t('group.notCreator'))
      return
    }
    const lower = partialName.toLowerCase()
    const target = group.members.find(
      (m) => m.id !== group.creatorId && m.name.toLowerCase().includes(lower)
    )
    if (!target) {
      message.reply(t('group.memberNotFound', { name: partialName }))
      return
    }
    group.members = group.members.filter((m) => m.id !== target.id)
    console.log(`[GroupHandler] ${target.name} kicked from x${group.size} group by creator`)
    message.channel.send(t('group.kicked', { name: target.name }))
    await GroupHandler._sendGroupStatus(message.channel, group)
  }

  // ─── Button interactions ──────────────────────────────────────────────────
  static async handleButton(interaction: any) {
    const channelId = interaction.channel?.id
    if (!channelId) return

    if (interaction.customId === 'group_join') {
      const group = activeGroups.get(channelId)
      if (!group) {
        await interaction.reply({ content: t('group.noGroup'), ephemeral: true })
        return
      }
      const totalSlots = group.size * 2
      if (group.members.some((m) => m.id === interaction.user.id)) {
        await interaction.reply({ content: t('group.alreadyIn'), ephemeral: true })
        return
      }
      if (group.members.length >= totalSlots) {
        await interaction.reply({ content: t('group.groupFull'), ephemeral: true })
        return
      }
      const displayName = interaction.member?.displayName ?? interaction.user.username
      group.members.push({ id: interaction.user.id, name: displayName })
      console.log(`[GroupHandler] ${displayName} joined x${group.size} group via button`)
      await interaction.deferUpdate()
      await GroupHandler._disableButtons(interaction)
      if (group.members.length === totalSlots) {
        await GroupHandler._sendFullGroup(interaction.channel, group)
      } else {
        await GroupHandler._sendGroupStatus(interaction.channel, group)
      }
      if (group.members.length === totalSlots) {
        await interaction.channel.send(t('group.joined', { name: interaction.member?.displayName ?? interaction.user.username }))
      }
      return
    }

    if (interaction.customId === 'group_random_teams') {
      const group = activeGroups.get(channelId)
      if (!group) {
        interaction.reply({ content: t('group.noGroup'), ephemeral: true })
        return
      }
      await interaction.deferUpdate()
      await GroupHandler._disableButtons(interaction)
      await GroupHandler._randomTeams(interaction, group)
      return
    }

    if (interaction.customId === 'group_random_teams_heroes') {
      const group = activeGroups.get(channelId)
      if (!group) {
        interaction.reply({ content: t('group.noGroup'), ephemeral: true })
        return
      }
      await interaction.deferUpdate()
      await GroupHandler._disableButtons(interaction)
      await GroupHandler._randomTeamsHeroes(interaction, group)
      return
    }

    if (interaction.customId === 'group_assign_heroes') {
      const stored = lastTeams.get(channelId)
      if (!stored) {
        interaction.reply({ content: t('group.noTeamData'), ephemeral: true })
        return
      }
      await interaction.deferUpdate()
      await GroupHandler._disableButtons(interaction)
      await GroupHandler._assignHeroesToTeams(interaction, stored.teamA, stored.teamB)
      return
    }

    if (interaction.customId === 'group_split_channels') {
      const stored = lastTeams.get(channelId)
      if (!stored) {
        interaction.reply({ content: t('group.noTeamData'), ephemeral: true })
        return
      }
      await interaction.deferUpdate()
      await GroupHandler._disableButtons(interaction)
      await GroupHandler._splitVoiceChannels(interaction, stored.teamA, stored.teamB)
      // Clean up — the event has started, group and team data are no longer needed
      activeGroups.delete(channelId)
      lastTeams.delete(channelId)
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
      .setTitle(t('group.statusTitle', { size: group.size, current: group.members.length, total: totalSlots }))
      .setDescription(memberList || '...')
      .setFooter({ text: `${spots} spot(s) remaining | !x${group.size}` })

    const joinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('group_join')
        .setLabel(t('group.btnJoin'))
        .setStyle(ButtonStyle.Primary)
    )

    await channel.send({ embeds: [embed], components: [joinRow] })
  }

  private static async _sendFullGroup(channel: any, group: Group) {
    const memberList = group.members.map((m, i) => `${i + 1}. ${m.name}`).join('\n')

    const embed = new EmbedBuilder()
      .setColor(0x00ff99)
      .setTitle(t('group.fullTitle', { size: group.size }))
      .setDescription(memberList)
      .setFooter({ text: '⬇️' })

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('group_random_teams')
        .setLabel(t('group.btnRandomTeams'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('group_random_teams_heroes')
        .setLabel(t('group.btnRandomTeamsHeroes'))
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

  /** Disables all buttons on the message that triggered this interaction. */
  private static async _disableButtons(interaction: any) {
    try {
      const disabled = interaction.message.components.map((row: any) =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          row.components.map((btn: any) =>
            ButtonBuilder.from(btn.toJSON ? btn.toJSON() : btn).setDisabled(true)
          )
        )
      )
      await interaction.message.edit({ components: disabled })
    } catch { /* ignore — message may have been deleted */ }
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
      .setTitle(t('group.btnRandomTeams'))
      .addFields(
        {
          name: t('group.teamATitle'),
          value: teamA.map((m, i) => `${i + 1}. ${m.name}`).join('\n'),
          inline: true,
        },
        {
          name: t('group.teamBTitle'),
          value: teamB.map((m, i) => `${i + 1}. ${m.name}`).join('\n'),
          inline: true,
        }
      )

    const moveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('group_split_channels')
        .setLabel(t('group.btnMoveChannels'))
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
    const rolesA = ROLES.slice(0, teamA.length)
    const rolesB = ROLES.slice(0, teamB.length)
    const allRoles = rolesA  // same for both teams
    const size = teamA.length

    // ── Try AI hero assignment ──────────────────────────────────────────
    let assignA: { member: typeof teamA[0]; role: string; hero: any }[] | null = null
    let assignB: { member: typeof teamB[0]; role: string; hero: any }[] | null = null

    try {
      const prompt = heroPickPrompt({ size, roles: allRoles, heroPool: heroes })
      const raw = await askAI(prompt, 300, 0.4)

      if (raw) {
        // Extract JSON — strip any markdown fences the model might add
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { teamA: string[]; teamB: string[] }

          if (
            Array.isArray(parsed.teamA) && parsed.teamA.length === size &&
            Array.isArray(parsed.teamB) && parsed.teamB.length === size
          ) {
            // Match returned names to hero objects (case-insensitive)
            const findHero = (name: string) =>
              heroes.find((h: any) =>
                h.localized_name.toLowerCase() === name.toLowerCase() ||
                h.name.toLowerCase() === name.toLowerCase()
              )

            const heroesA = parsed.teamA.map(findHero)
            const heroesB = parsed.teamB.map(findHero)

            // Only accept if every name resolved and there are no duplicates
            const allFound = [...heroesA, ...heroesB].every(Boolean)
            const ids = [...heroesA, ...heroesB].map((h: any) => h?.id)
            const noDups = new Set(ids).size === ids.length

            if (allFound && noDups) {
              assignA = teamA.map((m, i) => ({ member: m, role: rolesA[i], hero: heroesA[i] }))
              assignB = teamB.map((m, i) => ({ member: m, role: rolesB[i], hero: heroesB[i] }))
              console.log('[GroupHandler] AI hero assignment succeeded')
            } else {
              console.warn('[GroupHandler] AI returned unknown/duplicate heroes, falling back')
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[GroupHandler] AI hero pick failed, using fallback:', err?.message ?? err)
    }

    // ── Fallback: role-based random pick ───────────────────────────────
    if (!assignA || !assignB) {
      const usedHeroIds = new Set<number>()

      const pickHeroForRole = (roleName: string) => {
        const preferred = ROLE_PREFERRED_HERO_ROLES[roleName] ?? []
        const available = heroes.filter((h: any) => !usedHeroIds.has(h.id))
        const matching = available.filter((h: any) =>
          h.roles.some((r: string) => preferred.includes(r))
        )
        const pool = matching.length > 0 ? matching : available
        const hero = pool[Math.floor(Math.random() * pool.length)]
        usedHeroIds.add(hero.id)
        return hero
      }

      assignA = teamA.map((m, i) => ({ member: m, role: rolesA[i], hero: pickHeroForRole(rolesA[i]) }))
      assignB = teamB.map((m, i) => ({ member: m, role: rolesB[i], hero: pickHeroForRole(rolesB[i]) }))
    }

    const heroImg = (name: string) =>
      `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${name}.png`

    const embeds: EmbedBuilder[] = []

    // Team A embeds (blue)
    assignA!.forEach((a, i) => {
      const e = new EmbedBuilder()
        .setColor(0x5865f2)
        .setThumbnail(heroImg(a.hero.name))
        .setDescription(`**${a.role}** — ${a.member.name}\n↳ **${a.hero.localized_name}**`)
      if (i === 0) {
        e.setTitle(t('group.btnRandomTeamsHeroes'))
        e.setAuthor({ name: `🔵 ${t('group.teamATitle')}` })
      }
      embeds.push(e)
    })

    // Team B embeds (red)
    assignB!.forEach((a, i) => {
      const e = new EmbedBuilder()
        .setColor(0xed4245)
        .setThumbnail(heroImg(a.hero.name))
        .setDescription(`**${a.role}** — ${a.member.name}\n↳ **${a.hero.localized_name}**`)
      if (i === 0) {
        e.setAuthor({ name: `🔴 ${t('group.teamBTitle')}` })
      }
      embeds.push(e)
    })

    const moveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('group_split_channels')
        .setLabel(t('group.btnMoveChannels'))
        .setStyle(ButtonStyle.Secondary)
    )

    await interaction.channel.send({ embeds, components: [moveRow] })
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
      await interaction.channel.send(t('group.noSecondChannel'))
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
      t('group.splitTeamA', { channel: otherChannel.name }),
      t('group.splitTeamB', { channel: homeChannel.name }),
    ]
    if (failed.length) lines.push(t('group.splitFailed', { names: failed.join(', ') }))

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(t('group.splitTitle'))
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
      message.reply(t('group.autoNotInVoice', { size }))
      return
    }

    const voiceChannel = voiceMember.voice.channel
    const excludedIds = new Set(message.mentions.users.map((u) => u.id))

    const candidates = voiceChannel.members
      .filter((m: GuildMember) => !m.user.bot && !excludedIds.has(m.id))
      .map((m: GuildMember) => ({ id: m.id, name: m.displayName }))

    if (candidates.length < totalSlots) {
      message.reply(t('group.autoNotEnough', { need: totalSlots, found: candidates.length }))
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
      .setTitle(`🤖 Auto x${size}`)
      .addFields(
        { name: t('group.teamATitle'), value: teamA.map((m, i) => `${i + 1}. ${m.name}`).join('\n'), inline: true },
        { name: t('group.teamBTitle'), value: teamB.map((m, i) => `${i + 1}. ${m.name}`).join('\n'), inline: true }
      )
      .setFooter({ text: `!x${size}cancel | !x${size}kick <nick>` })

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('group_assign_heroes')
        .setLabel(t('group.btnAssignHeroes'))
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('group_split_channels')
        .setLabel(t('group.btnMoveChannels'))
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
        if (textChannel) await textChannel.send(t('group.disbanded.empty'))
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
        await textChannel.send(t('group.voiceLeft', { name: member.name }) + creatorNote)
      }
      break
    }
  }
}
