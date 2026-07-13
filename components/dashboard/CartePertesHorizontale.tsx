'use client';
import { useState } from 'react';
import { ChevronDown, ChevronUp, LayoutList, PieChart as PieIcon, ArrowRight } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatMontant } from '@/lib/format';
import Link from 'next/link';

interface ProduitPerte {
  nom: string;
  valeur: number;
  quantite: number;
}

interface CategoriePerte {
  categorie: string;
  valeur: number;
}

interface Props {
  totalPertes: number;
  topProduits: ProduitPerte[];
  parCategorie: CategoriePerte[];
  totalProduits: number;
}

const COULEURS = ['#6366f1', '#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

export default function CartePertesHorizontale({ totalPertes, topProduits, parCategorie, totalProduits }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [vue, setVue] = useState<'produits' | 'categories'>('produits');

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

      {/* En-tête cliquable */}
      <button
        onClick={() => setOuvert(!ouvert)}
        className="w-full flex items-center justify-between px-6 py-5 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="w-2.5 h-10 bg-red-500 rounded-full" />
          <div className="text-left">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pertes de stock</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{formatMontant(totalPertes)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {totalPertes === 0 && (
            <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">Aucune perte</span>
          )}
          {ouvert ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
        </div>
      </button>

      {/* Contenu déplié */}
      {ouvert && (
        <div className="border-t border-gray-100 px-6 py-5">

          {/* Toggle */}
          <div className="flex items-center gap-2 mb-5">
            <button
              onClick={() => setVue('produits')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${vue === 'produits' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <LayoutList size={14} />
              Par produit
            </button>
            <button
              onClick={() => setVue('categories')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${vue === 'categories' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <PieIcon size={14} />
              Par catégorie
            </button>
          </div>

          {/* Vue par produit */}
          {vue === 'produits' && (
            <div>
              {topProduits.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">Aucune perte enregistrée</p>
              ) : (
                <>
                  <div className="space-y-2">
                    {topProduits.map((p, i) => (
                      <div key={p.nom} className="flex items-center gap-3 py-2">
                        <span className="text-xs font-bold text-gray-300 w-5 text-center">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-900 truncate">{p.nom}</span>
                            <span className="text-sm font-bold text-red-600 ml-2">{formatMontant(p.valeur)}</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div
                              className="bg-red-400 h-1.5 rounded-full"
                              style={{ width: totalPertes > 0 ? `${(p.valeur / totalPertes) * 100}%` : '0%' }}
                            />
                          </div>
                        </div>
                        <span className="text-xs text-gray-400 w-16 text-right">{p.quantite.toLocaleString('fr-FR')} u</span>
                      </div>
                    ))}
                  </div>

                  {totalProduits > 10 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <Link
                        href="/pertes"
                        className="flex items-center justify-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        Voir tous les {totalProduits} produits
                        <ArrowRight size={14} />
                      </Link>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Vue par catégorie */}
          {vue === 'categories' && (
            <div>
              {parCategorie.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">Aucune perte enregistrée</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={parCategorie}
                        dataKey="valeur"
                        nameKey="categorie"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        innerRadius={50}
                      >
                        {parCategorie.map((_, index) => (
                          <Cell key={index} fill={COULEURS[index % COULEURS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => formatMontant(value)}
                        labelStyle={{ fontWeight: 600 }}
                      />
                      <Legend
                        formatter={(value) => <span className="text-xs text-gray-600">{value}</span>}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
