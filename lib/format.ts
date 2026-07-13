export function formatMontant(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '— FCFA';
  return n.toLocaleString('fr-FR') + ' FCFA';
}

export function formatDate(ts: any): string {
  if (!ts) return '—';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
