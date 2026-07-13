'use client';
import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { formatMontant, formatDate } from '@/lib/format';
import { Search, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface Perte {
  id: string;
  produitNom: string;
  quantite: number;
  totalLigne: number;
  categorie: string;
  date: any;
}

export default function PertesPage() {
  const { user } = useAuth();
  const [pertes, setPertes] = useState<Perte[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const snap = await getDocs(query(
        collection(db, 'mouvements'),
        where('userId', '==', user!.uid),
        where('typeDocument', '==', 'Perte')
      ));
      const data: Perte[] = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Perte));
      data.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
      setPertes(data);
      setLoading(false);
    }
    load();
  }, [user]);

  const filtered = pertes.filter(p =>
    p.produitNom?.toLowerCase().includes(search.toLowerCase()) ||
    p.categorie?.toLowerCase().includes(search.toLowerCase())
  );

  const total = filtered.reduce((s, p) => s + (p.totalLigne || 0), 0);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center gap-4">
          <Link href="/dashboard" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={18} className="text-gray-500" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">Pertes de stock</h1>
            <p className="text-gray-500 text-sm mt-1">{pertes.length} pertes enregistrées</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Total pertes</p>
            <p className="text-xl font-bold text-red-600">{formatMontant(total)}</p>
          </div>
        </div>

        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher par produit ou catégorie..."
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Produit</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Catégorie</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Quantité</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Valeur</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-10 text-gray-400">Aucune perte enregistrée</td></tr>
                ) : filtered.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{p.produitNom}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 bg-red-50 text-red-600 rounded-full text-xs font-medium">
                        {p.categorie || 'Non classé'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{p.quantite?.toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">{formatMontant(p.totalLigne)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{formatDate(p.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
