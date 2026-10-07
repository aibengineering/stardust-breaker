import * as ui from './ui.js';
import { input, initInput } from './input.js';
import { sfx } from './audio.js';
import { createGame } from './game.js';

const canvas = document.getElementById('game');

initInput(canvas);
const game = createGame({ canvas, ui, input, sfx });

ui.initUI({
  onStart: () => { sfx.unlock(); game.start(); },
  onRestart: () => { sfx.unlock(); game.start(); },
  onPause: () => game.pause(),
  onResume: () => game.resume(),
  onQuit: () => game.quitToTitle(),
  onToggleMute: () => game.toggleMute(),
});
ui.setMuted(sfx.isMuted());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
});

window.__game = game;
