'use client';
import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { formatMontant } from '@/lib/format';
import { Package, TrendingUp, TrendingDown } from 'lucide-react';

export default function DashboardStockPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalProduits: 0, valeurStock: 0, totalEntreeQte: 0, totalSortieQte: 0 });
  const [topProduits, setTopProduits] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const snap = await getDocs(query(collection(db, 'Produits'), where('userId', '==', user!.uid)));
      let valeurStock = 0;
      const prods: any[] = [];
      snap.forEach(doc => {
        const d = doc.data();
        const valeur = (d.prix_unitaire || 0) * (d.quantite_unitaire_total || 0);
        valeurStock += valeur;
        prods.push({ id: doc.id, designation: d.designation, quantite: d.quantite_unitaire_total || 0, valeur });
      });
      prods.sort((a, b) => b.valeur - a.valeur);
      setTopProduits(prods.slice(0, 10));

      const mouv = await getDocs(query(collection(db, 'mouvements'), where('userId', '==', user!.uid)));
      let totalEntreeQte = 0, totalSortieQte = 0;
      mouv.forEach(doc => {
        const d = doc.data();
        if (d.typeDocument === 'Entrée') totalEntreeQte += d.quantite || 0;
        else if (d.typeDocument === 'Sortie') totalSortieQte += d.quantite || 0;
      });

      setStats({ totalProduits: snap.size, valeurStock, totalEntreeQte, totalSortieQte });
      setLoading(false);
    }
    load();
  }, [user]);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard Stock</h1>
          <p className="text-gray-500 text-sm mt-1">Vue d'ensemble de ton stock</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Produits', value: stats.totalProduits.toString(), icon: Package, color: 'bg-indigo-500' },
                { label: 'Valeur stock', value: formatMontant(stats.valeurStock), icon: Package, color: 'bg-purple-500' },
                { label: 'Qté entrées', value: stats.totalEntreeQte.toLocaleString('fr-FR'), icon: TrendingUp, color: 'bg-green-500' },
                { label: 'Qté sorties', value: stats.totalSortieQte.toLocaleString('fr-FR'), icon: TrendingDown, color: 'bg-blue-500' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <div className={`w-10 h-10 ${color} rounded-lg flex items-center justify-center mb-3`}>
                    <Icon size={20} className="text-white" />
                  </div>
                  <p className="text-xs text-gray-500 font-medium">{label}</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{value}</p>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Top 10 produits par valeur</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">#</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Produit</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Quantité</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Valeur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {topProduits.map((p, i) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-400 font-medium">{i + 1}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{p.designation}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{p.quantite.toLocaleString('fr-FR')}</td>
                      <td className="px-4 py-3 text-right font-semibold text-indigo-600">{formatMontant(p.valeur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
