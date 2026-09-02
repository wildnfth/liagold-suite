import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextCameraAction, cameraUiState } from '../lib/camera-power.js';

describe('nextCameraAction', () => {
  it('starts by default when the camera is not running', () => {
    assert.equal(nextCameraAction({ running: false }), 'start');
    assert.equal(nextCameraAction({ wantedOn: true, running: false }), 'start');
  });

  it('stops when the switch is off and the camera is running', () => {
    assert.equal(nextCameraAction({ wantedOn: false, running: true }), 'stop');
  });

  it('keeps the current state when it already matches', () => {
    assert.equal(nextCameraAction({ wantedOn: true, running: true }), 'keep');
    assert.equal(nextCameraAction({ wantedOn: false, running: false }), 'keep');
  });
});

describe('cameraUiState', () => {
  it('shows the preview by default and zoom only when caps exist', () => {
    assert.deepEqual(cameraUiState({ zoomCaps: { min: 1, max: 3 } }), {
      previewHidden: false,
      zoomHidden: false,
    });
    assert.deepEqual(cameraUiState({}), {
      previewHidden: false,
      zoomHidden: true,
    });
  });

  it('hides preview and zoom when the camera is off', () => {
    assert.deepEqual(cameraUiState({
      wantedOn: false,
      zoomCaps: { min: 1, max: 3 },
    }), {
      previewHidden: true,
      zoomHidden: true,
    });
  });
});
