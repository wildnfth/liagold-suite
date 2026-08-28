const NON_TEXT_INPUT = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'image',
  'file',
  'hidden',
]);

export function isPanelTextField(tagName, inputType) {
  const tag = String(tagName || '').toLowerCase();
  const type = String(inputType || 'text').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  return tag === 'input' && !NON_TEXT_INPUT.has(type);
}

export function shouldBounceScanFocus({
  panelVisible,
  targetId,
  insidePanel,
  tagName,
  inputType,
} = {}) {
  if (!panelVisible) return false;
  if (targetId === 'lg-scan-input') return false;
  if (insidePanel && isPanelTextField(tagName, inputType)) return false;
  return true;
}
