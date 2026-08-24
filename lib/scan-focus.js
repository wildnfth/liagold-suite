export function shouldBounceScanFocus({
  panelVisible,
  targetId,
  insidePanel,
  tagName,
  inputType,
} = {}) {
  if (!panelVisible) return false;
  if (targetId === 'lg-scan-input') return false;
  const tag = String(tagName || '').toLowerCase();
  const type = String(inputType || 'text').toLowerCase();
  const isPanelTextField = tag === 'textarea' || tag === 'select'
    || (tag === 'input' && type !== 'checkbox' && type !== 'radio' && type !== 'button'
      && type !== 'submit' && type !== 'reset' && type !== 'image' && type !== 'file' && type !== 'hidden');
  if (insidePanel && isPanelTextField) return false;
  return true;
}
