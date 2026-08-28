export function pickSoldItem(json) {
  if (json == null) return null;
  if (Array.isArray(json) && json.length) return json[0];
  if (json.items?.length) return json.items[0];
  if (json.data?.length) return json.data[0];
  if (json.Name || json.FullName || json.Id) return json;
  return null;
}

function codeFromSoldItem(item, fallbackCode) {
  if (item.CodeProduct) return item.CodeProduct;
  if (item.FullName) return item.FullName.split(' - ')[0].trim();
  return fallbackCode;
}

export function normalizeSoldProduct(item, fallbackCode, pickPrice) {
  if (!item) return null;
  return {
    codeProduct: codeFromSoldItem(item, fallbackCode),
    code: item.Code || '-',
    name: item.Name || '',
    fullName: item.FullName || '',
    weight: item.WeightReal || item.WeightSystem || 0,
    price: pickPrice(item),
    image: item.ProductPicture || '',
    kadar: item.Kadar || '',
    trayCode: item.TrayCode || '-',
    stockQty: item.StockQuantity ?? 0,
  };
}
