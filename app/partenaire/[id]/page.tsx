'use client';
import { useEffect, useState, useMemo } from 'react';
import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { formatMontant, formatDate } from '@/lib/format';
import { ArrowLeft, Store, Users, TrendingUp, TrendingDown, ArrowUpDown, RefreshCw } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import FiltreDates, { PlageDates } from '@/components/FiltreDates';

interface Partenaire {
  id: string;
  nom: string;
  type: 'partenaire' | 'boutique';
  adresse?: string;
  numero?: string;
}

interface Mouvement {
  id: string;
  typeTransaction?: string;
  typeDocument: string;
  produitNom: string;
  nomClient?: string;
  quantite: number;
  totalLigne: number;
  prixUnitaireReel?: number;
  typeUnite?: string;
  date: any;
  motif?: string;
  numeroDocument?: string;
}

function tsOf(d: any): number {
  if (!d) return 0;
  if (d.seconds) return d.seconds * 1000;
  return new Date(d).getTime();
}

function StatCard({ label, value, sub, subColor, color }: {
  label: string; value: string; sub?: string; subColor?: string;
  color: 'green' | 'blue' | 'indigo' | 'orange';
}) {
  const styles = {
    green: { card: 'border-green-100 dark:border-green-900/40', label: 'text-green-600 dark:text-green-400', icon: 'bg-green-100 dark:bg-green-900/30' },
    blue: { card: 'border-blue-100 dark:border-blue-900/40', label: 'text-blue-600 dark:text-blue-400', icon: 'bg-blue-100 dark:bg-blue-900/30' },
    indigo: { card: 'border-indigo-100 dark:border-indigo-900/40', label: 'text-indigo-600 dark:text-indigo-400', icon: 'bg-indigo-100 dark:bg-indigo-900/30' },
    orange: { card: 'border-orange-100 dark:border-orange-900/40', label: 'text-orange-600 dark:text-orange-400', icon: 'bg-orange-100 dark:bg-orange-900/30' },
  };
  const s = styles[color];
  return (
    <div className={`bg-white dark:bg-gray-900 rounded-2xl border ${s.card} shadow-sm p-5`}>
      <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${s.label}`}>{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
      {sub && <p className={`text-xs mt-1 ${subColor || 'text-gray-400'}`}>{sub}</p>}
    </div>
  );
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  vente:         { label: 'Vente',          color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  Vente:         { label: 'Vente',          color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  Achat:         { label: 'Achat',           color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  Retour:        { label: 'Retour',          color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  Reajustement:  { label: 'Réajustement',   color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
};

export default function FichePartenairePage() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [partenaire, setPartenaire] = useState<Partenaire | null>(null);
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);
  const [loading, setLoading] = useState(true);
  const [plage, setPlage] = useState<PlageDates>({ debut: null, fin: null });

  useEffect(() => {
    if (!user || !id) return;
    async function load() {
      const [partDoc, mouvSnap] = await Promise.all([
        getDoc(doc(db, 'Partenaire', id)),
        getDocs(query(collection(db, 'mouvements'), where('userId', '==', user!.uid))),
      ]);
      if (!partDoc.exists()) { router.push('/partenaire'); return; }
      const p = { id: partDoc.id, ...partDoc.data() } as Partenaire;
      setPartenaire(p);

      const nomLower = p.nom.trim().toLowerCase();
      const tous: Mouvement[] = mouvSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Mouvement))
        .filter(m => (m.nomClient as any || '').trim().toLowerCase() === nomLower);
      tous.sort((a, b) => tsOf(b.date) - tsOf(a.date));
      setMouvements(tous);
      setLoading(false);
    }
    load();
  }, [user, id]);

  const filtres = useMemo(() => {
    if (!plage.debut || !plage.fin) return mouvements;
    return mouvements.filter(m => {
      const ts = tsOf(m.date);
      return ts >= plage.debut!.getTime() && ts <= plage.fin!.getTime();
    });
  }, [mouvements, plage]);

  const stats = useMemo(() => {
    let ventesVal = 0, ventesQte = 0;
    let retoursSortieVal = 0;
    let achatsVal = 0, achatsQte = 0;
    let retoursEntreeVal = 0;
    let reajHausse = 0, reajBaisse = 0;

    filtres.forEach(m => {
      const val = m.totalLigne || 0;
      const qte = m.quantite || 0;
      const tt = m.typeTransaction || '';
      const td = m.typeDocument || '';
      if (tt === 'vente' || tt === 'Vente' || (td === 'Sortie' && !tt)) { ventesVal += val; ventesQte += qte; }
      else if (tt === 'Achat' || (td === 'Entrée' && !tt)) { achatsVal += val; achatsQte += qte; }
      else if (tt === 'Retour') {
        if (td === 'Entrée') retoursSortieVal += val;
        else retoursEntreeVal += val;
      } else if (tt === 'Reajustement') {
        if (td === 'Entrée') reajHausse += val;
        else reajBaisse += val;
      }
    });

    return {
      ventesVal, ventesQte, retoursSortieVal, sortiesNettes: ventesVal - retoursSortieVal,
      achatsVal, achatsQte, retoursEntreeVal, entreesNettes: achatsVal - retoursEntreeVal,
      reajHausse, reajBaisse, nbOps: filtres.length,
    };
  }, [filtres]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (!partenaire) return null;
  const isBoutique = partenaire.type === 'boutique';
  const accentColor = isBoutique ? 'text-purple-600' : 'text-indigo-600';
  const accentBg = isBoutique ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-indigo-100 dark:bg-indigo-900/30';

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">

        {/* En-tête */}
        <div className="flex items-start gap-4">
          <button onClick={() => router.push('/partenaire')}
            className="mt-1 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-full flex items-center justify-center ${accentBg}`}>
                {isBoutique
                  ? <Store size={20} className={accentColor} />
                  : <span className={`font-bold text-lg ${accentColor}`}>{partenaire.nom.charAt(0).toUpperCase()}</span>}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{partenaire.nom}</h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isBoutique ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400'}`}>
                    {isBoutique ? 'Boutique' : 'Partenaire'}
                  </span>
                  {partenaire.adresse && <span className="text-xs text-gray-400">{partenaire.adresse}</span>}
                  {partenaire.numero && <span className="text-xs text-gray-400">· {partenaire.numero}</span>}
                </div>
              </div>
            </div>
          </div>
          <div className="text-right text-xs text-gray-400 mt-1">
            <p>{stats.nbOps} opération{stats.nbOps !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {/* Filtre dates */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
          <FiltreDates onChange={setPlage} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">

          {/* Sorties */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-blue-100 dark:border-blue-900/40 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <TrendingDown size={15} className="text-blue-600" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">Sorties</p>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatMontant(stats.sortiesNettes)}</p>
            <p className="text-xs text-gray-400 mt-1">{stats.ventesQte.toLocaleString('fr-FR')} unités</p>
            {stats.retoursSortieVal > 0 && (
              <p className="text-xs text-red-500 mt-1">
                <span className="font-semibold">Retours : </span>−{formatMontant(stats.retoursSortieVal)}
              </p>
            )}
          </div>

          {/* Entrées */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-green-100 dark:border-green-900/40 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                <TrendingUp size={15} className="text-green-600" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">Entrées</p>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatMontant(stats.entreesNettes)}</p>
            <p className="text-xs text-gray-400 mt-1">{stats.achatsQte.toLocaleString('fr-FR')} unités</p>
            {stats.retoursEntreeVal > 0 && (
              <p className="text-xs text-red-500 mt-1">
                <span className="font-semibold">Retours : </span>−{formatMontant(stats.retoursEntreeVal)}
              </p>
            )}
          </div>

          {/* Réajustements */}
          {(stats.reajHausse > 0 || stats.reajBaisse > 0) && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-orange-100 dark:border-orange-900/40 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
                  <ArrowUpDown size={15} className="text-orange-600" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400">Réajustements</p>
              </div>
              {stats.reajHausse > 0 && <p className="text-sm font-semibold text-green-600">↑ {formatMontant(stats.reajHausse)}</p>}
              {stats.reajBaisse > 0 && <p className="text-sm font-semibold text-red-500">↓ {formatMontant(stats.reajBaisse)}</p>}
            </div>
          )}

          {/* Solde net */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center">
                <RefreshCw size={15} className="text-indigo-600" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Solde net</p>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {formatMontant(stats.sortiesNettes - stats.entreesNettes)}
            </p>
            <p className="text-xs text-gray-400 mt-1">Sorties − Entrées</p>
          </div>
        </div>

        {/* Historique */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Historique des opérations
              {filtres.length > 0 && <span className="text-gray-400 font-normal ml-2">({filtres.length})</span>}
            </h2>
          </div>

          {filtres.length === 0 ? (
            <p className="text-center text-gray-400 py-12 text-sm">Aucune opération</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Produit</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Qté</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {filtres.map(m => {
                    const tt = m.typeTransaction || (m.typeDocument === 'Sortie' ? 'Vente' : 'Achat');
                    const badge = TYPE_LABELS[tt] || { label: tt, color: 'bg-gray-100 text-gray-600' };
                    const isRetour = tt === 'Retour';
                    const isReaj = tt === 'Reajustement';
                    return (
                      <tr key={m.id} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${isRetour ? 'opacity-80' : ''}`}>
                        <td className="px-6 py-3.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {formatDate(m.date)}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badge.color}`}>
                            {badge.label}
                            {isReaj && m.motif && ` · ${m.motif}`}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-gray-900 dark:text-gray-100 font-medium max-w-[200px] truncate">
                          {m.produitNom}
                        </td>
                        <td className="px-4 py-3.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {m.quantite?.toLocaleString('fr-FR')} {m.typeUnite || ''}
                        </td>
                        <td className="px-6 py-3.5 text-right font-semibold whitespace-nowrap">
                          <span className={
                            (tt === 'vente' || tt === 'Vente') ? 'text-blue-600' :
                            tt === 'Achat' ? 'text-green-600' :
                            tt === 'Retour' ? 'text-red-500' : 'text-orange-600'
                          }>
                            {isRetour ? '−' : ''}{formatMontant(m.totalLigne || 0)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
