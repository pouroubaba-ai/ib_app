'use client';
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { formatMontant } from '@/lib/format';
import { Search, Store, Users, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

type TypePartenaire = 'partenaire' | 'boutique';
type Filtre = 'tout' | 'partenaire' | 'boutique';

interface Partenaire {
  id: string;
  nom: string;
  type: TypePartenaire;
  adresse?: string;
  numero?: string;
}

interface StatPartenaire {
  totalVentes: number;
  totalEntrees: number;
  totalQuantite: number;
  nbOperations: number;
}

export default function PartenairePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [partenaires, setPartenaires] = useState<Partenaire[]>([]);
  const [stats, setStats] = useState<Record<string, StatPartenaire>>({});
  const [search, setSearch] = useState('');
  const [filtre, setFiltre] = useState<Filtre>('tout');
  const [loading, setLoading] = useState(true);

  /* ── Modal ajout ── */
  const [showModal, setShowModal] = useState(false);
  const [nom, setNom] = useState('');
  const [type, setType] = useState<TypePartenaire>('partenaire');
  const [adresse, setAdresse] = useState('');
  const [numero, setNumero] = useState('');
  const [saving, setSaving] = useState(false);
  const [erreurModal, setErreurModal] = useState('');

  function ouvrirModal() {
    setNom(''); setType('partenaire'); setAdresse(''); setNumero(''); setErreurModal('');
    setShowModal(true);
  }

  async function sauvegarder() {
    if (!nom.trim()) { setErreurModal('Le nom est requis.'); return; }
    if (!user) return;
    const doublon = partenaires.find(p => p.nom.trim().toLowerCase() === nom.trim().toLowerCase());
    if (doublon) { setErreurModal(`"${doublon.nom}" existe déjà.`); return; }
    setSaving(true);
    try {
      const ref = await addDoc(collection(db, 'Partenaire'), {
        userId: user.uid,
        nom: nom.trim(),
        type,
        adresse: adresse.trim(),
        numero: numero.trim(),
        dateCreation: serverTimestamp(),
      });
      setPartenaires(prev => [...prev, { id: ref.id, nom: nom.trim(), type, adresse: adresse.trim(), numero: numero.trim() }]);
      setShowModal(false);
    } catch {
      setErreurModal('Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  }

  /* ── Chargement ── */
  useEffect(() => {
    if (!user) return;
    async function load() {
      const [partSnap, mouvSnap] = await Promise.all([
        getDocs(query(collection(db, 'Partenaire'), where('userId', '==', user!.uid))),
        getDocs(query(collection(db, 'mouvements'), where('userId', '==', user!.uid))),
      ]);

      const liste: Partenaire[] = partSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Partenaire))
        .filter(p => (p.type as any) !== 'importation');

      // Calculer les stats depuis les mouvements
      const map: Record<string, StatPartenaire> = {};
      mouvSnap.docs.forEach(d => {
        const m = d.data();
        const nom = (m.nomClient || '').trim().toLowerCase();
        if (!nom) return;
        if (!map[nom]) map[nom] = { totalVentes: 0, totalEntrees: 0, totalQuantite: 0, nbOperations: 0 };
        if (m.typeDocument === 'Sortie') map[nom].totalVentes += m.totalLigne || 0;
        if (m.typeDocument === 'Entrée') map[nom].totalEntrees += m.totalLigne || 0;
        map[nom].totalQuantite += m.quantite || 0;
        map[nom].nbOperations += 1;
      });

      // Trier par total sorties décroissant
      liste.sort((a, b) => {
        const sa = map[a.nom.trim().toLowerCase()]?.totalVentes || 0;
        const sb = map[b.nom.trim().toLowerCase()]?.totalVentes || 0;
        return sb - sa;
      });

      setPartenaires(liste);
      setStats(map);
      setLoading(false);
    }
    load();
  }, [user]);

  /* ── Filtre ── */
  const filtered = useMemo(() => partenaires.filter(p => {
    const matchSearch = !search || p.nom.toLowerCase().includes(search.toLowerCase());
    if (filtre === 'boutique') return matchSearch && p.type === 'boutique';
    if (filtre === 'partenaire') return matchSearch && p.type === 'partenaire';
    return matchSearch;
  }), [partenaires, search, filtre]);

  const nbBoutiques = partenaires.filter(p => p.type === 'boutique').length;
  const nbPartenaires = partenaires.filter(p => p.type === 'partenaire').length;

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">

        {/* ── En-tête ── */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Partenaires & Boutiques</h1>
            <p className="text-gray-500 text-sm mt-1">{nbPartenaires} partenaires · {nbBoutiques} boutiques</p>
          </div>
          <button onClick={ouvrirModal}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors">
            <Plus size={16} /> Nouveau partenaire
          </button>
        </div>

        {/* ── Filtres ── */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {(['tout', 'partenaire', 'boutique'] as Filtre[]).map(f => (
            <button key={f} onClick={() => setFiltre(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${filtre === f ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
              {f === 'tout' ? `Tout (${partenaires.length})` : f === 'partenaire' ? `Partenaires (${nbPartenaires})` : `Boutiques (${nbBoutiques})`}
            </button>
          ))}
        </div>

        {/* ── Recherche ── */}
        <div className="relative mb-5 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un nom..."
            className="w-full pl-9 pr-8 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>

        {/* ── Grille ── */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-16">Aucun résultat</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(p => {
              const isBoutique = p.type === 'boutique';
              const s = stats[p.nom.trim().toLowerCase()] || { totalVentes: 0, totalEntrees: 0, totalQuantite: 0, nbOperations: 0 };
              return (
                <div key={p.id} onClick={() => router.push(`/partenaire/${p.id}`)} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-700 transition-all cursor-pointer">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0
                      ${isBoutique ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-indigo-100 dark:bg-indigo-900/30'}`}>
                      {isBoutique
                        ? <Store size={18} className="text-purple-600 dark:text-purple-400" />
                        : <span className="text-indigo-600 dark:text-indigo-400 font-bold text-sm">{p.nom.charAt(0).toUpperCase()}</span>}
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full
                      ${isBoutique ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400' : 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400'}`}>
                      {isBoutique ? 'Boutique' : 'Partenaire'}
                    </span>
                  </div>

                  <h3 className="font-semibold text-gray-900 dark:text-gray-100">{p.nom}</h3>
                  {p.adresse && <p className="text-xs text-gray-400 mt-0.5">{p.adresse}</p>}

                  <div className="mt-3 space-y-1.5 border-t border-gray-50 dark:border-gray-800 pt-3">
                    {s.totalVentes > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Sorties</span>
                        <span className={`font-semibold ${isBoutique ? 'text-purple-600' : 'text-blue-600'}`}>
                          {formatMontant(s.totalVentes)}
                        </span>
                      </div>
                    )}
                    {s.totalEntrees > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Entrées</span>
                        <span className="font-semibold text-green-600">{formatMontant(s.totalEntrees)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Opérations</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300">{s.nbOperations}</span>
                    </div>
                    {s.totalQuantite > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Quantité totale</span>
                        <span className="font-medium text-gray-700 dark:text-gray-300">{s.totalQuantite.toLocaleString('fr-FR')} U</span>
                      </div>
                    )}
                    {s.nbOperations === 0 && (
                      <p className="text-xs text-gray-400 italic">Aucune opération</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── MODAL AJOUT ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Nouveau partenaire</h2>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Type</label>
              <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 text-sm font-semibold">
                <button onClick={() => setType('partenaire')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 transition-colors
                    ${type === 'partenaire' ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                  <Users size={15} /> Partenaire
                </button>
                <button onClick={() => setType('boutique')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 transition-colors
                    ${type === 'boutique' ? 'bg-purple-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                  <Store size={15} /> Boutique
                </button>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nom <span className="text-red-500">*</span></label>
              <input autoFocus type="text" value={nom} onChange={e => setNom(e.target.value)}
                placeholder={type === 'boutique' ? 'Nom de la boutique...' : 'Nom du partenaire...'}
                onKeyDown={e => e.key === 'Enter' && sauvegarder()}
                className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Adresse <span className="text-gray-400 font-normal">(optionnel)</span></label>
              <input type="text" value={adresse} onChange={e => setAdresse(e.target.value)} placeholder="Quartier, ville..."
                className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
            </div>

            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Téléphone <span className="text-gray-400 font-normal">(optionnel)</span></label>
              <input type="tel" value={numero} onChange={e => setNumero(e.target.value)} placeholder="06 XX XX XX XX"
                className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
            </div>

            {erreurModal && <p className="text-red-500 text-sm mb-3">{erreurModal}</p>}

            <div className="flex gap-3">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Annuler
              </button>
              <button onClick={sauvegarder} disabled={saving}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50
                  ${type === 'boutique' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                {saving ? 'Sauvegarde...' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
