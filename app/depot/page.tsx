'use client';
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import DepotLayout from '@/components/DepotLayout';
import { formatDate } from '@/lib/format';
import { Search, X, ChevronRight, Truck, Clock, CheckCircle2, Download, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Document {
  id: string;
  numeroDocument: string;
  clientNom: string;
  nombreDeProduit: number;
  statut: string;
  livraison: 'non_livre' | 'livre';
  date: any;
}

interface BoutiqueInfo {
  nom?: string;
  telephone?: string;
  adresse?: string;
  logo?: string;
}

function isAujourdhui(date: any) {
  if (!date) return false;
  const d = date?.seconds ? new Date(date.seconds * 1000) : new Date(date);
  const now = new Date();
  return d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
}

export default function DepotDocumentsPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [recherche, setRecherche] = useState('');
  const [onglet, setOnglet] = useState<'en_attente' | 'livre'>('en_attente');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [modalAncien, setModalAncien] = useState<Document | null>(null);
  const [boutiqueInfo, setBoutiqueInfo] = useState<BoutiqueInfo | null>(null);

  useEffect(() => {
    if (!profile) return;
    async function load() {
      const snap = await getDocs(query(
        collection(db, 'documents_stock'),
        where('userId', '==', profile!.adminUid),
        where('typeDocument', '==', 'Sortie'),
      ));
      const data: Document[] = snap.docs.map(d => ({
        id: d.id,
        numeroDocument: d.data().numeroDocument || '',
        clientNom: d.data().clientNom || '',
        nombreDeProduit: d.data().nombreDeProduit || 0,
        statut: d.data().statut || 'En cours',
        livraison: d.data().livraison || 'non_livre',
        date: d.data().date,
      }));
      data.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
      setDocs(data);

      // Charger infos boutique pour le PDF
      const boutiqueSnap = await getDoc(doc(db, 'boutiques', profile!.adminUid));
      if (boutiqueSnap.exists()) setBoutiqueInfo(boutiqueSnap.data() as BoutiqueInfo);

      setLoading(false);
    }
    load();
  }, [profile]);

  // Logique de visibilité :
  // En attente : tous les non livrés (aujourd'hui + anciens)
  // Livré : seulement les livrés d'aujourd'hui
  const filtered = useMemo(() => docs.filter(d => {
    const okRecherche = !recherche ||
      (d.clientNom || '').toLowerCase().includes(recherche.toLowerCase()) ||
      (d.numeroDocument || '').toLowerCase().includes(recherche.toLowerCase());

    if (onglet === 'livre') {
      return okRecherche && d.livraison === 'livre' && isAujourdhui(d.date);
    } else {
      return okRecherche && d.livraison !== 'livre';
    }
  }), [docs, recherche, onglet]);

  const nbAttente = docs.filter(d => d.livraison !== 'livre').length;
  const nbLivre   = docs.filter(d => d.livraison === 'livre' && isAujourdhui(d.date)).length;

  useEffect(() => {
    if ('setAppBadge' in navigator) {
      if (nbAttente > 0) navigator.setAppBadge(nbAttente);
      else navigator.clearAppBadge();
    }
  }, [nbAttente]);

  async function confirmerLivraison(d: Document) {
    setUpdatingId(d.id);
    const newLivraison = d.livraison === 'livre' ? 'non_livre' : 'livre';
    const newStatut = newLivraison === 'livre' ? 'Terminé' : 'En cours';
    await updateDoc(doc(db, 'documents_stock', d.id), {
      livraison: newLivraison,
      statut: newStatut,
      livraisonUpdatedAt: serverTimestamp(),
    });
    setDocs(prev => prev.map(x => x.id === d.id ? { ...x, livraison: newLivraison, statut: newStatut } : x));
    setUpdatingId(null);
    setModalAncien(null);
  }

  async function handleClickLivraison(d: Document) {
    if (d.livraison === 'livre') {
      // Annuler livraison — direct
      await confirmerLivraison(d);
      return;
    }
    if (!isAujourdhui(d.date)) {
      // Bon d'un autre jour — modal d'avertissement
      setModalAncien(d);
      return;
    }
    await confirmerLivraison(d);
  }

  async function confirmerAncien() {
    if (!modalAncien) return;
    // Pour les anciens bons : marquer livré mais ils disparaîtront (pas du jour donc hors livré visible)
    setUpdatingId(modalAncien.id);
    await updateDoc(doc(db, 'documents_stock', modalAncien.id), {
      livraison: 'livre',
      statut: 'Terminé',
      livraisonUpdatedAt: serverTimestamp(),
    });
    setDocs(prev => prev.map(x => x.id === modalAncien!.id ? { ...x, livraison: 'livre', statut: 'Terminé' } : x));
    setUpdatingId(null);
    setModalAncien(null);
  }

  // ── Rapport du jour PDF ──────────────────────────────────
  async function telechargerRapport() {
    const aujourdhui = docs.filter(d => isAujourdhui(d.date));
    if (aujourdhui.length === 0) return;

    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = 210;
    const M = 14;
    const colW = pageW - M * 2;
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const trunc = (s: string, max: number) => s.length > max ? s.slice(0, max - 1) + '.' : s;

    // ── Bandeau en-tête ──────────────────────────────────────
    pdf.setFillColor(30, 41, 90);
    pdf.rect(0, 0, pageW, 36, 'F');

    let textLeft = M;
    if (boutiqueInfo?.logo) {
      try {
        const ext = boutiqueInfo.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(boutiqueInfo.logo, ext, M, 5, 22, 22, undefined, 'FAST');
        textLeft = M + 26;
      } catch { /* ignore */ }
    }

    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14); pdf.setTextColor(255);
    pdf.text(boutiqueInfo?.nom || 'IBD Kunda', textLeft, 15);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(180, 190, 230);
    if (boutiqueInfo?.telephone) pdf.text('Tel: ' + boutiqueInfo.telephone, textLeft, 21);
    if (boutiqueInfo?.adresse)   pdf.text(boutiqueInfo.adresse, textLeft, 26);

    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(255);
    pdf.text('RAPPORT DU JOUR', pageW - M, 15, { align: 'right' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(180, 190, 230);
    pdf.text(dateStr, pageW - M, 22, { align: 'right' });
    pdf.text(`${aujourdhui.length} bon(s) au total`, pageW - M, 28, { align: 'right' });

    let y = 44;

    // ── Stats résumé ─────────────────────────────────────────
    const nbLivresJour    = aujourdhui.filter(d => d.livraison === 'livre').length;
    const nbNonLivresJour = aujourdhui.filter(d => d.livraison !== 'livre').length;

    const statW = (colW - 6) / 3;
    const stats = [
      { label: 'Total bons', val: String(aujourdhui.length), bg: [49, 70, 145] as [number,number,number] },
      { label: 'Livres',     val: String(nbLivresJour),      bg: [22, 101, 52]  as [number,number,number] },
      { label: 'En attente', val: String(nbNonLivresJour),   bg: [180, 83, 9]   as [number,number,number] },
    ];
    stats.forEach((s, i) => {
      const sx = M + i * (statW + 3);
      pdf.setFillColor(...s.bg);
      pdf.roundedRect(sx, y, statW, 14, 2, 2, 'F');
      pdf.setFontSize(16); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(255);
      pdf.text(s.val, sx + statW / 2, y + 8, { align: 'center' });
      pdf.setFontSize(7); pdf.setFont('helvetica', 'normal');
      pdf.text(s.label, sx + statW / 2, y + 12.5, { align: 'center' });
    });
    y += 20;

    // ── Bons du jour ─────────────────────────────────────────
    for (const d of aujourdhui) {
      // En-tête du bon
      const estLivre = d.livraison === 'livre';
      const headerBg: [number,number,number] = estLivre ? [22, 101, 52] : [180, 83, 9];

      // Vérifier espace restant
      if (y > 260) { pdf.addPage(); y = 14; }

      pdf.setFillColor(...headerBg);
      pdf.roundedRect(M, y, colW, 10, 2, 2, 'F');
      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(255);
      pdf.text(trunc(d.clientNom, 35), M + 3, y + 6.5);
      pdf.text(`${d.nombreDeProduit} produit(s)`, M + colW / 2, y + 6.5, { align: 'center' });
      const statutLabel = estLivre ? 'LIVRE' : 'EN ATTENTE';
      pdf.text(statutLabel, M + colW - 3, y + 6.5, { align: 'right' });
      y += 11;

      // Charger les mouvements du document pour avoir les produits
      try {
        const mouvSnap = await getDocs(query(
          collection(db, 'mouvements'),
          where('documentId', '==', doc(db, 'documents_stock', d.id)),
        ));

        if (mouvSnap.empty) {
          // Pas de mouvements — ligne simple
          pdf.setFontSize(8); pdf.setFont('helvetica', 'italic'); pdf.setTextColor(150);
          pdf.text('Aucun detail disponible', M + 3, y + 5);
          y += 8;
        } else {
          // En-tête colonnes produits
          pdf.setFillColor(240, 242, 248);
          pdf.rect(M, y, colW, 6, 'F');
          pdf.setFontSize(7.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(80);
          pdf.text('Designation', M + 3, y + 4.2);
          pdf.text('Unite', M + 110, y + 4.2);
          pdf.text('Quantite', M + colW - 3, y + 4.2, { align: 'right' });
          y += 6;

          mouvSnap.docs.forEach((m, mi) => {
            if (y > 270) { pdf.addPage(); y = 14; }
            const data = m.data();
            const bg: [number,number,number] = mi % 2 === 0 ? [255,255,255] : [248,249,252];
            pdf.setFillColor(...bg);
            pdf.rect(M, y, colW, 6.5, 'F');
            pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(30);
            pdf.text(trunc(data.produitNom || '', 52), M + 3, y + 4.5);
            pdf.text(data.typeUnite === 'C' ? 'Carton' : 'Unite', M + 110, y + 4.5);
            pdf.setFont('helvetica', 'bold');
            pdf.text(String(data.quantite || 0), M + colW - 3, y + 4.5, { align: 'right' });
            y += 6.5;
          });
        }
      } catch {
        y += 6;
      }

      // Séparateur entre bons
      pdf.setDrawColor(220, 225, 240); pdf.setLineWidth(0.3);
      pdf.line(M, y + 2, M + colW, y + 2);
      y += 7;
    }

    pdf.save(`Rapport-Depot-${dateStr.replace(/\//g, '-')}.pdf`);
  }

  return (
    <DepotLayout>
      <div className="px-4 pt-5 pb-4">
        {/* En-tête + bouton rapport */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2 flex-1">
            <button onClick={() => setOnglet('en_attente')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors
                ${onglet === 'en_attente' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-500'}`}>
              <Clock size={15} />
              En attente
              {nbAttente > 0 && (
                <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center
                  ${onglet === 'en_attente' ? 'bg-white/30 text-white' : 'bg-orange-100 text-orange-600'}`}>
                  {nbAttente}
                </span>
              )}
            </button>
            <button onClick={() => setOnglet('livre')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors
                ${onglet === 'livre' ? 'bg-green-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-500'}`}>
              <Truck size={15} />
              Livré
              {nbLivre > 0 && (
                <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center
                  ${onglet === 'livre' ? 'bg-white/30 text-white' : 'bg-green-100 text-green-600'}`}>
                  {nbLivre}
                </span>
              )}
            </button>
          </div>
          {/* Bouton rapport */}
          <button
            onClick={telechargerRapport}
            className="ml-2 p-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl transition-colors shrink-0"
            title="Rapport du jour"
          >
            <Download size={16} />
          </button>
        </div>

        {/* Recherche */}
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={recherche} onChange={e => setRecherche(e.target.value)}
            placeholder="Rechercher un client ou N° doc..."
            className="w-full pl-9 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
          {recherche && (
            <button onClick={() => setRecherche('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Indication visibilité */}
        {onglet === 'livre' && (
          <p className="text-xs text-gray-400 text-center mb-3">Seuls les bons livrés aujourd'hui sont visibles</p>
        )}
        {onglet === 'en_attente' && (
          <p className="text-xs text-gray-400 text-center mb-3">Tous les bons non livrés — aujourd'hui et jours précédents</p>
        )}

        {/* Liste */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Truck size={40} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">Aucun document {onglet === 'livre' ? 'livré aujourd\'hui' : 'en attente'}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map(d => {
              const ancienNonLivre = !isAujourdhui(d.date) && d.livraison !== 'livre';
              return (
                <div key={d.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden
                  ${ancienNonLivre ? 'border-amber-200' : 'border-gray-100'}`}>
                  {ancienNonLivre && (
                    <div className="px-4 pt-2 pb-0">
                      <span className="text-xs text-amber-600 font-medium">Bon d'un jour précédent</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 px-4 pt-4 pb-3 cursor-pointer"
                    onClick={() => router.push(`/depot/document/${d.id}`)}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                      ${d.livraison === 'livre' ? 'bg-green-100' : ancienNonLivre ? 'bg-amber-50' : 'bg-orange-50'}`}>
                      {d.livraison === 'livre'
                        ? <CheckCircle2 size={20} className="text-green-600" />
                        : <Clock size={20} className={ancienNonLivre ? 'text-amber-400' : 'text-orange-400'} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900 truncate">{d.clientNom || '—'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {d.numeroDocument} · {d.nombreDeProduit} produit(s) · {formatDate(d.date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                        ${d.statut === 'Terminé' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        {d.statut}
                      </span>
                      <ChevronRight size={15} className="text-gray-300" />
                    </div>
                  </div>

                  <div className="border-t border-gray-50 px-4 py-2.5">
                    <button
                      onClick={() => handleClickLivraison(d)}
                      disabled={updatingId === d.id}
                      className={`w-full py-2 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2
                        ${d.livraison === 'livre'
                          ? 'bg-green-50 text-green-600 border border-green-200'
                          : ancienNonLivre
                            ? 'bg-amber-500 text-white'
                            : 'bg-orange-500 text-white'}`}>
                      {updatingId === d.id ? (
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : d.livraison === 'livre' ? (
                        <><CheckCircle2 size={15} /> Livré — Annuler</>
                      ) : (
                        <><Truck size={15} /> Marquer comme livré</>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal bon d'un autre jour */}
      {modalAncien && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setModalAncien(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex flex-col items-center gap-3 mb-5">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                <AlertTriangle size={22} className="text-amber-500" />
              </div>
              <p className="text-base font-bold text-gray-900 text-center">Bon d'un autre jour</p>
              <p className="text-sm text-gray-500 text-center">
                Ce bon (<span className="font-semibold">{modalAncien.clientNom}</span>) n'est pas du jour.
                Si vous confirmez, il disparaîtra de la liste — il ne sera pas visible dans les livrés d'aujourd'hui.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setModalAncien(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={confirmerAncien}
                disabled={updatingId === modalAncien.id}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50"
              >
                {updatingId === modalAncien.id ? '...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DepotLayout>
  );
}
