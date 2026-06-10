import { Client, Collection, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import {
  ADDGAME_LINK_PREFIX,
  ADDGAME_NEW_PREFIX,
  ADDGAME_SELECT_ID,
  handleAddgameButton,
  handleAddgameSelect,
} from './commands/addgame.js';
import {
  DELETESESSION_CANCEL_PREFIX,
  DELETESESSION_CONFIRM_PREFIX,
  DELETESESSION_SELECT_ID,
  handleDeleteSessionButton,
  handleDeleteSessionSelect,
} from './commands/deletesession.js';
import {
  EDITSESSION_MODAL_PREFIX,
  EDITSESSION_SELECT_ID,
  handleEditSessionModal,
  handleEditSessionSelect,
} from './commands/editsession.js';
import { handleRateManyButton, RATEMANY_PREFIX } from './commands/ratemany.js';
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
    return;
  }

  if (interaction.isStringSelectMenu()) {
    try {
      if (interaction.customId === EDITSESSION_SELECT_ID) {
        await handleEditSessionSelect(interaction);
      } else if (interaction.customId === DELETESESSION_SELECT_ID) {
        await handleDeleteSessionSelect(interaction);
      } else if (interaction.customId === ADDGAME_SELECT_ID) {
        await handleAddgameSelect(interaction);
      }
    } catch (err) {
      console.error(`Select menu error (${interaction.customId}):`, err);
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    try {
      if (interaction.customId.startsWith(EDITSESSION_MODAL_PREFIX)) {
        await handleEditSessionModal(interaction);
      }
    } catch (err) {
      console.error(`Modal submit error (${interaction.customId}):`, err);
    }
    return;
  }

  if (interaction.isButton()) {
    try {
      if (
        interaction.customId.startsWith(DELETESESSION_CONFIRM_PREFIX) ||
        interaction.customId.startsWith(DELETESESSION_CANCEL_PREFIX)
      ) {
        await handleDeleteSessionButton(interaction);
      } else if (
        interaction.customId.startsWith(ADDGAME_LINK_PREFIX) ||
        interaction.customId.startsWith(ADDGAME_NEW_PREFIX)
      ) {
        await handleAddgameButton(interaction);
      } else if (interaction.customId.startsWith(RATEMANY_PREFIX)) {
        await handleRateManyButton(interaction);
      }
    } catch (err) {
      console.error(`Button error (${interaction.customId}):`, err);
    }
    return;
  }
});

void client.login(config.DISCORD_TOKEN);
