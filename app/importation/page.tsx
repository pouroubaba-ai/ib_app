'use client';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection, query, where, getDocs, doc, serverTimestamp,
  writeBatch, increment, arrayUnion, getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import { formatMontant, formatDate } from '@/lib/format';
import {
  ArrowLeft, Plus, Search, X, ChevronRight, Info,
  Edit2, Check, Package2, Ship, AlertCircle, History, Clock, ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';

/* - types - */
type Etape = 'liste' | 'creation' | 'fiche';

interface Importation {
  id: string; numero: string; date: any;
  nombreDeProduit: number; nombreDeProduitModifie: number;
  nombreProduitTraite: number; nombreEcarts?: number;
  valeurTotale: number; produitsModifies: string[];
  statut?: 'en_cours' | 'traite' | 'termine';
}


interface ProduitDB {
  id: string; designation: string; prix_unitaire: number;
  quantite_par_emballage: number; quantite_unitaire_total: number;
}

interface LigneCreation {
  key: string; produitId: string | null; produitNom: string;
  qpe: number; typeUnite: 'U' | 'C'; quantite: number;
  prix: number; estNouveau: boolean; mettreAJourPrix: boolean;
}

interface LigneFiche {
  mouvId: string; produitId: string; produitNom: string;
  quantite: number; typeUnite: 'U' | 'C'; prixSaisi: number;
  totalLigne: number; qpe: number; estNouveau: boolean;
  quantiteDepot?: number; depotTraite?: boolean;
}

interface Modification {
  id: string; produitNom: string; champ: string;
  ancienneValeur: any; nouvelleValeur: any; date: any;
}

/* - layout sans sidebar - */
function FullLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-50 dark:bg-gray-950">{children}</div>;
}

/* ════════════════════════════════════════════════════════════ */
export default function ImportationPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [etape, setEtape] = useState<Etape>('liste');
  const [importationSelectee, setImportationSelectee] = useState<Importation | null>(null);

  /* - liste - */
  const [importations, setImportations] = useState<Importation[]>([]);
  const [loadingListe, setLoadingListe] = useState(true);
  const [filtreStatut, setFiltreStatut] = useState<'tout' | 'en_cours' | 'traite' | 'termine'>('tout');
  const [triValeur, setTriValeur] = useState<'aucun' | 'desc' | 'asc'>('aucun');

  /* - création - */
  const [produits, setProduits] = useState<ProduitDB[]>([]);
  const [lignesCreation, setLignesCreation] = useState<LigneCreation[]>([]);
  const [recherche, setRecherche] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [erreurCreation, setErreurCreation] = useState('');
  const [showModalNouv, setShowModalNouv] = useState(false);
  const [nouvNom, setNouvNom] = useState('');
  const [nouvQpe, setNouvQpe] = useState(1);
  const [nouvPrix, setNouvPrix] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /* - fiche - */
  const [lignesFiche, setLignesFiche] = useState<LigneFiche[]>([]);
  const [modifications, setModifications] = useState<Modification[]>([]);
  const [loadingFiche, setLoadingFiche] = useState(false);
  const [tabFiche, setTabFiche] = useState<'produits' | 'modifications'>('produits');
  const [expandedMods, setExpandedMods] = useState<Set<string>>(new Set());
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editQte, setEditQte] = useState(0);
  const [editPrix, setEditPrix] = useState(0);
  const [editNom, setEditNom] = useState('');
  const [editMajPrix, setEditMajPrix] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [erreurEdit, setErreurEdit] = useState('');
  const [showModalConfirm, setShowModalConfirm] = useState(false);
  const [savingConfirm, setSavingConfirm] = useState(false);
  const [filtreEcart, setFiltreEcart] = useState<'tout' | 'avec_ecart' | 'sans_ecart'>('tout');
  const [rechercheFiche, setRechercheFiche] = useState('');

  /* - ajout produit dans fiche - */
  const [showModalAjoutFiche, setShowModalAjoutFiche] = useState(false);
  const [ajoutRecherche, setAjoutRecherche] = useState('');
  const [ajoutProduits, setAjoutProduits] = useState<ProduitDB[]>([]);
  const [ajoutSelectee, setAjoutSelectee] = useState<ProduitDB | null>(null);
  const [ajoutNom, setAjoutNom] = useState('');
  const [ajoutQpe, setAjoutQpe] = useState(1);
  const [ajoutTypeUnite, setAjoutTypeUnite] = useState<'U' | 'C'>('C');
  const [ajoutQte, setAjoutQte] = useState(0);
  const [ajoutPrix, setAjoutPrix] = useState(0);
  const [ajoutEstNouveau, setAjoutEstNouveau] = useState(false);
  const [savingAjout, setSavingAjout] = useState(false);
  const [erreurAjout, setErreurAjout] = useState('');

  const lignesFicheFiltrees = useMemo(() => {
    let list = lignesFiche;
    if (filtreEcart === 'avec_ecart') list = list.filter(l => l.depotTraite && l.quantiteDepot !== l.quantite);
    if (filtreEcart === 'sans_ecart') list = list.filter(l => !l.depotTraite || l.quantiteDepot === l.quantite);
    if (rechercheFiche.trim()) {
      const q = rechercheFiche.toLowerCase();
      list = list.filter(l => l.produitNom.toLowerCase().includes(q));
    }
    return list;
  }, [lignesFiche, filtreEcart, rechercheFiche]);

  /* ══════════ LOAD LISTE ══════════ */
  async function chargerImportations() {
    if (!user) return;
    setLoadingListe(true);
    const [impSnap, mouvSnap] = await Promise.all([
      getDocs(query(collection(db, 'importations'), where('userId', '==', user.uid))),
      getDocs(query(collection(db, 'mouvements'), where('userId', '==', user.uid), where('typeTransaction', '==', 'Achat'))),
    ]);

    // Calcul valeurTotale + nombreDeProduit depuis les mouvements pour les docs sans ces champs
    const valeurParImp: Record<string, number> = {};
    const compteParImp: Record<string, number> = {};
    mouvSnap.forEach(d => {
      const impRef = (d.data().importationId as any);
      if (!impRef) return;
      const impId = impRef.id || impRef;
      valeurParImp[impId] = (valeurParImp[impId] || 0) + (d.data().totalLigne || 0);
      compteParImp[impId] = (compteParImp[impId] || 0) + 1;
    });

    const data = impSnap.docs.map(d => {
      const base = { id: d.id, ...d.data() } as Importation;
      return {
        ...base,
        valeurTotale: base.valeurTotale ?? valeurParImp[d.id] ?? 0,
        nombreDeProduit: base.nombreDeProduit ?? compteParImp[d.id] ?? 0,
      };
    });
    data.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
    setImportations(data);
    setLoadingListe(false);
  }

  useEffect(() => { chargerImportations(); }, [user]);

  /* click outside dropdown */
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ══════════ OUVRIR CRÉATION ══════════ */
  async function ouvrirCreation() {
    if (!user) return;
    const snap = await getDocs(query(collection(db, 'Produits'), where('userId', '==', user.uid)));
    setProduits(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProduitDB)));
    setLignesCreation([]);
    setRecherche('');
    setErreurCreation('');
    setEtape('creation');
  }

  /* ══════════ OUVRIR FICHE ══════════ */
  async function ouvrirFiche(imp: Importation) {
    if (!user) return;
    setImportationSelectee(imp);
    setTabFiche('produits');
    setExpandedMods(new Set());
    setEditKey(null);
    setLoadingFiche(true);
    setEtape('fiche');

    const impRef = doc(db, 'importations', imp.id);
    const [allMouvSnap, modSnap, prodsSnap] = await Promise.all([
      getDocs(query(collection(db, 'mouvements'), where('userId', '==', user.uid))),
      getDocs(query(collection(db, 'importation_modifications'), where('importationId', '==', impRef))),
      getDocs(query(collection(db, 'Produits'), where('userId', '==', user.uid))),
    ]);

    const prodMap: Record<string, ProduitDB> = {};
    prodsSnap.forEach(d => { prodMap[d.id] = { id: d.id, ...d.data() } as ProduitDB; });

    const lignes: LigneFiche[] = allMouvSnap.docs
      .filter(d => (d.data().importationId as any)?.id === imp.id)
      .map(d => {
        const m = d.data();
        const prodId = (m.produitId as any)?.id || '';
        const qpe = prodMap[prodId]?.quantite_par_emballage || 1;
        return {
          mouvId: d.id, produitId: prodId, produitNom: m.produitNom,
          quantite: m.quantite, typeUnite: m.typeUnite,
          prixSaisi: m.quantite ? Math.round(m.totalLigne / m.quantite) : 0,
          totalLigne: m.totalLigne, qpe, estNouveau: m.estNouveauProduit || false,
          quantiteDepot: m.quantiteDepot, depotTraite: m.depotTraite || false,
        };
      });

    const mods = modSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as Modification))
      .sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));

    setLignesFiche(lignes);
    setModifications(mods);
    setLoadingFiche(false);
  }

  /* ══════════ CRÉATION: helpers ══════════ */
  const produitsDisponibles = useMemo(() => {
    const dejaDans = new Set(lignesCreation.map(l => l.produitId).filter(Boolean));
    return produits
      .filter(p => !dejaDans.has(p.id) && p.designation.toLowerCase().includes(recherche.toLowerCase()))
      .slice(0, 8);
  }, [produits, lignesCreation, recherche]);

  function ajouterProduitExistant(p: ProduitDB) {
    setLignesCreation(prev => [...prev, {
      key: `ex-${p.id}`, produitId: p.id, produitNom: p.designation,
      qpe: p.quantite_par_emballage || 1, typeUnite: 'C',
      quantite: 0, prix: Math.round((p.prix_unitaire || 0) * (p.quantite_par_emballage || 1)),
      estNouveau: false, mettreAJourPrix: false,
    }]);
    setRecherche(''); setShowDropdown(false);
  }

  function ajouterNouveauProduit() {
    if (!nouvNom.trim()) return;
    setLignesCreation(prev => [...prev, {
      key: `new-${Date.now()}`, produitId: null, produitNom: nouvNom.trim(),
      qpe: nouvQpe || 1, typeUnite: 'C', quantite: 0,
      prix: nouvPrix, estNouveau: true, mettreAJourPrix: false,
    }]);
    setNouvNom(''); setNouvQpe(1); setNouvPrix(0); setShowModalNouv(false);
  }

  function updateLigne(key: string, patch: Partial<LigneCreation>) {
    setLignesCreation(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  }

  const totalCreation = useMemo(
    () => lignesCreation.reduce((s, l) => s + l.prix * l.quantite, 0),
    [lignesCreation],
  );

  /* ══════════ VALIDER CRÉATION ══════════ */
  async function validerCreation() {
    if (!user) return;
    const actives = lignesCreation.filter(l => l.quantite > 0);
    if (actives.length === 0) {
      setErreurCreation('Ajoutez au moins un produit avec une quantité.'); return;
    }
    setSaving(true); setErreurCreation('');
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();

      const existSnap = await getDocs(query(collection(db, 'importations'), where('userId', '==', user.uid)));
      const numero = `CTN-${String(existSnap.size + 1).padStart(3, '0')}`;

      const impRef = doc(collection(db, 'importations'));
      batch.set(impRef, {
        userId: user.uid, numero, date: now,
        nombreDeProduit: actives.length, nombreDeProduitModifie: 0,
        nombreProduitTraite: 0,
        valeurTotale: totalCreation, produitsModifies: [],
        statut: 'en_cours',
      });

      for (const l of actives) {
        const total = l.prix * l.quantite;
        const prixPerUnit = l.typeUnite === 'C' ? l.prix / l.qpe : l.prix;

        let prodId = l.produitId;
        if (!prodId) {
          // Nouveau produit : créé avec stock 0, sera mis à jour à la confirmation
          const newProdRef = doc(collection(db, 'Produits'));
          batch.set(newProdRef, {
            userId: user.uid, designation: l.produitNom,
            quantite_par_emballage: l.qpe, prix_unitaire: prixPerUnit,
            quantite_unitaire_total: 0,
          });
          prodId = newProdRef.id;
        }
        // Pas de mise à jour stock ni prix pour les produits existants

        batch.set(doc(collection(db, 'mouvements')), {
          userId: user.uid, typeDocument: 'Entrée', typeTransaction: 'Achat',
          produitNom: l.produitNom, produitId: doc(db, 'Produits', prodId!),
          quantite: l.quantite, typeUnite: l.typeUnite,
          prixUnitaireReel: prixPerUnit, totalLigne: total,
          importationId: impRef, nomClient: 'Importation',
          estNouveauProduit: l.estNouveau, date: now,
        });
      }

      await batch.commit();
      await chargerImportations();
      setEtape('liste');
    } catch (e) {
      console.error(e); setErreurCreation('Erreur lors de la validation. Réessayez.');
    } finally {
      setSaving(false);
    }
  }

  /* ══════════ FICHE: CONFIRMER IMPORTATION ══════════ */
  async function confirmerImportation() {
    if (!user || !importationSelectee) return;
    setSavingConfirm(true);
    try {
      const batch = writeBatch(db);
      const impRef = doc(db, 'importations', importationSelectee.id);

      // Appliquer les quantités admin sur le stock de chaque produit
      for (const l of lignesFiche) {
        const qteU = l.typeUnite === 'C' ? l.quantite * l.qpe : l.quantite;
        const prixPerUnit = l.typeUnite === 'C' ? l.prixSaisi / l.qpe : l.prixSaisi;
        if (l.produitId) {
          batch.update(doc(db, 'Produits', l.produitId), {
            quantite_unitaire_total: increment(qteU),
            prix_unitaire: prixPerUnit,
          });
        }
      }

      batch.update(impRef, { statut: 'termine', confirmeAt: serverTimestamp() });
      await batch.commit();
      router.refresh(); // invalide le cache pour que le dashboard se rafraîchisse
      setImportationSelectee(prev => prev ? { ...prev, statut: 'termine' } : prev);
      setShowModalConfirm(false);
      await chargerImportations();
    } catch (e) { console.error(e); }
    finally { setSavingConfirm(false); }
  }

  /* ══════════ FICHE: MODIFIER PRODUIT ══════════ */
  function startEdit(l: LigneFiche) {
    setEditKey(l.mouvId); setEditQte(l.quantite);
    setEditPrix(l.prixSaisi); setEditNom(l.produitNom); setEditMajPrix(false);
  }

  async function validerEdit(l: LigneFiche) {
    if (!user || !importationSelectee) return;
    const mouvPatch: Record<string, any> = {};
    const modRecords: { champ: string; ancien: any; nouveau: any }[] = [];

    const newQte = editQte;
    const newPrix = editPrix;
    const newNom = editNom.trim();

    const estTermine = importationSelectee.statut === 'termine';
    const prodPatch: Record<string, any> = {};

    if (newQte !== l.quantite) {
      mouvPatch.quantite = newQte;
      if (estTermine) {
        // Appliquer le delta sur le stock (la confirmation avait déjà crédité l'ancienne qté)
        const oldU = l.typeUnite === 'C' ? l.quantite * l.qpe : l.quantite;
        const newU = l.typeUnite === 'C' ? newQte * l.qpe : newQte;
        prodPatch.quantite_unitaire_total = increment(newU - oldU);
      }
      modRecords.push({ champ: 'quantite', ancien: l.quantite, nouveau: newQte });
    }

    if (newPrix !== l.prixSaisi) {
      const prixPerUnit = l.typeUnite === 'C' ? newPrix / l.qpe : newPrix;
      mouvPatch.prixUnitaireReel = prixPerUnit;
      if (estTermine) prodPatch.prix_unitaire = prixPerUnit;
      modRecords.push({ champ: 'prix', ancien: l.prixSaisi, nouveau: newPrix });
    }

    mouvPatch.totalLigne = newQte * newPrix;

    if (l.estNouveau && newNom !== l.produitNom) {
      mouvPatch.produitNom = newNom;
      prodPatch.designation = newNom;
      modRecords.push({ champ: 'designation', ancien: l.produitNom, nouveau: newNom });
    }

    if (modRecords.length === 0) { setEditKey(null); return; }

    // Vérifier que le réajustement ne crée pas un stock négatif
    if (estTermine && newQte !== l.quantite && l.produitId) {
      const oldU = l.typeUnite === 'C' ? l.quantite * l.qpe : l.quantite;
      const newU2 = l.typeUnite === 'C' ? newQte * l.qpe : newQte;
      const delta = newU2 - oldU;
      if (delta < 0) {
        const prodSnap2 = await getDoc(doc(db, 'Produits', l.produitId));
        const stockActuel = (prodSnap2.data()?.quantite_unitaire_total ?? 0) as number;
        if (stockActuel + delta < 0) {
          setErreurEdit(`Réajustement impossible : stock actuel ${stockActuel} unité(s), retrait demandé ${-delta} unité(s).`);
          return;
        }
      }
    }
    setErreurEdit('');

    setSavingEdit(true);
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();
      const impRef = doc(db, 'importations', importationSelectee.id);
      const mouvRef = doc(db, 'mouvements', l.mouvId);

      batch.update(mouvRef, mouvPatch);
      if (Object.keys(prodPatch).length > 0 && l.produitId) {
        batch.update(doc(db, 'Produits', l.produitId), prodPatch);
      }

      for (const mod of modRecords) {
        batch.set(doc(collection(db, 'importation_modifications')), {
          userId: user.uid, importationId: impRef,
          produitNom: l.produitNom, produitId: doc(db, 'Produits', l.produitId),
          champ: mod.champ, ancienneValeur: mod.ancien, nouvelleValeur: mod.nouveau, date: now,
        });
      }

      const newValeurTotale = lignesFiche
        .map(lf => lf.mouvId === l.mouvId ? newQte * newPrix : lf.totalLigne)
        .reduce((s, v) => s + v, 0);

      const dejaModifie = (importationSelectee.produitsModifies ?? []).includes(l.produitNom);
      batch.update(impRef, {
        valeurTotale: newValeurTotale,
        ...(dejaModifie ? {} : {
          nombreDeProduitModifie: increment(1),
          produitsModifies: arrayUnion(l.produitNom),
        }),
      });

      await batch.commit();
      router.refresh(); // invalide le cache dashboard pour refléter les nouvelles quantités
      const updSnap = await getDoc(impRef);
      if (updSnap.exists()) setImportationSelectee({ id: updSnap.id, ...updSnap.data() } as Importation);
      await ouvrirFiche({ id: importationSelectee.id, ...updSnap.data() } as Importation);
    } catch (e) {
      console.error(e);
    } finally {
      setSavingEdit(false); setEditKey(null);
    }
  }

  /* ══════════ FICHE: AJOUT PRODUIT ══════════ */
  async function ouvrirModalAjoutFiche() {
    if (!user) return;
    const snap = await getDocs(query(collection(db, 'Produits'), where('userId', '==', user.uid)));
    setAjoutProduits(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProduitDB)));
    setAjoutRecherche(''); setAjoutSelectee(null);
    setAjoutNom(''); setAjoutQpe(1); setAjoutTypeUnite('C');
    setAjoutQte(0); setAjoutPrix(0); setAjoutEstNouveau(false); setErreurAjout('');
    setShowModalAjoutFiche(true);
  }

  async function validerAjoutFiche() {
    if (!user || !importationSelectee) return;
    if (ajoutQte <= 0) { setErreurAjout('La quantité doit être supérieure à 0.'); return; }
    if (ajoutEstNouveau && !ajoutNom.trim()) { setErreurAjout('Saisissez un nom de produit.'); return; }
    if (!ajoutEstNouveau && !ajoutSelectee) { setErreurAjout('Sélectionnez un produit.'); return; }

    setSavingAjout(true); setErreurAjout('');
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();
      const impRef = doc(db, 'importations', importationSelectee.id);
      const estTermine = importationSelectee.statut === 'termine';

      const prixPerUnit = ajoutTypeUnite === 'C' ? ajoutPrix / ajoutQpe : ajoutPrix;
      const total = ajoutQte * ajoutPrix;
      const qteU = ajoutTypeUnite === 'C' ? ajoutQte * ajoutQpe : ajoutQte;

      let prodId: string;
      let prodNom: string;

      if (ajoutEstNouveau) {
        const newProdRef = doc(collection(db, 'Produits'));
        prodId = newProdRef.id;
        prodNom = ajoutNom.trim();
        batch.set(newProdRef, {
          userId: user.uid, designation: prodNom,
          quantite_par_emballage: ajoutQpe, prix_unitaire: prixPerUnit,
          quantite_unitaire_total: estTermine ? qteU : 0,
        });
      } else {
        prodId = ajoutSelectee!.id;
        prodNom = ajoutSelectee!.designation;
        if (estTermine) {
          batch.update(doc(db, 'Produits', prodId), {
            quantite_unitaire_total: increment(qteU),
            prix_unitaire: prixPerUnit,
          });
        }
      }

      const mouvRef = doc(collection(db, 'mouvements'));
      batch.set(mouvRef, {
        userId: user.uid, typeDocument: 'Entrée', typeTransaction: 'Achat',
        produitNom: prodNom, produitId: doc(db, 'Produits', prodId),
        quantite: ajoutQte, typeUnite: ajoutTypeUnite,
        prixUnitaireReel: prixPerUnit, totalLigne: total,
        importationId: impRef, nomClient: 'Importation',
        estNouveauProduit: ajoutEstNouveau, date: now,
      });

      const newValeur = lignesFiche.reduce((s, l) => s + l.totalLigne, 0) + total;
      batch.update(impRef, {
        nombreDeProduit: increment(1),
        valeurTotale: newValeur,
      });

      await batch.commit();
      router.refresh();
      setShowModalAjoutFiche(false);
      await ouvrirFiche(importationSelectee);
      const updSnap = await getDoc(doc(db, 'importations', importationSelectee.id));
      if (updSnap.exists()) setImportationSelectee({ id: updSnap.id, ...updSnap.data() } as Importation);
    } catch (e) {
      console.error(e); setErreurAjout('Erreur lors de l\'ajout.');
    } finally {
      setSavingAjout(false);
    }
  }

  /* ══════════ MODS PAR PRODUIT ══════════ */
  const modsParProduit = useMemo(() => {
    const map: Record<string, Modification[]> = {};
    modifications.forEach(m => {
      if (!map[m.produitNom]) map[m.produitNom] = [];
      map[m.produitNom].push(m);
    });
    return map;
  }, [modifications]);

  /* - helpers statut (utilisés dans fiche et liste) - */
  const statutLabel = (s?: string) => {
    if (s === 'traite') return 'Traité';
    if (s === 'termine') return 'Terminé';
    return 'En cours';
  };
  const statutClasses = (s?: string) => {
    if (s === 'traite') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400';
    if (s === 'termine') return 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400';
    return 'bg-orange-100 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400';
  };

  const importationsFiltrees = useMemo(() => {
    const filtered = importations.filter(imp =>
      filtreStatut === 'tout' ? true : (imp.statut ?? 'en_cours') === filtreStatut,
    );
    if (triValeur === 'desc') return [...filtered].sort((a, b) => (b.valeurTotale || 0) - (a.valeurTotale || 0));
    if (triValeur === 'asc') return [...filtered].sort((a, b) => (a.valeurTotale || 0) - (b.valeurTotale || 0));
    return filtered;
  }, [importations, filtreStatut, triValeur]);
  const totalValeur = importationsFiltrees.reduce((s, i) => s + (i.valeurTotale || 0), 0);

  /* ════════════════════════════════════
     RENDER — CRÉATION
  ════════════════════════════════════ */
  if (etape === 'creation') return (
    <FullLayout>
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => setEtape('liste')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
          <div className="flex-1">
            <p className="text-xs text-gray-400">Nouvelle importation</p>
            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">Plan de travail</p>
          </div>
          <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-full">
            {lignesCreation.filter(l => l.quantite > 0).length} produit(s)
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 pb-32">
        {/* Barre ajout */}
        <div className="flex gap-2 mb-5" ref={dropdownRef}>
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" placeholder="Rechercher un produit existant..."
              value={recherche}
              onChange={e => { setRecherche(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 dark:text-gray-100"
            />
            {showDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-10 max-h-60 overflow-y-auto">
                {produitsDisponibles.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-4">
                    {recherche ? 'Aucun résultat' : 'Commencez à taper...'}
                  </p>
                ) : produitsDisponibles.map(p => (
                  <button key={p.id} onClick={() => ajouterProduitExistant(p)}
                    className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-left text-sm transition-colors">
                    <Package2 size={14} className="text-gray-400 shrink-0" />
                    <span className="flex-1 font-medium text-gray-900 dark:text-gray-100">{p.designation}</span>
                    <span className="text-xs text-gray-400">QPE {p.quantite_par_emballage} · {formatMontant(p.prix_unitaire)}/u</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setShowModalNouv(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors shrink-0">
            <Plus size={15} /> Nouveau produit
          </button>
        </div>

        {/* Table */}
        {lignesCreation.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-16 text-center">
            <Ship size={44} className="mx-auto text-gray-200 dark:text-gray-700 mb-4" />
            <p className="font-semibold text-gray-400 dark:text-gray-500 mb-1">Plan de travail vide</p>
            <p className="text-sm text-gray-400 dark:text-gray-600">Recherchez un produit existant ou ajoutez-en un nouveau</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Produit</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500 w-20">Type</th>
                    <th className="text-right px-3 py-3 font-medium text-gray-500 w-28">Quantité</th>
                    <th className="text-right px-3 py-3 font-medium text-gray-500 w-32">Prix/unit.</th>
                    <th className="text-right px-3 py-3 font-medium text-gray-500 w-32">Total</th>
                    <th className="w-8" />
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {lignesCreation.map(l => {
                    const unit = l.typeUnite === 'C' ? 'ctn' : 'u';
                    return (
                      <tr key={l.key} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            {l.estNouveau ? (
                              <input value={l.produitNom}
                                onChange={e => updateLigne(l.key, { produitNom: e.target.value })}
                                className="font-medium text-gray-900 dark:text-gray-100 bg-transparent border-b border-dashed border-indigo-300 focus:outline-none focus:border-indigo-500 min-w-0 w-40"
                              />
                            ) : (
                              <span className="font-medium text-gray-900 dark:text-gray-100">{l.produitNom}</span>
                            )}
                            {l.estNouveau && (
                              <span className="text-xs font-semibold px-1.5 py-0.5 bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 rounded-full shrink-0">Nouveau</span>
                            )}
                          </div>
                          {l.estNouveau && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-xs text-gray-400">QPE :</span>
                              <input type="number" min={1} value={l.qpe}
                                onChange={e => updateLigne(l.key, { qpe: parseInt(e.target.value) || 1 })}
                                className="w-12 text-xs text-gray-600 dark:text-gray-400 bg-transparent border-b border-dashed border-gray-300 focus:outline-none" />
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                            {(['U', 'C'] as const).map(t => (
                              <button key={t} onClick={() => {
                                const newPrix = t !== l.typeUnite
                                  ? (t === 'C' ? Math.round(l.prix * l.qpe) : Math.round(l.prix / l.qpe))
                                  : l.prix;
                                updateLigne(l.key, { typeUnite: t, prix: newPrix });
                              }}
                                className={`px-2.5 py-1 text-xs font-semibold transition-colors ${l.typeUnite === t ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                                {t}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <input type="number" min={0} value={l.quantite || ''}
                              onChange={e => updateLigne(l.key, { quantite: parseInt(e.target.value) || 0 })}
                              placeholder="0"
                              className="w-20 text-right border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white dark:bg-gray-800 dark:text-gray-100" />
                            <span className="text-xs text-gray-400 w-6">{unit}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <input type="number" min={0} value={l.prix || ''}
                            onChange={e => updateLigne(l.key, { prix: parseFloat(e.target.value) || 0 })}
                            placeholder="0"
                            className="w-28 text-right border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white dark:bg-gray-800 dark:text-gray-100" />
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-gray-800 dark:text-gray-200">
                          {formatMontant(l.prix * l.quantite)}
                        </td>
                        <td />
                        <td className="px-2 py-3 text-center">
                          <button onClick={() => setLignesCreation(prev => prev.filter(x => x.key !== l.key))}
                            className="text-gray-300 hover:text-red-400 transition-colors p-1">
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50 dark:bg-gray-800 border-t-2 border-gray-200 dark:border-gray-700">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 font-bold text-gray-900 dark:text-gray-100">Total importation</td>
                    <td className="px-3 py-3 text-right font-bold text-lg text-green-600">{formatMontant(totalCreation)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {erreurCreation && (
          <div className="mt-4 flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl border border-red-200 dark:border-red-800">
            <AlertCircle size={15} className="shrink-0" /> {erreurCreation}
          </div>
        )}
      </main>

      {/* Footer fixe */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-4 py-4 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">
              {lignesCreation.filter(l => l.quantite > 0).length} produit(s)
              {lignesCreation.filter(l => l.estNouveau && l.quantite > 0).length > 0 && ` · ${lignesCreation.filter(l => l.estNouveau && l.quantite > 0).length} nouveau(x)`}
            </p>
            <p className="font-bold text-lg text-green-600">{formatMontant(totalCreation)}</p>
          </div>
          <button onClick={validerCreation}
            disabled={saving || lignesCreation.filter(l => l.quantite > 0).length === 0}
            className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:text-gray-400 text-white font-semibold rounded-xl transition-colors shadow-md">
            {saving
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Check size={16} />}
            {saving ? 'Validation...' : 'Valider l\'importation'}
          </button>
        </div>
      </div>

      {/* Modal nouveau produit */}
      {showModalNouv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModalNouv(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-96 mx-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-gray-900 dark:text-gray-100">Nouveau produit</h3>
              <button onClick={() => setShowModalNouv(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Désignation *</label>
                <input value={nouvNom} onChange={e => setNouvNom(e.target.value)}
                  placeholder="Nom du produit"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 dark:text-gray-100" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Qté par emballage</label>
                  <input type="number" min={1} value={nouvQpe}
                    onChange={e => setNouvQpe(parseInt(e.target.value) || 1)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 dark:text-gray-100" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Prix unitaire</label>
                  <input type="number" min={0} value={nouvPrix}
                    onChange={e => setNouvPrix(parseFloat(e.target.value) || 0)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 dark:text-gray-100" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowModalNouv(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
                Annuler
              </button>
              <button onClick={ajouterNouveauProduit} disabled={!nouvNom.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:text-gray-400 text-white transition-colors">
                Ajouter
              </button>
            </div>
          </div>
        </div>
      )}
    </FullLayout>
  );

  /* ════════════════════════════════════
     RENDER — FICHE
  ════════════════════════════════════ */
  if (etape === 'fiche' && importationSelectee) return (
    <FullLayout>
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => setEtape('liste')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-bold text-gray-900 dark:text-gray-100 font-mono">{importationSelectee.numero}</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statutClasses(importationSelectee.statut)}`}>
                {statutLabel(importationSelectee.statut)}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{formatDate(importationSelectee.date)}</p>
          </div>
          <div className="flex items-center gap-2">
            <p className="font-bold text-green-600">{formatMontant(importationSelectee.valeurTotale ?? lignesFiche.reduce((s, l) => s + (l.totalLigne || 0), 0))}</p>
            <button onClick={ouvrirModalAjoutFiche}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors">
              <Plus size={13} /> Produit
            </button>
            {importationSelectee.statut !== 'termine' && (
              <button onClick={() => setShowModalConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition-colors">
                <Check size={13} /> Confirmer
              </button>
            )}
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-5xl mx-auto px-4 flex gap-0 border-t border-gray-100 dark:border-gray-800">
          {([['produits', 'Produits'], ['modifications', 'Modifications']] as const).map(([tab, label]) => (
            <button key={tab} onClick={() => setTabFiche(tab)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${tabFiche === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {label}
              {tab === 'modifications' && modifications.length > 0 && (
                <span className="ml-1.5 text-xs bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 px-1.5 py-0.5 rounded-full">{modifications.length}</span>
              )}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Stats */}
        {(() => {
          const filtre = filtreEcart !== 'tout';
          return (
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label: filtre ? 'Produits filtrés' : 'Produits', value: filtre ? `${lignesFicheFiltrees.length}/${lignesFiche.length}` : (importationSelectee.nombreDeProduit ?? lignesFiche.length), color: 'text-gray-900 dark:text-gray-100' },
                { label: 'Modifiés', value: filtre ? lignesFicheFiltrees.filter(l => importationSelectee.produitsModifies?.includes(l.produitNom)).length : (importationSelectee.nombreDeProduitModifie ?? 0), color: 'text-orange-500' },
                { label: 'Valeur totale', value: formatMontant(lignesFicheFiltrees.reduce((s, l) => s + (l.totalLigne || 0), 0)), color: 'text-green-600' },
              ].map(s => (
                <div key={s.label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 p-4 text-center shadow-sm">
                  <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                  <p className={`font-bold text-lg ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          );
        })()}

        {loadingFiche ? (
          <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : tabFiche === 'produits' ? (
          /* - ONGLET PRODUITS - */
          <>
          {/* Recherche produit */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={rechercheFiche} onChange={e => setRechercheFiche(e.target.value)}
              placeholder="Rechercher un produit..."
              className="w-full pl-9 pr-8 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            {rechercheFiche && (
              <button onClick={() => setRechercheFiche('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filtre écart */}
          <div className="flex gap-2 mb-3">
            {(['tout', 'avec_ecart', 'sans_ecart'] as const).map(f => (
              <button key={f} onClick={() => setFiltreEcart(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border
                  ${filtreEcart === f
                    ? f === 'avec_ecart' ? 'bg-red-500 text-white border-red-500'
                      : f === 'sans_ecart' ? 'bg-green-600 text-white border-green-600'
                      : 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'
                  }`}>
                {f === 'tout' ? 'Tout' : f === 'avec_ecart' ? 'Avec écart' : 'Sans écart'}
              </button>
            ))}
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">#</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Produit</th>
                    <th className="text-center px-3 py-3 font-medium text-gray-500">Type</th>
                    <th className="text-right px-3 py-3 font-medium text-gray-500">Qté achetée</th>
                    <th className="text-right px-3 py-3 font-medium text-blue-500">Qté dépôt</th>
                    <th className="text-right px-3 py-3 font-medium text-gray-500">Écart</th>
                    <th className="text-right px-3 py-3 font-medium text-gray-500">Prix/unit.</th>
                    <th className="text-right px-3 py-3 font-medium text-gray-500">Total</th>
                    <th className="w-24 text-center px-3 py-3 font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lignesFicheFiltrees.map((l, i) => {
                    const isEditing = editKey === l.mouvId;
                    const unit = l.typeUnite === 'C' ? 'ctn' : 'u';
                    const modsL = modsParProduit[l.produitNom] || [];
                    const expanded = expandedMods.has(l.mouvId);

                    return (
                      <React.Fragment key={l.mouvId}>
                        <tr className={`border-t border-gray-50 dark:border-gray-800 ${isEditing ? 'bg-indigo-50/40 dark:bg-indigo-900/10' : 'hover:bg-gray-50/50 dark:hover:bg-gray-800/30'}`}>
                          <td className="px-4 py-3 text-xs font-bold text-gray-300">{i + 1}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {isEditing && l.estNouveau ? (
                                <input value={editNom} onChange={e => setEditNom(e.target.value)}
                                  className="font-medium border-b border-indigo-400 bg-transparent focus:outline-none text-gray-900 dark:text-gray-100 w-40" />
                              ) : (
                                <span className="font-medium text-gray-900 dark:text-gray-100">{l.produitNom}</span>
                              )}
                              {l.estNouveau && <span className="text-xs font-semibold px-1.5 py-0.5 bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 rounded-full shrink-0">Nouveau</span>}
                              {modsL.length > 0 && <span className="text-xs font-semibold px-1.5 py-0.5 bg-orange-100 text-orange-500 rounded-full shrink-0">{modsL.length} modif.</span>}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${l.typeUnite === 'C' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>
                              {l.typeUnite}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            {isEditing ? (
                              <input type="number" min={0} value={editQte}
                                onChange={e => setEditQte(parseInt(e.target.value) || 0)}
                                className="w-20 text-right border border-indigo-300 dark:border-indigo-600 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white dark:bg-gray-800 dark:text-gray-100" />
                            ) : (
                              <span className="text-gray-700 dark:text-gray-300">{l.quantite.toLocaleString('fr-FR')} <span className="text-xs text-gray-400">{unit}</span></span>
                            )}
                          </td>
                          {/* Qté dépôt */}
                          <td className="px-3 py-3 text-right">
                            {l.depotTraite ? (
                              <span className="font-semibold text-blue-600">
                                {(l.quantiteDepot ?? 0).toLocaleString('fr-FR')} <span className="text-xs font-normal text-gray-400">{unit}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-gray-300 italic">En attente</span>
                            )}
                          </td>
                          {/* Écart */}
                          <td className="px-3 py-3 text-right">
                            {l.depotTraite ? (() => {
                              const ecart = (l.quantiteDepot ?? 0) - l.quantite;
                              return ecart === 0
                                ? <span className="text-xs text-green-500 font-semibold">✓</span>
                                : <span className={`text-xs font-bold ${ecart > 0 ? 'text-blue-500' : 'text-red-500'}`}>
                                    {ecart > 0 ? '+' : ''}{ecart}
                                  </span>;
                            })() : <span className="text-gray-200">—</span>}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {isEditing ? (
                              <input type="number" min={0} value={editPrix}
                                onChange={e => setEditPrix(parseFloat(e.target.value) || 0)}
                                className="w-28 text-right border border-indigo-300 dark:border-indigo-600 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white dark:bg-gray-800 dark:text-gray-100" />
                            ) : (
                              <span className="text-gray-600 dark:text-gray-400">{l.prixSaisi.toLocaleString('fr-FR')}<span className="text-xs text-gray-400 ml-1">/{unit}</span></span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-green-600">
                            {isEditing ? formatMontant(editQte * editPrix) : formatMontant(l.totalLigne)}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {isEditing ? (
                                <>
                                  <button onClick={() => validerEdit(l)} disabled={savingEdit}
                                    className="p-1.5 rounded-lg bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50 transition-colors">
                                    {savingEdit ? <div className="w-3.5 h-3.5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" /> : <Check size={14} />}
                                  </button>
                                  <button onClick={() => setEditKey(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                                    <X size={14} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => startEdit(l)} title="Modifier"
                                    className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                                    <Edit2 size={14} />
                                  </button>
                                  {modsL.length > 0 && (
                                    <button onClick={() => setExpandedMods(prev => {
                                      const next = new Set(prev);
                                      next.has(l.mouvId) ? next.delete(l.mouvId) : next.add(l.mouvId);
                                      return next;
                                    })} title="Voir les modifications"
                                      className={`p-1.5 rounded-lg transition-colors ${expanded ? 'bg-orange-100 text-orange-500 dark:bg-orange-900/30' : 'text-gray-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20'}`}>
                                      <Info size={14} />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {/* Ligne dépliée modifications produit */}
                        {expanded && modsL.length > 0 && (
                          <tr className="bg-orange-50/50 dark:bg-orange-900/5 border-t border-orange-100 dark:border-orange-900/20">
                            <td colSpan={7} className="px-6 py-3">
                              <p className="text-xs font-semibold text-orange-500 mb-2 uppercase tracking-wider">Modifications</p>
                              <div className="space-y-1.5">
                                {modsL.map(mod => (
                                  <div key={mod.id} className="flex items-center gap-3 text-xs">
                                    <span className="text-gray-400"><Clock size={11} className="inline mr-1" />{formatDate(mod.date)}</span>
                                    <span className="font-semibold text-gray-600 dark:text-gray-400 capitalize">{mod.champ}</span>
                                    <span className="text-gray-400">{String(mod.ancienneValeur)}</span>
                                    <span className="text-gray-300">→</span>
                                    <span className="font-semibold text-orange-600 dark:text-orange-400">{String(mod.nouvelleValeur)}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50 dark:bg-gray-800 border-t-2 border-gray-200 dark:border-gray-700">
                  <tr>
                    <td colSpan={7} className="px-4 py-3 font-bold text-gray-900 dark:text-gray-100">Total général</td>
                    <td className="px-3 py-3 text-right font-bold text-lg text-green-600">
                      {formatMontant(lignesFicheFiltrees.reduce((s, l) => s + l.totalLigne, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          {erreurEdit && (
            <div className="mt-3 flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl border border-red-200 dark:border-red-800">
              <AlertCircle size={15} className="shrink-0" /> {erreurEdit}
            </div>
          )}
          </>
        ) : (
          /* - ONGLET MODIFICATIONS - */
          <div className="space-y-2">
            {modifications.length === 0 ? (
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 p-12 text-center">
                <History size={36} className="mx-auto text-gray-200 dark:text-gray-700 mb-3" />
                <p className="text-gray-400 text-sm">Aucune modification enregistrée</p>
              </div>
            ) : modifications.map(mod => (
              <div key={mod.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 px-5 py-3.5 flex items-center gap-4 shadow-sm">
                <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/20 rounded-lg flex items-center justify-center shrink-0">
                  <Edit2 size={14} className="text-orange-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">{mod.produitNom}</p>
                  <p className="text-xs text-gray-400 capitalize mt-0.5">
                    {mod.champ} : <span className="line-through">{String(mod.ancienneValeur)}</span>
                    <span className="mx-1.5 text-gray-300">→</span>
                    <span className="text-orange-500 font-medium">{String(mod.nouvelleValeur)}</span>
                  </p>
                </div>
                <p className="text-xs text-gray-400 whitespace-nowrap shrink-0">{formatDate(mod.date)}</p>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modal ajout produit dans fiche */}
      {showModalAjoutFiche && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowModalAjoutFiche(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <p className="font-bold text-gray-900 dark:text-gray-100 mb-4">
              Ajouter un produit
              {importationSelectee.statut === 'termine' && (
                <span className="ml-2 text-xs font-normal text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full">Stock crédité immédiatement</span>
              )}
            </p>

            {/* Toggle nouveau / existant */}
            <div className="flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-4">
              <button onClick={() => { setAjoutEstNouveau(false); setAjoutSelectee(null); setAjoutRecherche(''); }}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${!ajoutEstNouveau ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                Produit existant
              </button>
              <button onClick={() => { setAjoutEstNouveau(true); setAjoutSelectee(null); }}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${ajoutEstNouveau ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                Nouveau produit
              </button>
            </div>

            {!ajoutEstNouveau ? (
              /* Recherche produit existant */
              <div className="mb-4">
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={ajoutRecherche} onChange={e => setAjoutRecherche(e.target.value)}
                    placeholder="Rechercher un produit..."
                    className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {ajoutProduits
                    .filter(p => p.designation.toLowerCase().includes(ajoutRecherche.toLowerCase()))
                    .slice(0, 8)
                    .map(p => (
                      <button key={p.id} onClick={() => {
                        setAjoutSelectee(p);
                        setAjoutQpe(p.quantite_par_emballage || 1);
                        setAjoutPrix(Math.round((p.prix_unitaire || 0) * (p.quantite_par_emballage || 1)));
                        setAjoutRecherche(p.designation);
                      }}
                        className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-colors
                          ${ajoutSelectee?.id === p.id ? 'bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300' : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>
                        {p.designation}
                      </button>
                    ))}
                </div>
              </div>
            ) : (
              /* Nouveau produit */
              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Nom du produit</label>
                  <input value={ajoutNom} onChange={e => setAjoutNom(e.target.value)}
                    placeholder="Désignation..."
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Qté par emballage (QPE)</label>
                  <input type="number" min={1} value={ajoutQpe} onChange={e => setAjoutQpe(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
              </div>
            )}

            {/* Quantité + type + prix */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  {(['C', 'U'] as const).map(t => (
                    <button key={t} onClick={() => setAjoutTypeUnite(t)}
                      className={`flex-1 py-2 text-xs font-bold transition-colors ${ajoutTypeUnite === t ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                      {t === 'C' ? 'Ctn' : 'Unité'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Quantité</label>
                <input type="number" min={0} value={ajoutQte} onChange={e => setAjoutQte(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-center" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Prix/{ajoutTypeUnite === 'C' ? 'ctn' : 'u'}</label>
                <input type="number" min={0} value={ajoutPrix} onChange={e => setAjoutPrix(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-right" />
              </div>
            </div>

            {ajoutQte > 0 && ajoutPrix > 0 && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-2.5 text-center mb-4">
                <span className="text-xs text-gray-400">Total </span>
                <span className="font-bold text-green-600">{formatMontant(ajoutQte * ajoutPrix)}</span>
              </div>
            )}

            {erreurAjout && (
              <p className="text-xs text-red-500 mb-3">{erreurAjout}</p>
            )}

            <div className="flex gap-3">
              <button onClick={() => setShowModalAjoutFiche(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Annuler
              </button>
              <button onClick={validerAjoutFiche} disabled={savingAjout}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors">
                {savingAjout ? 'Ajout...' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmation importation */}
      {showModalConfirm && (() => {
        const nonTraites = lignesFiche.filter(l => !l.depotTraite);
        const avecEcart = lignesFiche.filter(l => l.depotTraite && l.quantiteDepot !== l.quantite);
        const avertissements = [
          nonTraites.length > 0 && `${nonTraites.length} produit(s) non encore traité(s) par le dépôt`,
          avecEcart.length > 0 && `${avecEcart.length} produit(s) avec des écarts de quantité`,
        ].filter(Boolean) as string[];

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowModalConfirm(false)} />
            <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${avertissements.length > 0 ? 'bg-orange-100 dark:bg-orange-900/30' : 'bg-green-100 dark:bg-green-900/30'}`}>
                  <AlertCircle size={22} className={avertissements.length > 0 ? 'text-orange-500' : 'text-green-600'} />
                </div>
                <div>
                  <p className="font-bold text-gray-900 dark:text-gray-100">Confirmer l'importation</p>
                  <p className="text-xs text-gray-400">{importationSelectee!.numero}</p>
                </div>
              </div>

              {avertissements.length > 0 ? (
                <div className="bg-orange-50 dark:bg-orange-900/10 rounded-xl border border-orange-200 dark:border-orange-800 p-4 mb-5">
                  <p className="text-sm font-semibold text-orange-700 dark:text-orange-400 mb-2">Attention</p>
                  <ul className="space-y-1">
                    {avertissements.map((a, i) => (
                      <li key={i} className="text-sm text-orange-600 dark:text-orange-300 flex items-start gap-2">
                        <span className="mt-0.5 shrink-0">•</span>{a}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-orange-500 dark:text-orange-400 mt-3">Tu peux quand même confirmer. Le stock sera mis à jour selon les quantités que tu as saisies (pas celles du dépôt).</p>
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
                  Tous les produits ont été vérifiés par le dépôt sans écart. L'importation sera marquée comme confirmée.
                </p>
              )}

              <div className="flex gap-3">
                <button onClick={() => setShowModalConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
                  Annuler
                </button>
                <button onClick={confirmerImportation} disabled={savingConfirm}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white">
                  {savingConfirm ? 'Confirmation...' : 'Confirmer quand même'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </FullLayout>
  );

  /* ════════════════════════════════════
     RENDER — LISTE (défaut)
  ════════════════════════════════════ */

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        {/* En-tête */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Importations</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{importationsFiltrees.length} conteneur(s)</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right hidden sm:block">
              <p className="text-xs text-gray-400">Valeur totale</p>
              <p className="text-lg font-bold text-green-600">{formatMontant(totalValeur)}</p>
            </div>
            <button onClick={ouvrirCreation}
              className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-md">
              <Plus size={16} />
              <span className="hidden sm:inline">Nouvelle importation</span>
              <span className="sm:hidden">Nouveau</span>
            </button>
          </div>
        </div>

        {/* Toggles statut + tri */}
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1 items-center">
          {([
            { key: 'tout', label: 'Tout' },
            { key: 'en_cours', label: 'En cours' },
            { key: 'traite', label: 'Traité' },
            { key: 'termine', label: 'Terminé' },
          ] as const).map(f => {
            const count = f.key === 'tout'
              ? importations.length
              : importations.filter(i => (i.statut ?? 'en_cours') === f.key).length;
            return (
              <button key={f.key} onClick={() => setFiltreStatut(f.key)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0
                  ${filtreStatut === f.key
                    ? f.key === 'en_cours' ? 'bg-orange-500 text-white'
                      : f.key === 'traite' ? 'bg-blue-500 text-white'
                      : f.key === 'termine' ? 'bg-green-600 text-white'
                      : 'bg-indigo-600 text-white'
                    : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                {f.label}
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold
                    ${filtreStatut === f.key ? 'bg-white/20 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          <div className="ml-auto shrink-0">
            <button
              onClick={() => setTriValeur(t => t === 'aucun' ? 'desc' : t === 'desc' ? 'asc' : 'aucun')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap border
                ${triValeur !== 'aucun'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              {triValeur === 'desc' ? <ArrowDown size={14} /> : triValeur === 'asc' ? <ArrowUp size={14} /> : <ArrowUpDown size={14} />}
              Valeur
            </button>
          </div>
        </div>

        {loadingListe ? (
          <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : importationsFiltrees.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-16 text-center">
            <Ship size={48} className="mx-auto text-gray-200 dark:text-gray-700 mb-4" />
            {importations.length === 0 ? (
              <>
                <p className="font-semibold text-gray-400 dark:text-gray-500 mb-2">Aucune importation</p>
                <p className="text-sm text-gray-400 dark:text-gray-600 mb-6">Créez votre premier conteneur d'importation</p>
                <button onClick={ouvrirCreation}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl transition-colors">
                  <Plus size={15} /> Nouvelle importation
                </button>
              </>
            ) : (
              <p className="font-semibold text-gray-400 dark:text-gray-500">Aucun conteneur dans cette catégorie</p>
            )}
          </div>
        ) : (
          <>
            {/* - Mobile cards - */}
            <div className="sm:hidden space-y-2">
              {importationsFiltrees.map(imp => (
                <div key={imp.id} onClick={() => ouvrirFiche(imp)}
                  className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 cursor-pointer active:bg-gray-50 dark:active:bg-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 bg-green-100 dark:bg-green-900/20 rounded-xl flex items-center justify-center shrink-0">
                        <Ship size={14} className="text-green-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-gray-900 dark:text-gray-100 font-mono">{imp.numero}</p>
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${statutClasses(imp.statut)}`}>
                            {statutLabel(imp.statut)}
                          </span>
                          {(imp.nombreEcarts ?? 0) > 0 && (
                            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 shrink-0">
                              {imp.nombreEcarts} écart{(imp.nombreEcarts ?? 0) > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {imp.nombreProduitTraite ?? 0}/{imp.nombreDeProduit} traités
                          {imp.nombreDeProduitModifie > 0 && ` · ↻ ${imp.nombreDeProduitModifie} modifié(s)`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="font-bold text-green-600">{formatMontant(imp.valeurTotale)}</p>
                      <p className="text-xs text-gray-400">{imp.nombreDeProduit} produit(s)</p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">{formatDate(imp.date)}</p>
                </div>
              ))}
              <div className="bg-green-50 dark:bg-green-900/10 rounded-xl border border-green-100 dark:border-green-800 p-4 flex justify-between items-center">
                <span className="font-bold text-gray-700 dark:text-gray-300">Total importations</span>
                <span className="font-bold text-green-600">{formatMontant(totalValeur)}</span>
              </div>
            </div>

            {/* - Desktop table - */}
            <div className="hidden sm:block bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Conteneur</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Statut</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Traités</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Modifiés</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Valeur</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Date</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                    {importationsFiltrees.map(imp => (
                      <tr key={imp.id} onClick={() => ouvrirFiche(imp)}
                        className="cursor-pointer hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10 transition-colors">
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-green-100 dark:bg-green-900/20 rounded-xl flex items-center justify-center shrink-0">
                              <Ship size={16} className="text-green-600 dark:text-green-400" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-bold text-gray-900 dark:text-gray-100 font-mono">{imp.numero}</p>
                                {(imp.nombreEcarts ?? 0) > 0 && (
                                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
                                    {imp.nombreEcarts} écart{(imp.nombreEcarts ?? 0) > 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                              {imp.nombreDeProduitModifie > 0 && <span className="text-xs text-orange-500">↻ {imp.nombreDeProduitModifie} modifié(s)</span>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statutClasses(imp.statut)}`}>
                            {statutLabel(imp.statut)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-medium text-gray-700 dark:text-gray-300">
                          <span className={(imp.nombreProduitTraite ?? 0) >= imp.nombreDeProduit ? 'text-green-600' : ''}>
                            {imp.nombreProduitTraite ?? 0}
                          </span>
                          <span className="text-gray-400">/{imp.nombreDeProduit}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {imp.nombreDeProduitModifie > 0 ? <span className="text-orange-500 font-medium">{imp.nombreDeProduitModifie}</span> : <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold text-green-600">{formatMontant(imp.valeurTotale)}</td>
                        <td className="px-4 py-3.5 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(imp.date)}</td>
                        <td className="px-4 py-3.5 text-gray-300 dark:text-gray-600"><ChevronRight size={15} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
