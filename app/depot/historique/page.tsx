'use client';
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import DepotLayout from '@/components/DepotLayout';
import { formatDate } from '@/lib/format';
import { Search, X } from 'lucide-react';

interface Mouvement {
  id: string;
  produitNom: string;
  quantite: number;
  typeUnite: string;
  typeTransaction: string;
  nomClient: string;
  date: any;
}

export default function DepotHistoriquePage() {
  const { profile } = useAuth();
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);
  const [loading, setLoading] = useState(true);
  const [recherche, setRecherche] = useState('');

  useEffect(() => {
    if (!profile) return;
    async function load() {
      const snap = await getDocs(query(
        collection(db, 'mouvements'),
        where('userId', '==', profile!.adminUid),
        where('typeDocument', '==', 'Sortie'),
      ));
      const data: Mouvement[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as Mouvement));
      data.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
      setMouvements(data);
      setLoading(false);
    }
    load();
  }, [profile]);

  const filtered = useMemo(() => mouvements.filter(m => {
    return !recherche ||
      (m.produitNom || '').toLowerCase().includes(recherche.toLowerCase()) ||
      (m.nomClient || '').toLowerCase().includes(recherche.toLowerCase());
  }), [mouvements, recherche]);

  const totalQte = filtered.reduce((s, m) => s + (m.quantite || 0), 0);

  return (
    <DepotLayout>
      <div className="px-4 pt-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-500">{filtered.length} mouvement(s)</p>
          <p className="text-sm font-bold text-gray-700">{totalQte.toLocaleString('fr-FR')} unités</p>
        </div>

        {/* Recherche */}
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={recherche} onChange={e => setRecherche(e.target.value)}
            placeholder="Rechercher un produit ou client..."
            className="w-full pl-9 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
          {recherche && (
            <button onClick={() => setRecherche('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              <X size={14} />
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-12 text-sm">Aucun résultat</p>
        ) : (
          <div className="space-y-2">
            {filtered.map(m => (
              <div key={m.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-gray-900 truncate">{m.produitNom}</span>
                    {m.typeTransaction === 'Retour' && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded-full shrink-0">↩</span>
                    )}
                  </div>
                  <span className="font-bold text-gray-900 shrink-0 ml-2">
                    {m.quantite?.toLocaleString('fr-FR')}
                    <span className="text-xs font-normal text-gray-400 ml-1">{m.typeUnite}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{m.nomClient || '—'}</span>
                  <span>{formatDate(m.date)}</span>
                </div>
              </div>
            ))}

            {/* Total */}
            <div className="bg-gray-100 rounded-2xl p-4 flex justify-between items-center mt-2">
              <span className="font-bold text-gray-700">Total</span>
              <span className="font-bold text-gray-900">{totalQte.toLocaleString('fr-FR')} unités</span>
            </div>
          </div>
        )}
      </div>
    </DepotLayout>
  );
}
