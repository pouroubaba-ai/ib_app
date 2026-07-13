'use client';
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { formatMontant, formatDate } from '@/lib/format';
import { Search, X, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import FiltreDates, { PlageDates } from '@/components/FiltreDates';

interface Document {
  id: string;
  numeroDocument: string;
  clientNom: string;
  totalGeneral: number;
  nombreDeProduit: number;
  date: any;
}

export default function DocumentsEntreesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [docs, setDocs] = useState<Document[]>([]);
  const [docIdsAvecRetour, setDocIdsAvecRetour] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [plage, setPlage] = useState<PlageDates>({ debut: null, fin: null });
  const [recherche, setRecherche] = useState('');

  useEffect(() => {
    if (!user) return;
    async function load() {
      const [snap, retourSnap] = await Promise.all([
        getDocs(query(collection(db, 'documents_stock'), where('userId', '==', user!.uid), where('typeDocument', '==', 'Entrée'))),
        getDocs(query(collection(db, 'mouvements'), where('userId', '==', user!.uid), where('typeTransaction', '==', 'Retour'))),
      ]);
      const data: Document[] = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Document));
      data.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
      setDocs(data);
      const ids = new Set<string>();
      retourSnap.docs.forEach(d => {
        const refId: string | undefined = (d.data().documentId as any)?.id;
        if (refId) ids.add(refId);
      });
      setDocIdsAvecRetour(ids);
      setLoading(false);
    }
    load();
  }, [user]);

  const filtered = useMemo(() => {
    return docs.filter(d => {
      const okRecherche = !recherche || (d.clientNom || '').toLowerCase().includes(recherche.toLowerCase()) || (d.numeroDocument || '').toLowerCase().includes(recherche.toLowerCase());
      const ts = d.date?.seconds ? d.date.seconds * 1000 : null;
      const okDebut = !plage.debut || (ts && ts >= plage.debut.getTime());
      const okFin = !plage.fin || (ts && ts <= plage.fin.getTime());
      return okRecherche && okDebut && okFin;
    });
  }, [docs, recherche, plage]);

  const total = filtered.reduce((s, d) => s + (d.totalGeneral || 0), 0);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Documents d'entrées</h1>
            <p className="text-gray-500 text-sm mt-1">{filtered.length} document(s)</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Total</p>
            <p className="text-lg font-bold text-green-600">{formatMontant(total)}</p>
          </div>
        </div>

        {/* Filtre par date */}
        <div className="mb-4">
          <FiltreDates onChange={setPlage} defaut="tout" />
        </div>

        {/* Barre de recherche */}
        <div className="relative mb-4 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher un fournisseur ou N° document..."
            value={recherche}
            onChange={e => setRecherche(e.target.value)}
            className="w-full pl-9 pr-8 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          {recherche && (
            <button onClick={() => setRecherche('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <>
            {/* ── Mobile cards ── */}
            <div className="sm:hidden space-y-2">
              {filtered.length === 0 ? (
                <p className="text-center text-gray-400 py-10">Aucun document</p>
              ) : filtered.map(d => (
                <div key={d.id} onClick={() => router.push(`/document/${d.id}`)}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 cursor-pointer active:bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-gray-900 truncate">{d.clientNom || '—'}</span>
                      {docIdsAvecRetour.has(d.id) && <span className="text-xs font-semibold px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded-full shrink-0">↩</span>}
                    </div>
                    <ChevronRight size={15} className="text-gray-300 shrink-0 ml-2" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-mono text-gray-400">{d.numeroDocument}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{d.nombreDeProduit} produit(s) · {formatDate(d.date)}</p>
                    </div>
                    <span className="font-bold text-green-600">{formatMontant(d.totalGeneral)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Desktop table ── */}
            <div className="hidden sm:block bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">N° Document</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Fournisseur</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Produits</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Retour</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Date</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-10 text-gray-400">Aucun document</td></tr>
                    ) : filtered.map(d => (
                      <tr key={d.id} onClick={() => router.push(`/document/${d.id}`)} className="cursor-pointer hover:bg-indigo-50/40 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{d.numeroDocument}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">{d.clientNom}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{d.nombreDeProduit}</td>
                        <td className="px-4 py-3 text-right font-semibold text-green-600">{formatMontant(d.totalGeneral)}</td>
                        <td className="px-4 py-3 text-center">
                          {docIdsAvecRetour.has(d.id) && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-600">↩ Retour</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">{formatDate(d.date)}</td>
                        <td className="px-4 py-3 text-gray-300"><ChevronRight size={15} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
