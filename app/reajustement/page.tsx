'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { collection, query, where, getDocs, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { formatMontant } from '@/lib/format';
import { TrendingUp, TrendingDown, Search, X, Trash2, CheckCircle, ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';

/* ─── Types ─────────────────────────────────────── */
type Sens = 'Entrée' | 'Sortie';

interface Produit {
  id: string;
  designation: string;
  prix_unitaire: number;
  quantite_unitaire_total: number;
  quantite_par_emballage: number;
}

interface Ligne {
  key: string;
  produit: Produit;
  quantite: number;
  typeUnite: 'U' | 'C';
  motif: string;
}

/* ─── Motifs par sens ────────────────────────────── */
const MOTIFS: Record<Sens, string[]> = {
  Sortie: ['Vol', 'Abîmé', 'Avarie', 'Perte', 'Don', 'Péremption', 'Erreur de comptage', 'Autre'],
  Entrée: ['Produit retrouvé', 'Erreur de comptage', 'Don reçu', 'Retour non enregistré', 'Ajustement inventaire', 'Autre'],
};

/* ─── Stock dispo ────────────────────────────────── */
function stockDispo(p: Produit, typeUnite: 'U' | 'C') {
  if (typeUnite === 'C') return Math.floor(p.quantite_unitaire_total / p.quantite_par_emballage);
  return p.quantite_unitaire_total;
}

/* ─── Composant select motif ─────────────────────── */
function MotifSelect({ motif, motifs, onChange }: {
  motif: string;
  motifs: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={motif}
        onChange={e => onChange(e.target.value)}
        className="w-full appearance-none pl-3 pr-8 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600
          text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
          focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="">— Motif —</option>
        {motifs.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
  );
}

/* ─── Page principale ────────────────────────────── */
export default function ReajustementPage() {
  const { user } = useAuth();
  const router = useRouter();

  /* étape : 'choix' = modal de sélection, 'travail' = formulaire */
  const [etape, setEtape] = useState<'choix' | 'travail'>('choix');
  const [sens, setSens] = useState<Sens>('Sortie');

  const [produits, setProduits] = useState<Produit[]>([]);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [recherche, setRecherche] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState(false);
  const rechercheRef = useRef<HTMLInputElement>(null);

  /* ── Chargement produits ── */
  useEffect(() => {
    if (!user) return;
    getDocs(query(collection(db, 'Produits'), where('userId', '==', user.uid))).then(snap => {
      setProduits(snap.docs.map(d => ({ id: d.id, ...d.data() } as Produit)));
    });
  }, [user]);

  /* ── Suggestions ── */
  const suggestions = useMemo(() => {
    if (!recherche.trim()) return [];
    const q = recherche.toLowerCase();
    const deja = new Set(lignes.map(l => l.produit.id));
    return produits.filter(p => p.designation.toLowerCase().includes(q) && !deja.has(p.id)).slice(0, 8);
  }, [recherche, produits, lignes]);

  function ajouterProduit(p: Produit) {
    setLignes(prev => [...prev, {
      key: `${p.id}-${Date.now()}`,
      produit: p,
      quantite: 1,
      typeUnite: 'C',
      motif: '',
    }]);
    setRecherche('');
    setShowDropdown(false);
    setTimeout(() => rechercheRef.current?.focus(), 50);
  }

  function updateLigne(key: string, changes: Partial<Pick<Ligne, 'quantite' | 'typeUnite' | 'motif'>>) {
    setLignes(prev => prev.map(l => {
      if (l.key !== key) return l;
      const next = { ...l, ...changes };
      if (changes.typeUnite && changes.typeUnite !== l.typeUnite) next.quantite = 1;
      return next;
    }));
  }

  function supprimerLigne(key: string) {
    setLignes(prev => prev.filter(l => l.key !== key));
  }

  /* ── Validation ── */
  async function valider() {
    if (!user || lignes.length === 0) return;

    // Vérifications
    const sansmotif = lignes.find(l => !l.motif);
    if (sansmotif) { setErreur(`Motif manquant pour "${sansmotif.produit.designation}"`); return; }

    if (sens === 'Sortie') {
      const depasse = lignes.find(l => l.quantite > stockDispo(l.produit, l.typeUnite));
      if (depasse) { setErreur(`Stock insuffisant pour "${depasse.produit.designation}"`); return; }
    }

    setSaving(true);
    setErreur('');
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();

      for (const l of lignes) {
        const qteU = l.typeUnite === 'C'
          ? l.quantite * l.produit.quantite_par_emballage
          : l.quantite;
        const total = l.quantite * l.produit.prix_unitaire *
          (l.typeUnite === 'C' ? l.produit.quantite_par_emballage : 1);

        // Mouvement
        const mouvRef = doc(collection(db, 'mouvements'));
        batch.set(mouvRef, {
          userId: user.uid,
          typeDocument: sens,
          typeTransaction: 'Reajustement',
          motif: l.motif,
          produitNom: l.produit.designation,
          produitId: doc(db, 'Produits', l.produit.id),
          quantite: l.quantite,
          typeUnite: l.typeUnite,
          prixUnitaireReel: l.produit.prix_unitaire,
          totalLigne: total,
          nomClient: 'Reajustement',
          date: now,
        });

        // Mise à jour stock
        const prodRef = doc(db, 'Produits', l.produit.id);
        batch.update(prodRef, {
          quantite_unitaire_total: l.produit.quantite_unitaire_total + (sens === 'Entrée' ? qteU : -qteU),
        });
      }

      await batch.commit();
      router.back();
    } catch {
      setErreur('Erreur lors de la validation.');
    } finally {
      setSaving(false);
    }
  }

  const couleur = sens === 'Entrée'
    ? { bg: 'bg-green-600', light: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-600', border: 'border-green-200 dark:border-green-800', ring: 'focus:ring-green-500' }
    : { bg: 'bg-orange-500', light: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-600', border: 'border-orange-200 dark:border-orange-800', ring: 'focus:ring-orange-500' };

  /* ══════════════════════════════════════════════
     ÉTAPE 1 — Modal de choix du sens
  ══════════════════════════════════════════════ */
  if (etape === 'choix') {
    return (
      <AppLayout>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Nouveau réajustement</h2>
              <button onClick={() => router.back()}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 transition-colors">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Quel type de réajustement souhaitez-vous effectuer ?
            </p>

            <div className="grid grid-cols-2 gap-3 mb-6">
              {/* Hausse */}
              <button
                onClick={() => setSens('Entrée')}
                className={`flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all
                  ${sens === 'Entrée'
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-green-300 dark:hover:border-green-700'}`}
              >
                <div className={`w-12 h-12 rounded-full flex items-center justify-center
                  ${sens === 'Entrée' ? 'bg-green-500' : 'bg-gray-100 dark:bg-gray-800'}`}>
                  <TrendingUp size={22} className={sens === 'Entrée' ? 'text-white' : 'text-gray-400'} />
                </div>
                <div className="text-center">
                  <p className={`font-semibold text-sm ${sens === 'Entrée' ? 'text-green-700 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>
                    Hausse
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">Augmenter le stock</p>
                </div>
              </button>

              {/* Baisse */}
              <button
                onClick={() => setSens('Sortie')}
                className={`flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all
                  ${sens === 'Sortie'
                    ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-orange-300 dark:hover:border-orange-700'}`}
              >
                <div className={`w-12 h-12 rounded-full flex items-center justify-center
                  ${sens === 'Sortie' ? 'bg-orange-500' : 'bg-gray-100 dark:bg-gray-800'}`}>
                  <TrendingDown size={22} className={sens === 'Sortie' ? 'text-white' : 'text-gray-400'} />
                </div>
                <div className="text-center">
                  <p className={`font-semibold text-sm ${sens === 'Sortie' ? 'text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'}`}>
                    Baisse
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">Réduire le stock</p>
                </div>
              </button>
            </div>

            {/* Motifs aperçu */}
            <div className={`rounded-xl p-3 mb-6 ${couleur.light}`}>
              <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${couleur.text}`}>
                Motifs disponibles
              </p>
              <div className="flex flex-wrap gap-1.5">
                {MOTIFS[sens].map(m => (
                  <span key={m} className={`text-xs px-2 py-0.5 rounded-full border ${couleur.border} ${couleur.text} bg-white dark:bg-gray-900`}>
                    {m}
                  </span>
                ))}
              </div>
            </div>

            <button
              onClick={() => setEtape('travail')}
              className={`w-full py-3 rounded-xl text-white font-semibold text-sm transition-colors ${couleur.bg} hover:opacity-90`}
            >
              Continuer →
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  /* ══════════════════════════════════════════════
     ÉTAPE 2 — Page de travail
  ══════════════════════════════════════════════ */
  const canValider = lignes.length > 0 && lignes.every(l => l.motif);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-5">

        {/* En-tête */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => { setEtape('choix'); setLignes([]); setErreur(''); setSucces(false); }}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
          >
            ←
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className={`px-3 py-1 rounded-full text-xs font-semibold text-white ${couleur.bg}`}>
                {sens === 'Entrée' ? '↑ Hausse' : '↓ Baisse'}
              </div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Réajustement de stock</h1>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {sens === 'Entrée' ? 'Augmentation du stock' : 'Réduction du stock'} — motif obligatoire par ligne
            </p>
          </div>
        </div>

        {/* Barre de recherche */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={rechercheRef}
              value={recherche}
              onChange={e => { setRecherche(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              onKeyDown={e => {
                if (e.key === 'Enter' && suggestions[0]) ajouterProduit(suggestions[0]);
                if (e.key === 'Escape') { setRecherche(''); setShowDropdown(false); }
              }}
              placeholder="Rechercher un produit à réajuster... (Entrée pour ajouter le premier)"
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
            {recherche && (
              <button onClick={() => { setRecherche(''); setShowDropdown(false); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}

            {/* Dropdown suggestions */}
            {showDropdown && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600
                rounded-xl shadow-xl z-20 overflow-hidden">
                {suggestions.map((p, i) => {
                  const dispo = stockDispo(p, 'C');
                  return (
                    <button
                      key={p.id}
                      onMouseDown={e => { e.preventDefault(); ajouterProduit(p); }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors
                        ${i === 0 ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}
                    >
                      <span className="font-medium text-gray-900 dark:text-gray-100">{p.designation}</span>
                      <span className="text-xs text-gray-400">
                        {p.quantite_unitaire_total.toLocaleString('fr-FR')} u · {dispo} C
                        {i === 0 && <span className="ml-2 text-indigo-500">← Entrée</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Tableau */}
        {lignes.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Produit</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Unité</th>
                    {sens === 'Sortie' && (
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Dispo</th>
                    )}
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Quantité</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Motif</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {lignes.map(l => {
                    const dispo = stockDispo(l.produit, l.typeUnite);
                    const depasse = sens === 'Sortie' && l.quantite > dispo;
                    return (
                      <tr key={l.key} className={`transition-colors ${depasse ? 'bg-red-50/40 dark:bg-red-900/10' : 'hover:bg-gray-50/50 dark:hover:bg-gray-800/30'}`}>

                        {/* Produit */}
                        <td className="px-5 py-3">
                          <p className="font-medium text-gray-900 dark:text-gray-100">{l.produit.designation}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            Stock : {l.produit.quantite_unitaire_total.toLocaleString('fr-FR')} u
                          </p>
                        </td>

                        {/* Unité U/C */}
                        <td className="px-4 py-3">
                          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 text-xs font-semibold w-fit mx-auto">
                            {(['U', 'C'] as const).map(t => (
                              <button
                                key={t}
                                onMouseDown={e => { e.preventDefault(); updateLigne(l.key, { typeUnite: t }); }}
                                className={`px-3 py-1.5 transition-colors
                                  ${l.typeUnite === t
                                    ? `${couleur.bg} text-white`
                                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </td>

                        {/* Dispo (sortie uniquement) */}
                        {sens === 'Sortie' && (
                          <td className="px-4 py-3 text-right">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                              ${dispo === 0 ? 'bg-red-100 text-red-600' : dispo < 5 ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                              {dispo.toLocaleString('fr-FR')} {l.typeUnite}
                            </span>
                          </td>
                        )}

                        {/* Quantité */}
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number" min={1}
                            max={sens === 'Sortie' ? dispo : undefined}
                            value={l.quantite}
                            onChange={e => {
                              const v = Math.max(1, parseInt(e.target.value) || 1);
                              updateLigne(l.key, { quantite: sens === 'Sortie' ? Math.min(v, dispo) : v });
                            }}
                            className={`w-20 text-right px-2 py-1.5 rounded-lg border text-sm font-medium
                              focus:outline-none focus:ring-2 ${couleur.ring} bg-white dark:bg-gray-800
                              ${depasse ? 'border-red-400' : 'border-gray-200 dark:border-gray-600'}
                              text-gray-900 dark:text-gray-100`}
                          />
                        </td>

                        {/* Motif */}
                        <td className="px-4 py-3 min-w-[170px]">
                          <MotifSelect
                            motif={l.motif}
                            motifs={MOTIFS[sens]}
                            onChange={v => updateLigne(l.key, { motif: v })}
                          />
                        </td>

                        {/* Supprimer */}
                        <td className="px-3 py-3">
                          <button onClick={() => supprimerLigne(l.key)}
                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pied de page */}
        <div className="flex items-center justify-between gap-4">
          <div>
            {erreur && <p className="text-red-500 text-sm">{erreur}</p>}
            {succes && (
              <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                <CheckCircle size={16} />
                Réajustement enregistré avec succès.
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {lignes.length > 0 && (
              <button
                onClick={() => setLignes([])}
                className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium
                  text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Tout annuler
              </button>
            )}
            <button
              onClick={valider}
              disabled={!canValider || saving}
              className={`px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all
                ${canValider && !saving ? `${couleur.bg} hover:opacity-90 shadow-sm` : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'}`}
            >
              {saving ? 'Enregistrement...' : `Valider le réajustement (${lignes.length})`}
            </button>
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
