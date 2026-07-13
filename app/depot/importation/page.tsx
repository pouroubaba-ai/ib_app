'use client';
import { useEffect, useState, useMemo } from 'react';
import {
  collection, query, where, getDocs, doc, writeBatch, serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import DepotLayout from '@/components/DepotLayout';
import { formatDate } from '@/lib/format';
import {
  ArrowLeft, Ship, Check, Package2, ChevronRight, CheckCircle2,
  AlertTriangle, Plus, X, Edit2,
} from 'lucide-react';

interface Importation {
  id: string; numero: string; date: any;
  nombreDeProduit: number; nombreProduitTraite: number;
  nombreEcarts?: number;
  statut?: 'en_cours' | 'traite' | 'termine';
}

interface LigneFiche {
  mouvId: string; produitNom: string;
  quantite: number; typeUnite: 'U' | 'C';
  depotTraite: boolean; quantiteDepot?: number;
  comptes: number[];
}

type Vue = 'liste' | 'fiche';
type FiltreStatut = 'tout' | 'en_cours' | 'traite' | 'termine';

const statutLabel = (s?: string) => {
  if (s === 'traite') return 'Traité';
  if (s === 'termine') return 'Terminé';
  return 'En cours';
};

export default function DepotImportationPage() {
  const { profile } = useAuth();
  const [vue, setVue] = useState<Vue>('liste');
  const [importations, setImportations] = useState<Importation[]>([]);
  const [loading, setLoading] = useState(true);
  const [impSelectee, setImpSelectee] = useState<Importation | null>(null);
  const [lignes, setLignes] = useState<LigneFiche[]>([]);
  const [loadingFiche, setLoadingFiche] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState<FiltreStatut>('tout');

  /* Comptage séquentiel */
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [addInput, setAddInput] = useState('');
  const [editingSegment, setEditingSegment] = useState<{ mouvId: string; idx: number; val: string } | null>(null);
  const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());

  async function chargerImportations() {
    if (!profile) return;
    const snap = await getDocs(query(
      collection(db, 'importations'),
      where('userId', '==', profile.adminUid),
    ));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Importation));
    data.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
    setImportations(data);
    setLoading(false);
  }

  useEffect(() => { chargerImportations(); }, [profile]);

  async function ouvrirFiche(imp: Importation) {
    if (!profile) return;
    setImpSelectee(imp);
    setLoadingFiche(true);
    setVue('fiche');
    setAddingFor(null);
    setEditingSegment(null);
    setExpandedLines(new Set());

    const snap = await getDocs(query(
      collection(db, 'mouvements'),
      where('userId', '==', profile.adminUid),
    ));

    const mvts: LigneFiche[] = snap.docs
      .filter(d => (d.data().importationId as any)?.id === imp.id)
      .map(d => ({
        mouvId: d.id,
        produitNom: d.data().produitNom || '',
        quantite: d.data().quantite || 0,
        typeUnite: d.data().typeUnite || 'U',
        depotTraite: d.data().depotTraite || false,
        quantiteDepot: d.data().quantiteDepot,
        comptes: d.data().comptes ?? [],
      }));

    setLignes(mvts);
    setLoadingFiche(false);
  }

  /* Sauvegarde commune */
  async function sauvegarder(l: LigneFiche, newComptes: number[]) {
    if (!impSelectee || !profile) return;
    const total = newComptes.reduce((s, n) => s + n, 0);
    const traite = newComptes.length > 0;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'mouvements', l.mouvId), {
        quantiteDepot: total,
        depotTraite: traite,
        comptes: newComptes,
        depotTraiteAt: serverTimestamp(),
      });

      const newLignes = lignes.map(x =>
        x.mouvId === l.mouvId ? { ...x, depotTraite: traite, quantiteDepot: total, comptes: newComptes } : x,
      );
      const nbApres = newLignes.filter(x => x.depotTraite).length;
      const toutesTraitees = nbApres >= newLignes.length;
      const wasTraite = l.depotTraite;

      const nbEcarts = newLignes.filter(x => x.depotTraite && x.quantiteDepot !== x.quantite).length;
      const impRef = doc(db, 'importations', impSelectee.id);
      if (!wasTraite && traite) {
        batch.update(impRef, {
          nombreProduitTraite: increment(1),
          nombreEcarts: nbEcarts,
          ...(toutesTraitees ? { statut: 'traite' } : {}),
        });
      } else if (wasTraite && !traite) {
        batch.update(impRef, { nombreProduitTraite: increment(-1), nombreEcarts: nbEcarts, statut: 'en_cours' });
      } else {
        batch.update(impRef, {
          nombreEcarts: nbEcarts,
          ...(toutesTraitees && impSelectee.statut === 'en_cours' ? { statut: 'traite' } : {}),
        });
      }

      await batch.commit();
      setLignes(newLignes);
      setImpSelectee(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          nombreEcarts: nbEcarts,
          nombreProduitTraite: !wasTraite && traite
            ? (prev.nombreProduitTraite ?? 0) + 1
            : wasTraite && !traite
              ? Math.max(0, (prev.nombreProduitTraite ?? 0) - 1)
              : prev.nombreProduitTraite,
          statut: wasTraite && !traite ? 'en_cours' : (toutesTraitees && prev.statut !== 'termine' ? 'traite' : prev.statut),
        };
      });
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  async function ajouterSegment(l: LigneFiche) {
    const val = parseInt(addInput) || 0;
    if (val <= 0) return;
    setAddingFor(null);
    setAddInput('');
    await sauvegarder(l, [...l.comptes, val]);
  }

  async function modifierSegment(l: LigneFiche) {
    if (!editingSegment) return;
    const val = parseInt(editingSegment.val) || 0;
    if (val <= 0) return;
    const newComptes = l.comptes.map((c, i) => i === editingSegment.idx ? val : c);
    setEditingSegment(null);
    await sauvegarder(l, newComptes);
  }

  async function supprimerSegment(l: LigneFiche, idx: number) {
    await sauvegarder(l, l.comptes.filter((_, i) => i !== idx));
  }

  const toutesTraitees = useMemo(() => lignes.length > 0 && lignes.every(l => l.depotTraite), [lignes]);
  const nbTraitees = lignes.filter(l => l.depotTraite).length;
  const estTermine = impSelectee?.statut === 'termine';
  const avecEcart = useMemo(
    () => lignes.filter(l => l.depotTraite && l.quantiteDepot !== l.quantite),
    [lignes],
  );

  /* ════ FICHE ════ */
  if (vue === 'fiche' && impSelectee) return (
    <DepotLayout>
      <div>
        {/* Header */}
        <div className="bg-white border-b border-gray-100 px-4 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setVue('liste')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
              <ArrowLeft size={18} className="text-gray-500" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-gray-900 font-mono">{impSelectee.numero}</p>
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full shrink-0
                  ${impSelectee.statut === 'traite' ? 'bg-blue-100 text-blue-700'
                    : impSelectee.statut === 'termine' ? 'bg-green-100 text-green-700'
                    : 'bg-orange-100 text-orange-600'}`}>
                  {statutLabel(impSelectee.statut)}
                </span>
                {estTermine && avecEcart.length > 0 && (
                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 shrink-0">
                    {avecEcart.length} écart(s)
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400">{nbTraitees}/{lignes.length} traités · {formatDate(impSelectee.date)}</p>
            </div>
          </div>
        </div>

        {loadingFiche ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="px-4 pt-4 space-y-3 pb-6">
            {estTermine && (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-3 flex items-center gap-2">
                <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                <p className="text-sm text-green-700 font-medium">Importation confirmée. Lecture seule.</p>
              </div>
            )}

            {lignes.map(l => {
              const unit = l.typeUnite === 'C' ? 'ctn' : 'u';
              const total = l.comptes.reduce((s, n) => s + n, 0);
              const ecart = estTermine && l.depotTraite ? total - l.quantite : null;
              const isAdding = addingFor === l.mouvId;
              const expanded = expandedLines.has(l.mouvId);
              const hasSegments = l.comptes.length > 0;

              function toggleExpand() {
                setExpandedLines(prev => {
                  const next = new Set(prev);
                  next.has(l.mouvId) ? next.delete(l.mouvId) : next.add(l.mouvId);
                  return next;
                });
              }

              return (
                <div key={l.mouvId} className={`bg-white rounded-2xl border shadow-sm overflow-hidden
                  ${l.depotTraite
                    ? (estTermine && ecart !== 0 ? 'border-red-200' : 'border-green-200')
                    : 'border-gray-100'}`}>

                  {/* En-tête — toujours visible */}
                  <div className="px-4 py-3.5 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0
                      ${l.depotTraite
                        ? (estTermine && ecart !== 0 ? 'bg-red-100' : 'bg-green-100')
                        : 'bg-gray-100'}`}>
                      {l.depotTraite
                        ? (estTermine && ecart !== 0
                          ? <AlertTriangle size={15} className="text-red-500" />
                          : <CheckCircle2 size={16} className="text-green-600" />)
                        : <Package2 size={16} className="text-gray-400" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{l.produitNom}</p>
                      {hasSegments && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {l.comptes.length} segment{l.comptes.length > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Total */}
                      {l.depotTraite && (
                        <div className="text-right">
                          <p className={`text-sm font-bold ${estTermine && ecart !== 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {total.toLocaleString('fr-FR')} {unit}
                          </p>
                          {estTermine && ecart !== null && ecart !== 0 && (
                            <p className="text-xs text-gray-400">
                              Admin: {l.quantite}
                              <span className={`ml-1 font-bold ${ecart > 0 ? 'text-blue-500' : 'text-red-500'}`}>
                                ({ecart > 0 ? '+' : ''}{ecart})
                              </span>
                            </p>
                          )}
                        </div>
                      )}

                      {/* Bouton +  (compact, toujours visible si pas terminé) */}
                      {!estTermine && !isAdding && (
                        <button
                          onClick={() => { setAddingFor(l.mouvId); setAddInput(''); setEditingSegment(null); if (!expanded) toggleExpand(); }}
                          disabled={saving}
                          className="w-9 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition-colors disabled:opacity-40 shrink-0">
                          <Plus size={16} />
                        </button>
                      )}

                      {/* Chevron dépli (si segments) */}
                      {hasSegments && (
                        <button onClick={toggleExpand}
                          className="w-9 h-9 rounded-xl border border-gray-100 text-gray-400 flex items-center justify-center hover:bg-gray-50 transition-colors shrink-0">
                          <ChevronRight size={16} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Input ajout — visible si isAdding (même si pas expanded) */}
                  {isAdding && (
                    <div className="px-4 pb-3 flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={addInput}
                        onChange={e => setAddInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && ajouterSegment(l)}
                        placeholder={`Quantité (${unit})`}
                        autoFocus
                        className="flex-1 border border-blue-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-blue-50"
                      />
                      <button onClick={() => ajouterSegment(l)} disabled={saving || !addInput}
                        className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:bg-gray-200 disabled:text-gray-400 transition-colors shrink-0">
                        <Check size={14} /> OK
                      </button>
                      <button onClick={() => { setAddingFor(null); setAddInput(''); }}
                        className="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors shrink-0">
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  {/* Segments — visibles uniquement si expanded */}
                  {expanded && hasSegments && (
                    <div className="mx-4 mb-3 bg-gray-50 rounded-xl overflow-hidden divide-y divide-gray-100">
                      {l.comptes.map((c, idx) => {
                        const isEditingThis = editingSegment?.mouvId === l.mouvId && editingSegment.idx === idx;
                        return (
                          <div key={idx} className="flex items-center gap-2 px-3 py-2">
                            <span className="text-xs font-bold text-gray-300 w-5">#{idx + 1}</span>
                            {isEditingThis ? (
                              <>
                                <input
                                  type="number" min={1}
                                  value={editingSegment.val}
                                  onChange={e => setEditingSegment({ ...editingSegment, val: e.target.value })}
                                  onKeyDown={e => e.key === 'Enter' && modifierSegment(l)}
                                  autoFocus
                                  className="flex-1 border border-blue-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                                />
                                <button onClick={() => modifierSegment(l)} disabled={saving}
                                  className="w-7 h-7 rounded-lg bg-green-100 text-green-600 flex items-center justify-center disabled:opacity-40">
                                  <Check size={13} />
                                </button>
                                <button onClick={() => setEditingSegment(null)}
                                  className="w-7 h-7 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center">
                                  <X size={13} />
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="flex-1 text-sm font-semibold text-gray-700">
                                  {c.toLocaleString('fr-FR')} {unit}
                                </span>
                                {!estTermine && (
                                  <>
                                    <button onClick={() => setEditingSegment({ mouvId: l.mouvId, idx, val: String(c) })}
                                      className="w-7 h-7 rounded-lg text-gray-300 hover:bg-blue-50 hover:text-blue-500 flex items-center justify-center transition-colors">
                                      <Edit2 size={13} />
                                    </button>
                                    <button onClick={() => supprimerSegment(l, idx)} disabled={saving}
                                      className="w-7 h-7 rounded-lg text-gray-300 hover:bg-red-50 hover:text-red-400 flex items-center justify-center transition-colors disabled:opacity-40">
                                      <X size={13} />
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                      {l.comptes.length > 1 && (
                        <div className="flex items-center justify-between px-3 py-2 bg-gray-100">
                          <span className="text-xs text-gray-400 font-medium">Total</span>
                          <span className="text-sm font-bold text-gray-700">{total.toLocaleString('fr-FR')} {unit}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {toutesTraitees && !estTermine && (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
                <CheckCircle2 size={28} className="mx-auto text-green-500 mb-2" />
                <p className="font-bold text-green-700">Tous les produits ont été traités</p>
                <p className="text-xs text-green-600 mt-1">L'admin peut maintenant confirmer cette importation.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </DepotLayout>
  );

  /* ════ LISTE ════ */
  const importationsFiltrees = importations.filter(imp =>
    filtreStatut === 'tout' ? true : (imp.statut ?? 'en_cours') === filtreStatut,
  );

  return (
    <DepotLayout>
      <div className="px-4 pt-5 pb-6">
        <p className="font-bold text-gray-900 text-lg mb-4">Importations</p>

        <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
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
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0
                  ${filtreStatut === f.key
                    ? f.key === 'en_cours' ? 'bg-orange-500 text-white'
                      : f.key === 'traite' ? 'bg-blue-500 text-white'
                      : f.key === 'termine' ? 'bg-green-600 text-white'
                      : 'bg-indigo-600 text-white'
                    : 'bg-white border border-gray-200 text-gray-600'}`}>
                {f.label}
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold
                    ${filtreStatut === f.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : importationsFiltrees.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Ship size={40} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">{importations.length === 0 ? 'Aucune importation' : 'Aucune dans cette catégorie'}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {importationsFiltrees.map(imp => {
              const s = imp.statut ?? 'en_cours';
              return (
                <button key={imp.id} onClick={() => ouvrirFiche(imp)}
                  className={`w-full bg-white rounded-2xl shadow-sm p-4 text-left active:bg-gray-50 border
                    ${s === 'termine' ? 'border-green-200 opacity-80'
                      : s === 'traite' ? 'border-blue-200'
                      : 'border-orange-200'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center
                        ${s === 'termine' ? 'bg-green-50' : s === 'traite' ? 'bg-blue-50' : 'bg-orange-50'}`}>
                        {s === 'termine'
                          ? <CheckCircle2 size={18} className="text-green-500" />
                          : <Ship size={18} className={s === 'traite' ? 'text-blue-500' : 'text-orange-500'} />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-gray-900 font-mono">{imp.numero}</p>
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full
                            ${s === 'traite' ? 'bg-blue-100 text-blue-700'
                              : s === 'termine' ? 'bg-green-100 text-green-700'
                              : 'bg-orange-100 text-orange-600'}`}>
                            {statutLabel(s)}
                          </span>
                          {s === 'termine' && (imp.nombreEcarts ?? 0) > 0 && (
                            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
                              {imp.nombreEcarts} écart{(imp.nombreEcarts ?? 0) > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">
                          {imp.nombreProduitTraite ?? 0}/{imp.nombreDeProduit} traités · {formatDate(imp.date)}
                        </p>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-gray-300" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </DepotLayout>
  );
}
