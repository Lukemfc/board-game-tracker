import { Client, Collection, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { commands } from './commands/index.js';
import type { BotCommand } from './commandTypes.js';
import { config } from './config.js';

const commandMap = new Collection<string, BotCommand>();
for (const command of commands) commandMap.set(command.data.name, command);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Meeple Ledger bot logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = commandMap.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error in /${interaction.commandName}:`, err);
      const content = '⚠️ An unexpected error occurred.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content }).catch(() => undefined);
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    const command = commandMap.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (err) {
      console.error(`Autocomplete error in /${interaction.commandName}:`, err);
    }
  }
});

void client.login(config.DISCORD_TOKEN);
