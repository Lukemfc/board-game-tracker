import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { errorMessage } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('linkbgg')
  .setDescription('Link your BoardGameGeek account for collection imports')
  .addStringOption((o) =>
    o.setName('username').setDescription('Your BGG username').setRequired(true),
  );

const linkbgg: BotCommand = {
  data,
  async execute(interaction) {
    const username = interaction.options.getString('username', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const player = await api.linkBgg(interaction.user.id, username);
      await interaction.editReply({
        content: `✅ Linked **${player.displayName}** to BGG account \`${player.bggUsername}\`. Run \`/importcollection\` to pull in your games.`,
      });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
};

export default linkbgg;
