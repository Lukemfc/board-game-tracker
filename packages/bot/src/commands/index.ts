import type { BotCommand } from '../commandTypes.js';
import addgame from './addgame.js';
import deletesession from './deletesession.js';
import editsession from './editsession.js';
import gameratings from './gameratings.js';
import games from './games.js';
import importcollection from './importcollection.js';
import leaderboard from './leaderboard.js';
import linkbgg from './linkbgg.js';
import linkme from './linkme.js';
import logplay from './logplay.js';
import players from './players.js';
import rate from './rate.js';
import recent from './recent.js';
import renamegame from './renamegame.js';
import stats from './stats.js';

export const commands: BotCommand[] = [
  logplay,
  editsession,
  deletesession,
  recent,
  games,
  addgame,
  renamegame,
  players,
  linkme,
  linkbgg,
  importcollection,
  stats,
  leaderboard,
  rate,
  gameratings,
];
