export function nextCameraAction({ wantedOn, running } = {}) {
  const on = wantedOn !== false;
  if (on && !running) return 'start';
  if (!on && running) return 'stop';
  return 'keep';
}

export function cameraUiState({ wantedOn, zoomCaps } = {}) {
  const on = wantedOn !== false;
  return {
    previewHidden: !on,
    zoomHidden: !on || !zoomCaps,
  };
}
