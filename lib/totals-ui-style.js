export const TOTALS_STICKY_BG = '#fff';

export function totalsFooterCss({
  rowClass,
  labelClass,
  valueClass,
  negClass,
  methodClass,
  amountClass,
} = {}) {
  const row = rowClass || 'gold-total-footer-row';
  const label = labelClass || 'gold-total-label';
  const value = valueClass || '';
  const neg = negClass || 'gold-total-negative';
  let css = `
.${row} td {
background: #fff !important;
border-top: 1px solid rgba(0,0,0,.12) !important;
white-space: nowrap;
position: sticky;
bottom: 0;
z-index: 60;
box-sizing: border-box;
}
.${row} td.mat-table-sticky {
z-index: 65;
}
.${row} td.${label} {
background: #fff !important;
text-align: left !important;
padding-left: 16px !important;
z-index: 70 !important;
white-space: nowrap !important;
}
.${row} td.${label}.mat-table-sticky {
z-index: 70 !important;
}
.${row} td.${neg} {
color: #d2453a !important;
}
tfoot {
display: table-footer-group;
}
`;
  if (value) {
    css += `
.${row} td.${value} {
text-align: right !important;
font-variant-numeric: tabular-nums;
}
`;
  }
  if (methodClass) {
    css += `
.${row} td.${methodClass} {
text-align: left !important;
max-width: 160px;
overflow: hidden;
text-overflow: ellipsis;
}
`;
  }
  if (amountClass) {
    css += `
.${row} td.${amountClass} {
text-align: right !important;
}
`;
  }
  return css;
}

export function totalsPayBarCss(barId) {
  const id = barId || 'gold-sales-pay-bar';
  return `
#${id} {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0;
  margin: 0 0 8px;
  border-top: 1px solid rgba(0,0,0,.12);
  background: #fff;
  font-family: inherit;
  font-weight: 400;
  font-size: inherit;
  color: inherit;
}
#${id} .gold-sales-pay-label {
  background: transparent;
  color: inherit;
  padding: 10px 16px;
  font-family: inherit;
  font-size: inherit;
  white-space: nowrap;
  display: flex;
  align-items: center;
}
#${id} .gold-sales-pay-methods {
  display: flex;
  flex-wrap: wrap;
  flex: 1;
}
#${id} .gold-sales-pay-cell {
  padding: 10px 16px;
  min-width: 140px;
  border-left: 1px solid rgba(0,0,0,.08);
}
#${id} .gold-sales-pay-method {
  display: block;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
}
#${id} .gold-sales-pay-amount {
  display: block;
  margin-top: 2px;
  font-family: inherit;
  font-size: inherit;
  font-variant-numeric: tabular-nums;
  text-align: left;
}
#${id} .gold-sales-pay-amount.neg {
  color: #d2453a;
}
#${id} .gold-sales-pay-sum {
  background: transparent;
  margin-left: auto;
}
`;
}
