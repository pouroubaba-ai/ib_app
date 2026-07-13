'use client';
import { useEffect, useState } from 'react';
import { doc, getDoc, getDocs, collection, query, where, updateDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { formatMontant, formatDate } from '@/lib/format';
import { ArrowLeft, Pencil, Check, X, Trash2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';

interface Produit {
  id: string;
  designation: string;
  prix_unitaire: number;
  quantite_par_emballage: number;
  quantite_unitaire_total: number;
}

interface Mouvement {
  id: string;
  typeDocument: string;
  typeTransaction?: string;
  motif?: string;
  quantite: number;
  totalLigne: number;
  prixUnitaireReel: number;
  nomClient?: string;
  date: any;
  typeUnite?: string;
}

type FiltreHistorique = 'tout' | 'Entrée' | 'Sortie' | 'Retour' | 'Reajustement';

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: 'green' | 'blue' | 'indigo' }) {
  const styles = {
    green: 'bg-green-50 border-green-100 text-green-700',
    blue: 'bg-blue-50 border-blue-100 text-blue-700',
    indigo: 'bg-indigo-50 border-indigo-100 text-indigo-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${styles[color]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-60 mb-1">{label}</p>
      <p className="text-xl font-bold">{value}</p>
      {sub && <p className="text-xs opacity-50 mt-0.5">{sub}</p>}
    </div>
  );
}

function InlineEdit({ label, value, type = 'text', onSave }: {
  label: string; value: string; type?: string; onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!val.trim()) return;
    setSaving(true);
    await onSave(val.trim());
    setSaving(false);
    setEditing(false);
  }

  function cancel() {
    setVal(value);
    setEditing(false);
  }

  return (
    <div>
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      {!editing ? (
        <div className="flex items-center gap-2">
          <p className="font-semibold text-gray-900">{value}</p>
          <button onClick={() => { setVal(value); setEditing(true); }} className="p-1 rounded hover:bg-gray-100 transition-colors">
            <Pencil size={13} className="text-gray-400 hover:text-indigo-500" />
          </button>
        </div>
      ) : (
        <div className="mt-1 space-y-2">
          <input
            type={type}
            value={val}
            onChange={e => setVal(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 border border-indigo-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving || !val.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-indigo-700 transition-colors"
            >
              <Check size={13} />
              {saving ? 'Enregistrement...' : 'Confirmer'}
            </button>
            <button
              onClick={cancel}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              <X size={13} />
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const BADGE: Record<string, { label: string; color: string }> = {
  'vente':        { label: 'Vente',         color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' },
  'Achat':        { label: 'Achat',          color: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' },
  'Retour':       { label: 'Retour',         color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
  'Reajustement': { label: 'Réajustement',  color: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' },
  // Legacy fallbacks
  'Entrée':       { label: 'Achat',          color: 'bg-green-100 text-green-600' },
  'Sortie':       { label: 'Vente',          color: 'bg-blue-100 text-blue-600' },
  'Perte':        { label: 'Réajustement',  color: 'bg-orange-100 text-orange-600' },
};

export default function FicheProduitPage() {
  const { user } = useAuth();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [produit, setProduit] = useState<Produit | null>(null);
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);
  const [loading, setLoading] = useState(true);
  const [renomMessage, setRenomMessage] = useState('');
  const [filtreHistorique, setFiltreHistorique] = useState<FiltreHistorique>('tout');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const prodRef = doc(db, 'Produits', id);
      const [prodSnap, mouvSnap] = await Promise.all([
        getDoc(prodRef),
        getDocs(query(collection(db, 'mouvements'), where('produitId', '==', prodRef))),
      ]);

      if (!prodSnap.exists()) { setLoading(false); return; }
      const d = prodSnap.data();
      setProduit({
        id: prodSnap.id,
        designation: d.designation,
        prix_unitaire: d.prix_unitaire,
        quantite_par_emballage: d.quantite_par_emballage,
        quantite_unitaire_total: d.quantite_unitaire_total || 0,
      });

      const mvts = mouvSnap.docs.map(d => ({ id: d.id, ...d.data() } as Mouvement));
      mvts.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
      setMouvements(mvts);
      setLoading(false);
    }
    load();
  }, [user, id]);

  async function saveNom(newNom: string) {
    if (!produit) return;
    const oldNom = produit.designation;
    await updateDoc(doc(db, 'Produits', id), { designation: newNom });

    const mouvSnap = await getDocs(query(
      collection(db, 'mouvements'),
      where('userId', '==', user!.uid),
      where('produitNom', '==', oldNom)
    ));
    const batch = writeBatch(db);
    mouvSnap.docs.forEach(d => batch.update(d.ref, { produitNom: newNom }));
    await batch.commit();

    setProduit(p => p ? { ...p, designation: newNom } : p);
    setRenomMessage(`Nom mis à jour sur ${mouvSnap.docs.length} mouvement(s).`);
    setTimeout(() => setRenomMessage(''), 4000);
  }

  async function savePrix(newPrix: string) {
    const prix = Number(newPrix);
    if (isNaN(prix) || prix <= 0) return;
    await updateDoc(doc(db, 'Produits', id), { prix_unitaire: prix });
    setProduit(p => p ? { ...p, prix_unitaire: prix } : p);
  }

  async function confirmerSuppression() {
    setDeleting(true);
    await deleteDoc(doc(db, 'Produits', id));
    router.replace('/inventaire');
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!produit) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">
      Produit introuvable.
    </div>
  );

  let totalAchats = 0, qteAchats = 0;
  let totalVentes = 0, qteVentes = 0;
  let totalRetours = 0, qteRetours = 0;
  let totalReajHausse = 0, qteReajHausse = 0;
  let totalReajBaisse = 0, qteReajBaisse = 0;
  const qpe = produit.quantite_par_emballage || 1;
  mouvements.forEach(m => {
    const val = m.totalLigne || 0;
    const qte = m.quantite || 0;
    const qteU = m.typeUnite === 'C' ? qte * qpe : qte;
    const cartonsU = m.typeUnite === 'C' ? qte : qte / qpe;
    const tt = m.typeTransaction || '';
    const td = m.typeDocument || '';
    if (tt === 'Achat' || (td === 'Entrée' && !tt)) { totalAchats += val; qteAchats += qteU; }
    else if (tt === 'vente' || tt === 'Vente' || (td === 'Sortie' && !tt)) { totalVentes += val; qteVentes += qteU; }
    else if (tt === 'Retour') { totalRetours += val; qteRetours += qteU; }
    else if (tt === 'Reajustement') {
      if (td === 'Entrée') { totalReajHausse += val; qteReajHausse += cartonsU; }
      else { totalReajBaisse += val; qteReajBaisse += cartonsU; }
    }
  });
  const valeurStock = produit.prix_unitaire * produit.quantite_unitaire_total;

  const mouvementsFiltres = filtreHistorique === 'tout'
    ? mouvements
    : filtreHistorique === 'Retour'
      ? mouvements.filter(m => m.typeTransaction === 'Retour')
      : filtreHistorique === 'Reajustement'
        ? mouvements.filter(m => m.typeTransaction === 'Reajustement')
        : filtreHistorique === 'Entrée'
          ? mouvements.filter(m => m.typeTransaction === 'Achat' || (m.typeDocument === 'Entrée' && !m.typeTransaction))
          : mouvements.filter(m => m.typeTransaction === 'vente' || m.typeTransaction === 'Vente' || (m.typeDocument === 'Sortie' && !m.typeTransaction));

  return (
    <div className="min-h-screen bg-gray-50">

      {/* EN-TÊTE */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400">Fiche produit</p>
            <p className="font-bold text-gray-900 truncate">{produit.designation}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
<button
              onClick={() => setShowDeleteModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg text-sm font-medium transition-colors"
            >
              <Trash2 size={14} />
              Supprimer
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* INFORMATIONS MODIFIABLES */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Informations</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <InlineEdit label="Désignation" value={produit.designation} onSave={saveNom} />
              {renomMessage && <p className="text-xs text-green-600 mt-1">{renomMessage}</p>}
            </div>
            <InlineEdit label="Prix unitaire (FCFA)" value={String(produit.prix_unitaire)} type="number" onSave={savePrix} />
            <div>
              <p className="text-gray-400 text-xs mb-1">Emballage</p>
              <p className="font-semibold text-gray-900">{produit.quantite_par_emballage} unités / carton</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-1">Stock actuel</p>
              <p className={`font-semibold ${produit.quantite_unitaire_total === 0 ? 'text-red-500' : 'text-gray-900'}`}>
                {produit.quantite_unitaire_total.toLocaleString('fr-FR')} unités
                <span className="text-xs font-normal text-gray-400 ml-2">
                  ({(produit.quantite_unitaire_total / produit.quantite_par_emballage).toFixed(1)} cartons)
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* STATS */}
        {(() => {
          const qpe = produit.quantite_par_emballage;
          function qteLabel(u: number) {
            const c = Math.floor(u / qpe);
            return `${u.toLocaleString('fr-FR')} unités (${c.toLocaleString('fr-FR')} carton${c > 1 ? 's' : ''})`;
          }
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <StatCard
                label="Achats"
                value={formatMontant(totalAchats)}
                sub={qteLabel(qteAchats)}
                color="green"
              />
              <StatCard
                label="Ventes nettes"
                value={formatMontant(totalVentes - totalRetours)}
                sub={totalRetours > 0
                  ? `Retours : −${formatMontant(totalRetours)} · ${qteLabel(qteVentes)}`
                  : qteLabel(qteVentes)}
                color="blue"
              />
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-orange-100 dark:border-orange-900/40 shadow-sm p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400 mb-3">Réajustements</p>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-gray-500">↑ Hausse</span>
                  <span className="text-sm font-bold text-green-600">
                    {formatMontant(totalReajHausse)}
                    {qteReajHausse > 0 && <span className="text-xs font-normal text-gray-400 ml-1">({Math.round(qteReajHausse)} carton{Math.round(qteReajHausse) > 1 ? 's' : ''})</span>}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">↓ Baisse</span>
                  <span className="text-sm font-bold text-red-500">
                    {formatMontant(totalReajBaisse)}
                    {qteReajBaisse > 0 && <span className="text-xs font-normal text-gray-400 ml-1">({Math.round(qteReajBaisse)} carton{Math.round(qteReajBaisse) > 1 ? 's' : ''})</span>}
                  </span>
                </div>
                {qteReajHausse === 0 && qteReajBaisse === 0 && (
                  <p className="text-xs text-gray-400 italic mt-1">Aucun réajustement</p>
                )}
              </div>
              <StatCard
                label="Valeur en stock"
                value={formatMontant(valeurStock)}
                sub={qteLabel(produit.quantite_unitaire_total)}
                color="indigo"
              />
            </div>
          );
        })()}

        {/* HISTORIQUE */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Historique des mouvements</h2>
              <p className="text-xs text-gray-400 mt-0.5">{mouvementsFiltres.length} opération(s)</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {([
                { key: 'tout', label: 'Tout', active: 'bg-gray-800 text-white' },
                { key: 'Entrée', label: 'Achats', active: 'bg-green-600 text-white' },
                { key: 'Sortie', label: 'Ventes', active: 'bg-blue-600 text-white' },
                { key: 'Retour', label: 'Retours', active: 'bg-red-500 text-white' },
                { key: 'Reajustement', label: 'Réajust.', active: 'bg-orange-500 text-white' },
              ] as { key: FiltreHistorique; label: string; active: string }[]).map(({ key, label, active }) => (
                <button
                  key={key}
                  onClick={() => setFiltreHistorique(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${filtreHistorique === key ? active : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mouvementsFiltres.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">Aucun mouvement</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Type</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Client / Fourn.</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Qté</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Prix unit.</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Total</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {mouvementsFiltres.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3">
                        {(() => {
                          const key = m.typeTransaction || m.typeDocument;
                          const b = BADGE[key] || { label: key, color: 'bg-gray-100 text-gray-500' };
                          return (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${b.color}`}>
                              {b.label}{m.typeTransaction === 'Reajustement' && m.motif ? ` · ${m.motif}` : ''}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-5 py-3 text-gray-700">{m.nomClient || '—'}</td>
                      <td className="px-5 py-3 text-right font-medium text-gray-900">
                        {m.quantite?.toLocaleString('fr-FR')}
                        <span className="text-xs text-gray-400 ml-1">{m.typeUnite}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600">
                        {(m.prixUnitaireReel || 0).toLocaleString('fr-FR')}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-gray-900">
                        {formatMontant(m.totalLigne)}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-400 whitespace-nowrap">
                        {formatDate(m.date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </main>

      {/* MODALE SUPPRESSION */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !deleting && setShowDeleteModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <Trash2 size={22} className="text-red-500" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-gray-900">Supprimer ce produit ?</h3>
              <p className="text-sm text-gray-500 mt-1">
                <span className="font-medium text-gray-700">« {produit.designation} »</span> sera supprimé définitivement.
                Les mouvements associés ne seront pas supprimés.
              </p>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
              >
                Annuler
              </button>
              <button
                onClick={confirmerSuppression}
                disabled={deleting}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
              >
                {deleting ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
