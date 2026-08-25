import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFormTrayLabel,
  matchTrayByCode,
  planAutoSelectFormTray,
  planSyncFormTray,
  readFormTrayLabel,
  findFormTrayOption,
} from '../lib/form-tray.js';

describe('parseFormTrayLabel', () => {
  it('takes the tray code before " - " from the CUAN ng-select label', () => {
    assert.equal(parseFormTrayLabel('11 - BAKI 11'), '11');
    assert.equal(parseFormTrayLabel('BS - BAKI BS'), 'BS');
  });

  it('returns null for a blank label', () => {
    assert.equal(parseFormTrayLabel(''), null);
    assert.equal(parseFormTrayLabel('   '), null);
    assert.equal(parseFormTrayLabel(null), null);
  });
});

const trays = [
  { trayId: 11, trayCode: '8' },
  { trayId: 14, trayCode: '11' },
  { trayId: 2, trayCode: 'BS' },
];

describe('matchTrayByCode', () => {
  it('matches trayCode 11 to Baki 11, not trayId 11 (Baki 8)', () => {
    assert.deepEqual(matchTrayByCode(trays, '11'), { trayId: 14, trayCode: '11' });
  });
});

describe('planAutoSelectFormTray', () => {
  it('skips when the form has no tray selected', () => {
    assert.deepEqual(planAutoSelectFormTray({
      formLabel: '',
      trayList: trays,
      selectedTray: 'all',
      trayListReady: true,
    }), { action: 'skip', reason: 'no-form-tray' });
  });

  it('waits when the tray list is not ready yet', () => {
    assert.deepEqual(planAutoSelectFormTray({
      formLabel: '11 - BAKI 11',
      trayList: [],
      selectedTray: 'all',
      trayListReady: false,
    }), { action: 'pending', code: '11' });
  });

  it('reports missing when the form tray is not in the scanner list', () => {
    assert.deepEqual(planAutoSelectFormTray({
      formLabel: '99 - BAKI 99',
      trayList: trays,
      selectedTray: 'all',
      trayListReady: true,
    }), { action: 'missing', code: '99' });
  });

  it('skips reload when the scanner already has that tray', () => {
    assert.deepEqual(planAutoSelectFormTray({
      formLabel: '11 - BAKI 11',
      trayList: trays,
      selectedTray: '14',
      trayListReady: true,
    }), {
      action: 'skip',
      reason: 'already-selected',
      tray: { trayId: 14, trayCode: '11' },
    });
  });

  it('selects the form tray by trayId 14 when the label is Baki 11', () => {
    assert.deepEqual(planAutoSelectFormTray({
      formLabel: '11 - BAKI 11',
      trayList: trays,
      selectedTray: 'all',
      trayListReady: true,
    }), {
      action: 'select',
      tray: { trayId: 14, trayCode: '11' },
    });
  });

  it('selects the form tray even if the scanner already has a different tray', () => {
    assert.deepEqual(planAutoSelectFormTray({
      formLabel: '11 - BAKI 11',
      trayList: trays,
      selectedTray: '4',
      trayListReady: true,
    }), {
      action: 'select',
      tray: { trayId: 14, trayCode: '11' },
    });
  });
});

describe('readFormTrayLabel', () => {
  it('reads the CUAN TrayId ng-select value label', () => {
    const root = {
      querySelector(sel) {
        if (sel === 'ng-select[formcontrolname="TrayId"] .ng-value-label') {
          return { textContent: '  11 - BAKI 11  ' };
        }
        return null;
      },
    };
    assert.equal(readFormTrayLabel(root), '11 - BAKI 11');
  });

  it('returns empty when the form has no selected tray label', () => {
    assert.equal(readFormTrayLabel({ querySelector() { return null; } }), '');
    assert.equal(readFormTrayLabel(null), '');
  });
});

describe('planSyncFormTray', () => {
  it('skips when the scanner change came from the form auto-select', () => {
    assert.deepEqual(planSyncFormTray({
      scannerTray: '14',
      scannerTrayCode: '11',
      formLabel: '11 - BAKI 11',
      fromFormAutoSelect: true,
    }), { action: 'skip', reason: 'from-form' });
  });

  it('skips Semua Baki so the form tray stays put', () => {
    assert.deepEqual(planSyncFormTray({
      scannerTray: 'all',
      scannerTrayCode: '',
      formLabel: '11 - BAKI 11',
    }), { action: 'skip', reason: 'no-scanner-tray' });
  });

  it('applies when the form has no tray yet', () => {
    assert.deepEqual(planSyncFormTray({
      scannerTray: '14',
      scannerTrayCode: '11',
      formLabel: '',
    }), { action: 'apply', code: '11' });
  });

  it('skips when the form already shows that tray code', () => {
    assert.deepEqual(planSyncFormTray({
      scannerTray: '14',
      scannerTrayCode: '11',
      formLabel: '11 - BAKI 11',
    }), { action: 'skip', reason: 'already-same' });
  });

  it('applies when the form is on a different tray', () => {
    assert.deepEqual(planSyncFormTray({
      scannerTray: '14',
      scannerTrayCode: '11',
      formLabel: '8 - BAKI 8',
    }), { action: 'apply', code: '11' });
  });
});

describe('findFormTrayOption', () => {
  function optionsRoot(labels) {
    const nodes = labels.map((text) => ({ textContent: text }));
    return {
      querySelectorAll(sel) {
        if (sel.includes('.ng-option')) return nodes;
        return [];
      },
    };
  }

  it('picks the option whose label code is 11, not an 11 buried in another name', () => {
    const root = optionsRoot(['8 - BAKI 8', '111 - BAKI 111', '11 - BAKI 11', 'BS - BAKI BS']);
    assert.equal(findFormTrayOption(root, '11').textContent, '11 - BAKI 11');
  });

  it('matches letter tray codes case-insensitively', () => {
    const root = optionsRoot(['bs - BAKI BS']);
    assert.equal(findFormTrayOption(root, 'BS').textContent, 'bs - BAKI BS');
  });

  it('returns null when no option matches', () => {
    assert.equal(findFormTrayOption(optionsRoot(['8 - BAKI 8']), '11'), null);
    assert.equal(findFormTrayOption(null, '11'), null);
  });
});
