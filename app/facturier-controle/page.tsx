'use client';
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import FiltreDates, { PlageDates } from '@/components/FiltreDates';
import { formatMontant, formatDate } from '@/lib/format';
import {
  Users, FileText, CheckCircle2, Clock,
  ChevronDown, ChevronUp, Search, X, AlertTriangle,
} from 'lucide-react';
import RetourModal from '@/components/RetourModal';

interface ProduitControle {
  mouvId: string;
  produitNom: string;
  quantite: number;
  typeUnite: string;
  totalLigne: number;
  traite: boolean;
  retourQte?: number;
  retourTotal?: number;
  retourNonVu?: boolean; // retour non encore confirmé par le facturier
}

interface DocSortie {
  id: string;
  numeroDocument: string;
  clientNom: string;
  totalGeneral: number;
  nombreDeProduit: number;
  facturierTraites: string[];
  facturierRetoursVus: string[];
  hasPendingRetour: boolean; // calculé côté client à partir des mouvements Retour
  date: any;
}

export default function FacturierControlePage() {
  const { profile } = useAuth();
  const [docs, setDocs] = useState<DocSortie[]>([]);
  const [facturiers, setFacturiers] = useState<{ uid: string; nom: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [produitsParDoc, setProduitsParDoc] = useState<Record<string, ProduitControle[]>>({});
  const [recherche, setRecherche] = useState('');
  const [retourModalDocId, setRetourModalDocId] = useState<string | null>(null);
  const [filtreStatut, setFiltreStatut] = useState<'tout' | 'en_cours' | 'termine'>('tout');
  const [plage, setPlage] = useState<PlageDates>({ debut: null, fin: null });

  useEffect(() => {
    if (!profile) return;
    async function load() {
      const uid = profile!.uid;
      const [docSnap, partSnap, userSnap, retourSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'documents_stock'),
          where('userId', '==', uid),
          where('typeDocument', '==', 'Sortie'),
        )),
        getDocs(query(
          collection(db, 'Partenaire'),
          where('userId', '==', uid),
          where('type', '==', 'boutique'),
        )),
        getDocs(query(
          collection(db, 'users'),
          where('adminUid', '==', uid),
          where('role', '==', 'facturier'),
        )),
        // Tous les mouvements Retour de cet admin
        getDocs(query(
          collection(db, 'mouvements'),
          where('userId', '==', uid),
          where('typeTransaction', '==', 'Retour'),
        )),
      ]);

      // Grouper les IDs de retours par docId
      const retourIdsByDoc: Record<string, string[]> = {};
      retourSnap.docs.forEach(r => {
        const docRef = r.data().documentId;
        const docId = docRef?.id || docRef;
        if (!docId) return;
        if (!retourIdsByDoc[docId]) retourIdsByDoc[docId] = [];
        retourIdsByDoc[docId].push(r.id);
      });

      const boutiques = new Set<string>(partSnap.docs.map(d => (d.data().nom || '').toLowerCase()));

      const data: DocSortie[] = docSnap.docs
        .map(d => {
          const retoursVus: string[] = d.data().facturierRetoursVus ?? [];
          const vusSet = new Set(retoursVus);
          const retourIds = retourIdsByDoc[d.id] ?? [];
          const hasPendingRetour = retourIds.some(rid => !vusSet.has(rid));
          return {
            id: d.id,
            numeroDocument: d.data().numeroDocument || '',
            clientNom: d.data().clientNom || '',
            totalGeneral: d.data().totalGeneral || 0,
            nombreDeProduit: d.data().nombreDeProduit || 0,
            facturierTraites: d.data().facturierTraites ?? [],
            facturierRetoursVus: retoursVus,
            hasPendingRetour,
            date: d.data().date,
          };
        })
        .filter(d => !boutiques.has(d.clientNom.toLowerCase()));

      data.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
      setDocs(data);
      setFacturiers(userSnap.docs.map(d => ({ uid: d.id, nom: d.data().nom || 'Sans nom' })));
      setLoading(false);
    }
    load();
  }, [profile]);

  const filtered = useMemo(() => {
    let list = docs;
    if (recherche) {
      const q = recherche.toLowerCase();
      list = list.filter(d =>
        d.clientNom.toLowerCase().includes(q) ||
        d.numeroDocument.toLowerCase().includes(q),
      );
    }
    if (filtreStatut === 'en_cours') {
      list = list.filter(d => d.facturierTraites.length < d.nombreDeProduit || d.hasPendingRetour);
    } else if (filtreStatut === 'termine') {
      list = list.filter(d => d.facturierTraites.length >= d.nombreDeProduit && d.nombreDeProduit > 0 && !d.hasPendingRetour);
    }
    if (plage.debut || plage.fin) {
      list = list.filter(d => {
        const ts = d.date?.seconds ? d.date.seconds * 1000 : null;
        if (!ts) return false;
        if (plage.debut && ts < plage.debut.getTime()) return false;
        if (plage.fin && ts > plage.fin.getTime()) return false;
        return true;
      });
    }
    return list;
  }, [docs, recherche, filtreStatut, plage]);

  const nbTermine = useMemo(() =>
    filtered.filter(d => d.facturierTraites.length >= d.nombreDeProduit && d.nombreDeProduit > 0 && !d.hasPendingRetour).length, [filtered]);
  const nbEnCours = filtered.length - nbTermine;

  const toggleExpand = async (d: DocSortie) => {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(d.id) ? n.delete(d.id) : n.add(d.id);
      return n;
    });
    if (!produitsParDoc[d.id]) {
      const docRef = doc(db, 'documents_stock', d.id);
      const [snap, docSnap] = await Promise.all([
        getDocs(query(collection(db, 'mouvements'), where('documentId', '==', docRef))),
        getDoc(docRef),
      ]);
      const retoursVusSet = new Set<string>(docSnap.data()?.facturierRetoursVus ?? []);
      const traitesSet = new Set(d.facturierTraites);

      // Séparer ventes et retours
      const ventesRaw = snap.docs.filter(m => m.data().typeTransaction !== 'Retour');
      const retoursRaw = snap.docs.filter(m => m.data().typeTransaction === 'Retour');

      // Agréger les retours par produitNom
      const retourParProduit: Record<string, { qte: number; total: number; hasNonVu: boolean }> = {};
      retoursRaw.forEach(r => {
        const nom = r.data().produitNom || '';
        if (!retourParProduit[nom]) retourParProduit[nom] = { qte: 0, total: 0, hasNonVu: false };
        retourParProduit[nom].qte   += r.data().quantite || 0;
        retourParProduit[nom].total += r.data().totalLigne || 0;
        if (!retoursVusSet.has(r.id)) retourParProduit[nom].hasNonVu = true;
      });

      const produits: ProduitControle[] = ventesRaw.map(m => {
        const nom = m.data().produitNom || '—';
        const ret = retourParProduit[nom];
        return {
          mouvId: m.id,
          produitNom: nom,
          quantite: m.data().quantite || 0,
          typeUnite: m.data().typeUnite || 'U',
          totalLigne: m.data().totalLigne || 0,
          traite: traitesSet.has(m.id),
          retourQte: ret?.qte,
          retourTotal: ret?.total,
          retourNonVu: ret?.hasNonVu,
        };
      });

      // Tri : retours non vus en premier, puis non traités, puis traités
      produits.sort((a, b) => {
        if (a.retourNonVu && !b.retourNonVu) return -1;
        if (!a.retourNonVu && b.retourNonVu) return 1;
        return Number(b.traite) - Number(a.traite);
      });
      setProduitsParDoc(prev => ({ ...prev, [d.id]: produits }));
    }
  };

  return (
    <AppLayout>
      {retourModalDocId && (
        <RetourModal docId={retourModalDocId} onClose={() => setRetourModalDocId(null)} />
      )}
      <div className="max-w-2xl mx-auto">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Contrôle Facturiers</h1>
          <p className="text-sm text-gray-400 mt-0.5">Suivi de l'avancement de la facturation</p>
        </div>

        {/* Résumé */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3.5 text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{filtered.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">Total</p>
          </div>
          <div className="bg-orange-50 dark:bg-orange-950/30 rounded-2xl border border-orange-100 dark:border-orange-900/30 p-3.5 text-center">
            <p className="text-2xl font-bold text-orange-500">{nbEnCours}</p>
            <p className="text-xs text-orange-400 mt-0.5">En cours</p>
          </div>
          <div className="bg-green-50 dark:bg-green-950/30 rounded-2xl border border-green-100 dark:border-green-900/30 p-3.5 text-center">
            <p className="text-2xl font-bold text-green-600">{nbTermine}</p>
            <p className="text-xs text-green-400 mt-0.5">Terminés</p>
          </div>
        </div>

        {/* Facturiers */}
        {facturiers.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 mb-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2.5">
              Facturiers ({facturiers.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {facturiers.map(f => (
                <div key={f.uid} className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/30 rounded-full px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300">
                  <Users size={12} />
                  {f.nom}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filtres */}
        <div className="flex gap-2 mb-3">
          {(['tout', 'en_cours', 'termine'] as const).map(f => (
            <button key={f} onClick={() => setFiltreStatut(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors
                ${filtreStatut === f
                  ? f === 'en_cours' ? 'bg-orange-500 text-white'
                    : f === 'termine' ? 'bg-green-600 text-white'
                    : 'bg-gray-800 text-white dark:bg-gray-100 dark:text-gray-900'
                  : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-500'}`}>
              {f === 'tout' ? 'Tout' : f === 'en_cours' ? 'En cours' : 'Terminé'}
            </button>
          ))}
        </div>

        {/* Filtre dates */}
        <div className="mb-3">
          <FiltreDates onChange={setPlage} defaut="aujourdhui" />
        </div>

        {/* Recherche */}
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={recherche} onChange={e => setRecherche(e.target.value)}
            placeholder="Client ou numéro de document..."
            className="w-full pl-9 pr-8 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          {recherche && (
            <button onClick={() => setRecherche('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Liste */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <FileText size={40} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">Aucun document</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map(d => {
              const nb = d.facturierTraites.length;
              const total = d.nombreDeProduit;
              const done = total > 0 && nb >= total;
              const pct = total > 0 ? Math.round((nb / total) * 100) : 0;
              const isExp = expanded.has(d.id);
              const pendingRetour = d.hasPendingRetour;
              // "terminé" seulement si tout traité ET aucun retour en attente
              const vraimentTermine = done && !pendingRetour;

              return (
                <div key={d.id}
                  className={`bg-white dark:bg-gray-900 rounded-2xl border shadow-sm overflow-hidden
                    ${pendingRetour
                      ? 'border-orange-400 dark:border-orange-700'
                      : vraimentTermine
                        ? 'border-green-200 dark:border-green-900/40'
                        : 'border-orange-200 dark:border-orange-900/40'}`}>
                  <div className="p-4 cursor-pointer" onClick={() => toggleExpand(d)}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          {vraimentTermine
                            ? <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                            : <Clock size={14} className="text-orange-400 shrink-0" />}
                          <p className="font-bold text-gray-900 dark:text-gray-100 truncate">{d.clientNom || '—'}</p>
                          {pendingRetour && (
                            <button
                              onClick={e => { e.stopPropagation(); setRetourModalDocId(d.id); }}
                              title="Retour non confirmé par le facturier"
                              className="shrink-0 flex items-center gap-1 px-2 py-0.5 bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400 text-xs font-bold rounded-full hover:bg-orange-200 transition-colors"
                            >
                              <AlertTriangle size={11} />
                              Retour
                            </button>
                          )}
                        </div>
                        <p className="text-xs font-mono text-gray-400 ml-5">{d.numeroDocument}</p>
                        <p className="text-xs text-gray-300 dark:text-gray-600 ml-5 mt-0.5">{formatDate(d.date)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="font-semibold text-blue-600 text-sm">{formatMontant(d.totalGeneral)}</span>
                        {isExp ? <ChevronUp size={15} className="text-gray-300" /> : <ChevronDown size={15} className="text-gray-300" />}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-3">
                      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${vraimentTermine ? 'bg-green-500' : 'bg-orange-400'}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`text-xs font-bold shrink-0 ${vraimentTermine ? 'text-green-600' : 'text-orange-500'}`}>
                        {nb}/{total}
                        {pendingRetour && <span className="ml-1 text-orange-500">⚠</span>}
                      </span>
                    </div>
                  </div>

                  {isExp && (
                    <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 bg-gray-50 dark:bg-gray-950/50">
                      {!produitsParDoc[d.id] ? (
                        <div className="flex justify-center py-2">
                          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : produitsParDoc[d.id].length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-1">Aucun produit trouvé</p>
                      ) : (
                        <div className="space-y-2">
                          {produitsParDoc[d.id].map(p => (
                            <div key={p.mouvId}
                              className={`rounded-xl px-3 py-2.5 border
                                ${p.retourNonVu
                                  ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900/40'
                                  : p.traite
                                    ? 'bg-green-50 dark:bg-green-950/20 border-green-100 dark:border-green-900/30'
                                    : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800'}`}>
                              {/* Ligne produit */}
                              <div className="flex items-center gap-2 mb-1.5">
                                {p.retourNonVu
                                  ? <AlertTriangle size={13} className="text-orange-500 shrink-0" />
                                  : p.traite
                                    ? <CheckCircle2 size={13} className="text-green-500 shrink-0" />
                                    : <Clock size={13} className="text-orange-400 shrink-0" />}
                                <span className={`text-xs font-semibold truncate flex-1
                                  ${p.traite && !p.retourNonVu ? 'text-gray-400' : 'text-gray-800 dark:text-gray-200'}`}>
                                  {p.produitNom}
                                </span>
                                {p.retourNonVu && (
                                  <span className="text-xs font-bold text-orange-600 bg-orange-100 dark:bg-orange-900/40 px-1.5 py-0.5 rounded-full shrink-0">
                                    retour non confirmé
                                  </span>
                                )}
                              </div>
                              {/* Quantité vendue + prix */}
                              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 ml-5">
                                <span>
                                  {p.quantite} {p.typeUnite === 'C' ? 'ctn' : 'u'} × {p.quantite > 0 ? Math.round(p.totalLigne / p.quantite).toLocaleString('fr-FR') : '0'} FCFA
                                </span>
                                <span className={`font-bold ${p.traite && !p.retourNonVu ? 'text-gray-400' : 'text-blue-600 dark:text-blue-400'}`}>
                                  {p.totalLigne.toLocaleString('fr-FR')} FCFA
                                </span>
                              </div>
                              {/* Retour inline */}
                              {p.retourQte != null && p.retourQte > 0 && (
                                <div className="ml-5 mt-2 flex items-center justify-between text-xs bg-white dark:bg-gray-800 rounded-lg px-2.5 py-1.5 border border-orange-100 dark:border-orange-900/30">
                                  <span className={`font-semibold ${p.retourNonVu ? 'text-orange-600' : 'text-gray-400'}`}>
                                    ↩ Retour : {p.retourQte} {p.typeUnite === 'C' ? 'ctn' : 'u'}
                                    {p.retourQte > 0 && p.retourTotal
                                      ? ` × ${Math.round(p.retourTotal / p.retourQte).toLocaleString('fr-FR')} FCFA`
                                      : ''}
                                  </span>
                                  <span className={`font-bold ${p.retourNonVu ? 'text-orange-600' : 'text-gray-400'}`}>
                                    −{(p.retourTotal ?? 0).toLocaleString('fr-FR')} FCFA
                                  </span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
