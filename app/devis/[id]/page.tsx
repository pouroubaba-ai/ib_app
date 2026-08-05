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
  Edit2, Check, X, AlertTriangle, FileText, ClipboardList, Plus, Search, Trash2,
} from 'lucide-react';

interface ProduitDB {
  id: string;
  designation: string;
  prix_unitaire: number;
  quantite_par_emballage: number;
  quantite_unitaire_total: number;
}

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
  documentId?: string;
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

  // Ajout produit
  const [showModalAjout, setShowModalAjout] = useState(false);
  const [ajoutProduits, setAjoutProduits] = useState<ProduitDB[]>([]);
  const [ajoutRecherche, setAjoutRecherche] = useState('');
  const [ajoutSelectee, setAjoutSelectee] = useState<ProduitDB | null>(null);
  const [ajoutHorsDepot, setAjoutHorsDepot] = useState(false);
  const [ajoutNomHors, setAjoutNomHors] = useState('');
  const [ajoutTypeUnite, setAjoutTypeUnite] = useState<'U' | 'C'>('C');
  const [ajoutQte, setAjoutQte] = useState(0);
  const [ajoutPrix, setAjoutPrix] = useState(0);
  const [ajoutQpe, setAjoutQpe] = useState(1);
  const [savingAjout, setSavingAjout] = useState(false);
  const [erreurAjout, setErreurAjout] = useState('');
  const [confirmSupprIdx, setConfirmSupprIdx] = useState<number | null>(null);

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
      const aDesLignesDepot = lignesEffectives.length > 0;

      if (aDesLignesDepot) {
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
      }

      batch.update(doc(db, 'devis', devisId), {
        statut: 'confirme',
        confirmedAt: serverTimestamp(),
        documentId: aDesLignesDepot ? docId : null,
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

  async function confirmerSuppression() {
    if (!devis || confirmSupprIdx === null) return;
    const nouvellesLignes = devis.lignes.filter((_, i) => i !== confirmSupprIdx);
    const totalGeneral = nouvellesLignes.reduce((s, l) => s + l.quantite * l.prix, 0);
    const totalDepot = nouvellesLignes.filter(l => !l.horsDepot).reduce((s, l) => s + l.quantite * l.prix, 0);
    const totalHorsDepot = nouvellesLignes.filter(l => l.horsDepot).reduce((s, l) => s + l.quantite * l.prix, 0);
    await updateDoc(doc(db, 'devis', devisId), {
      lignes: nouvellesLignes, totalGeneral, totalDepot, totalHorsDepot,
      nbLignes: nouvellesLignes.length,
      nbLignesHorsDepot: nouvellesLignes.filter(l => l.horsDepot).length,
    });
    setDevis(prev => prev ? { ...prev, lignes: nouvellesLignes, totalGeneral, totalDepot, totalHorsDepot } : prev);
    setLignesEdit(nouvellesLignes);
    setConfirmSupprIdx(null);
  }

  function demanderSuppression(index: number) {
    if (!devis) return;
    const ligne = devis.lignes[index];
    if (devis.statut === 'confirme' && !ligne.horsDepot && ligne.produitId) {
      setConfirmSupprIdx(-1); // signal "bloqué"
    } else {
      setConfirmSupprIdx(index);
    }
  }

  async function ouvrirModalAjout() {
    if (!adminUid) return;
    const snap = await getDocs(query(collection(db, 'Produits'), where('userId', '==', adminUid)));
    setAjoutProduits(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProduitDB)));
    setAjoutRecherche(''); setAjoutSelectee(null);
    setAjoutHorsDepot(false); setAjoutNomHors('');
    setAjoutTypeUnite('C'); setAjoutQte(0); setAjoutPrix(0); setAjoutQpe(1);
    setErreurAjout('');
    setShowModalAjout(true);
  }

  async function validerAjout() {
    if (!devis || !adminUid) return;
    if (ajoutQte <= 0) { setErreurAjout('Quantité requise.'); return; }
    if (ajoutHorsDepot && !ajoutNomHors.trim()) { setErreurAjout('Nom du produit requis.'); return; }
    if (!ajoutHorsDepot && !ajoutSelectee) { setErreurAjout('Sélectionnez un produit.'); return; }

    setSavingAjout(true); setErreurAjout('');
    try {
      const nouvelleLigne: LigneDevis = {
        produitId: ajoutHorsDepot ? null : ajoutSelectee!.id,
        produitNom: ajoutHorsDepot ? ajoutNomHors.trim() : ajoutSelectee!.designation,
        typeUnite: ajoutTypeUnite,
        quantite: ajoutQte,
        prix: ajoutPrix,
        qpe: ajoutQpe,
        horsDepot: ajoutHorsDepot,
      };
      const nouvellesLignes = [...devis.lignes, nouvelleLigne];
      const totalGeneral = nouvellesLignes.reduce((s, l) => s + l.quantite * l.prix, 0);
      const totalDepot = nouvellesLignes.filter(l => !l.horsDepot).reduce((s, l) => s + l.quantite * l.prix, 0);
      const totalHorsDepot = nouvellesLignes.filter(l => l.horsDepot).reduce((s, l) => s + l.quantite * l.prix, 0);

      if (devis.statut === 'confirme' && !ajoutHorsDepot && ajoutSelectee) {
        // Produit stock sur devis confirmé → sortie atomique
        const batch = writeBatch(db);
        const prixParUnit = ajoutTypeUnite === 'C' ? ajoutPrix / ajoutQpe : ajoutPrix;
        const qteUnits = ajoutTypeUnite === 'C' ? ajoutQte * ajoutQpe : ajoutQte;
        const total = ajoutQte * ajoutPrix;

        // Mouvement de sortie
        const mouvRef = doc(collection(db, 'mouvements'));
        batch.set(mouvRef, {
          userId: adminUid,
          documentId: doc(db, 'documents_stock', devis.documentId!),
          typeTransaction: 'Sortie',
          produitId: ajoutSelectee.id,
          produitNom: ajoutSelectee.designation,
          quantite: ajoutQte,
          typeUnite: ajoutTypeUnite,
          quantiteUnites: qteUnits,
          prixUnitaire: prixParUnit,
          totalLigne: total,
          date: serverTimestamp(),
        });
        // Mise à jour document_stock
        batch.update(doc(db, 'documents_stock', devis.documentId), {
          nombreDeProduit: increment(1),
          totalGeneral: increment(total),
        });
        // Décrémentation stock
        batch.update(doc(db, 'Produits', ajoutSelectee.id), {
          quantite_unitaire_total: increment(-qteUnits),
        });
        // Mise à jour devis
        batch.update(doc(db, 'devis', devisId), {
          lignes: nouvellesLignes, totalGeneral, totalDepot, totalHorsDepot,
          nbLignes: nouvellesLignes.length,
          nbLignesHorsDepot: nouvellesLignes.filter(l => l.horsDepot).length,
        });
        await batch.commit();
      } else {
        // Brouillon/envoyé ou produit hors-stock sur confirmé → simple mise à jour devis
        await updateDoc(doc(db, 'devis', devisId), {
          lignes: nouvellesLignes, totalGeneral, totalDepot, totalHorsDepot,
          nbLignes: nouvellesLignes.length,
          nbLignesHorsDepot: nouvellesLignes.filter(l => l.horsDepot).length,
        });
      }

      setDevis(prev => prev ? { ...prev, lignes: nouvellesLignes, totalGeneral, totalDepot, totalHorsDepot } : prev);
      setLignesEdit(nouvellesLignes);
      setShowModalAjout(false);
    } catch (e) {
      console.error(e); setErreurAjout('Erreur lors de l\'ajout.');
    } finally {
      setSavingAjout(false);
    }
  }

  function partagerWhatsApp(type: 'facture' | 'bon') {
    if (!devis) return;
    const fmt = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    let texte = `*${boutiqueInfo?.nom || 'IBD Kunda'}*\n`;
    if (boutiqueInfo?.telephone) texte += `📞 ${boutiqueInfo.telephone}\n`;
    if (boutiqueInfo?.adresse) texte += `📍 ${boutiqueInfo.adresse}\n`;

    if (type === 'facture') {
      const titre = devis.statut === 'confirme' ? 'FACTURE' : 'DEVIS';
      texte += `\n*${titre} ${devis.numeroDevis}*\n`;
      texte += `Client : ${devis.clientNom}\n`;
      texte += `Date : ${formatDate(devis.date)}\n\n`;
      texte += `*Produits :*\n`;
      devis.lignes.forEach(l => {
        texte += `• ${l.produitNom} — ${l.quantite} ${l.typeUnite === 'C' ? 'ctn' : 'u'} x ${fmt(l.prix)} = ${fmt(l.quantite * l.prix)} FCFA\n`;
      });
      texte += `\n*Total : ${fmt(devis.totalGeneral)} FCFA*`;
    } else {
      texte += `\n*BON DE COMMANDE ${devis.numeroDevis}*\n`;
      texte += `Client : ${devis.clientNom}\n`;
      texte += `Date : ${formatDate(devis.date)}\n\n`;
      const lignesDepot = devis.lignes.filter(l => !l.horsDepot);
      const lignesHors  = devis.lignes.filter(l => l.horsDepot);
      if (lignesDepot.length > 0) {
        texte += `*Produits depot :*\n`;
        lignesDepot.forEach(l => {
          texte += `• ${l.produitNom} — ${l.quantite} ${l.typeUnite === 'C' ? 'ctn' : 'u'}\n`;
        });
      }
      if (lignesHors.length > 0) {
        texte += `\n*Hors depot (a preparer) :*\n`;
        lignesHors.forEach(l => {
          texte += `[ ] ${l.produitNom} — ${l.quantite} ${l.typeUnite === 'C' ? 'ctn' : 'u'}\n`;
        });
      }
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(texte)}`, '_blank');
  }

  // -- Helper PDF partagé ------------------------------------
  async function creerBasePDF(titre: string, bandeauRGB: [number, number, number]) {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = 210;
    const M = 15;
    const colW = pageW - M * 2;

    const fmt  = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' FCFA';
    const fmtF = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' F';
    const trunc = (s: string, max: number) => s.length > max ? s.slice(0, max - 1) + '.' : s;

    // Bandeau
    pdf.setFillColor(...bandeauRGB);
    pdf.rect(0, 0, pageW, 38, 'F');

    // Logo
    let textLeft = M;
    if (boutiqueInfo?.logo) {
      try {
        const ext = boutiqueInfo.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(boutiqueInfo.logo, ext, M, 6, 22, 22, undefined, 'FAST');
        textLeft = M + 26;
      } catch { /* ignore */ }
    }

    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(255);
    pdf.text(boutiqueInfo?.nom || 'IBD Kunda', textLeft, 16);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(200, 210, 255);
    let infoY = 22;
    if (boutiqueInfo?.telephone) { pdf.text('Tel: ' + boutiqueInfo.telephone, textLeft, infoY); infoY += 5; }
    if (boutiqueInfo?.adresse)   { pdf.text(boutiqueInfo.adresse, textLeft, infoY); }

    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(22); pdf.setTextColor(255);
    pdf.text(titre, pageW - M, 17, { align: 'right' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(200, 210, 255);
    pdf.text(devis!.numeroDevis, pageW - M, 23, { align: 'right' });
    pdf.text(formatDate(devis!.date), pageW - M, 29, { align: 'right' });

    let y = 46;

    // Bloc client
    pdf.setFillColor(245, 247, 255);
    pdf.roundedRect(M, y, colW, 11, 2, 2, 'F');
    pdf.setDrawColor(210, 215, 240); pdf.setLineWidth(0.3);
    pdf.roundedRect(M, y, colW, 11, 2, 2, 'S');
    pdf.setFontSize(8); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(100, 110, 160);
    pdf.text('CLIENT', M + 3, y + 4.5);
    pdf.setFontSize(10.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(20);
    pdf.text(devis!.clientNom, M + 3, y + 9);
    y += 17;

    function drawTable(
      headers: string[],
      widths: number[],
      aligns: ('L' | 'R')[],
      rows: string[][],
      accentBg: [number, number, number],
    ) {
      const rowH = 7.5;
      pdf.setFillColor(...accentBg);
      pdf.rect(M, y, colW, rowH, 'F');
      pdf.setFontSize(8.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(255);
      let x = M;
      headers.forEach((h, i) => {
        const cx = aligns[i] === 'R' ? x + widths[i] - 2 : x + 3;
        pdf.text(h, cx, y + 5.2, { align: aligns[i] === 'R' ? 'right' : 'left' });
        x += widths[i];
      });
      y += rowH;
      rows.forEach((row, ri) => {
        const bg: [number, number, number] = ri % 2 === 0 ? [255, 255, 255] : [247, 249, 255];
        pdf.setFillColor(...bg);
        pdf.rect(M, y, colW, rowH, 'F');
        pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(30);
        x = M;
        row.forEach((cell, ci) => {
          const cx = aligns[ci] === 'R' ? x + widths[ci] - 2 : x + 3;
          pdf.text(cell, cx, y + 5.2, { align: aligns[ci] === 'R' ? 'right' : 'left' });
          x += widths[ci];
        });
        pdf.setDrawColor(230, 233, 245); pdf.setLineWidth(0.2);
        pdf.line(M, y + rowH, M + colW, y + rowH);
        y += rowH;
      });
      pdf.setDrawColor(180, 185, 220); pdf.setLineWidth(0.4);
      pdf.line(M, y, M + colW, y);
      y += 6;
    }

    return { pdf, M, colW, pageW, y: y as number, fmt, fmtF, trunc, drawTable,
      getY: () => y, setY: (v: number) => { y = v; } };
  }

  // -- Facture / Devis (avec prix, pour le client) -----------
  async function telechargerFacture() {
    if (!devis) return;
    const estConfirme = devis.statut === 'confirme';
    const titre = estConfirme ? 'FACTURE' : 'DEVIS';
    const bandeau: [number, number, number] = estConfirme ? [22, 101, 52] : [49, 70, 145];
    const accent: [number, number, number]  = estConfirme ? [22, 101, 52] : [49, 70, 145];

    const ctx = await creerBasePDF(titre, bandeau);
    const { pdf, M, colW, pageW, fmt, fmtF, trunc, drawTable, getY, setY } = ctx;

    // Tous les produits ensemble (pas de distinction pour le client)
    if (devis.lignes.length > 0) {
      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...accent);
      pdf.text('PRODUITS', M, getY()); setY(getY() + 4);
      drawTable(
        ['Designation', 'Unite', 'Qte', 'Prix unitaire', 'Total'],
        [82, 20, 14, 38, 26],
        ['L', 'L', 'R', 'R', 'R'],
        devis.lignes.map(l => [
          trunc(l.produitNom, 44),
          l.typeUnite === 'C' ? 'Carton' : 'Unite',
          String(l.quantite),
          fmtF(l.prix),
          fmtF(l.quantite * l.prix),
        ]),
        accent,
      );
    }

    // Total général uniquement
    const totW = 85;
    const totX = pageW - M - totW;
    pdf.setFillColor(...accent);
    pdf.roundedRect(totX, getY(), totW, 11, 2, 2, 'F');
    pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(255);
    pdf.text('TOTAL GENERAL', totX + 3, getY() + 7);
    pdf.setFontSize(10);
    pdf.text(fmt(devis.totalGeneral), totX + totW - 2, getY() + 7, { align: 'right' });

    pdf.save(`${devis.numeroDevis}-${titre}.pdf`);
  }

  // -- Bon de commande (sans prix, pour le personnel) ---------
  async function telechargerBonCommande() {
    if (!devis) return;
    const ctx = await creerBasePDF('BON DE COMMANDE', [30, 30, 30]);
    const { pdf, M, fmtF: _, trunc, drawTable, getY, setY } = ctx;

    const lignesDepot = devis.lignes.filter(l => !l.horsDepot);
    const lignesHors  = devis.lignes.filter(l => l.horsDepot);

    if (lignesDepot.length > 0) {
      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(30, 30, 30);
      pdf.text('PRODUITS DEPOT', M, getY()); setY(getY() + 4);
      drawTable(
        ['Designation', 'Unite', 'Quantite'],
        [110, 30, 40],
        ['L', 'L', 'R'],
        lignesDepot.map(l => [
          trunc(l.produitNom, 58),
          l.typeUnite === 'C' ? 'Carton' : 'Unite',
          String(l.quantite),
        ]),
        [30, 30, 30],
      );
    }

    if (lignesHors.length > 0) {
      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(180, 83, 9);
      pdf.text('PRODUITS HORS DEPOT - a preparer', M, getY()); setY(getY() + 3);
      pdf.setFontSize(7.5); pdf.setFont('helvetica', 'italic'); pdf.setTextColor(140);
      pdf.text('Ces produits doivent etre recuperes separement par le personnel.', M, getY()); setY(getY() + 5);
      drawTable(
        ['', 'Designation', 'Unite', 'Quantite'],
        [10, 100, 30, 40],
        ['L', 'L', 'L', 'R'],
        lignesHors.map(l => [
          '[ ]',
          trunc(l.produitNom, 52),
          l.typeUnite === 'C' ? 'Carton' : 'Unite',
          String(l.quantite),
        ]),
        [180, 83, 9],
      );
    }

    pdf.save(`${devis.numeroDevis}-BON-COMMANDE.pdf`);
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
          <div className="flex items-center gap-1">
            {devis.statut !== 'annule' && !editMode && (
              <button onClick={ouvrirModalAjout}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <Plus size={16} className="text-indigo-500" />
              </button>
            )}
            {peutModifier && !editMode && (
              <button onClick={() => setEditMode(true)}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <Edit2 size={16} className="text-gray-500" />
              </button>
            )}
          </div>
        </div>

        {/* Produits dépôt */}
        {lignesDepot.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Produits dépôt</p>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {(editMode ? lignesEdit.filter(l => !l.horsDepot) : lignesDepot).map((l, i) => {
                const globalIdx = devis.lignes.indexOf(l);
                const peutSupprimer = devis.statut !== 'annule';
                const stockConfirme = devis.statut === 'confirme' && !l.horsDepot && !!l.produitId;
                return (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{l.produitNom}</p>
                    {editMode ? (
                      <div className="flex gap-2 mt-1.5">
                        <select value={l.typeUnite}
                          onChange={e => mettreAJourLigne(devis.lignes.findIndex((ll, ii) => !ll.horsDepot && ii === i), 'typeUnite', e.target.value)}
                          className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800">
                          <option value="U">Unité</option>
                          <option value="C">Carton</option>
                        </select>
                        <input type="number" min={1} value={l.quantite}
                          onChange={e => mettreAJourLigne(devis.lignes.findIndex((ll, ii) => !ll.horsDepot && ii === i), 'quantite', Number(e.target.value))}
                          className="w-16 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800" />
                        <input type="number" min={0} value={l.prix}
                          onChange={e => mettreAJourLigne(devis.lignes.findIndex((ll, ii) => !ll.horsDepot && ii === i), 'prix', Number(e.target.value))}
                          className="w-24 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800" />
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">{l.quantite} {l.typeUnite === 'C' ? 'carton(s)' : 'unité(s)'} × {l.prix.toLocaleString('fr-FR')} FCFA</p>
                    )}
                  </div>
                  <p className="text-sm font-bold text-indigo-600 shrink-0">{formatMontant(l.quantite * l.prix)}</p>
                  {peutSupprimer && !editMode && (
                    <button onClick={() => demanderSuppression(globalIdx)}
                      title={stockConfirme ? 'Passer par un retour' : 'Supprimer'}
                      className={`p-1.5 rounded-lg transition-colors shrink-0 ${stockConfirme ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed' : 'text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'}`}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                );
              })}
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
              {(editMode ? lignesEdit.filter(l => l.horsDepot) : lignesHors).map((l, i) => {
                const globalIdx = devis.lignes.indexOf(l);
                return (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{l.produitNom}</p>
                    {editMode ? (
                      <div className="flex gap-2 mt-1.5">
                        <input type="number" min={1} value={l.quantite}
                          onChange={e => mettreAJourLigne(devis.lignes.findIndex((ll, ii) => ll.horsDepot && ii === i), 'quantite', Number(e.target.value))}
                          className="w-16 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800" />
                        <input type="number" min={0} value={l.prix}
                          onChange={e => mettreAJourLigne(devis.lignes.findIndex((ll, ii) => ll.horsDepot && ii === i), 'prix', Number(e.target.value))}
                          className="w-24 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800" />
                      </div>
                    ) : (
                      <p className="text-xs text-amber-600/70 mt-0.5">{l.quantite} unité(s) × {l.prix.toLocaleString('fr-FR')} FCFA</p>
                    )}
                  </div>
                  <p className="text-sm font-bold text-amber-600 shrink-0">{formatMontant(l.quantite * l.prix)}</p>
                  {devis.statut !== 'annule' && !editMode && (
                    <button onClick={() => demanderSuppression(globalIdx)}
                      className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                );
              })}
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
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
          <div className="flex justify-between">
            <span className="font-bold text-gray-900 dark:text-gray-100">Total général</span>
            <span className="font-bold text-indigo-600 text-lg">{formatMontant(devis.totalGeneral)}</span>
          </div>
        </div>

        {erreur && <p className="text-sm text-red-500 text-center">{erreur}</p>}

        {/* Actions */}
        {!editMode && (
          <div className="space-y-3 pb-6">
            {devis.statut === 'confirme' ? (
              <>
                {/* Confirmé : deux boutons téléchargement + WhatsApp avec choix */}
                <div className="flex gap-3">
                  <button
                    onClick={telechargerFacture}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                  >
                    <FileText size={15} />
                    Facture PDF
                  </button>
                  <button
                    onClick={telechargerBonCommande}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-gray-700 hover:bg-gray-800 text-white transition-colors"
                  >
                    <ClipboardList size={15} />
                    Bon de commande
                  </button>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => partagerWhatsApp('facture')}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-green-500 hover:bg-green-600 text-white transition-colors"
                  >
                    <Share2 size={15} />
                    WA Facture
                  </button>
                  <button
                    onClick={() => partagerWhatsApp('bon')}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-green-700 hover:bg-green-800 text-white transition-colors"
                  >
                    <Share2 size={15} />
                    WA Bon commande
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Non confirmé : WhatsApp + Télécharger devis */}
                <div className="flex gap-3">
                  <button
                    onClick={() => partagerWhatsApp('facture')}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-green-500 hover:bg-green-600 text-white transition-colors"
                  >
                    <Share2 size={15} />
                    WhatsApp
                  </button>
                  <button
                    onClick={telechargerFacture}
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
              </>
            )}
          </div>
        )}
      </div>

      {/* Modal confirmation suppression */}
      {confirmSupprIdx !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmSupprIdx(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-80 mx-4">
            {confirmSupprIdx === -1 ? (
              /* Produit stock confirmé — bloqué */
              <>
                <div className="flex flex-col items-center gap-3 mb-5">
                  <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                    <AlertTriangle size={22} className="text-amber-500" />
                  </div>
                  <p className="text-base font-bold text-gray-900 dark:text-gray-100 text-center">Suppression impossible</p>
                  <p className="text-sm text-gray-400 text-center">Ce produit a déjà été sorti du stock lors de la confirmation. Pour le retirer, effectuez un retour depuis la gestion des sorties.</p>
                </div>
                <button onClick={() => setConfirmSupprIdx(null)}
                  className="w-full py-2.5 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                  Compris
                </button>
              </>
            ) : (
              /* Confirmation normale */
              <>
                <div className="flex flex-col items-center gap-3 mb-5">
                  <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <Trash2 size={22} className="text-red-500" />
                  </div>
                  <p className="text-base font-bold text-gray-900 dark:text-gray-100 text-center">Supprimer ce produit ?</p>
                  <p className="text-sm text-gray-400 text-center font-medium">{devis.lignes[confirmSupprIdx]?.produitNom}</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setConfirmSupprIdx(null)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    Annuler
                  </button>
                  <button onClick={confirmerSuppression}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors">
                    Supprimer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal ajout produit */}
      {showModalAjout && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowModalAjout(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <p className="font-bold text-gray-900 dark:text-gray-100 mb-1">Ajouter un produit</p>
            {devis.statut === 'confirme' && !ajoutHorsDepot && (
              <p className="text-xs text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-lg mb-3">Produit stock : sortie créée immédiatement</p>
            )}

            {/* Toggle dépôt / hors-dépôt */}
            <div className="flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-4">
              <button onClick={() => { setAjoutHorsDepot(false); setAjoutSelectee(null); setAjoutRecherche(''); }}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${!ajoutHorsDepot ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                Produit dépôt
              </button>
              <button onClick={() => { setAjoutHorsDepot(true); setAjoutSelectee(null); }}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${ajoutHorsDepot ? 'bg-amber-500 text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                Hors dépôt
              </button>
            </div>

            {!ajoutHorsDepot ? (
              <div className="mb-4">
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={ajoutRecherche} onChange={e => { setAjoutRecherche(e.target.value); setAjoutSelectee(null); }}
                    placeholder="Rechercher un produit stock..."
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
                        className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-colors flex items-center justify-between gap-2
                          ${ajoutSelectee?.id === p.id ? 'bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300' : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`}>
                        <span className="truncate">{p.designation}</span>
                        <span className="text-xs text-gray-400 shrink-0">{p.quantite_unitaire_total} u</span>
                      </button>
                    ))}
                </div>
              </div>
            ) : (
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1">Nom du produit</label>
                <input value={ajoutNomHors} onChange={e => setAjoutNomHors(e.target.value)}
                  placeholder="Désignation hors dépôt..."
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
            )}

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
                <input type="number" min={1} value={ajoutQte || ''} onChange={e => setAjoutQte(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-center" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Prix/{ajoutTypeUnite === 'C' ? 'ctn' : 'u'}</label>
                <input type="number" min={0} value={ajoutPrix || ''} onChange={e => setAjoutPrix(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-right" />
              </div>
            </div>

            {ajoutQte > 0 && ajoutPrix > 0 && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-2.5 text-center mb-4">
                <span className="text-xs text-gray-400">Total </span>
                <span className="font-bold text-green-600">{(ajoutQte * ajoutPrix).toLocaleString('fr-FR')} FCFA</span>
              </div>
            )}

            {erreurAjout && <p className="text-xs text-red-500 mb-3">{erreurAjout}</p>}

            <div className="flex gap-3">
              <button onClick={() => setShowModalAjout(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Annuler
              </button>
              <button onClick={validerAjout} disabled={savingAjout}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors">
                {savingAjout ? 'Ajout...' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}

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
