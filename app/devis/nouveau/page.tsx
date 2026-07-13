'use client';
import { useEffect, useState, useMemo } from 'react';
import {
  collection, query, where, getDocs, doc, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { useRouter } from 'next/navigation';
import { formatMontant } from '@/lib/format';
import { ArrowLeft, Plus, Search, X, Trash2, Package, CheckCircle2 } from 'lucide-react';

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

interface LigneDevis {
  key: string;
  produitId: string | null;
  produitNom: string;
  typeUnite: 'U' | 'C';
  quantite: number;
  prix: number;
  qpe: number;
  horsDepot: boolean;
}

function genNumeroDevis() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `DEV-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${Date.now().toString().slice(-4)}`;
}

function totalLigne(l: LigneDevis) {
  return l.quantite * l.prix;
}

export default function NouveauDevisPage() {
  const { user, profile } = useAuth();
  const router = useRouter();

  const adminUid = profile?.role === 'admin' ? user?.uid : profile?.adminUid;

  const [produits, setProduits] = useState<Produit[]>([]);
  const [partenaires, setPartenaires] = useState<Partenaire[]>([]);
  const [loading, setLoading] = useState(true);

  const [client, setClient] = useState<Partenaire | null>(null);
  const [showClientPanel, setShowClientPanel] = useState(false);
  const [rechercheClient, setRechercheClient] = useState('');

  const [lignes, setLignes] = useState<LigneDevis[]>([]);
  const [showProduitPanel, setShowProduitPanel] = useState(false);
  const [rechercheProduit, setRechercheProduit] = useState('');

  // Produit hors dépôt
  const [showHorsDepotForm, setShowHorsDepotForm] = useState(false);
  const [horsDepotNom, setHorsDepotNom] = useState('');
  const [horsDepotQte, setHorsDepotQte] = useState(1);
  const [horsDepotPrix, setHorsDepotPrix] = useState(0);

  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    if (!adminUid) return;
    async function load() {
      const [prodSnap, partSnap] = await Promise.all([
        getDocs(query(collection(db, 'Produits'), where('userId', '==', adminUid))),
        getDocs(query(collection(db, 'Partenaire'), where('userId', '==', adminUid))),
      ]);
      setProduits(prodSnap.docs.map(d => ({ id: d.id, ...d.data() } as Produit)));
      setPartenaires(partSnap.docs.map(d => ({ id: d.id, ...d.data() } as Partenaire)));
      setLoading(false);
    }
    load();
  }, [adminUid]);

  const clientsFiltres = useMemo(() =>
    partenaires.filter(p => p.nom.toLowerCase().includes(rechercheClient.toLowerCase())),
    [partenaires, rechercheClient]
  );

  const produitsFiltres = useMemo(() =>
    produits.filter(p => p.designation.toLowerCase().includes(rechercheProduit.toLowerCase())),
    [produits, rechercheProduit]
  );

  function ajouterProduit(p: Produit) {
    setLignes(prev => [...prev, {
      key: Date.now().toString(),
      produitId: p.id,
      produitNom: p.designation,
      typeUnite: 'U',
      quantite: 1,
      prix: p.prix_unitaire,
      qpe: p.quantite_par_emballage,
      horsDepot: false,
    }]);
    setShowProduitPanel(false);
    setRechercheProduit('');
  }

  function ajouterHorsDepot() {
    if (!horsDepotNom.trim() || horsDepotQte <= 0 || horsDepotPrix < 0) return;
    setLignes(prev => [...prev, {
      key: Date.now().toString(),
      produitId: null,
      produitNom: horsDepotNom.trim(),
      typeUnite: 'U',
      quantite: horsDepotQte,
      prix: horsDepotPrix,
      qpe: 1,
      horsDepot: true,
    }]);
    setHorsDepotNom('');
    setHorsDepotQte(1);
    setHorsDepotPrix(0);
    setShowHorsDepotForm(false);
  }

  function mettreAJourLigne(key: string, champ: keyof LigneDevis, valeur: any) {
    setLignes(prev => prev.map(l => {
      if (l.key !== key) return l;
      const updated = { ...l, [champ]: valeur };
      if (champ === 'typeUnite' && l.produitId) {
        const p = produits.find(p => p.id === l.produitId);
        if (p) updated.prix = valeur === 'C' ? p.prix_unitaire * p.quantite_par_emballage : p.prix_unitaire;
      }
      return updated;
    }));
  }

  function supprimerLigne(key: string) {
    setLignes(prev => prev.filter(l => l.key !== key));
  }

  const totalGeneral = useMemo(() => lignes.reduce((s, l) => s + totalLigne(l), 0), [lignes]);
  const totalDepot = useMemo(() => lignes.filter(l => !l.horsDepot).reduce((s, l) => s + totalLigne(l), 0), [lignes]);
  const totalHorsDepot = useMemo(() => lignes.filter(l => l.horsDepot).reduce((s, l) => s + totalLigne(l), 0), [lignes]);

  async function sauvegarder(statut: 'brouillon' | 'envoye') {
    if (!client) { setErreur('Sélectionner un client'); return; }
    if (lignes.length === 0) { setErreur('Ajouter au moins un produit'); return; }
    if (!adminUid) return;
    setErreur('');
    setSaving(true);
    try {
      const id = doc(collection(db, 'devis')).id;
      await setDoc(doc(db, 'devis', id), {
        adminUid,
        numeroDevis: genNumeroDevis(),
        clientNom: client.nom,
        clientId: client.id,
        statut,
        date: serverTimestamp(),
        lignes: lignes.map(({ key, ...l }) => l),
        totalGeneral,
        totalDepot,
        totalHorsDepot,
        nbLignes: lignes.length,
        nbLignesHorsDepot: lignes.filter(l => l.horsDepot).length,
      });
      router.push('/devis');
    } catch (e) {
      console.error(e);
      setErreur('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <AppLayout>
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-5">
        {/* En-tête */}
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Nouveau devis</h1>
            <p className="text-xs text-gray-400">Proposition commerciale</p>
          </div>
        </div>

        {/* Client */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Client</p>
          {client ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900 dark:text-gray-100">{client.nom}</p>
                <p className="text-xs text-gray-400 capitalize">{client.type}</p>
              </div>
              <button onClick={() => setClient(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X size={14} className="text-gray-400" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowClientPanel(true)}
              className="w-full py-3 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
            >
              Sélectionner un client
            </button>
          )}
        </div>

        {/* Lignes */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Produits</p>

          {lignes.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Aucun produit ajouté</p>
          ) : (
            <div className="space-y-3">
              {lignes.map(l => (
                <div key={l.key} className={`rounded-xl border p-3 space-y-2 ${l.horsDepot ? 'border-amber-200 bg-amber-50/50 dark:bg-amber-900/10' : 'border-gray-100 dark:border-gray-800'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      {l.horsDepot && <Package size={13} className="text-amber-500 shrink-0" />}
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{l.produitNom}</p>
                    </div>
                    <button onClick={() => supprimerLigne(l.key)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20">
                      <Trash2 size={13} className="text-red-400" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {!l.horsDepot && (
                      <select
                        value={l.typeUnite}
                        onChange={e => mettreAJourLigne(l.key, 'typeUnite', e.target.value)}
                        className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                      >
                        <option value="U">Unité</option>
                        <option value="C">Carton</option>
                      </select>
                    )}
                    <input
                      type="number"
                      min={1}
                      value={l.quantite}
                      onChange={e => mettreAJourLigne(l.key, 'quantite', Number(e.target.value))}
                      className={`text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 ${l.horsDepot ? 'col-span-1' : ''}`}
                      placeholder="Qté"
                    />
                    <input
                      type="number"
                      min={0}
                      value={l.prix}
                      onChange={e => mettreAJourLigne(l.key, 'prix', Number(e.target.value))}
                      className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                      placeholder="Prix"
                    />
                  </div>
                  <p className="text-xs font-semibold text-right text-indigo-600">{formatMontant(totalLigne(l))}</p>
                </div>
              ))}
            </div>
          )}

          {/* Boutons ajout */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setShowProduitPanel(true)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border-2 border-dashed border-indigo-200 dark:border-indigo-700 rounded-xl text-xs font-semibold text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              <Plus size={14} />
              Dépôt
            </button>
            <button
              onClick={() => setShowHorsDepotForm(true)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border-2 border-dashed border-amber-200 dark:border-amber-700 rounded-xl text-xs font-semibold text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
            >
              <Package size={14} />
              Hors dépôt
            </button>
          </div>

          {/* Formulaire hors dépôt */}
          {showHorsDepotForm && (
            <div className="border border-amber-200 dark:border-amber-700 rounded-xl p-3 space-y-2 bg-amber-50/50 dark:bg-amber-900/10">
              <p className="text-xs font-semibold text-amber-600">Produit hors dépôt</p>
              <input
                type="text"
                value={horsDepotNom}
                onChange={e => setHorsDepotNom(e.target.value)}
                placeholder="Nom du produit"
                className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number" min={1} value={horsDepotQte}
                  onChange={e => setHorsDepotQte(Number(e.target.value))}
                  placeholder="Quantité"
                  className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                />
                <input
                  type="number" min={0} value={horsDepotPrix}
                  onChange={e => setHorsDepotPrix(Number(e.target.value))}
                  placeholder="Prix unitaire"
                  className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowHorsDepotForm(false)} className="flex-1 py-2 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-500">Annuler</button>
                <button onClick={ajouterHorsDepot} className="flex-1 py-2 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white">Ajouter</button>
              </div>
            </div>
          )}
        </div>

        {/* Total */}
        {lignes.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 space-y-2">
            {totalHorsDepot > 0 && (
              <>
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Produits dépôt</span>
                  <span className="font-medium">{formatMontant(totalDepot)}</span>
                </div>
                <div className="flex justify-between text-sm text-amber-600">
                  <span className="flex items-center gap-1"><Package size={12} />Hors dépôt</span>
                  <span className="font-medium">{formatMontant(totalHorsDepot)}</span>
                </div>
                <div className="border-t border-gray-100 dark:border-gray-800 pt-2" />
              </>
            )}
            <div className="flex justify-between">
              <span className="font-bold text-gray-900 dark:text-gray-100">Total général</span>
              <span className="font-bold text-indigo-600 text-lg">{formatMontant(totalGeneral)}</span>
            </div>
          </div>
        )}

        {erreur && <p className="text-sm text-red-500 text-center">{erreur}</p>}

        {/* Actions */}
        <div className="flex gap-3 pb-6">
          <button
            onClick={() => sauvegarder('brouillon')}
            disabled={saving}
            className="flex-1 py-3 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            Enregistrer brouillon
          </button>
          <button
            onClick={() => sauvegarder('envoye')}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors"
          >
            <CheckCircle2 size={16} />
            Marquer envoyé
          </button>
        </div>
      </div>

      {/* Panel client */}
      {showClientPanel && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowClientPanel(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md max-h-[70vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800">
              <p className="font-bold text-gray-900 dark:text-gray-100 mb-3">Sélectionner un client</p>
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2">
                <Search size={15} className="text-gray-400 shrink-0" />
                <input
                  autoFocus
                  value={rechercheClient}
                  onChange={e => setRechercheClient(e.target.value)}
                  placeholder="Rechercher..."
                  className="flex-1 bg-transparent text-sm outline-none text-gray-700 dark:text-gray-300 placeholder-gray-400"
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {clientsFiltres.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setClient(p); setShowClientPanel(false); setRechercheClient(''); }}
                  className="w-full flex items-center justify-between px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                >
                  <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{p.nom}</p>
                  <p className="text-xs text-gray-400 capitalize">{p.type}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Panel produit dépôt */}
      {showProduitPanel && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowProduitPanel(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md max-h-[70vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800">
              <p className="font-bold text-gray-900 dark:text-gray-100 mb-3">Produit du dépôt</p>
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2">
                <Search size={15} className="text-gray-400 shrink-0" />
                <input
                  autoFocus
                  value={rechercheProduit}
                  onChange={e => setRechercheProduit(e.target.value)}
                  placeholder="Rechercher..."
                  className="flex-1 bg-transparent text-sm outline-none text-gray-700 dark:text-gray-300 placeholder-gray-400"
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {produitsFiltres.map(p => (
                <button
                  key={p.id}
                  onClick={() => ajouterProduit(p)}
                  className="w-full flex items-center justify-between px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                >
                  <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{p.designation}</p>
                  <p className="text-xs text-gray-400">{formatMontant(p.prix_unitaire)}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
