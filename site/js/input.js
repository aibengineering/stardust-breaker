export const input = {
  left: false,
  right: false,
  thrust: false,
  stick: { active: false, x: 0, y: 0 },
  pausePressed: false,
  // Drops the current touch stick (game takes over the screen). A still-held finger stops steering.
  cancel() { releaseStick(); },
};

const CONTROL_CODES = new Set(['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD', 'ArrowUp', 'KeyW']);
const RANGE = 60;
const KNOB = 52;

const held = new Set();
let pointerId = null;
let originX = 0;
let originY = 0;
let baseEl = null;
let knobEl = null;

function syncKeys() {
  input.left = held.has('ArrowLeft') || held.has('KeyA');
  input.right = held.has('ArrowRight') || held.has('KeyD');
  input.thrust = held.has('ArrowUp') || held.has('KeyW');
}

function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (CONTROL_CODES.has(e.code)) {
    held.add(e.code);
    syncKeys();
    e.preventDefault();
  } else if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) {
    input.pausePressed = true;
  }
}

function onKeyUp(e) {
  if (held.delete(e.code)) syncKeys();
}

function placeKnob(dx, dy) {
  knobEl.style.transform = `translate(${originX + dx - KNOB / 2}px, ${originY + dy - KNOB / 2}px)`;
}

function releaseStick() {
  pointerId = null;
  input.stick.active = false;
  input.stick.x = 0;
  input.stick.y = 0;
  // cancel() may run before initInput() has built the DOM circles
  if (baseEl) baseEl.hidden = true;
  if (knobEl) knobEl.hidden = true;
}

function releaseAll() {
  held.clear();
  syncKeys();
  releaseStick();
}

function onPointerMove(e) {
  if (e.pointerId !== pointerId) return;
  let dx = e.clientX - originX;
  let dy = e.clientY - originY;
  const len = Math.hypot(dx, dy);
  if (len > RANGE) {
    dx *= RANGE / len;
    dy *= RANGE / len;
  }
  input.stick.x = dx / RANGE;
  input.stick.y = dy / RANGE;
  placeKnob(dx, dy);
}

function onPointerEnd(e) {
  if (e.pointerId !== pointerId) return;
  releaseStick();
}

export function initInput(canvas) {
  baseEl = document.createElement('div');
  baseEl.className = 'stick-base';
  baseEl.hidden = true;
  knobEl = document.createElement('div');
  knobEl.className = 'stick-knob';
  knobEl.hidden = true;
  document.body.append(baseEl, knobEl);

  canvas.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    pointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    originX = e.clientX;
    originY = e.clientY;
    input.stick.active = true;
    input.stick.x = 0;
    input.stick.y = 0;
    baseEl.style.transform = `translate(${originX - RANGE}px, ${originY - RANGE}px)`;
    baseEl.hidden = false;
    placeKnob(0, 0);
    knobEl.hidden = false;
  });

  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
}
