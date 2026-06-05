import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { bggImportEmbed } from '../embeds.js';
import { errorMessage } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('importcollection')
  .setDescription('Import the games you own from your linked BGG collection');

const importcollection: BotCommand = {
  data,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply({
      content: '⏳ Fetching your BGG collection — this can take a moment…',
    });
    try {
      const result = await api.importCollection(interaction.user.id);
      await interaction.editReply({ content: '', embeds: [bggImportEmbed(result)] });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
};

export default importcollection;
