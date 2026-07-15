'use client';
import { useEffect, useState, useRef, useMemo } from 'react';
import {
  collection, getDocs, query, where, doc, writeBatch, serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { useRouter } from 'next/navigation';
import {
  Search, X, Trash2, ArrowUpCircle, ArrowDownCircle, CheckCircle2, Settings2,
} from 'lucide-react';

/* --- Types --- */
type Sens = 'Entrée' | 'Sortie';

interface Produit {
  id: string;
  designation: string;
  prix_unitaire: number;
  quantite_par_emballage: number;
  quantite_unitaire_total: number;
}

interface Partenaire {
  id: string;
  nom: string;
  type: string;
}

interface Ligne {
  key: string;
  produit: Produit;
  typeUnite: 'U' | 'C';
  quantite: number;
  prix: number;
}

/* - Helpers - */
function genNumero(sens: Sens) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const code = sens === 'Entrée' ? 'ENT' : 'SOR';
  return `${code}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${Date.now().toString().slice(-4)}`;
}

function stockDispo(p: Produit, type: 'U' | 'C') {
  if (type === 'U') return p.quantite_unitaire_total;
  return p.quantite_par_emballage > 0
    ? Math.floor(p.quantite_unitaire_total / p.quantite_par_emballage)
    : 0;
}

function prixParTypeUnite(p: Produit, typeUnite: 'U' | 'C') {
  return typeUnite === 'C' ? p.prix_unitaire * p.quantite_par_emballage : p.prix_unitaire;
}

function totalLigne(l: Ligne) {
  return l.quantite * l.prix;
}


/* - Page - */
export default function NouvelleOperationPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const isFacturier = profile?.role === 'facturier';
  const dataUid = isFacturier ? profile?.adminUid : user?.uid;

  const [sens, setSens] = useState<Sens>('Sortie');
  const [sensDefaut, setSensDefaut] = useState<Sens>('Sortie');
  const [showDefautMenu, setShowDefautMenu] = useState(false);

  const [produits, setProduits] = useState<Produit[]>([]);
  const [partenaires, setPartenaires] = useState<Partenaire[]>([]);
  const [partenaire, setPartenaire] = useState<Partenaire | null>(null);
  const [showPartenairePanel, setShowPartenairePanel] = useState(false);
  const [recherchePartenaire, setRecherchePartenaire] = useState('');

  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [rechercheProduit, setRechercheProduit] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState('');

  const searchRef = useRef<HTMLInputElement>(null);
  const partenaireRef = useRef<HTMLDivElement>(null);
  const defautRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null); // garde la ref pour éviter la fermeture prématurée

  /* - Init sens par défaut - */
  useEffect(() => {
    if (isFacturier) { setSens('Sortie'); setSensDefaut('Sortie'); return; }
    const saved = localStorage.getItem('defaultSens') as Sens | null;
    const def = saved || 'Sortie';
    setSensDefaut(def);
    setSens(def);
  }, [isFacturier]);

  /* - Chargement Firestore - */
  useEffect(() => {
    if (!dataUid) return;
    async function load() {
      const [pSnap, partSnap] = await Promise.all([
        getDocs(query(collection(db, 'Produits'), where('userId', '==', dataUid))),
        getDocs(query(collection(db, 'Partenaire'), where('userId', '==', dataUid))),
      ]);
      setProduits(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as Produit)));
      setPartenaires(
        partSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Partenaire))
          .filter(p => p.type !== 'importation')
      );
    }
    load();
  }, [dataUid]);

  /* - Fermer panels au clic extérieur - */
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (partenaireRef.current && !partenaireRef.current.contains(e.target as Node)) {
        setShowPartenairePanel(false);
      }
      if (defautRef.current && !defautRef.current.contains(e.target as Node)) {
        setShowDefautMenu(false);
      }
      // Le dropdown se ferme uniquement si le clic est hors du champ ET hors du dropdown
      if (
        searchRef.current && !searchRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* - Produits déjà en table - */
  const idsAjoutes = useMemo(() => new Set(lignes.map(l => l.produit.id)), [lignes]);

  /* - Autocomplete - */
  const produitsFiltres = useMemo(() => {
    if (!rechercheProduit) return [];
    const q = rechercheProduit.toLowerCase();
    return produits.filter(p => p.designation.toLowerCase().includes(q) && !idsAjoutes.has(p.id)).slice(0, 8);
  }, [produits, rechercheProduit, idsAjoutes]);

  /* - Partenaires filtrés - */
  const partenairesFiltres = useMemo(() => {
    if (!recherchePartenaire) return partenaires;
    const q = recherchePartenaire.toLowerCase();
    return partenaires.filter(p => p.nom.toLowerCase().includes(q));
  }, [partenaires, recherchePartenaire]);

  /* - Ajouter un produit - */
  function ajouterProduit(p: Produit) {
    const key = `${p.id}-${Date.now()}`;
    setLignes(prev => [...prev, { key, produit: p, typeUnite: 'C', quantite: 1, prix: prixParTypeUnite(p, 'C') }]);
    setRechercheProduit('');
    setShowDropdown(false);
    // Focus sur la quantité de la ligne ajoutée
    setTimeout(() => {
      const input = document.getElementById(`qty-${key}`) as HTMLInputElement;
      input?.focus();
      input?.select();
    }, 60);
  }

  /* - Modifier une ligne - */
  function updateLigne(key: string, changes: Partial<Pick<Ligne, 'typeUnite' | 'quantite' | 'prix'>>) {
    setLignes(prev => prev.map(l => {
      if (l.key !== key) return l;
      const next = { ...l, ...changes };
      if ('typeUnite' in changes && changes.typeUnite !== l.typeUnite) {
        next.quantite = 1;
        next.prix = prixParTypeUnite(l.produit, changes.typeUnite!);
      }
      return next;
    }));
  }

  function supprimerLigne(key: string) {
    setLignes(prev => prev.filter(l => l.key !== key));
  }

  const totalGeneral = lignes.reduce((s, l) => s + totalLigne(l), 0);

  /* - Changer défaut - */
  function changerDefaut(s: Sens) {
    setSensDefaut(s);
    setSens(s);
    localStorage.setItem('defaultSens', s);
    setShowDefautMenu(false);
  }

  /* - Valider - */
  async function valider() {
    if (lignes.length === 0 || !user || !dataUid) return;
    if (!partenaire) { setErreur(sens === 'Entrée' ? 'Veuillez sélectionner un fournisseur.' : 'Veuillez sélectionner un client.'); return; }
    // Vérifier qu'aucune ligne ne dépasse le stock (pour une sortie)
    if (sens === 'Sortie') {
      const depassement = lignes.find(l => l.quantite > stockDispo(l.produit, l.typeUnite));
      if (depassement) {
        setErreur(`Stock insuffisant pour "${depassement.produit.designation}"`);
        return;
      }
    }
    setSaving(true);
    setErreur('');
    try {
      const batch = writeBatch(db);
      const numero = genNumero(sens);
      const now = serverTimestamp();
      const docRef = doc(collection(db, 'documents_stock'));

      batch.set(docRef, {
        userId: dataUid,
        typeDocument: sens,
        numeroDocument: numero,
        clientNom: partenaire!.nom,
        totalGeneral,
        nombreDeProduit: lignes.length,
        statut: 'En cours',
        livraison: 'non_livre',
        facturierTraites: [],
        date: now,
      });

      for (const l of lignes) {
        const qteU = l.typeUnite === 'C' ? l.quantite * l.produit.quantite_par_emballage : l.quantite;
        const total = l.quantite * l.prix; // prix est déjà par carton ou par unité selon typeUnite
        const prixUnitaire = l.typeUnite === 'C' ? l.prix / l.produit.quantite_par_emballage : l.prix;
        const mouvRef = doc(collection(db, 'mouvements'));
        batch.set(mouvRef, {
          userId: dataUid,
          typeDocument: sens,
          typeTransaction: sens === 'Entrée' ? 'Achat' : 'Vente',
          produitNom: l.produit.designation,
          produitId: doc(db, 'Produits', l.produit.id),
          quantite: l.quantite,
          typeUnite: l.typeUnite,
          prixUnitaireReel: prixUnitaire,
          totalLigne: total,
          nomClient: partenaire!.nom,
          documentId: docRef,
          date: now,
        });
        batch.update(doc(db, 'Produits', l.produit.id), {
          quantite_unitaire_total: increment(sens === 'Entrée' ? qteU : -qteU),
        });
      }

      await batch.commit();
      if (isFacturier) { router.push('/facturier'); return; }
      setLignes([]);
      setPartenaire(null);
      setSens(sensDefaut);
      setSucces(`Opération validée avec succès.`);
      setTimeout(() => setSucces(''), 4000);
    } catch (e) {
      console.error(e);
      setErreur('Erreur lors de la validation. Réessayez.');
    } finally {
      setSaving(false);
    }
  }

  const couleurSens = sens === 'Entrée' ? 'text-green-600' : 'text-blue-600';
  const bgBouton = lignes.length === 0
    ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
    : sens === 'Entrée'
      ? 'bg-green-600 hover:bg-green-700 text-white shadow-md'
      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md';

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto flex flex-col gap-5">

        {/* - ENTÊTE - */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
          <div className="flex flex-wrap items-center gap-3">

            {/* Toggle Entrée / Sortie — masqué pour le facturier */}
            {!isFacturier && (
              <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 text-sm font-semibold">
                {(['Entrée', 'Sortie'] as Sens[]).map(s => (
                  <button key={s} onClick={() => setSens(s)}
                    className={`flex items-center gap-2 px-5 py-2.5 transition-colors
                      ${sens === s
                        ? s === 'Entrée' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                    {s === 'Entrée' ? <ArrowUpCircle size={16} /> : <ArrowDownCircle size={16} />}
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Partenaire */}
            <div className="relative flex-1 min-w-52" ref={partenaireRef}>
              <button onClick={() => { setShowPartenairePanel(!showPartenairePanel); setRecherchePartenaire(''); }}
                className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors
                  ${partenaire
                    ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white'
                    : 'bg-white dark:bg-gray-800 text-gray-400 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                <span className="flex-1 text-left truncate">
                  {partenaire?.nom ?? (sens === 'Entrée' ? '+ Fournisseur (optionnel)' : '+ Client (optionnel)')}
                </span>
                {partenaire && (
                  <X size={14} onClick={e => { e.stopPropagation(); setPartenaire(null); }} />
                )}
              </button>

              {showPartenairePanel && (
                <div onMouseDown={e => e.preventDefault()} className="absolute top-full left-0 mt-1 w-72 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl z-20 p-3">
                  <div className="relative mb-2">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input autoFocus type="text" placeholder="Rechercher..." value={recherchePartenaire}
                      onChange={e => setRecherchePartenaire(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-transparent text-gray-900 dark:text-gray-100" />
                  </div>
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {partenairesFiltres.map(p => (
                      <button key={p.id} onMouseDown={e => { e.preventDefault(); setPartenaire(p); setShowPartenairePanel(false); setRecherchePartenaire(''); }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
                          ${partenaire?.id === p.id ? 'bg-indigo-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
                        {p.nom}
                      </button>
                    ))}
                    {partenairesFiltres.length === 0 && <p className="text-center text-gray-400 text-sm py-3">Aucun résultat</p>}
                  </div>
                </div>
              )}
            </div>

            {/* Défaut — masqué pour le facturier */}
            {!isFacturier && (
              <div className="relative" ref={defautRef}>
                <button onClick={() => setShowDefautMenu(!showDefautMenu)}
                  title="Opération par défaut"
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <Settings2 size={15} />
                  <span className="hidden sm:inline text-xs">Défaut : <strong>{sensDefaut}</strong></span>
                </button>
                {showDefautMenu && (
                  <div className="absolute top-full left-0 sm:left-auto sm:right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg z-20 p-3 space-y-1">
                    <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold px-2 mb-2">Opération par défaut</p>
                    {(['Entrée', 'Sortie'] as Sens[]).map(s => (
                      <button key={s} onClick={() => changerDefaut(s)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors
                          ${sensDefaut === s ? 'bg-indigo-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
                        {s === 'Entrée' ? '↑ Entrée' : '↓ Sortie'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* - CORPS - */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-visible">

          {/* Barre de recherche produit */}
          <div className="p-4 border-b border-gray-100 dark:border-gray-700 relative">
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Ajouter un produit... (tapez pour rechercher, Enter pour ajouter le premier)"
                value={rechercheProduit}
                onChange={e => { setRechercheProduit(e.target.value); setShowDropdown(true); }}
                onFocus={() => rechercheProduit && setShowDropdown(true)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { setRechercheProduit(''); setShowDropdown(false); }
                  if (e.key === 'Enter' && produitsFiltres.length > 0) ajouterProduit(produitsFiltres[0]);
                }}
                className="w-full pl-10 pr-8 py-3 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
              />
              {rechercheProduit && (
                <button onClick={() => { setRechercheProduit(''); setShowDropdown(false); searchRef.current?.focus(); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Dropdown autocomplete */}
            {showDropdown && produitsFiltres.length > 0 && (
              <div ref={dropdownRef} className="absolute left-4 right-4 top-full mt-0.5 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl z-30 overflow-hidden">
                {produitsFiltres.map((p, i) => {
                  const stock = p.quantite_unitaire_total ?? 0;
                  const vide = sens === 'Sortie' && stock === 0;
                  return (
                    <button key={p.id}
                      onMouseDown={e => { e.preventDefault(); if (!vide) ajouterProduit(p); }}
                      disabled={vide}
                      className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors
                        ${i < produitsFiltres.length - 1 ? 'border-b border-gray-50 dark:border-gray-700' : ''}
                        ${i === 0 ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}
                        ${vide ? 'opacity-40 cursor-not-allowed' : 'hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer'}`}>
                      <div className="text-left">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{p.designation}</span>
                        {i === 0 && <span className="ml-2 text-xs text-indigo-400">← Enter</span>}
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                        ${stock === 0 ? 'bg-red-100 text-red-600' : stock < 10 ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                        {stock.toLocaleString('fr-FR')} U
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Vide */}
          {lignes.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-gray-400 text-sm">Aucun produit ajouté</p>
              <p className="text-gray-300 dark:text-gray-600 text-xs mt-1">Utilisez la barre ci-dessus pour ajouter des produits</p>
            </div>
          )}

          {/* - MOBILE : cartes (< md) - */}
          {lignes.length > 0 && (
            <div className="md:hidden divide-y divide-gray-50 dark:divide-gray-800">
              {lignes.map((l, i) => {
                const dispo = stockDispo(l.produit, l.typeUnite);
                const depasse = sens === 'Sortie' && l.quantite > dispo;
                return (
                  <div key={l.key} className={`p-4 ${depasse ? 'bg-red-50/40 dark:bg-red-900/10' : ''}`}>
                    {/* Ligne 1 : numéro + nom + supprimer */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-gray-300 shrink-0">{i + 1}</span>
                        <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm leading-tight">{l.produit.designation}</p>
                      </div>
                      <button onClick={() => supprimerLigne(l.key)}
                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors shrink-0">
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {/* Ligne 2 : Type + Stock dispo */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 text-xs font-semibold">
                        {(['U', 'C'] as const).map(t => (
                          <button key={t} onClick={() => updateLigne(l.key, { typeUnite: t })}
                            className={`px-4 py-2 transition-colors
                              ${l.typeUnite === t ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800'}`}>
                            {t === 'U' ? 'Unité' : 'Carton'}
                          </button>
                        ))}
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full
                        ${dispo === 0 ? 'bg-red-100 text-red-600' : dispo < 5 ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                        {dispo.toLocaleString('fr-FR')} {l.typeUnite} dispo
                      </span>
                    </div>

                    {/* Ligne 3 : Quantité +/− + Prix + Total */}
                    <div className="flex items-center gap-3">
                      {/* Stepper quantité */}
                      <div className={`flex items-center rounded-xl border overflow-hidden ${depasse ? 'border-red-400' : 'border-gray-200 dark:border-gray-600'}`}>
                        <button
                          onClick={() => {
                            const v = Math.max(1, l.quantite - 1);
                            updateLigne(l.key, { quantite: v });
                          }}
                          className="w-10 h-10 flex items-center justify-center text-lg font-bold text-gray-500 bg-gray-50 dark:bg-gray-800 active:bg-gray-100">
                          −
                        </button>
                        <input
                          id={`qty-${l.key}`}
                          type="number" min={1}
                          value={l.quantite}
                          onChange={e => {
                            const v = Math.max(1, parseFloat(e.target.value) || 1);
                            updateLigne(l.key, { quantite: sens === 'Sortie' ? Math.min(v, dispo) : v });
                          }}
                          className="w-12 text-center text-sm font-bold border-x border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none py-2"
                        />
                        <button
                          onClick={() => {
                            const v = sens === 'Sortie' ? Math.min(l.quantite + 1, dispo) : l.quantite + 1;
                            updateLigne(l.key, { quantite: v });
                          }}
                          className="w-10 h-10 flex items-center justify-center text-lg font-bold text-gray-500 bg-gray-50 dark:bg-gray-800 active:bg-gray-100">
                          +
                        </button>
                      </div>

                      {/* Prix */}
                      <div className="flex-1">
                        <p className="text-xs text-gray-400 mb-1">Prix unit.</p>
                        <input
                          type="number" min={0}
                          value={l.prix}
                          onChange={e => updateLigne(l.key, { prix: Math.max(0, parseFloat(e.target.value) || 0) })}
                          className="w-full text-right px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                        />
                      </div>

                      {/* Total */}
                      <div className="text-right shrink-0">
                        <p className="text-xs text-gray-400 mb-1">Total</p>
                        <p className={`text-sm font-bold ${couleurSens}`}>
                          {totalLigne(l).toLocaleString('fr-FR')}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* - DESKTOP / TABLETTE : tableau (>= md) - */}
          {lignes.length > 0 && (
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-400 w-8">#</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Produit</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Type</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Dispo</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Quantité</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Prix unit.</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l, i) => {
                    const dispo = stockDispo(l.produit, l.typeUnite);
                    const depasse = sens === 'Sortie' && l.quantite > dispo;
                    return (
                      <tr key={l.key} className={`border-b border-gray-50 dark:border-gray-800 transition-colors ${depasse ? 'bg-red-50/40 dark:bg-red-900/10' : 'hover:bg-gray-50/50 dark:hover:bg-gray-800/30'}`}>
                        <td className="px-4 py-3 text-xs font-bold text-gray-300 dark:text-gray-600">{i + 1}</td>
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{l.produit.designation}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-center">
                            <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 text-xs font-semibold">
                              {(['U', 'C'] as const).map(t => (
                                <button key={t} onClick={() => updateLigne(l.key, { typeUnite: t })}
                                  className={`px-3 py-1.5 transition-colors
                                    ${l.typeUnite === t ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                                  {t}
                                </button>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                            ${dispo === 0 ? 'bg-red-100 text-red-600' : dispo < 5 ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                            {dispo.toLocaleString('fr-FR')} {l.typeUnite}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            id={`qty-${l.key}`}
                            type="number" min={1}
                            max={sens === 'Sortie' ? dispo : undefined}
                            value={l.quantite}
                            onChange={e => {
                              const v = Math.max(1, parseFloat(e.target.value) || 1);
                              updateLigne(l.key, { quantite: sens === 'Sortie' ? Math.min(v, dispo) : v });
                            }}
                            className={`w-20 text-right px-2 py-1.5 rounded-lg border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800
                              ${depasse ? 'border-red-400' : 'border-gray-200 dark:border-gray-600'}
                              text-gray-900 dark:text-gray-100`}
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number" min={0}
                            value={l.prix}
                            onChange={e => updateLigne(l.key, { prix: Math.max(0, parseFloat(e.target.value) || 0) })}
                            className="w-28 text-right px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                          />
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${couleurSens}`}>
                          {totalLigne(l).toLocaleString('fr-FR')}
                        </td>
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
          )}
        </div>

        {/* - FOOTER - */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Total facture</p>
            <p className={`text-2xl font-bold ${couleurSens}`}>
              {totalGeneral.toLocaleString('fr-FR')}
              <span className="text-sm font-normal text-gray-400 ml-1">FCFA</span>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{lignes.length} produit{lignes.length > 1 ? 's' : ''}</p>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
            {erreur && <p className="text-red-500 text-xs md:text-right">{erreur}</p>}
            {succes && <p className="text-green-600 text-xs md:text-right font-medium">{succes}</p>}
            {lignes.length > 0 && (
              <button
                onClick={() => { setLignes([]); setPartenaire(null); setSens(sensDefaut); setErreur(''); }}
                className="w-full md:w-auto px-5 py-3 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-all duration-200"
              >
                Tout annuler
              </button>
            )}
            <button onClick={valider} disabled={lignes.length === 0 || saving}
              className={`w-full md:w-auto flex items-center justify-center gap-2.5 px-8 py-3 rounded-xl text-base font-semibold transition-all duration-200 ${bgBouton}`}>
              <CheckCircle2 size={19} />
              {saving ? 'Validation...' : 'Valider'}
            </button>
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
