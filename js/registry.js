// The single place that lists what is on the cabinet.
// To add a game (Imitation, or the Wave 2 original): create a module that exports
// `meta` (see js/core/game.js for the Game contract) and add it to GAMES below.
import { meta as snake } from './games/snake.js';
import { meta as breakout } from './games/breakout.js';
import { meta as splat } from './games/splat.js';
import { meta as asteroids } from './games/asteroids.js';
import { meta as missile } from './games/missile.js';
import { meta as pong } from './games/pong.js';

export const GAMES = [snake, breakout, splat, asteroids, missile, pong];

// Cabinet slots that exist but are built elsewhere. They render as locked cards.
export const COMING_SOON = [
  {
    id: 'imitation',
    title: 'Imitation',
    tagline: 'Human or AI? Prototyped separately in prototypes/imitation/ — awaiting integration.',
    accent: '#8f7fae',
  },
];

export const findGame = (id) => GAMES.find((g) => g.id === id);
