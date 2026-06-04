import type { BotCommand } from '../commandTypes.js';
import addgame from './addgame.js';
import deletesession from './deletesession.js';
import editsession from './editsession.js';
import games from './games.js';
import leaderboard from './leaderboard.js';
import linkme from './linkme.js';
import logplay from './logplay.js';
import players from './players.js';
import recent from './recent.js';
import stats from './stats.js';

export const commands: BotCommand[] = [
  logplay,
  editsession,
  deletesession,
  recent,
  games,
  addgame,
  players,
  linkme,
  stats,
  leaderboard,
];
