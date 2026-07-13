'use client';
import { useEffect, useState, useMemo, useRef } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { formatMontant, formatDate } from '@/lib/format';
import { SlidersHorizontal, X, Search } from 'lucide-react';
import FiltreDates, { PlageDates } from '@/components/FiltreDates';

interface Mouvement {
  id: string;
  produitNom: string;
  quantite: number;
  prixUnitaireReel: number;
  totalLigne: number;
  nomClient: string;
  date: any;
  typeUnite?: string;
  typeTransaction?: string;
}

export default function HistoriqueEntreesPage() {
  const { user } = useAuth();
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);
  const [loading, setLoading] = useState(true);
  const [plage, setPlage] = useState<PlageDates>({ debut: null, fin: null });
  const [rechercheProduit, setRechercheProduit] = useState('');
  const [filtrePersonne, setFiltrePersonne] = useState('');
  const [recherchePanel, setRecherchePanel] = useState('');
  const [showPanel, setShowPanel] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const snap = await getDocs(query(
        collection(db, 'mouvements'),
        where('userId', '==', user!.uid),
        where('typeDocument', '==', 'Entrée')
      ));
      const data: Mouvement[] = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Mouvement));
      data.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
      setMouvements(data);
      setLoading(false);
    }
    load();
  }, [user]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPanel(false);
        setRecherchePanel('');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toutesPersonnes = useMemo(() => [...new Set(mouvements.map(m => m.nomClient).filter(Boolean))].sort(), [mouvements]);

  const personnesFiltrees = useMemo(() =>
    recherchePanel ? toutesPersonnes.filter(p => p.toLowerCase().includes(recherchePanel.toLowerCase())) : toutesPersonnes,
    [toutesPersonnes, recherchePanel]
  );

  const filtered = useMemo(() => mouvements.filter(m => {
    const okProduit = !rechercheProduit || (m.produitNom || '').toLowerCase().includes(rechercheProduit.toLowerCase());
    const okPersonne = !filtrePersonne || m.nomClient === filtrePersonne;
    const ts = m.date?.seconds ? m.date.seconds * 1000 : null;
    const okDebut = !plage.debut || (ts && ts >= plage.debut.getTime());
    const okFin = !plage.fin || (ts && ts <= plage.fin.getTime());
    return okProduit && okPersonne && okDebut && okFin;
  }), [mouvements, rechercheProduit, filtrePersonne, plage]);

  const totalFiltre = filtered.reduce((s, m) => s + (m.totalLigne || 0), 0);
  const totalGeneral = mouvements.reduce((s, m) => s + (m.totalLigne || 0), 0);
  const filtrePanelActif = !!filtrePersonne;
  const filtreActif = !!(rechercheProduit || filtrePersonne);

  function clearFiltrePersonne() {
    setFiltrePersonne('');
    setRecherchePanel('');
    setShowPanel(false);
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Historique des entrées</h1>
            <p className="text-gray-500 text-sm mt-1">
              {filtered.length} mouvement(s)
              {filtreActif && <span className="ml-2 text-green-600 font-medium">· {formatMontant(totalFiltre)}</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Total général</p>
            <p className="text-lg font-bold text-green-600">{formatMontant(totalGeneral)}</p>
          </div>
        </div>

        {/* Filtre par date */}
        <div className="mb-4">
          <FiltreDates onChange={setPlage} defaut="tout" />
        </div>

        {/* Recherche produit + filtre fournisseur */}
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Rechercher un produit..."
              value={rechercheProduit}
              onChange={e => setRechercheProduit(e.target.value)}
              className="w-full pl-9 pr-8 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            {rechercheProduit && (
              <button onClick={() => setRechercheProduit('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="relative" ref={panelRef}>
            <button
              onClick={() => setShowPanel(!showPanel)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors
                ${filtrePanelActif ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
            >
              <SlidersHorizontal size={15} />
              Fournisseur
              {filtrePanelActif && (
                <span className="bg-white text-indigo-600 text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">1</span>
              )}
            </button>

            {showPanel && (
              <div className="absolute top-full right-0 mt-2 bg-white rounded-xl border border-gray-200 shadow-lg z-20 w-72 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Fournisseur</p>
                  {filtrePersonne && (
                    <button onClick={clearFiltrePersonne} className="text-xs text-red-500 hover:underline">Effacer</button>
                  )}
                </div>
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Chercher..."
                    value={recherchePanel}
                    onChange={e => setRecherchePanel(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {personnesFiltrees.length === 0 ? (
                    <p className="text-center text-gray-400 text-sm py-4">Aucun résultat</p>
                  ) : personnesFiltrees.map(p => (
                    <button key={p} onClick={() => { setFiltrePersonne(filtrePersonne === p ? '' : p); setRecherchePanel(''); setShowPanel(false); }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
                        ${filtrePersonne === p ? 'bg-green-600 text-white' : 'hover:bg-gray-100 text-gray-700'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {filtreActif && (
            <button onClick={() => { setRechercheProduit(''); setFiltrePersonne(''); setRecherchePanel(''); }}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-red-500 transition-colors">
              <X size={14} /> Tout effacer
            </button>
          )}
        </div>

        {filtrePersonne && (
          <div className="flex items-center gap-2 mb-3">
            <span className="flex items-center gap-1.5 bg-green-50 text-green-700 text-xs font-medium px-3 py-1.5 rounded-full border border-green-200">
              {filtrePersonne}
              <button onClick={clearFiltrePersonne}><X size={12} /></button>
            </span>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <>
            {/* ── Mobile cards ── */}
            <div className="sm:hidden space-y-2">
              {filtered.length === 0 ? (
                <p className="text-center text-gray-400 py-10">Aucun résultat</p>
              ) : filtered.map(m => (
                <div key={m.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-gray-900 truncate">{m.produitNom}</span>
                      {m.typeTransaction === 'Retour' && <span className="text-xs font-semibold px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded-full shrink-0">↩</span>}
                    </div>
                    <span className="font-bold text-green-600 shrink-0 ml-2">{formatMontant(m.totalLigne)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{m.nomClient || '—'} · {m.quantite?.toLocaleString('fr-FR')} {m.typeUnite}</span>
                    <span>{formatDate(m.date)}</span>
                  </div>
                </div>
              ))}
              {filtered.length > 0 && (
                <div className="bg-green-50 rounded-xl border border-green-100 p-4 flex justify-between items-center">
                  <span className="font-bold text-gray-700">Sous-total</span>
                  <span className="font-bold text-green-600">{formatMontant(totalFiltre)}</span>
                </div>
              )}
            </div>

            {/* ── Desktop table ── */}
            <div className="hidden sm:block bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Produit</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Fournisseur</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Quantité</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Prix unitaire</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-10 text-gray-400">Aucun résultat</td></tr>
                    ) : filtered.map(m => (
                      <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">
                          <div className="flex items-center gap-2">
                            {m.produitNom}
                            {m.typeTransaction === 'Retour' && <span className="text-xs font-semibold px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded-full shrink-0">↩ Retour</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{m.nomClient || '—'}</td>
                        <td className="px-4 py-3 text-right text-gray-900">{m.quantite?.toLocaleString('fr-FR')} <span className="text-xs text-gray-400">{m.typeUnite}</span></td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {m.quantite ? Math.round(m.totalLigne / m.quantite).toLocaleString('fr-FR') : '—'}
                          <span className="text-xs text-gray-400 ml-1">/{m.typeUnite === 'C' ? 'ctn' : 'u'}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-green-600">{formatMontant(m.totalLigne)}</td>
                        <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">{formatDate(m.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {filtered.length > 0 && (
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr>
                        <td colSpan={4} className="px-4 py-3 font-bold text-gray-700">Sous-total</td>
                        <td className="px-4 py-3 text-right font-bold text-green-600">{formatMontant(totalFiltre)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
