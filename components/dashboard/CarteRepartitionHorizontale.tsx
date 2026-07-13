'use client';
import { useState } from 'react';
import { ChevronDown, ChevronUp, TrendingDown, TrendingUp, ChevronRight } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatMontant } from '@/lib/format';

export interface RepartitionSortie {
  nom: string;        // nom de la boutique ou "Partenaires"
  valeur: number;
  type: 'boutique' | 'partenaires';
}

export interface RepartitionEntree {
  nom: string;        // "Importations", "Boutiques", "Partenaires"
  valeur: number;
  sousItems?: { nom: string; valeur: number }[];
}

interface Props {
  totalSorties: number;
  repartitionSorties: RepartitionSortie[];
  totalEntrees: number;
  repartitionEntrees: RepartitionEntree[];
}

const COULEURS_SORTIES = ['#8b5cf6', '#a78bfa', '#6366f1', '#3b82f6', '#60a5fa'];
const COULEURS_ENTREES = ['#10b981', '#8b5cf6', '#6366f1'];

export default function CarteRepartitionHorizontale({
  totalSorties, repartitionSorties, totalEntrees, repartitionEntrees
}: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [vue, setVue] = useState<'sorties' | 'entrees'>('sorties');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  function toggleExpand(nom: string) {
    setExpandedItems(prev => {
      const next = new Set(prev);
      next.has(nom) ? next.delete(nom) : next.add(nom);
      return next;
    });
  }

  const dataActif = vue === 'sorties' ? repartitionSorties : repartitionEntrees;
  const totalActif = vue === 'sorties' ? totalSorties : totalEntrees;
  const couleursActives = vue === 'sorties' ? COULEURS_SORTIES : COULEURS_ENTREES;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

      {/* En-tête cliquable */}
      <button
        onClick={() => setOuvert(!ouvert)}
        className="w-full flex items-center justify-between px-6 py-5 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="w-2.5 h-10 bg-indigo-500 rounded-full" />
          <div className="text-left">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Répartition des flux</p>
            <div className="flex items-center gap-4 mt-0.5">
              <span className="text-lg font-bold text-gray-900">
                Sorties <span className="text-indigo-600">{formatMontant(totalSorties)}</span>
              </span>
              <span className="text-gray-300">·</span>
              <span className="text-lg font-bold text-gray-900">
                Entrées <span className="text-green-600">{formatMontant(totalEntrees)}</span>
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {ouvert ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
        </div>
      </button>

      {/* Contenu déplié */}
      {ouvert && (
        <div className="border-t border-gray-100 px-6 py-5">

          {/* Toggle */}
          <div className="flex items-center gap-2 mb-5">
            <button
              onClick={() => setVue('sorties')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${vue === 'sorties' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <TrendingDown size={14} />
              Sorties
            </button>
            <button
              onClick={() => setVue('entrees')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${vue === 'entrees' ? 'bg-green-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <TrendingUp size={14} />
              Entrées
            </button>
          </div>

          {dataActif.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Aucune donnée disponible</p>
          ) : (
            <div className="flex flex-col lg:flex-row gap-6 items-center">
              {/* Camembert */}
              <div className="w-full lg:w-1/2 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={dataActif}
                      dataKey="valeur"
                      nameKey="nom"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      innerRadius={50}
                      label={({ name, percent }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {dataActif.map((_, index) => (
                        <Cell key={index} fill={couleursActives[index % couleursActives.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any) => formatMontant(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Légende détaillée */}
              <div className="w-full lg:w-1/2 space-y-3">
                {dataActif.map((item, index) => {
                  const pct = totalActif > 0 ? (item.valeur / totalActif) * 100 : 0;
                  const couleur = couleursActives[index % couleursActives.length];
                  const hasSous = ((item as any).sousItems?.length ?? 0) > 0;
                  const isExpanded = expandedItems.has(item.nom);
                  return (
                    <div key={item.nom}>
                      <div
                        className={`flex items-center justify-between mb-1 ${hasSous ? 'cursor-pointer' : ''}`}
                        onClick={() => hasSous && toggleExpand(item.nom)}
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: couleur }} />
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{item.nom}</span>
                          {hasSous && (
                            <ChevronRight size={14} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{pct.toFixed(1)}%</span>
                          <span className="text-xs text-gray-400 ml-2">{formatMontant(item.valeur)}</span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: couleur }} />
                      </div>
                      {/* Sous-items (conteneurs) */}
                      {hasSous && isExpanded && (
                        <div className="mt-2 ml-4 space-y-1.5 border-l-2 pl-3" style={{ borderColor: couleur + '40' }}>
                          {((item as any).sousItems as any[]).map((sous: any) => {
                            const sousPct = item.valeur > 0 ? (sous.valeur / item.valeur) * 100 : 0;
                            return (
                              <div key={sous.nom}>
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="text-xs text-gray-500 dark:text-gray-400">{sous.nom}</span>
                                  <div className="text-right">
                                    <span className="text-xs text-gray-500">{sousPct.toFixed(1)}%</span>
                                    <span className="text-xs text-gray-400 ml-2">{formatMontant(sous.valeur)}</span>
                                  </div>
                                </div>
                                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1">
                                  <div className="h-1 rounded-full opacity-60" style={{ width: `${sousPct}%`, backgroundColor: couleur }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
