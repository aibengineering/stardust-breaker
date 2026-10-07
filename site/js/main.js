import * as ui from './ui.js';
import { input, initInput } from './input.js';
import { sfx } from './audio.js';
import { createGame } from './game.js';

const canvas = document.getElementById('game');

initInput(canvas);
const game = createGame({ canvas, ui, input, sfx });

ui.initUI({
  onMapOpen: () => { sfx.unlock(); game.openMap(); },
  onMapBack: () => game.toTitle(),
  onSelectSector: (id) => { sfx.unlock(); game.selectSector(id); },
  onStart: () => { sfx.unlock(); game.startRun('belt'); },
  onRestart: () => { sfx.unlock(); game.retry(); },
  onContinue: () => game.continueRun(),
  onVictoryMap: () => game.openMap(),
  onGameOverMap: () => game.openMap(),
  onReroll: () => game.reroll(),
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
