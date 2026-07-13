'use client';
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import FacturierLayout from '@/components/FacturierLayout';
import { formatMontant, formatDate } from '@/lib/format';
import { History, Search, X } from 'lucide-react';

interface Mouvement {
  id: string;
  produitNom: string;
  nomClient: string;
  quantite: number;
  typeUnite: string;
  totalLigne: number;
  date: any;
}

export default function FacturierHistoriquePage() {
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
      const data: Mouvement[] = snap.docs.map(d => ({
        id: d.id,
        produitNom: d.data().produitNom || '',
        nomClient: d.data().nomClient || '',
        quantite: d.data().quantite || 0,
        typeUnite: d.data().typeUnite || 'U',
        totalLigne: d.data().totalLigne || 0,
        date: d.data().date,
      }));
      data.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
      setMouvements(data);
      setLoading(false);
    }
    load();
  }, [profile]);

  const filtered = useMemo(() => {
    if (!recherche) return mouvements;
    const q = recherche.toLowerCase();
    return mouvements.filter(m =>
      m.produitNom.toLowerCase().includes(q) ||
      m.nomClient.toLowerCase().includes(q),
    );
  }, [mouvements, recherche]);

  return (
    <FacturierLayout>
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-gray-900 text-lg">Historique sorties</p>
          <p className="text-xs text-gray-400">{filtered.length} ligne(s)</p>
        </div>

        <div className="relative mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={recherche} onChange={e => setRecherche(e.target.value)}
            placeholder="Produit ou client..."
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
          <div className="text-center py-16 text-gray-400">
            <History size={40} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">Aucun mouvement</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(m => (
              <div key={m.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-gray-900 truncate flex-1">{m.produitNom}</p>
                  <span className="font-bold text-blue-600 shrink-0 ml-2">{formatMontant(m.totalLigne)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{m.nomClient || '—'}</span>
                  <span>{m.quantite} {m.typeUnite === 'C' ? 'ctn' : 'u'} · {formatDate(m.date)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </FacturierLayout>
  );
}
