import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { errorMessage } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('linkme')
  .setDescription('Link your Discord account to a player profile')
  .addStringOption((o) =>
    o.setName('name').setDescription('Your real name, as the group knows you').setRequired(true),
  );

const linkme: BotCommand = {
  data,
  async execute(interaction) {
    const name = interaction.options.getString('name', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const player = await api.linkPlayer(
        { realName: name, discordUserId: interaction.user.id },
        interaction.user.id,
      );
      await interaction.editReply({
        content: `✅ Your Discord account is now linked to **${player.displayName}**.`,
      });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
};

export default linkme;
