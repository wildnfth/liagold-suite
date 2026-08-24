import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldBounceScanFocus } from '../lib/scan-focus.js';

describe('shouldBounceScanFocus', () => {
  it('does not bounce when the scanner panel is closed', () => {
    assert.equal(shouldBounceScanFocus({
      panelVisible: false,
      targetId: '',
      insidePanel: false,
      tagName: 'INPUT',
      inputType: 'text',
    }), false);
  });

  it('does not bounce when focus is already on the Tampermonkey scan input', () => {
    assert.equal(shouldBounceScanFocus({
      panelVisible: true,
      targetId: 'lg-scan-input',
      insidePanel: true,
      tagName: 'INPUT',
      inputType: 'text',
    }), false);
  });

  it('bounces when the ERP kode barang input steals focus during a scan', () => {
    assert.equal(shouldBounceScanFocus({
      panelVisible: true,
      targetId: '',
      insidePanel: false,
      tagName: 'INPUT',
      inputType: 'text',
    }), true);
  });

  it('does not bounce when typing in the tray search box', () => {
    assert.equal(shouldBounceScanFocus({
      panelVisible: true,
      targetId: 'lg-tray-search',
      insidePanel: true,
      tagName: 'INPUT',
      inputType: 'text',
    }), false);
  });

  it('does not bounce when editing batch size or delay', () => {
    assert.equal(shouldBounceScanFocus({
      panelVisible: true,
      targetId: 'lg-batch-size',
      insidePanel: true,
      tagName: 'INPUT',
      inputType: 'number',
    }), false);
  });

  it('bounces from panel buttons so the next scan stays in the scan input', () => {
    assert.equal(shouldBounceScanFocus({
      panelVisible: true,
      targetId: 'lg-scan-btn',
      insidePanel: true,
      tagName: 'BUTTON',
      inputType: '',
    }), true);
  });

  it('bounces from the autofill checkbox', () => {
    assert.equal(shouldBounceScanFocus({
      panelVisible: true,
      targetId: 'lg-autofill',
      insidePanel: true,
      tagName: 'INPUT',
      inputType: 'checkbox',
    }), true);
  });
});
