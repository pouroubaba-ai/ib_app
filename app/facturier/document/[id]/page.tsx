'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  doc, getDoc, collection, query, where, getDocs,
  updateDoc, arrayUnion, arrayRemove, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useRouter, useParams } from 'next/navigation';
import { formatMontant } from '@/lib/format';
import {
  ArrowLeft, RotateCcw,
  CheckCircle2, PackageOpen, AlertCircle, AlertTriangle,
} from 'lucide-react';

interface Mouvement {
  id: string;
  produitNom: string;
  quantite: number;
  typeUnite: string;
  qpe: number;
  prixUnitaire: number;
  totalLigne: number;
  produitId?: string;
}

interface RetourInfo {
  quantite: number;
  total: number;
  ids: string[]; // retour mouvement IDs
}

export default function FacturierDocumentPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const params = useParams();
  const docId = params?.id as string;

  const [docData, setDocData]       = useState<any>(null);
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);
  const [facturierTraites, setFacturierTraites]       = useState<string[]>([]);
  const [facturierRetoursVus, setFacturierRetoursVus] = useState<string[]>([]);
  // produitNom → { quantite, total, ids }
  const [retours, setRetours]       = useState<Record<string, RetourInfo>>({});
  const [loading, setLoading]       = useState(true);
  const [index, setIndex]           = useState(0);
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    if (!profile || !docId) return;
    async function load() {
      try {
        const docRef = doc(db, 'documents_stock', docId);
        const [docSnap, mouvSnap, retourSnap] = await Promise.all([
          getDoc(docRef),
          getDocs(query(
            collection(db, 'mouvements'),
            where('documentId', '==', docRef),
            where('userId', '==', profile!.adminUid),
          )),
          getDocs(query(
            collection(db, 'mouvements'),
            where('documentId', '==', docRef),
            where('typeTransaction', '==', 'Retour'),
          )),
        ]);

        if (!docSnap.exists()) { router.push('/facturier'); return; }
        const d = docSnap.data();
        setDocData(d);
        const traites: string[] = d.facturierTraites ?? [];
        const retoursVus: string[] = d.facturierRetoursVus ?? [];
        setFacturierTraites(traites);
        setFacturierRetoursVus(retoursVus);

        const movs: Mouvement[] = mouvSnap.docs
          .filter(m => m.data().typeTransaction !== 'Retour')
          .map(m => ({
            id: m.id,
            produitNom: m.data().produitNom || '',
            quantite: m.data().quantite || 0,
            typeUnite: m.data().typeUnite || 'U',
            qpe: m.data().qpe || 1,
            prixUnitaire: m.data().prixUnitaireReel || 0,
            totalLigne: m.data().totalLigne || 0,
            produitId: m.data().produitId,
          }));
        setMouvements(movs);

        // Grouper les retours par produitNom
        const retourMap: Record<string, RetourInfo> = {};
        retourSnap.docs.forEach(r => {
          const nom = r.data().produitNom || '';
          if (!retourMap[nom]) retourMap[nom] = { quantite: 0, total: 0, ids: [] };
          retourMap[nom].quantite += r.data().quantite || 0;
          retourMap[nom].total    += r.data().totalLigne || 0;
          retourMap[nom].ids.push(r.id);
        });
        setRetours(retourMap);

        // Détecter les retours non acquittés et mettre à jour le document
        const retoursVusSet = new Set(retoursVus);
        const allRetourIds  = retourSnap.docs.map(r => r.id);
        const hasPending    = allRetourIds.some(rid => !retoursVusSet.has(rid));
        if (hasPending) {
          await updateDoc(docRef, { facturierPendingRetour: true });
        }

        // Positionner sur le premier produit avec retour en attente, sinon premier non traité
        const traitesSet2 = new Set(traites);
        const firstPending = movs.findIndex(m => {
          const retour = retourMap[m.produitNom];
          return retour?.ids.some(rid => !retoursVusSet.has(rid));
        });
        if (firstPending >= 0) {
          setIndex(firstPending);
        } else {
          const firstUntreated = movs.findIndex(m => !traitesSet2.has(m.id));
          setIndex(firstUntreated >= 0 ? firstUntreated : 0);
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, [profile, docId]);

  const traitesSet = useMemo(() => new Set(facturierTraites), [facturierTraites]);
  const retoursVusSet = useMemo(() => new Set(facturierRetoursVus), [facturierRetoursVus]);

  function hasPendingRetour(produitNom: string): boolean {
    return (retours[produitNom]?.ids ?? []).some(rid => !retoursVusSet.has(rid));
  }

  const isTermine = mouvements.length > 0
    && mouvements.every(m => traitesSet.has(m.id))
    && !mouvements.some(m => hasPendingRetour(m.produitNom));

  const currentMov = mouvements[index];
  const estTraite  = currentMov ? traitesSet.has(currentMov.id) : false;
  const retourCurrent  = currentMov ? retours[currentMov.produitNom] : undefined;
  const pendingRetour  = currentMov ? hasPendingRetour(currentMov.produitNom) : false;

  const nbTraite = facturierTraites.length;
  const total    = mouvements.length;
  const pct      = total > 0 ? Math.round((nbTraite / total) * 100) : 0;

  // Marquer traité + acquitter les retours du produit
  const marquerTraite = useCallback(async () => {
    if (!currentMov || saving) return;
    setSaving(true);
    try {
      const newTraites       = [...facturierTraites, currentMov.id];
      const retourIdsProduit = retours[currentMov.produitNom]?.ids ?? [];
      const newRetoursVus    = [...new Set([...facturierRetoursVus, ...retourIdsProduit])];
      const allDone          = mouvements.every(m => m.id === currentMov.id || traitesSet.has(m.id));

      // Vérifier s'il reste d'autres retours en attente sur d'autres produits
      const newRetoursVusSet = new Set(newRetoursVus);
      const stillPending     = mouvements.some(m => {
        if (m.id === currentMov.id) return false;
        return (retours[m.produitNom]?.ids ?? []).some(rid => !newRetoursVusSet.has(rid));
      });

      await updateDoc(doc(db, 'documents_stock', docId), {
        facturierTraites:     arrayUnion(currentMov.id),
        facturierNbTraite:    newTraites.length,
        facturierRetoursVus:  newRetoursVus,
        facturierPendingRetour: stillPending,
        ...(allDone && !stillPending
          ? { facturierStatut: 'termine', facturierTermineAt: serverTimestamp() }
          : { facturierStatut: 'en_cours' }),
      });
      setFacturierTraites(newTraites);
      setFacturierRetoursVus(newRetoursVus);

      // Avancer au prochain produit non traité ou avec retour en attente
      const newTraitesSet    = new Set(newTraites);
      const nextWithPending  = mouvements.findIndex((m, i) =>
        i > index && (retours[m.produitNom]?.ids ?? []).some(rid => !newRetoursVusSet.has(rid))
      );
      const nextUntreated    = mouvements.findIndex((m, i) =>
        i > index && !newTraitesSet.has(m.id)
      );
      if (nextWithPending >= 0 && (nextUntreated < 0 || nextWithPending < nextUntreated)) {
        setIndex(nextWithPending);
      } else if (nextUntreated >= 0) {
        setIndex(nextUntreated);
      }
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }, [currentMov, saving, facturierTraites, facturierRetoursVus, mouvements, docId, index, retours, traitesSet]);

  // Acquitter uniquement le retour (produit déjà traité)
  const acquitterRetour = useCallback(async () => {
    if (!currentMov || saving) return;
    setSaving(true);
    try {
      const retourIdsProduit = retours[currentMov.produitNom]?.ids ?? [];
      const newRetoursVus    = [...new Set([...facturierRetoursVus, ...retourIdsProduit])];
      const newRetoursVusSet = new Set(newRetoursVus);
      const stillPending     = mouvements.some(m =>
        (retours[m.produitNom]?.ids ?? []).some(rid => !newRetoursVusSet.has(rid))
      );
      const allDone = mouvements.every(m => traitesSet.has(m.id));

      await updateDoc(doc(db, 'documents_stock', docId), {
        facturierRetoursVus:    newRetoursVus,
        facturierPendingRetour: stillPending,
        ...(!stillPending && allDone
          ? { facturierStatut: 'termine', facturierTermineAt: serverTimestamp() }
          : {}),
      });
      setFacturierRetoursVus(newRetoursVus);

      // Avancer vers le prochain produit avec retour en attente ou non traité
      const nextWithPending = mouvements.findIndex((m, i) =>
        i > index && (retours[m.produitNom]?.ids ?? []).some(rid => !newRetoursVusSet.has(rid))
      );
      const nextUntreated   = mouvements.findIndex((m, i) =>
        i > index && !traitesSet.has(m.id)
      );
      if (nextWithPending >= 0 && (nextUntreated < 0 || nextWithPending < nextUntreated)) {
        setIndex(nextWithPending);
      } else if (nextUntreated >= 0) {
        setIndex(nextUntreated);
      }
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }, [currentMov, saving, facturierRetoursVus, mouvements, docId, index, retours, traitesSet]);

  const retirerTraite = useCallback(async () => {
    if (!currentMov || saving) return;
    setSaving(true);
    try {
      const newTraites = facturierTraites.filter(id => id !== currentMov.id);
      await updateDoc(doc(db, 'documents_stock', docId), {
        facturierTraites:  arrayRemove(currentMov.id),
        facturierNbTraite: newTraites.length,
        facturierStatut:   'en_cours',
      });
      setFacturierTraites(newTraites);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }, [currentMov, saving, facturierTraites, docId]);

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => router.push('/facturier')} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 truncate text-sm">{docData?.clientNom || '—'}</p>
            <p className="text-xs font-mono text-gray-400">{docData?.numeroDocument}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-gray-400">Progression</p>
            <p className="font-bold text-sm text-blue-600">{nbTraite}/{total}</p>
          </div>
        </div>
        {/* Barre progression */}
        <div className="h-1 bg-gray-100">
          <div className={`h-full transition-all duration-500 ${isTermine ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }} />
        </div>
      </header>

      {/* Corps */}
      <main className="flex-1 flex flex-col px-4 py-4 gap-4">
        {isTermine ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-5">
            <CheckCircle2 size={64} className="text-green-500" />
            <div className="text-center">
              <p className="font-bold text-gray-900 text-xl">Document terminé !</p>
              <p className="text-sm text-gray-400 mt-1">Tous les {total} produits ont été traités.</p>
            </div>
            <button onClick={() => router.push('/facturier')}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold">
              Retour à la liste
            </button>
          </div>
        ) : (
          <>
            {/* Dots navigation — cliquables pour produits traités ou avec retour en attente */}
            <div className="flex items-center justify-center gap-1.5 flex-wrap">
              {mouvements.map((m, i) => {
                const traite  = traitesSet.has(m.id);
                const pending = hasPendingRetour(m.produitNom);
                const current = i === index;
                const clickable = traite || pending;
                return (
                  <button
                    key={m.id}
                    disabled={!clickable && !current}
                    onClick={() => clickable || current ? setIndex(i) : undefined}
                    className={`rounded-full transition-all relative
                      ${current ? 'w-6 h-1.5' : 'w-2 h-1.5'}
                      ${pending ? 'bg-orange-400' :
                        current ? 'bg-blue-500' :
                        traite ? 'bg-green-400' : 'bg-gray-200'}`}
                  >
                    {pending && (
                      <span className="absolute -top-1 -right-0.5 w-2 h-2 bg-orange-500 rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Numéro produit */}
            <p className="text-center text-xs font-semibold text-gray-400">
              Produit {index + 1} sur {total}
              {estTraite && !pendingRetour && <span className="ml-2 text-green-500">· Déjà traité</span>}
              {pendingRetour && <span className="ml-2 text-orange-500">· Retour à acquitter</span>}
            </p>

            {/* Carte produit */}
            {currentMov ? (
              <div className={`bg-white rounded-2xl border shadow-sm p-5 flex-1 flex flex-col gap-4
                ${pendingRetour ? 'border-orange-300' :
                  estTraite ? 'border-green-200' : 'border-blue-100'}`}>

                {/* Nom produit */}
                <div className="flex items-start gap-3">
                  <div className={`p-2.5 rounded-xl
                    ${pendingRetour ? 'bg-orange-50' :
                      estTraite ? 'bg-green-50' : 'bg-blue-50'}`}>
                    <PackageOpen size={24} className={
                      pendingRetour ? 'text-orange-500' :
                      estTraite ? 'text-green-500' : 'text-blue-500'} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-gray-900 text-lg leading-tight">{currentMov.produitNom}</p>
                    {estTraite && !pendingRetour && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 font-semibold mt-0.5">
                        <CheckCircle2 size={12} /> Traité
                      </span>
                    )}
                    {pendingRetour && (
                      <span className="inline-flex items-center gap-1 text-xs text-orange-600 font-semibold mt-0.5">
                        <AlertTriangle size={12} /> Retour non acquitté
                      </span>
                    )}
                  </div>
                </div>

                <div className="h-px bg-gray-100" />

                {/* Détails quantité / prix */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-400 mb-0.5">Quantité vendue</p>
                    <p className="font-bold text-gray-900 text-lg">
                      {currentMov.quantite}
                      <span className="text-sm font-normal text-gray-400 ml-1">
                        {currentMov.typeUnite === 'C' ? 'ctn' : 'u'}
                      </span>
                    </p>
                    {currentMov.typeUnite === 'C' && currentMov.qpe > 1 && (
                      <p className="text-xs text-gray-400 mt-0.5">= {currentMov.quantite * currentMov.qpe} unités</p>
                    )}
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-400 mb-0.5">Montant</p>
                    <p className="font-bold text-blue-600 text-base">{formatMontant(currentMov.totalLigne)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {currentMov.quantite > 0
                        ? formatMontant(Math.round(currentMov.totalLigne / currentMov.quantite))
                        : '—'}
                      /{currentMov.typeUnite === 'C' ? 'ctn' : 'u'}
                    </p>
                  </div>
                </div>

                {/* Retour */}
                {retourCurrent ? (
                  <div className={`border rounded-xl p-3 flex items-start gap-2
                    ${pendingRetour
                      ? 'bg-orange-50 border-orange-200'
                      : 'bg-red-50 border-red-100'}`}>
                    <AlertCircle size={16} className={`shrink-0 mt-0.5 ${pendingRetour ? 'text-orange-500' : 'text-red-400'}`} />
                    <div>
                      <p className={`text-xs font-bold mb-0.5 ${pendingRetour ? 'text-orange-600' : 'text-red-600'}`}>
                        {pendingRetour ? '⚠️ Retour à confirmer' : 'Retour enregistré'}
                      </p>
                      <p className={`text-sm font-semibold ${pendingRetour ? 'text-orange-700' : 'text-red-700'}`}>
                        {retourCurrent.quantite} {currentMov.typeUnite === 'C' ? 'ctn' : 'u'} retournée(s)
                      </p>
                      <p className={`text-xs mt-0.5 ${pendingRetour ? 'text-orange-500' : 'text-red-500'}`}>
                        Valeur : {formatMontant(retourCurrent.total)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-400 text-center">
                    Aucun retour enregistré
                  </div>
                )}

                <div className="flex-1" />

                {/* Boutons d'action */}
                {pendingRetour && estTraite ? (
                  // Produit traité mais retour non acquitté
                  <div className="flex gap-2">
                    <button onClick={retirerTraite} disabled={saving}
                      className="flex-1 py-3.5 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm font-semibold flex items-center justify-center gap-2">
                      <RotateCcw size={16} /> Démarquer
                    </button>
                    <button onClick={acquitterRetour} disabled={saving}
                      className="flex-1 py-3.5 rounded-xl bg-orange-500 active:bg-orange-600 text-white text-sm font-bold flex items-center justify-center gap-2">
                      {saving
                        ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <><CheckCircle2 size={18} /> Retour vu</>}
                    </button>
                  </div>
                ) : pendingRetour && !estTraite ? (
                  // Produit non traité avec retour en attente
                  <button onClick={marquerTraite} disabled={saving}
                    className="w-full py-4 bg-orange-500 active:bg-orange-600 text-white rounded-2xl text-base font-bold flex items-center justify-center gap-2 shadow-md disabled:opacity-50">
                    {saving
                      ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <><CheckCircle2 size={20} /> Traité + Retour vu</>}
                  </button>
                ) : estTraite ? (
                  // Produit traité, pas de retour en attente
                  <button onClick={retirerTraite} disabled={saving}
                    className="w-full py-3.5 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm font-semibold flex items-center justify-center gap-2">
                    <RotateCcw size={16} /> Démarquer
                  </button>
                ) : (
                  // Produit non traité normal
                  <button onClick={marquerTraite} disabled={saving}
                    className="w-full py-4 bg-green-600 active:bg-green-700 text-white rounded-2xl text-base font-bold flex items-center justify-center gap-2 shadow-md disabled:opacity-50">
                    {saving
                      ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <><CheckCircle2 size={20} /> Traité — Suivant</>}
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center py-10 text-gray-400 text-sm">Aucun produit</div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
