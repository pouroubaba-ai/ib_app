'use client';
import { useEffect, useState, useMemo } from 'react';
import {
  doc, getDoc, updateDoc, serverTimestamp, collection, writeBatch, increment, getDocs, query, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { useRouter, useParams } from 'next/navigation';
import { formatMontant, formatDate } from '@/lib/format';
import {
  ArrowLeft, Package, CheckCircle2, XCircle, Share2, Download,
  Edit2, Check, X, AlertTriangle,
} from 'lucide-react';

type StatutDevis = 'brouillon' | 'envoye' | 'confirme' | 'annule';

interface LigneDevis {
  produitId: string | null;
  produitNom: string;
  typeUnite: 'U' | 'C';
  quantite: number;
  prix: number;
  qpe: number;
  horsDepot: boolean;
}

interface DevisData {
  id: string;
  numeroDevis: string;
  clientNom: string;
  clientId: string;
  statut: StatutDevis;
  date: any;
  lignes: LigneDevis[];
  totalGeneral: number;
  totalDepot: number;
  totalHorsDepot: number;
  adminUid: string;
}

interface BoutiqueInfo {
  nom: string;
  telephone: string;
  adresse: string;
  logo?: string;
}

const STATUT_CONFIG: Record<StatutDevis, { label: string; color: string; bg: string }> = {
  brouillon: { label: 'Brouillon',  color: 'text-gray-600',  bg: 'bg-gray-100 dark:bg-gray-800' },
  envoye:    { label: 'Envoyé',     color: 'text-blue-600',  bg: 'bg-blue-100 dark:bg-blue-900/30' },
  confirme:  { label: 'Confirmé',   color: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900/30' },
  annule:    { label: 'Annulé',     color: 'text-red-500',   bg: 'bg-red-100 dark:bg-red-900/30' },
};

type ModalType = 'confirmer' | 'annuler' | null;

interface AlerteStock {
  produitNom: string;
  demande: number;
  disponible: number;
  typeUnite: 'U' | 'C';
}

export default function FicheDevisPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const params = useParams();
  const devisId = params.id as string;

  const adminUid = profile?.role === 'admin' ? user?.uid : profile?.adminUid;

  const [devis, setDevis] = useState<DevisData | null>(null);
  const [boutiqueInfo, setBoutiqueInfo] = useState<BoutiqueInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalType>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const [alertesStock, setAlertesStock] = useState<AlerteStock[]>([]);

  // Edition des lignes
  const [editMode, setEditMode] = useState(false);
  const [lignesEdit, setLignesEdit] = useState<LigneDevis[]>([]);

  useEffect(() => {
    if (!devisId) return;
    async function load() {
      const snap = await getDoc(doc(db, 'devis', devisId));
      if (snap.exists()) {
        setDevis({ id: snap.id, ...snap.data() } as DevisData);
        setLignesEdit((snap.data().lignes || []) as LigneDevis[]);
      }

      // Charger les infos boutique
      if (adminUid) {
        const boutiqueSnap = await getDoc(doc(db, 'boutiques', adminUid));
        if (boutiqueSnap.exists()) {
          setBoutiqueInfo(boutiqueSnap.data() as BoutiqueInfo);
        }
      }
      setLoading(false);
    }
    load();
  }, [devisId, adminUid]);

  function mettreAJourLigne(index: number, champ: keyof LigneDevis, valeur: any) {
    setLignesEdit(prev => prev.map((l, i) => i === index ? { ...l, [champ]: valeur } : l));
  }

  async function sauvegarderEdition() {
    if (!devis) return;
    setEnCours(true);
    try {
      const totalGeneral = lignesEdit.reduce((s, l) => s + l.quantite * l.prix, 0);
      const totalDepot = lignesEdit.filter(l => !l.horsDepot).reduce((s, l) => s + l.quantite * l.prix, 0);
      const totalHorsDepot = lignesEdit.filter(l => l.horsDepot).reduce((s, l) => s + l.quantite * l.prix, 0);
      await updateDoc(doc(db, 'devis', devisId), {
        lignes: lignesEdit,
        totalGeneral,
        totalDepot,
        totalHorsDepot,
        nbLignes: lignesEdit.length,
        nbLignesHorsDepot: lignesEdit.filter(l => l.horsDepot).length,
      });
      setDevis(prev => prev ? { ...prev, lignes: lignesEdit, totalGeneral, totalDepot, totalHorsDepot } : prev);
      setEditMode(false);
    } catch (e) {
      console.error(e);
    } finally {
      setEnCours(false);
    }
  }

  // Vérifier le stock avant d'ouvrir la modale de confirmation
  async function ouvrirModalConfirmation() {
    if (!devis) return;
    setEnCours(true);
    const alertes: AlerteStock[] = [];
    const lignesDepot = devis.lignes.filter(l => !l.horsDepot && l.produitId);
    for (const l of lignesDepot) {
      const snap = await getDoc(doc(db, 'Produits', l.produitId!));
      const stockUnits = (snap.data()?.quantite_unitaire_total ?? 0) as number;
      const stockDispo = l.typeUnite === 'C' && l.qpe > 0
        ? Math.floor(stockUnits / l.qpe)
        : stockUnits;
      if (l.quantite > stockDispo) {
        alertes.push({
          produitNom: l.produitNom,
          demande: l.quantite,
          disponible: stockDispo,
          typeUnite: l.typeUnite,
        });
      }
    }
    setAlertesStock(alertes);
    setEnCours(false);
    setModal('confirmer');
  }

  async function confirmerDevis() {
    if (!devis || !adminUid) return;
    setEnCours(true);
    setErreur('');
    try {
      const lignesDepot = devis.lignes.filter(l => !l.horsDepot && l.produitId);
      const batch = writeBatch(db);

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const numeroDoc = `SOR-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${Date.now().toString().slice(-4)}`;
      const docId = doc(collection(db, 'documents_stock')).id;

      // Calculer les quantités réelles (limitées au stock)
      const lignesEffectives: (LigneDevis & { qteReelle: number; qteUnitsReelle: number })[] = [];
      for (const l of lignesDepot) {
        const snap = await getDoc(doc(db, 'Produits', l.produitId!));
        const stockUnits = (snap.data()?.quantite_unitaire_total ?? 0) as number;
        const stockDispo = l.typeUnite === 'C' && l.qpe > 0
          ? Math.floor(stockUnits / l.qpe)
          : stockUnits;
        const qteReelle = Math.min(l.quantite, stockDispo);
        const qteUnitsReelle = l.typeUnite === 'C' ? qteReelle * l.qpe : qteReelle;
        if (qteReelle > 0) lignesEffectives.push({ ...l, qteReelle, qteUnitsReelle });
      }

      const totalDepotReel = lignesEffectives.reduce((s, l) => s + l.qteReelle * l.prix, 0);

      batch.set(doc(db, 'documents_stock', docId), {
        userId: adminUid,
        typeDocument: 'Sortie',
        numeroDocument: numeroDoc,
        clientNom: devis.clientNom,
        clientId: devis.clientId,
        date: serverTimestamp(),
        nombreDeProduit: lignesEffectives.length,
        totalGeneral: totalDepotReel,
        facturierTraites: [],
        facturierNbTraite: 0,
        facturierStatut: 'en_cours',
        devisId: devisId,
        devisNumero: devis.numeroDevis,
      });

      for (const l of lignesEffectives) {
        const mouvId = doc(collection(db, 'mouvements')).id;
        batch.set(doc(db, 'mouvements', mouvId), {
          userId: adminUid,
          documentId: doc(db, 'documents_stock', docId),
          typeTransaction: 'Sortie',
          produitId: l.produitId,
          produitNom: l.produitNom,
          quantite: l.qteReelle,
          typeUnite: l.typeUnite,
          quantiteUnites: l.qteUnitsReelle,
          prixUnitaire: l.prix,
          totalLigne: l.qteReelle * l.prix,
          date: serverTimestamp(),
        });
        batch.update(doc(db, 'Produits', l.produitId!), {
          quantite_unitaire_total: increment(-l.qteUnitsReelle),
        });
      }

      batch.update(doc(db, 'devis', devisId), {
        statut: 'confirme',
        confirmedAt: serverTimestamp(),
        documentId: docId,
      });

      await batch.commit();
      setDevis(prev => prev ? { ...prev, statut: 'confirme' } : prev);
      setModal(null);
    } catch (e) {
      console.error(e);
      setErreur('Erreur lors de la confirmation');
    } finally {
      setEnCours(false);
    }
  }

  async function annulerDevis() {
    setEnCours(true);
    try {
      await updateDoc(doc(db, 'devis', devisId), {
        statut: 'annule',
        annuleAt: serverTimestamp(),
      });
      setDevis(prev => prev ? { ...prev, statut: 'annule' } : prev);
      setModal(null);
    } catch (e) {
      console.error(e);
    } finally {
      setEnCours(false);
    }
  }

  function partagerWhatsApp() {
    if (!devis) return;
    const lignesDepot = devis.lignes.filter(l => !l.horsDepot);
    const lignesHors = devis.lignes.filter(l => l.horsDepot);

    let texte = `*${boutiqueInfo?.nom || 'IBD Kunda'}*\n`;
    if (boutiqueInfo?.telephone) texte += `📞 ${boutiqueInfo.telephone}\n`;
    if (boutiqueInfo?.adresse) texte += `📍 ${boutiqueInfo.adresse}\n`;
    texte += `\n*DEVIS ${devis.numeroDevis}*\n`;
    texte += `Client : ${devis.clientNom}\n`;
    texte += `Date : ${formatDate(devis.date)}\n\n`;

    if (lignesDepot.length > 0) {
      texte += `*Produits :*\n`;
      lignesDepot.forEach(l => {
        const total = l.quantite * l.prix;
        texte += `• ${l.produitNom} — ${l.quantite} ${l.typeUnite === 'C' ? 'ctn' : 'u'} × ${l.prix.toLocaleString('fr-FR')} = ${total.toLocaleString('fr-FR')} FCFA\n`;
      });
    }

    if (lignesHors.length > 0) {
      texte += `\n*Hors dépôt :*\n`;
      lignesHors.forEach(l => {
        const total = l.quantite * l.prix;
        texte += `• ${l.produitNom} — ${l.quantite} × ${l.prix.toLocaleString('fr-FR')} = ${total.toLocaleString('fr-FR')} FCFA\n`;
      });
    }

    texte += `\n*Total : ${devis.totalGeneral.toLocaleString('fr-FR')} FCFA*`;

    const url = `https://wa.me/?text=${encodeURIComponent(texte)}`;
    window.open(url, '_blank');
  }

  async function telecharger() {
    if (!devis) return;
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

    const lignesDepot = devis.lignes.filter(l => !l.horsDepot);
    const lignesHors  = devis.lignes.filter(l => l.horsDepot);
    const pageW = 210;
    const margin = 14;
    const colW = pageW - margin * 2;
    let y = margin;

    // ── Logo + en-tête boutique ──────────────────────────────
    if (boutiqueInfo?.logo) {
      try {
        const ext = boutiqueInfo.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(boutiqueInfo.logo, ext, margin, y, 28, 14, undefined, 'FAST');
        pdf.setFontSize(14); pdf.setFont('helvetica', 'bold');
        pdf.text(boutiqueInfo.nom || '', margin + 32, y + 5);
        pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(80);
        if (boutiqueInfo.telephone) pdf.text(boutiqueInfo.telephone, margin + 32, y + 10);
        if (boutiqueInfo.adresse)   pdf.text(boutiqueInfo.adresse,   margin + 32, y + 14);
      } catch {
        pdf.setFontSize(14); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0);
        pdf.text(boutiqueInfo?.nom || '', margin, y + 6);
      }
    } else {
      pdf.setFontSize(14); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0);
      pdf.text(boutiqueInfo?.nom || 'IBD Kunda', margin, y + 6);
      pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(80);
      if (boutiqueInfo?.telephone) pdf.text(boutiqueInfo.telephone, margin, y + 11);
      if (boutiqueInfo?.adresse)   pdf.text(boutiqueInfo.adresse,   margin, y + 15);
    }

    // Numéro de devis (droite)
    pdf.setFontSize(18); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0);
    pdf.text('DEVIS', pageW - margin, y + 4, { align: 'right' });
    pdf.setFontSize(10); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(80);
    pdf.text(devis.numeroDevis, pageW - margin, y + 10, { align: 'right' });
    pdf.text(formatDate(devis.date), pageW - margin, y + 15, { align: 'right' });

    y += 22;
    pdf.setDrawColor(0); pdf.setLineWidth(0.4);
    pdf.line(margin, y, pageW - margin, y);
    y += 6;

    // ── Client ───────────────────────────────────────────────
    pdf.setFillColor(245, 245, 245);
    pdf.roundedRect(margin, y, colW, 10, 2, 2, 'F');
    pdf.setFontSize(10); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0);
    pdf.text('Client :', margin + 3, y + 6.5);
    pdf.setFont('helvetica', 'normal');
    pdf.text(devis.clientNom, margin + 20, y + 6.5);
    y += 16;

    // ── Helper tableau ────────────────────────────────────────
    function drawTable(
      headers: string[],
      widths: number[],
      rows: string[][],
      headerBg: [number, number, number] = [17, 17, 17],
    ) {
      const rowH = 7;
      // header
      pdf.setFillColor(...headerBg);
      pdf.rect(margin, y, colW, rowH, 'F');
      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(255);
      let x = margin + 2;
      headers.forEach((h, i) => { pdf.text(h, x, y + 5); x += widths[i]; });
      y += rowH;

      // rows
      pdf.setFont('helvetica', 'normal'); pdf.setTextColor(0);
      rows.forEach((row, ri) => {
        if (ri % 2 === 1) { pdf.setFillColor(250, 250, 250); pdf.rect(margin, y, colW, rowH, 'F'); }
        x = margin + 2;
        row.forEach((cell, ci) => {
          pdf.setFontSize(9);
          pdf.text(cell, x, y + 5);
          x += widths[ci];
        });
        pdf.setDrawColor(230); pdf.line(margin, y + rowH, margin + colW, y + rowH);
        y += rowH;
      });
      y += 4;
    }

    // ── Produits dépôt ────────────────────────────────────────
    if (lignesDepot.length > 0) {
      pdf.setFontSize(10); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0);
      pdf.text('Produits dépôt', margin, y); y += 5;
      drawTable(
        ['Désignation', 'Unité', 'Qté', 'Prix unit.', 'Total'],
        [70, 22, 16, 34, 40],
        lignesDepot.map(l => [
          l.produitNom.length > 32 ? l.produitNom.slice(0, 31) + '…' : l.produitNom,
          l.typeUnite === 'C' ? 'Carton' : 'Unité',
          String(l.quantite),
          l.prix.toLocaleString('fr-FR') + ' F',
          (l.quantite * l.prix).toLocaleString('fr-FR') + ' F',
        ]),
      );
    }

    // ── Produits hors dépôt ───────────────────────────────────
    if (lignesHors.length > 0) {
      pdf.setFontSize(10); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(180, 83, 9);
      pdf.text('Produits à préparer (hors dépôt)', margin, y); y += 3;
      pdf.setFontSize(8); pdf.setFont('helvetica', 'italic'); pdf.setTextColor(120);
      pdf.text('Ces produits doivent être récupérés séparément par le personnel.', margin, y); y += 5;
      drawTable(
        ['✓', 'Désignation', 'Qté', 'Prix unit.', 'Total'],
        [10, 80, 16, 34, 42],
        lignesHors.map(l => [
          '☐',
          l.produitNom.length > 38 ? l.produitNom.slice(0, 37) + '…' : l.produitNom,
          String(l.quantite),
          l.prix.toLocaleString('fr-FR') + ' F',
          (l.quantite * l.prix).toLocaleString('fr-FR') + ' F',
        ]),
        [180, 83, 9],
      );
    }

    // ── Totaux ────────────────────────────────────────────────
    pdf.setDrawColor(0); pdf.setLineWidth(0.4);
    pdf.line(margin, y, pageW - margin, y); y += 5;

    pdf.setFontSize(10); pdf.setTextColor(0);
    if (devis.totalHorsDepot > 0) {
      pdf.setFont('helvetica', 'normal');
      pdf.text('Sous-total dépôt', pageW - margin - 55, y);
      pdf.text(devis.totalDepot.toLocaleString('fr-FR') + ' FCFA', pageW - margin, y, { align: 'right' });
      y += 6;
      pdf.setTextColor(180, 83, 9);
      pdf.text('Sous-total hors dépôt', pageW - margin - 55, y);
      pdf.text(devis.totalHorsDepot.toLocaleString('fr-FR') + ' FCFA', pageW - margin, y, { align: 'right' });
      y += 6;
      pdf.setTextColor(0);
    }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12);
    pdf.text('TOTAL GÉNÉRAL', pageW - margin - 55, y);
    pdf.text(devis.totalGeneral.toLocaleString('fr-FR') + ' FCFA', pageW - margin, y, { align: 'right' });

    pdf.save(`${devis.numeroDevis}.pdf`);
  }

  if (loading) return (
    <AppLayout>
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    </AppLayout>
  );

  if (!devis) return (
    <AppLayout>
      <div className="text-center py-16 text-gray-400">Devis introuvable</div>
    </AppLayout>
  );

  const cfg = STATUT_CONFIG[devis.statut];
  const peutModifier = devis.statut === 'brouillon' || devis.statut === 'envoye';
  const peutConfirmer = devis.statut === 'envoye' || devis.statut === 'brouillon';
  const peutAnnuler = devis.statut !== 'annule' && devis.statut !== 'confirme';
  const lignesDepot = devis.lignes.filter(l => !l.horsDepot);
  const lignesHors = devis.lignes.filter(l => l.horsDepot);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-5">
        {/* En-tête */}
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{devis.clientNom}</h1>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
            </div>
            <p className="text-xs font-mono text-gray-400 mt-0.5">{devis.numeroDevis} · {formatDate(devis.date)}</p>
          </div>
          {peutModifier && !editMode && (
            <button
              onClick={() => setEditMode(true)}
              className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Edit2 size={16} className="text-gray-500" />
            </button>
          )}
        </div>

        {/* Produits dépôt */}
        {lignesDepot.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Produits dépôt</p>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {(editMode ? lignesEdit.filter(l => !l.horsDepot) : lignesDepot).map((l, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{l.produitNom}</p>
                    {editMode ? (
                      <div className="flex gap-2 mt-1.5">
                        <select
                          value={l.typeUnite}
                          onChange={e => mettreAJourLigne(devis.lignes.findIndex((ll, ii) => !ll.horsDepot && ii === i), 'typeUnite', e.target.value)}
                          className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800"
                        >
                          <option value="U">Unité</option>
                          <option value="C">Carton</option>
                        </select>
                        <input type="number" min={1} value={l.quantite}
                          onChange={e => mettreAJourLigne(devis.lignes.findIndex((ll, ii) => !ll.horsDepot && ii === i), 'quantite', Number(e.target.value))}
                          className="w-16 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800"
                        />
                        <input type="number" min={0} value={l.prix}
                          onChange={e => mettreAJourLigne(devis.lignes.findIndex((ll, ii) => !ll.horsDepot && ii === i), 'prix', Number(e.target.value))}
                          className="w-24 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800"
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">{l.quantite} {l.typeUnite === 'C' ? 'carton(s)' : 'unité(s)'} × {l.prix.toLocaleString('fr-FR')} FCFA</p>
                    )}
                  </div>
                  <p className="text-sm font-bold text-indigo-600 shrink-0">{formatMontant(l.quantite * l.prix)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Produits hors dépôt */}
        {lignesHors.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-200 dark:border-amber-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-amber-200 dark:border-amber-700 flex items-center gap-2">
              <Package size={14} className="text-amber-600" />
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Hors dépôt — à préparer</p>
            </div>
            <div className="divide-y divide-amber-100 dark:divide-amber-800">
              {(editMode ? lignesEdit.filter(l => l.horsDepot) : lignesHors).map((l, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{l.produitNom}</p>
                    {editMode ? (
                      <div className="flex gap-2 mt-1.5">
                        <input type="number" min={1} value={l.quantite}
                          onChange={e => mettreAJourLigne(devis.lignes.findIndex((ll, ii) => ll.horsDepot && ii === i), 'quantite', Number(e.target.value))}
                          className="w-16 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800"
                        />
                        <input type="number" min={0} value={l.prix}
                          onChange={e => mettreAJourLigne(devis.lignes.findIndex((ll, ii) => ll.horsDepot && ii === i), 'prix', Number(e.target.value))}
                          className="w-24 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800"
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-amber-600/70 mt-0.5">{l.quantite} unité(s) × {l.prix.toLocaleString('fr-FR')} FCFA</p>
                    )}
                  </div>
                  <p className="text-sm font-bold text-amber-600 shrink-0">{formatMontant(l.quantite * l.prix)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Boutons édition */}
        {editMode && (
          <div className="flex gap-3">
            <button onClick={() => { setEditMode(false); setLignesEdit(devis.lignes); }}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-500">
              Annuler
            </button>
            <button onClick={sauvegarderEdition} disabled={enCours}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
              <Check size={15} />
              Sauvegarder
            </button>
          </div>
        )}

        {/* Total */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 space-y-2">
          {devis.totalHorsDepot > 0 && (
            <>
              <div className="flex justify-between text-sm text-gray-500">
                <span>Sous-total dépôt</span>
                <span>{formatMontant(devis.totalDepot)}</span>
              </div>
              <div className="flex justify-between text-sm text-amber-600">
                <span className="flex items-center gap-1"><Package size={12} />Hors dépôt</span>
                <span>{formatMontant(devis.totalHorsDepot)}</span>
              </div>
              <div className="border-t border-gray-100 dark:border-gray-800 pt-2" />
            </>
          )}
          <div className="flex justify-between">
            <span className="font-bold text-gray-900 dark:text-gray-100">Total général</span>
            <span className="font-bold text-indigo-600 text-lg">{formatMontant(devis.totalGeneral)}</span>
          </div>
        </div>

        {erreur && <p className="text-sm text-red-500 text-center">{erreur}</p>}

        {/* Actions */}
        {!editMode && (
          <div className="space-y-3 pb-6">
            {/* Partager / Imprimer */}
            <div className="flex gap-3">
              <button
                onClick={partagerWhatsApp}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-green-500 hover:bg-green-600 text-white transition-colors"
              >
                <Share2 size={15} />
                WhatsApp
              </button>
              <button
                onClick={telecharger}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
              >
                <Download size={15} />
                Télécharger PDF
              </button>
            </div>

            {/* Confirmer / Annuler */}
            <div className="flex gap-3">
              {peutAnnuler && (
                <button
                  onClick={() => setModal('annuler')}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <XCircle size={15} />
                  Annuler le devis
                </button>
              )}
              {peutConfirmer && (
                <button
                  onClick={ouvrirModalConfirmation}
                  disabled={enCours}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors"
                >
                  <CheckCircle2 size={15} />
                  Confirmer
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal confirmation */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !enCours && setModal(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-80 mx-4">
            <div className="flex flex-col items-center gap-3 mb-5">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${modal === 'confirmer' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                {modal === 'confirmer'
                  ? <CheckCircle2 size={22} className="text-green-600" />
                  : <AlertTriangle size={22} className="text-red-500" />
                }
              </div>
              <p className="text-base font-bold text-gray-900 dark:text-gray-100 text-center">
                {modal === 'confirmer' ? 'Confirmer ce devis ?' : 'Annuler ce devis ?'}
              </p>
              <p className="text-sm text-gray-400 text-center">
                {modal === 'confirmer'
                  ? `Cette action va créer une sortie de stock pour les produits du dépôt. Elle est irréversible.`
                  : 'Le devis sera définitivement annulé. Aucun mouvement ne sera créé.'
                }
              </p>
              {modal === 'confirmer' && alertesStock.length > 0 && (
                <div className="w-full mt-1 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-amber-600 text-xs font-semibold">
                    <AlertTriangle size={13} />
                    Stock insuffisant — quantité ajustée
                  </div>
                  {alertesStock.map((a, i) => (
                    <div key={i} className="text-xs text-amber-700 dark:text-amber-400">
                      <span className="font-medium">{a.produitNom}</span>
                      {' '}— demandé : <span className="font-bold">{a.demande}</span>,
                      disponible : <span className="font-bold text-green-600">{a.disponible}</span>
                      {' '}{a.typeUnite === 'C' ? 'ctn' : 'u'}
                      {a.disponible === 0 && (
                        <span className="ml-1 text-red-500 font-semibold">(hors stock — ignoré)</span>
                      )}
                    </div>
                  ))}
                  <p className="text-xs text-amber-600/80 mt-1">Seule la quantité disponible sera sortie du stock.</p>
                </div>
              )}
            </div>
            {erreur && <p className="text-xs text-red-500 text-center mb-3">{erreur}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setModal(null)}
                disabled={enCours}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Retour
              </button>
              <button
                onClick={modal === 'confirmer' ? confirmerDevis : annulerDevis}
                disabled={enCours}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-colors
                  ${modal === 'confirmer' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-500 hover:bg-red-600'}`}
              >
                {enCours ? '...' : modal === 'confirmer' ? 'Confirmer' : 'Annuler le devis'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
