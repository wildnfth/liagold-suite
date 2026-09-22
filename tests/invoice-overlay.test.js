import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOldSalesInvoiceUrl,
  createInvoiceOverlayGate,
  overlayCenter,
  linePositions,
  MM_TO_PT,
} from '../lib/invoice-overlay.js';

describe('isOldSalesInvoiceUrl', () => {
  it('matches Cetak Invoice Lama only', () => {
    assert.equal(
      isOldSalesInvoiceUrl('https://liagold.cuan.co/web/sales/invoice?id=1&setZeroValue=false&printType=OLD'),
      true
    );
    assert.equal(isOldSalesInvoiceUrl('/web/sales/invoice?printType=OLD'), true);
  });

  it('ignores invoice baru, order, and check-print', () => {
    assert.equal(
      isOldSalesInvoiceUrl('https://liagold.cuan.co/web/sales/invoice?printType=NEW'),
      false
    );
    assert.equal(
      isOldSalesInvoiceUrl('https://liagold.cuan.co/web/order/invoice?printType=OLD'),
      false
    );
    assert.equal(
      isOldSalesInvoiceUrl('https://liagold.cuan.co/web/sales/check-print-invoice/1'),
      false
    );
    assert.equal(isOldSalesInvoiceUrl(''), false);
  });
});

describe('createInvoiceOverlayGate', () => {
  it('arms, takes once, and expires', () => {
    const gate = createInvoiceOverlayGate(20000);
    assert.equal(gate.has(1000), false);
    gate.arm(1000);
    assert.equal(gate.has(1000), true);
    assert.equal(gate.take(1000), true);
    assert.equal(gate.take(1000), false);
    gate.arm(1000);
    assert.equal(gate.has(21000), false);
    assert.equal(gate.take(21000), false);
  });

  it('drop cancels a failed request without eating the one still printing', () => {
    const gate = createInvoiceOverlayGate(20000);
    const first = gate.arm(0);
    const second = gate.arm(0);
    gate.drop(second);
    assert.equal(gate.take(0), true);
    assert.equal(gate.take(0), false);
    assert.equal(first === second, false);
  });
});

describe('overlay placement', () => {
  it('centers the block at 111mm from the left, vertical middle', () => {
    const center = overlayCenter(453, 303, { xMm: 111, yMm: null });
    assert.ok(Math.abs(center.x - 111 * MM_TO_PT) < 0.01);
    assert.equal(center.y, 151.5);
  });

  it('uses yMm from the bottom when set', () => {
    const center = overlayCenter(453, 303, { xMm: 111, yMm: 20 });
    assert.ok(Math.abs(center.y - 20 * MM_TO_PT) < 0.01);
  });

  it('puts line 1 above line 2, both centered', () => {
    const center = { x: 314.6, y: 151.5 };
    const pos = linePositions(
      ['Potongan bisa berubah apabila', 'harga emas turun +-10%'],
      [96.9, 77.2],
      7,
      1.5,
      center
    );
    assert.equal(pos[0].text, 'Potongan bisa berubah apabila');
    assert.ok(pos[0].y > pos[1].y);
    assert.ok(Math.abs(pos[0].x + 96.9 / 2 - 314.6) < 0.01);
    assert.ok(Math.abs(pos[1].x + 77.2 / 2 - 314.6) < 0.01);
  });
});
