/**
 * Register slash commands with Discord.
 *  - With DISCORD_GUILD_ID set: guild-scoped (updates instantly) — use in dev.
 *  - Without it: global (may take up to an hour to propagate) — use in prod.
 *
 * Run: pnpm --filter @meeple/bot deploy-commands
 */
import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';
import { config } from './config.js';

const body = commands.map((command) => command.data.toJSON());
const rest = new REST().setToken(config.DISCORD_TOKEN);

async function main() {
  if (config.DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
      { body },
    );

    console.log(`Registered ${body.length} guild command(s) to ${config.DISCORD_GUILD_ID}.`);
  } else {
    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), { body });

    console.log(`Registered ${body.length} global command(s).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
