'use client';
import { useState } from 'react';
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatMontant } from '@/lib/format';

export interface ReajProduit { nom: string; valeur: number; quantite: number; }
export interface ReajMotif { motif: string; valeur: number; cartons: number; }

interface Props {
  reajHausse: number;
  reajBaisse: number;
  hausse: { produits: ReajProduit[]; parMotif: ReajMotif[] };
  baisse: { produits: ReajProduit[]; parMotif: ReajMotif[] };
}

const COULEURS_HAUSSE = ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5'];
const COULEURS_BAISSE = ['#ef4444', '#f87171', '#fca5a5', '#fecaca', '#fee2e2'];

export default function CarteReajustementHorizontale({ reajHausse, reajBaisse, hausse, baisse }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [sens, setSens] = useState<'hausse' | 'baisse'>('baisse');
  const [vue, setVue] = useState<'produits' | 'motifs'>('produits');

  const data = sens === 'hausse' ? hausse : baisse;
  const total = sens === 'hausse' ? reajHausse : reajBaisse;
  const couleurs = sens === 'hausse' ? COULEURS_HAUSSE : COULEURS_BAISSE;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">

      <button
        onClick={() => setOuvert(!ouvert)}
        className="w-full flex items-center justify-between px-6 py-5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="w-2.5 h-10 bg-orange-400 rounded-full" />
          <div className="text-left">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Réajustements</p>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-sm font-semibold text-green-600">+{formatMontant(reajHausse)}</span>
              <span className="text-gray-300">·</span>
              <span className="text-sm font-semibold text-red-500">−{formatMontant(reajBaisse)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {reajHausse === 0 && reajBaisse === 0 && (
            <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">Aucun réajustement</span>
          )}
          {ouvert ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
        </div>
      </button>

      {ouvert && (
        <div className="border-t border-gray-100 dark:border-gray-700 px-6 py-5">

          {/* Toggle hausse/baisse */}
          <div className="flex items-center gap-2 mb-4">
            <button onClick={() => setSens('hausse')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${sens === 'hausse' ? 'bg-green-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
              <TrendingUp size={13} /> Hausse ({formatMontant(reajHausse)})
            </button>
            <button onClick={() => setSens('baisse')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${sens === 'baisse' ? 'bg-red-500 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
              <TrendingDown size={13} /> Baisse ({formatMontant(reajBaisse)})
            </button>
          </div>

          {/* Toggle produits/motifs */}
          <div className="flex items-center gap-2 mb-5">
            {(['produits', 'motifs'] as const).map(v => (
              <button key={v} onClick={() => setVue(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                  ${vue === v ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                {v === 'produits' ? 'Par produit' : 'Par motif'}
              </button>
            ))}
          </div>

          {/* Vue produits */}
          {vue === 'produits' && (
            data.produits.length === 0
              ? <p className="text-sm text-gray-400 text-center py-6">Aucun réajustement</p>
              : <div className="space-y-2">
                  {data.produits.slice(0, 10).map((p, i) => (
                    <div key={p.nom + i} className="flex items-center gap-3 py-1.5">
                      <span className="text-xs font-bold text-gray-300 w-5 text-center">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.nom}</span>
                          <span className={`text-sm font-bold ml-2 ${sens === 'hausse' ? 'text-green-600' : 'text-red-500'}`}>
                            {formatMontant(p.valeur)}
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${sens === 'hausse' ? 'bg-green-400' : 'bg-red-400'}`}
                            style={{ width: total > 0 ? `${(p.valeur / total) * 100}%` : '0%' }}
                          />
                        </div>
                      </div>
                      <span className="text-xs text-gray-400 w-16 text-right">{p.quantite.toLocaleString('fr-FR')} u</span>
                    </div>
                  ))}
                </div>
          )}

          {/* Vue motifs (camembert) */}
          {vue === 'motifs' && (
            data.parMotif.length === 0
              ? <p className="text-sm text-gray-400 text-center py-6">Aucun réajustement</p>
              : <div>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.parMotif}
                          dataKey="valeur"
                          nameKey="motif"
                          cx="50%" cy="50%"
                          outerRadius={90}
                          innerRadius={50}
                          label={({ cx, cy, midAngle, innerRadius, outerRadius, index }) => {
                            const RADIAN = Math.PI / 180;
                            const r = innerRadius + (outerRadius - innerRadius) * 1.35;
                            const x = cx + r * Math.cos(-midAngle * RADIAN);
                            const y = cy + r * Math.sin(-midAngle * RADIAN);
                            const m = data.parMotif[index];
                            const c = Math.round(m.cartons);
                            return c > 0 ? (
                              <text x={x} y={y} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central"
                                className="fill-gray-600 dark:fill-gray-300" style={{ fontSize: 11 }}>
                                {c} ctn
                              </text>
                            ) : null;
                          }}
                          labelLine={false}
                        >
                          {data.parMotif.map((_, i) => (
                            <Cell key={i} fill={couleurs[i % couleurs.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: any) => formatMontant(v as number)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Légende personnalisée */}
                  <div className="mt-2 space-y-1.5">
                    {data.parMotif.map((m, i) => (
                      <div key={m.motif} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: couleurs[i % couleurs.length] }} />
                          <span className="text-xs text-gray-600 dark:text-gray-400 truncate">{m.motif}</span>
                        </div>
                        <span className={`text-xs font-semibold shrink-0 ${sens === 'hausse' ? 'text-green-600' : 'text-red-500'}`}>
                          {formatMontant(m.valeur)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
          )}
        </div>
      )}
    </div>
  );
}
