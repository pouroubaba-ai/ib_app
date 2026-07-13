'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  collection, getDocs, getDoc, query, where, doc,
  writeBatch, serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { formatMontant } from '@/lib/format';
import FiltreDates, { PlageDates } from '@/components/FiltreDates';
import {
  ArrowLeft, Search, X, AlertCircle, CheckCircle2,
  ArrowUpCircle, ArrowDownCircle, RotateCcw,
} from 'lucide-react';

/* ─── Types ──────────────────────────────────────────────── */
type Etape = 'choix' | 'liste' | 'travail';
type Sens = 'Sortie' | 'Entrée';

interface DocStock {
  id: string;
  typeDocument: string;
  numeroDocument: string;
  clientNom: string;
  totalGeneral: number;
  nombreDeProduit: number;
  date: any;
}

interface MouvRaw {
  id: string;
  produitNom: string;
  produitId: any;
  quantite: number;
  typeUnite: string;
  prixUnitaireReel: number;
  totalLigne: number;
  typeTransaction: string;
  typeDocument: string;
  documentId: any;
  date: any;
}

interface LigneTravail {
  produitNom: string;
  produitIdStr: string;
  produitRef: any;
  typeUnite: 'U' | 'C';
  qpe: number;
  qteBrute: number;
  prixUnitaireReel: number;
  qteRetourDejaUnits: number;
  stockActuelUnits: number;
  qteARetourner: number;
}

/* ─── Helpers ────────────────────────────────────────────── */
function tsOf(d: any): number {
  if (!d) return 0;
  if (d.seconds) return d.seconds * 1000;
  return new Date(d).getTime();
}

function formatDate(d: any): string {
  const ts = tsOf(d);
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* ─── Layout plein écran (sans sidebar) ─────────────────── */
function FullLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {children}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────── */
export default function RetourPage() {
  const { user, profile } = useAuth();
  const dataUid = profile?.adminUid ?? user?.uid ?? '';

  const [etape, setEtape] = useState<Etape>('choix');
  const [sens, setSens] = useState<Sens>('Sortie');

  /* ── Liste ── */
  const [docs, setDocs] = useState<DocStock[]>([]);
  const [docIdsAvecRetour, setDocIdsAvecRetour] = useState<Set<string>>(new Set());
  const [loadingListe, setLoadingListe] = useState(false);
  const [plage, setPlage] = useState<PlageDates>({ debut: null, fin: null });
  const [search, setSearch] = useState('');

  /* ── Aperçu "!" ── */
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewMouvs, setPreviewMouvs] = useState<MouvRaw[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  /* ── Travail ── */
  const [selectedDoc, setSelectedDoc] = useState<DocStock | null>(null);
  const [lignes, setLignes] = useState<LigneTravail[]>([]);
  const [loadingTravail, setLoadingTravail] = useState(false);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [succes, setSucces] = useState(false);

  /* ── Chargement liste documents ── */
  useEffect(() => {
    if (!user || etape !== 'liste') return;
    setLoadingListe(true);

    async function load() {
      const [docSnap, retourSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'documents_stock'),
          where('userId', '==', user!.uid),
          where('typeDocument', '==', sens),
        )),
        getDocs(query(
          collection(db, 'mouvements'),
          where('userId', '==', user!.uid),
          where('typeTransaction', '==', 'Retour'),
        )),
      ]);

      const list: DocStock[] = docSnap.docs.map(d => ({ id: d.id, ...d.data() } as DocStock));
      list.sort((a, b) => tsOf(b.date) - tsOf(a.date));
      setDocs(list);

      const ids = new Set<string>();
      retourSnap.docs.forEach(d => {
        const refId: string | undefined = (d.data().documentId as any)?.id;
        if (refId) ids.add(refId);
      });
      setDocIdsAvecRetour(ids);
      setLoadingListe(false);
    }
    load();
  }, [user, etape, sens]);

  /* ── Aperçu "!" — filtre côté client ── */
  useEffect(() => {
    if (!previewId || !user) return;
    setLoadingPreview(true);
    // Charge tous les mouvements du user puis filtre par documentId.id
    getDocs(query(collection(db, 'mouvements'), where('userId', '==', dataUid)))
      .then(snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as MouvRaw));
        setPreviewMouvs(all.filter(m => (m.documentId as any)?.id === previewId));
        setLoadingPreview(false);
      });
  }, [previewId, user]);

  /* ── Ouvrir plan de travail ── */
  async function ouvrirTravail(d: DocStock) {
    if (!user) return;
    setSelectedDoc(d);
    setEtape('travail');
    setLoadingTravail(true);
    setErreur('');
    setSucces(false);

    // Charge mouvements + produits en parallèle
    // Filtre mouvements par documentId.id côté client (évite index composite Firestore)
    const [mouvSnap, prodSnap] = await Promise.all([
      getDocs(query(collection(db, 'mouvements'), where('userId', '==', dataUid))),
      getDocs(query(collection(db, 'Produits'), where('userId', '==', dataUid))),
    ]);

    const prodMap: Record<string, { qpe: number; stockUnits: number }> = {};
    prodSnap.forEach(dd => {
      const pd = dd.data();
      prodMap[dd.id] = { qpe: pd.quantite_par_emballage || 1, stockUnits: pd.quantite_unitaire_total || 0 };
    });

    // Filtre sur ce document uniquement
    const allMouvs = mouvSnap.docs
      .map(dd => ({ id: dd.id, ...dd.data() } as MouvRaw))
      .filter(m => (m.documentId as any)?.id === d.id);

    const originals = allMouvs.filter(m => m.typeTransaction !== 'Retour');
    const retours   = allMouvs.filter(m => m.typeTransaction === 'Retour');

    // Retours déjà faits par produit, en unités
    const retourMap: Record<string, number> = {};
    retours.forEach(m => {
      const prodIdStr: string = (m.produitId as any)?.id || '';
      const qpe = prodMap[prodIdStr]?.qpe || 1;
      const qteUnits = m.typeUnite === 'C' ? m.quantite * qpe : m.quantite;
      retourMap[m.produitNom] = (retourMap[m.produitNom] || 0) + qteUnits;
    });

    setLignes(originals.map(m => {
      const produitIdStr: string = (m.produitId as any)?.id || '';
      const prod = prodMap[produitIdStr];
      const qpe = prod?.qpe || 1;
      return {
        produitNom: m.produitNom,
        produitIdStr,
        produitRef: m.produitId,
        typeUnite: (m.typeUnite || 'U') as 'U' | 'C',
        qpe,
        qteBrute: m.quantite,
        prixUnitaireReel: m.prixUnitaireReel || 0,
        qteRetourDejaUnits: retourMap[m.produitNom] || 0,
        stockActuelUnits: prod?.stockUnits || 0,
        qteARetourner: 0,
      };
    }));
    setLoadingTravail(false);
  }

  function maxRetour(l: LigneTravail): number {
    const origUnits = l.typeUnite === 'C' ? l.qteBrute * l.qpe : l.qteBrute;
    const dispoUnits = Math.max(0, origUnits - l.qteRetourDejaUnits);
    return l.typeUnite === 'C' ? Math.floor(dispoUnits / l.qpe) : dispoUnits;
  }

  function updateQte(idx: number, val: string) {
    setLignes(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], qteARetourner: Math.max(0, parseInt(val) || 0) };
      return next;
    });
    setErreur('');
  }

  async function validerRetour() {
    if (!user || !selectedDoc) return;
    setEnCours(true);
    setErreur('');

    const actives = lignes.filter(l => l.qteARetourner > 0);
    if (actives.length === 0) {
      setErreur('Veuillez saisir au moins une quantité à retourner.');
      setEnCours(false);
      return;
    }

    for (const l of actives) {
      if (l.qteARetourner > maxRetour(l)) {
        setErreur(`${l.produitNom} : max ${maxRetour(l)} ${l.typeUnite === 'C' ? 'carton(s)' : 'unité(s)'} retournable(s).`);
        setEnCours(false);
        return;
      }
      if (sens === 'Entrée' && l.produitIdStr) {
        const qteUnits = l.typeUnite === 'C' ? l.qteARetourner * l.qpe : l.qteARetourner;
        // Récupérer le stock en temps réel pour éviter les données périmées
        const prodSnap = await getDoc(doc(db, 'Produits', l.produitIdStr));
        const stockActuel = (prodSnap.data()?.quantite_unitaire_total ?? 0) as number;
        if (qteUnits > stockActuel) {
          setErreur(`${l.produitNom} : stock insuffisant (${stockActuel} unité(s) disponible(s), retour demandé ${qteUnits}).`);
          setEnCours(false);
          return;
        }
      }
    }

    const batch = writeBatch(db);
    const docRef = doc(db, 'documents_stock', selectedDoc.id);
    const now = serverTimestamp();
    const retourTypeDoc = sens === 'Sortie' ? 'Entrée' : 'Sortie';

    for (const l of actives) {
      const qteUnits = l.typeUnite === 'C' ? l.qteARetourner * l.qpe : l.qteARetourner;
      batch.set(doc(collection(db, 'mouvements')), {
        userId: dataUid,
        typeDocument: retourTypeDoc,
        typeTransaction: 'Retour',
        produitNom: l.produitNom,
        produitId: l.produitRef,
        quantite: l.qteARetourner,
        typeUnite: l.typeUnite,
        prixUnitaireReel: l.prixUnitaireReel,
        totalLigne: qteUnits * l.prixUnitaireReel,
        nomClient: selectedDoc.clientNom,
        documentId: docRef,
        date: now,
      });
      if (l.produitIdStr) {
        batch.update(doc(db, 'Produits', l.produitIdStr), {
          quantite_unitaire_total: increment(sens === 'Sortie' ? qteUnits : -qteUnits),
        });
      }
    }

    await batch.commit();
    setSucces(true);
    setEnCours(false);
    // Retour vers page initiale après 2s
    setTimeout(() => {
      setEtape('choix');
      setSucces(false);
      setLignes([]);
      setSelectedDoc(null);
    }, 2000);
  }

  const docsFiltres = useMemo(() => docs.filter(d => {
    if (plage.debut && plage.fin) {
      const ts = tsOf(d.date);
      if (ts < plage.debut.getTime() || ts > plage.fin.getTime()) return false;
    }
    if (search.trim() && !(d.clientNom || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [docs, plage, search]);

  const totalDejaRetourne = lignes.reduce((acc, l) => acc + l.qteRetourDejaUnits * l.prixUnitaireReel, 0);
  const totalARetourner = lignes.reduce((acc, l) => {
    const u = l.typeUnite === 'C' ? l.qteARetourner * l.qpe : l.qteARetourner;
    return acc + u * l.prixUnitaireReel;
  }, 0);

  /* ════════════════════════ CHOIX (avec sidebar) ══════════ */
  if (etape === 'choix') return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8">Retour</h1>
        <div className="grid grid-cols-2 gap-5">
          {([
            { s: 'Sortie' as Sens, label: 'Retour sorties', sub: 'Retour client', Icon: ArrowDownCircle, color: 'blue' },
            { s: 'Entrée' as Sens, label: 'Retour entrées', sub: 'Retour fournisseur', Icon: ArrowUpCircle, color: 'green' },
          ]).map(({ s, label, sub, Icon, color }) => (
            <button
              key={s}
              onClick={() => { setSens(s); setSearch(''); setEtape('liste'); }}
              className={`flex flex-col items-center gap-4 p-8 bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm
                hover:border-${color}-400 hover:shadow-md transition-all`}
            >
              <div className={`w-16 h-16 bg-${color}-100 dark:bg-${color}-900/30 rounded-2xl flex items-center justify-center`}>
                <Icon size={30} className={`text-${color}-600`} />
              </div>
              <div className="text-center">
                <p className="font-bold text-gray-900 dark:text-gray-100">{label}</p>
                <p className="text-sm text-gray-400 mt-1">{sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </AppLayout>
  );

  /* ════════════════════════ LISTE (sans sidebar) ══════════ */
  if (etape === 'liste') {
    const accentBtn = sens === 'Sortie' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700';
    return (
      <FullLayout>
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
            <button onClick={() => setEtape('choix')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
              <ArrowLeft size={18} className="text-gray-500" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                Retour {sens === 'Sortie' ? 'clients' : 'fournisseurs'}
              </h1>
              <p className="text-xs text-gray-400">Sélectionne le document concerné</p>
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-6 py-6 space-y-4">
          {/* Filtre dates */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
            <FiltreDates onChange={setPlage} defaut="tout" />
          </div>

          {/* Recherche */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Rechercher par ${sens === 'Sortie' ? 'client' : 'fournisseur'}…`}
              className="w-full pl-9 pr-10 py-2.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 bg-gray-300 hover:bg-gray-400 rounded-full flex items-center justify-center transition-colors">
                <X size={10} className="text-white" />
              </button>
            )}
          </div>

          {loadingListe ? (
            <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : docsFiltres.length === 0 ? (
            <p className="text-center py-16 text-gray-400">Aucun document trouvé</p>
          ) : (
            <div className="space-y-3">
              {docsFiltres.map(d => {
                const avecRetour = docIdsAvecRetour.has(d.id);
                return (
                  <div key={d.id} className={`bg-white dark:bg-gray-900 rounded-xl border shadow-sm
                    ${avecRetour ? 'border-orange-200 dark:border-orange-800/50' : 'border-gray-100 dark:border-gray-700'}`}>
                    <div className="flex items-center justify-between p-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{d.clientNom}</p>
                          {avecRetour && (
                            <span className="text-xs font-semibold px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-full">
                              ↩ Retour
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          <span>{d.nombreDeProduit} produit{d.nombreDeProduit > 1 ? 's' : ''}</span>
                          <span>·</span>
                          <span>{formatDate(d.date)}</span>
                          <span>·</span>
                          <span className="font-semibold text-gray-600 dark:text-gray-300">{formatMontant(d.totalGeneral)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        <button
                          onClick={() => setPreviewId(previewId === d.id ? null : d.id)}
                          title="Voir les produits"
                          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors
                            ${previewId === d.id ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        >
                          <AlertCircle size={15} />
                        </button>
                        <button
                          onClick={() => ouvrirTravail(d)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-colors ${accentBtn}`}
                        >
                          Sélectionner
                        </button>
                      </div>
                    </div>

                    {previewId === d.id && (
                      <div className="border-t border-gray-100 dark:border-gray-700 px-4 pb-4 pt-3">
                        {loadingPreview ? (
                          <div className="flex justify-center py-3"><div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
                        ) : (
                          <div className="space-y-2">
                            {previewMouvs.filter(m => m.typeTransaction !== 'Retour').map((m, i) => {
                              const retoursProd = previewMouvs.filter(r => r.typeTransaction === 'Retour' && r.produitNom === m.produitNom);
                              const qteR = retoursProd.reduce((acc, r) => acc + (r.quantite || 0), 0);
                              const unit = m.typeUnite === 'C' ? 'ctn' : 'u';
                              return (
                                <div key={i} className="flex items-center justify-between text-xs py-1">
                                  <span className="font-medium text-gray-700 dark:text-gray-300">{m.produitNom}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-gray-400">{m.quantite} {unit}</span>
                                    {qteR > 0 && <span className="text-orange-500 font-medium">↩ {qteR} {unit} retourné</span>}
                                    <span className="font-semibold text-gray-600 dark:text-gray-300">{formatMontant(m.totalLigne)}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </FullLayout>
    );
  }

  /* ════════════════════════ TRAVAIL (sans sidebar) ════════ */
  return (
    <FullLayout>
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => { setEtape('liste'); setSelectedDoc(null); setLignes([]); setSucces(false); }}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Retour — {selectedDoc?.clientNom}
            </h1>
            <p className="text-xs text-gray-400">
              {selectedDoc?.numeroDocument} · {formatDate(selectedDoc?.date)}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6 pb-36">
        {loadingTravail ? (
          <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : succes ? (
          <div className="flex flex-col items-center py-20 gap-4">
            <CheckCircle2 size={52} className="text-green-500" />
            <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">Retour enregistré !</p>
            <p className="text-sm text-gray-400">Retour à la page retour…</p>
          </div>
        ) : (
          <>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Produit</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-500">Qté d'origine</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-500">Déjà retourné</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-500">Retournable</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-500">À retourner</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                    {lignes.map((l, i) => {
                      const max = maxRetour(l);
                      const unit = l.typeUnite === 'C' ? 'ctn' : 'u';
                      const dejaDisplay = l.typeUnite === 'C'
                        ? Math.round(l.qteRetourDejaUnits / l.qpe)
                        : l.qteRetourDejaUnits;
                      const depasse = l.qteARetourner > max;
                      const stockKo = sens === 'Entrée' && (() => {
                        const u = l.typeUnite === 'C' ? l.qteARetourner * l.qpe : l.qteARetourner;
                        return u > l.stockActuelUnits;
                      })();
                      const enErr = depasse || stockKo;
                      return (
                        <tr key={i} className={enErr ? 'bg-red-50/60 dark:bg-red-900/10' : ''}>
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{l.produitNom}</td>
                          <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{l.qteBrute} {unit}</td>
                          <td className="px-4 py-3 text-center">
                            {dejaDisplay > 0
                              ? <span className="text-orange-500 font-medium">{dejaDisplay} {unit}</span>
                              : <span className="text-gray-300 dark:text-gray-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={max === 0 ? 'text-red-400 font-medium' : 'text-gray-600 dark:text-gray-400'}>
                              {max} {unit}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <input
                                type="number" min={0} max={max}
                                value={l.qteARetourner || ''}
                                onChange={e => updateQte(i, e.target.value)}
                                disabled={max === 0}
                                placeholder="0"
                                className={`w-20 text-center px-2 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500
                                  ${enErr ? 'border-red-400 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-gray-600 dark:bg-gray-800'}
                                  ${max === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                              />
                              {sens === 'Entrée' && l.qteARetourner > 0 && (
                                <span className="text-xs text-gray-400">
                                  Stock: {l.typeUnite === 'C' ? Math.floor(l.stockActuelUnits / l.qpe) : l.stockActuelUnits} {unit}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {erreur && (
              <div className="mt-4 flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <AlertCircle size={16} className="text-red-500 shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">{erreur}</p>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer fixe */}
      {!loadingTravail && !succes && (
        <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-xl z-20">
          <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
            <div className="flex gap-8">
              <div>
                <p className="text-xs text-gray-400">Déjà retourné</p>
                <p className="text-lg font-bold text-orange-500">{formatMontant(totalDejaRetourne)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">À retourner</p>
                <p className="text-lg font-bold text-indigo-600">{formatMontant(totalARetourner)}</p>
              </div>
            </div>
            <button
              onClick={validerRetour}
              disabled={enCours || totalARetourner === 0}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700
                disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors"
            >
              {enCours
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <RotateCcw size={16} />}
              Confirmer le retour
            </button>
          </div>
        </div>
      )}
    </FullLayout>
  );
}
