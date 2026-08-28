export function mapPaymentFetches(codes, fetchPayment, nonInvoice) {
  return codes.map((code) => fetchPayment(code, nonInvoice));
}
