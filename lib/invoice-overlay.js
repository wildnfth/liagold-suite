export const MM_TO_PT = 72 / 25.4;

export function isOldSalesInvoiceUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  let parsed;
  try {
    parsed = new URL(url, 'https://liagold.cuan.co');
  } catch (e) {
    return false;
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/sales/invoice')) return false;
  return parsed.searchParams.get('printType') === 'OLD';
}

export function createInvoiceOverlayGate(timeoutMs) {
  const wait = timeoutMs == null ? 20000 : timeoutMs;
  let next = 1;
  const pending = [];
  function sweep(at) {
    const now = at == null ? Date.now() : at;
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].exp <= now) pending.splice(i, 1);
    }
  }
  return {
    arm(at) {
      const id = next++;
      pending.push({ id, exp: (at == null ? Date.now() : at) + wait });
      return id;
    },
    drop(id) {
      const i = pending.findIndex((item) => item.id === id);
      if (i >= 0) pending.splice(i, 1);
    },
    has(at) {
      sweep(at);
      return pending.length > 0;
    },
    take(at) {
      sweep(at);
      if (!pending.length) return false;
      pending.shift();
      return true;
    },
  };
}

export function overlayCenter(pageWidth, pageHeight, config) {
  const x = config.xMm * MM_TO_PT;
  const y = config.yMm == null ? pageHeight / 2 : config.yMm * MM_TO_PT;
  return { x, y };
}

export function linePositions(lines, widths, fontSize, lineGap, center) {
  const leading = fontSize + lineGap;
  const top = center.y + (leading * lines.length) / 2;
  return lines.map((text, i) => {
    const width = widths[i];
    return {
      text,
      x: center.x - width / 2,
      y: top - fontSize - i * leading,
    };
  });
}

export async function overlayInvoicePdf(bytes, config, pdfLib) {
  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const page of doc.getPages()) {
    const size = page.getSize();
    const center = overlayCenter(size.width, size.height, config);
    const widths = config.lines.map((line) => font.widthOfTextAtSize(line, config.fontSize));
    const positions = linePositions(config.lines, widths, config.fontSize, config.lineGap, center);
    for (const pos of positions) {
      page.drawText(pos.text, {
        x: pos.x,
        y: pos.y,
        size: config.fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }
  return doc.save();
}
