'use client';
import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { formatMontant } from '@/lib/format';
import { Search, PlusCircle, ChevronRight, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Produit {
  id: string;
  designation: string;
  prix_unitaire: number;
  quantite_unitaire_total: number;
  quantite_par_emballage: number;
  valeur: number;
}

export default function InventairePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [produits, setProduits] = useState<Produit[]>([]);
  const [search, setSearch] = useState('');
  const [filtre, setFiltre] = useState<'tout' | 'disponible' | 'termine'>('tout');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const snap = await getDocs(query(collection(db, 'Produits'), where('userId', '==', user!.uid)));
      const data: Produit[] = snap.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          designation: d.designation || '',
          prix_unitaire: d.prix_unitaire || 0,
          quantite_unitaire_total: d.quantite_unitaire_total || 0,
          quantite_par_emballage: d.quantite_par_emballage || 1,
          valeur: (d.prix_unitaire || 0) * (d.quantite_unitaire_total || 0),
        };
      });
      data.sort((a, b) => a.designation.localeCompare(b.designation));
      setProduits(data);
      setLoading(false);
    }
    load();
  }, [user]);

  const filtered = produits.filter(p => {
    const matchSearch = p.designation.toLowerCase().includes(search.toLowerCase());
    if (filtre === 'disponible') return matchSearch && p.quantite_unitaire_total > 0;
    if (filtre === 'termine') return matchSearch && p.quantite_unitaire_total === 0;
    return matchSearch;
  });

  const totalValeur = filtered.reduce((s, p) => s + p.valeur, 0);
  const totalQte = filtered.reduce((s, p) => s + p.quantite_unitaire_total, 0);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Inventaire</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {filtered.length} produit{filtered.length > 1 ? 's' : ''}
              {filtre === 'disponible' && ' disponibles'}
              {filtre === 'termine' && ' terminés'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right hidden sm:block">
              <p className="text-xs text-gray-500">Valeur totale</p>
              <p className="text-xl font-bold text-indigo-600">{formatMontant(totalValeur)}</p>
            </div>
            <button onClick={() => router.push('/reajustement')}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium transition-colors">
              <SlidersHorizontal size={15} />
              <span className="hidden sm:inline">Réajustement</span>
            </button>
            <Link href="/nouveau-produit"
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors">
              <PlusCircle size={15} />
              <span className="hidden sm:inline">Nouveau produit</span>
              <span className="sm:hidden">Nouveau</span>
            </Link>
          </div>
        </div>

        {/* Filtres */}
        <div className="flex items-center gap-2 mb-4">
          {([
            { key: 'tout', label: 'Tout' },
            { key: 'disponible', label: 'Disponible' },
            { key: 'termine', label: 'Terminé' },
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => setFiltre(f.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${filtre === f.key
                  ? f.key === 'termine' ? 'bg-red-500 text-white' : 'bg-indigo-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un produit..."
            className="w-full pl-9 pr-10 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 bg-gray-300 hover:bg-gray-400 rounded-full flex items-center justify-center transition-colors"
            >
              <span className="text-white text-xs font-bold leading-none">✕</span>
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* ── Mobile cards ── */}
            <div className="sm:hidden space-y-2">
              {filtered.length === 0 ? (
                <p className="text-center text-gray-400 py-10">Aucun produit</p>
              ) : filtered.map(p => (
                <div key={p.id} onClick={() => router.push(`/produit/${p.id}`)}
                  className={`bg-white rounded-xl border border-gray-100 shadow-sm p-4 cursor-pointer active:bg-gray-50 ${p.quantite_unitaire_total === 0 ? 'border-red-100' : ''}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-gray-900 truncate">{p.designation}</span>
                      {p.quantite_unitaire_total === 0 && (
                        <span className="text-xs font-semibold px-1.5 py-0.5 bg-red-100 text-red-500 rounded-full shrink-0">Terminé</span>
                      )}
                    </div>
                    <ChevronRight size={15} className="text-gray-300 shrink-0 ml-2" />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="space-y-0.5">
                      <p className="text-xs text-gray-400">{p.quantite_unitaire_total.toLocaleString('fr-FR')} u · {(p.quantite_unitaire_total / p.quantite_par_emballage).toFixed(1)} ctn</p>
                      <p className="text-xs text-gray-400">{p.prix_unitaire.toLocaleString('fr-FR')} FCFA/u</p>
                    </div>
                    <span className="font-bold text-indigo-600">{formatMontant(p.valeur)}</span>
                  </div>
                </div>
              ))}
              <div className="bg-indigo-50 rounded-xl border border-indigo-100 p-4 flex justify-between items-center">
                <span className="font-bold text-gray-700">{totalQte.toLocaleString('fr-FR')} unités</span>
                <span className="font-bold text-indigo-600">{formatMontant(totalValeur)}</span>
              </div>
            </div>

            {/* ── Desktop table ── */}
            <div className="hidden sm:block bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Désignation</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Prix unitaire</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Qté unités</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Qté cartons</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Valeur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(p => (
                    <tr key={p.id} onClick={() => router.push(`/produit/${p.id}`)}
                      className={`cursor-pointer hover:bg-indigo-50/40 transition-colors ${p.quantite_unitaire_total === 0 ? 'bg-red-50/40' : ''}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          {p.designation}
                          {p.quantite_unitaire_total === 0 && (
                            <span className="text-xs font-semibold px-2 py-0.5 bg-red-100 text-red-500 rounded-full">Terminé</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{p.prix_unitaire.toLocaleString('fr-FR')}</td>
                      <td className={`px-4 py-3 text-right font-medium ${p.quantite_unitaire_total === 0 ? 'text-red-500' : 'text-gray-900'}`}>{p.quantite_unitaire_total.toLocaleString('fr-FR')}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{(p.quantite_unitaire_total / p.quantite_par_emballage).toFixed(1)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-indigo-600">{formatMontant(p.valeur)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td className="px-4 py-3 font-bold text-gray-900">Total</td>
                    <td />
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{totalQte.toLocaleString('fr-FR')}</td>
                    <td />
                    <td className="px-4 py-3 text-right font-bold text-indigo-600">{formatMontant(totalValeur)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
