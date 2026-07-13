'use client';
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import FiltreDates, { PlageDates } from '@/components/FiltreDates';
import { formatMontant } from '@/lib/format';
import { Search, ChevronDown, ChevronUp, LayoutList, Users, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Mouvement {
  id: string;
  typeDocument: string;
  typeTransaction?: string;
  produitNom: string;
  nomClient?: string;
  quantite: number;
  typeUnite?: string;
  totalLigne: number;
  date: any;
}

interface LigneTop {
  nom: string;
  qteUnits: number;
  qteCartons: number;
  valeur: number;
}

function getPartenaire(m: Mouvement) {
  return m.nomClient || 'Inconnu';
}

function filtrerParDate(mouvements: Mouvement[], plage: PlageDates) {
  if (!plage.debut || !plage.fin) return mouvements; // Tout
  return mouvements.filter(m => {
    const ts = m.date?.seconds ? m.date.seconds * 1000 : m.date ? new Date(m.date).getTime() : 0;
    return ts >= plage.debut!.getTime() && ts <= plage.fin!.getTime();
  });
}

function aggreger(items: Mouvement[], keyFn: (m: Mouvement) => string, qpeMap: Record<string, number>): LigneTop[] {
  const map: Record<string, LigneTop> = {};
  items.forEach(m => {
    const k = keyFn(m);
    if (!map[k]) map[k] = { nom: k, qteUnits: 0, qteCartons: 0, valeur: 0 };
    const qte = m.quantite || 0;
    const qpe = qpeMap[m.produitNom] || 1;
    const units = m.typeUnite === 'C' ? qte * qpe : qte;
    const cartons = m.typeUnite === 'C' ? qte : qte / qpe;
    map[k].qteUnits += units;
    map[k].qteCartons += cartons;
    map[k].valeur += m.totalLigne || 0;
  });
  return Object.values(map).sort((a, b) => b.valeur - a.valeur);
}

interface CarteProps {
  titre: string;
  couleur: 'blue' | 'green';
  toggleA: string;
  toggleB: string;
  dataA: LigneTop[];
  dataB: LigneTop[];
  search: string;
  totalGlobal?: number;
}

const STYLES = {
  blue:  { bar: 'bg-blue-500',  badge: 'bg-blue-50 text-blue-600',   btn: 'bg-blue-600 text-white'  },
  green: { bar: 'bg-green-500', badge: 'bg-green-50 text-green-600', btn: 'bg-green-600 text-white' },
};

function CarteRapport({ titre, couleur, toggleA, toggleB, dataA, dataB, search }: CarteProps) {
  const [ouvert, setOuvert] = useState(true);
  const [vue, setVue] = useState<'A' | 'B'>('A');
  const s = STYLES[couleur];

  const data = vue === 'A' ? dataA : dataB;
  const filtered = search
    ? data.filter(l => l.nom.toLowerCase().includes(search.toLowerCase()))
    : data;
  const totalFiltre = filtered.reduce((acc, l) => acc + l.valeur, 0);
  const maxValeur = filtered[0]?.valeur || 1;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOuvert(!ouvert)}
        className="w-full flex items-center justify-between px-6 py-5 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className={`w-2.5 h-10 ${s.bar} rounded-full`} />
          <div className="text-left">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{titre}</p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <p className="text-2xl font-bold text-gray-900">{formatMontant(totalFiltre)}</p>
              {search && filtered.length > 0 && (
                <span className="text-xs text-gray-400">{filtered.length} résultat(s)</span>
              )}
            </div>
          </div>
        </div>
        {ouvert ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
      </button>

      {ouvert && (
        <div className="border-t border-gray-100 px-6 py-5">
          <div className="flex items-center gap-2 mb-5">
            <button
              onClick={() => setVue('A')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${vue === 'A' ? s.btn : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <LayoutList size={14} />
              {toggleA}
            </button>
            <button
              onClick={() => setVue('B')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${vue === 'B' ? s.btn : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <Users size={14} />
              {toggleB}
            </button>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              {search ? 'Aucun résultat pour cette recherche' : 'Aucune donnée'}
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((l, i) => (
                <div key={l.nom} className="flex items-center gap-3 py-2">
                  <span className="text-xs font-bold text-gray-300 w-5 text-center shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900 truncate">{l.nom}</span>
                      <div className="flex items-center gap-3 ml-2 shrink-0">
                        <span className="text-xs text-gray-400">
                          {Math.round(l.qteUnits).toLocaleString('fr-FR')} u
                          <span className="text-gray-300 ml-1">({Math.round(l.qteCartons)} ctn)</span>
                        </span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.badge}`}>
                          {formatMontant(l.valeur)}
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className={`${s.bar} h-1.5 rounded-full transition-all`}
                        style={{ width: `${(l.valeur / maxValeur) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RapportPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);
  const [qpeMap, setQpeMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [plage, setPlage] = useState<PlageDates>({ debut: null, fin: null });

  useEffect(() => {
    if (!user) return;
    async function load() {
      const [mouvSnap, prodSnap] = await Promise.all([
        getDocs(query(collection(db, 'mouvements'), where('userId', '==', user!.uid))),
        getDocs(query(collection(db, 'Produits'), where('userId', '==', user!.uid))),
      ]);
      const map: Record<string, number> = {};
      prodSnap.forEach(doc => {
        const d = doc.data();
        if (d.designation) map[d.designation] = d.quantite_par_emballage || 1;
      });
      setQpeMap(map);
      setMouvements(mouvSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Mouvement)));
      setLoading(false);
    }
    load();
  }, [user]);

  const filtres = useMemo(() => filtrerParDate(mouvements, plage), [mouvements, plage]);
  const sorties = useMemo(() => filtres.filter(m => m.typeDocument === 'Sortie'), [filtres]);
  const entrees = useMemo(() => filtres.filter(m => m.typeDocument === 'Entrée'), [filtres]);

  const topProduitsSortants = useMemo(() => aggreger(sorties, m => m.produitNom || 'Inconnu', qpeMap), [sorties, qpeMap]);
  const topClients        = useMemo(() => aggreger(sorties, getPartenaire, qpeMap), [sorties, qpeMap]);
  const topProduitsEntrants = useMemo(() => aggreger(entrees, m => m.produitNom || 'Inconnu', qpeMap), [entrees, qpeMap]);
  const topFournisseurs   = useMemo(() => aggreger(entrees, getPartenaire, qpeMap), [entrees, qpeMap]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* En-tête sans sidebar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-900">Rapport</h1>
            <p className="text-xs text-gray-400">Analyse détaillée de tes flux</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-5">

        {/* Filtres dates */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <FiltreDates onChange={setPlage} defaut="tout" />
        </div>

        {/* Barre de recherche */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un produit, client ou fournisseur..."
            className="w-full pl-9 pr-10 py-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
          <div className="space-y-4">
            <CarteRapport
              titre="Sorties"
              couleur="blue"
              toggleA="Par produit"
              toggleB="Par client"
              dataA={topProduitsSortants}
              dataB={topClients}
              search={search}
            />
            <CarteRapport
              titre="Entrées"
              couleur="green"
              toggleA="Par produit"
              toggleB="Par fournisseur"
              dataA={topProduitsEntrants}
              dataB={topFournisseurs}
              search={search}
            />
          </div>
        )}
      </main>
    </div>
  );
}
