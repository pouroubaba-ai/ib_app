'use client';
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { formatMontant } from '@/lib/format';
import { TrendingUp, TrendingDown, Package, ArrowUpDown, BarChart2 } from 'lucide-react';
import Link from 'next/link';
import FiltreDates, { PlageDates } from '@/components/FiltreDates';
import CarteReajustementHorizontale, { ReajProduit, ReajMotif } from '@/components/dashboard/CarteReajustementHorizontale';
import CarteRepartitionHorizontale, { RepartitionSortie, RepartitionEntree } from '@/components/dashboard/CarteRepartitionHorizontale';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

interface RawMouvement {
  typeDocument: string;
  typeTransaction?: string;
  motif?: string;
  produitNom: string;
  nomClient?: string;
  quantite: number;
  typeUnite?: string;
  totalLigne: number;
  date: any;
  importationId?: any;
}

const MOIS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

function tsOf(d: any): number {
  if (!d) return 0;
  if (d.seconds) return d.seconds * 1000;
  return new Date(d).getTime();
}

function formatMilliers(val: number) {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
  return String(val);
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [allMouvements, setAllMouvements] = useState<RawMouvement[]>([]);
  const [inventaireValeur, setInventaireValeur] = useState(0);
  const [inventaireQte, setInventaireQte] = useState(0);
  const [inventaireCartons, setInventaireCartons] = useState(0);
  const [prodQpeMap, setProdQpeMap] = useState<Record<string, number>>({});
  const [partenaireTypeMap, setPartenaireTypeMap] = useState<Record<string, string>>({});
  const [importationNomMap, setImportationNomMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [plage, setPlage] = useState<PlageDates>({
    debut: new Date(new Date().getFullYear(), 0, 1),
    fin: (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; })(),
  });

  const modeGraphique: 'mois' | 'annee' = useMemo(() => {
    if (!plage.debut || !plage.fin) return 'annee';
    const diffMs = plage.fin.getTime() - plage.debut.getTime();
    const diffJours = diffMs / (1000 * 60 * 60 * 24);
    return diffJours > 366 ? 'annee' : 'mois';
  }, [plage]);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const [prodSnap, partSnap, mouvSnap, impSnap] = await Promise.all([
        getDocs(query(collection(db, 'Produits'), where('userId', '==', user!.uid))),
        getDocs(query(collection(db, 'Partenaire'), where('userId', '==', user!.uid))),
        getDocs(query(collection(db, 'mouvements'), where('userId', '==', user!.uid))),
        getDocs(query(collection(db, 'importations'), where('userId', '==', user!.uid))),
      ]);

      let invVal = 0, invQte = 0, invCartons = 0;
      const qpeMap: Record<string, number> = {};
      prodSnap.forEach(doc => {
        const d = doc.data();
        const qpe = d.quantite_par_emballage || 1;
        const qtu = d.quantite_unitaire_total || 0;
        invVal += (d.prix_unitaire || 0) * qtu;
        invQte += qtu;
        invCartons += qtu / qpe;
        if (d.designation) qpeMap[d.designation] = qpe;
      });
      setInventaireValeur(invVal);
      setInventaireQte(invQte);
      setInventaireCartons(invCartons);
      setProdQpeMap(qpeMap);

      const typeMap: Record<string, string> = {};
      partSnap.forEach(doc => {
        const d = doc.data();
        if (d.nom) typeMap[d.nom.trim()] = d.type || 'partenaire';
      });
      setPartenaireTypeMap(typeMap);

      const nomMap: Record<string, string> = {};
      impSnap.forEach(doc => { nomMap[doc.id] = doc.data().numero || doc.id; });
      setImportationNomMap(nomMap);

      setAllMouvements(mouvSnap.docs.map(doc => doc.data() as RawMouvement));
      setLoading(false);
    }
    load();
  }, [user]);

  const computed = useMemo(() => {
    const filtres = allMouvements.filter(m => {
      if (!plage.debut || !plage.fin) return true;
      const ts = tsOf(m.date);
      return ts >= plage.debut.getTime() && ts <= plage.fin.getTime();
    });

    let ventesValeur = 0, ventesQte = 0, ventesCartons = 0;
    let achatsValeur = 0, achatsQte = 0, achatsCartons = 0;
    let retoursSortieValeur = 0;
    let retoursEntreeValeur = 0;
    let reajHausse = 0, reajBaisse = 0, reajHausseCartons = 0, reajBaisseCartons = 0;

    const sortieBoutiqueMap: Record<string, number> = {};
    let sortiePartenairesTotal = 0;
    let entreeImportationTotal = 0, entreeBoutiqueTotal = 0, entreePartenaireTotal = 0;
    const importationParId: Record<string, number> = {};

    const reajProdHausseMap: Record<string, ReajProduit> = {};
    const reajProdBaisseMap: Record<string, ReajProduit> = {};
    const reajMotifHausseMap: Record<string, number> = {};
    const reajMotifBaisseMap: Record<string, number> = {};
    const reajMotifHausseCartonsMap: Record<string, number> = {};
    const reajMotifBaisseCartonsMap: Record<string, number> = {};

    const parMois: Record<number, { entrees: number; sorties: number }> = {};
    for (let i = 0; i < 12; i++) parMois[i] = { entrees: 0, sorties: 0 };
    const parAnnee: Record<number, { entrees: number; sorties: number }> = {};

    filtres.forEach(m => {
      const val = m.totalLigne || 0;
      const qte = m.quantite || 0;
      const qpe = prodQpeMap[m.produitNom] || 1;
      // qte is in cartons if typeUnite='C', in units otherwise
      const qteUnits = m.typeUnite === 'C' ? qte * qpe : qte;
      const cartons = m.typeUnite === 'C' ? qte : qte / qpe;
      const tt = m.typeTransaction || '';
      const td = m.typeDocument || '';
      const partenaire = (m.nomClient || '').trim();
      const typeP = partenaireTypeMap[partenaire] || 'partenaire';
      const dateObj = new Date(tsOf(m.date));
      const moisIdx = dateObj.getMonth();
      const annee = dateObj.getFullYear();
      if (!parAnnee[annee]) parAnnee[annee] = { entrees: 0, sorties: 0 };

      if (tt === 'vente' || tt === 'Vente') {
        ventesValeur += val; ventesQte += qteUnits; ventesCartons += cartons;
        parMois[moisIdx].sorties += val;
        parAnnee[annee].sorties += val;
        if (typeP === 'boutique') sortieBoutiqueMap[partenaire] = (sortieBoutiqueMap[partenaire] || 0) + val;
        else sortiePartenairesTotal += val;
      } else if (tt === 'Achat') {
        achatsValeur += val; achatsQte += qteUnits; achatsCartons += cartons;
        parMois[moisIdx].entrees += val;
        parAnnee[annee].entrees += val;
        if (m.importationId || typeP === 'importation') {
          entreeImportationTotal += val;
          const impId = (m.importationId as any)?.id || m.importationId || 'inconnu';
          importationParId[impId] = (importationParId[impId] || 0) + val;
        } else if (typeP === 'boutique') entreeBoutiqueTotal += val;
        else entreePartenaireTotal += val;
      } else if (tt === 'Retour') {
        if (td === 'Entrée') {
          // Client returns stock → reduces net sales
          retoursSortieValeur += val;
        } else {
          // Return to supplier → reduces net purchases
          retoursEntreeValeur += val;
        }
      } else if (tt === 'Reajustement') {
        const motif = m.motif || 'Autre';
        const nom = m.produitNom || 'Inconnu';
        if (td === 'Entrée') {
          reajHausse += val; reajHausseCartons += cartons;
          if (!reajProdHausseMap[nom]) reajProdHausseMap[nom] = { nom, valeur: 0, quantite: 0 };
          reajProdHausseMap[nom].valeur += val;
          reajProdHausseMap[nom].quantite += qteUnits;
          reajMotifHausseMap[motif] = (reajMotifHausseMap[motif] || 0) + val;
          reajMotifHausseCartonsMap[motif] = (reajMotifHausseCartonsMap[motif] || 0) + cartons;
        } else {
          reajBaisse += val; reajBaisseCartons += cartons;
          if (!reajProdBaisseMap[nom]) reajProdBaisseMap[nom] = { nom, valeur: 0, quantite: 0 };
          reajProdBaisseMap[nom].valeur += val;
          reajProdBaisseMap[nom].quantite += qteUnits;
          reajMotifBaisseMap[motif] = (reajMotifBaisseMap[motif] || 0) + val;
          reajMotifBaisseCartonsMap[motif] = (reajMotifBaisseCartonsMap[motif] || 0) + cartons;
        }
      }
      // Legacy fallback for old typeDocument-only data
      else if (!tt) {
        if (td === 'Entrée') {
          achatsValeur += val; achatsQte += qteUnits; achatsCartons += cartons;
          parMois[moisIdx].entrees += val;
          parAnnee[annee].entrees += val;
          if (typeP === 'importation') entreeImportationTotal += val;
          else if (typeP === 'boutique') entreeBoutiqueTotal += val;
          else entreePartenaireTotal += val;
        } else if (td === 'Sortie') {
          ventesValeur += val; ventesQte += qteUnits; ventesCartons += cartons;
          parMois[moisIdx].sorties += val;
          parAnnee[annee].sorties += val;
          if (typeP === 'boutique') sortieBoutiqueMap[partenaire] = (sortieBoutiqueMap[partenaire] || 0) + val;
          else sortiePartenairesTotal += val;
        }
      }
    });

    const sortiesNettes = ventesValeur; // retours affichés séparément, pas soustraits
    const entreesNettes = achatsValeur - retoursEntreeValeur;

    const repSorties: RepartitionSortie[] = [
      ...Object.entries(sortieBoutiqueMap).map(([nom, valeur]) => ({ nom, valeur, type: 'boutique' as const })),
      ...(sortiePartenairesTotal > 0 ? [{ nom: 'Partenaires', valeur: sortiePartenairesTotal, type: 'partenaires' as const }] : []),
    ].sort((a, b) => b.valeur - a.valeur);

    const sousItemsImportation = Object.entries(importationParId)
      .map(([id, valeur]) => ({ nom: importationNomMap[id] || id, valeur }))
      .sort((a, b) => b.valeur - a.valeur);

    const repEntrees: RepartitionEntree[] = [
      ...(entreeImportationTotal > 0 ? [{ nom: 'Importations', valeur: entreeImportationTotal, sousItems: sousItemsImportation }] : []),
      ...(entreeBoutiqueTotal > 0 ? [{ nom: 'Boutiques', valeur: entreeBoutiqueTotal }] : []),
      ...(entreePartenaireTotal > 0 ? [{ nom: 'Partenaires', valeur: entreePartenaireTotal }] : []),
    ];

    let donneesGraphique: { mois: string; Entrées: number; Sorties: number }[];
    if (modeGraphique === 'annee') {
      donneesGraphique = Object.entries(parAnnee)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([annee, v]) => ({ mois: annee, Entrées: v.entrees, Sorties: v.sorties }));
    } else {
      const debutMois = plage.debut ? plage.debut.getMonth() : 0;
      const finMois = plage.fin ? plage.fin.getMonth() : 11;
      const memeAnnee = plage.debut && plage.fin && plage.debut.getFullYear() === plage.fin.getFullYear();
      donneesGraphique = MOIS
        .map((label, i) => ({ mois: label, Entrées: parMois[i].entrees, Sorties: parMois[i].sorties, _hors: memeAnnee && (i < debutMois || i > finMois) }))
        .filter(d => !d._hors)
        .map(({ mois, Entrées, Sorties }) => ({ mois, Entrées, Sorties }));
    }

    const toSortedProduits = (map: Record<string, ReajProduit>) =>
      Object.values(map).sort((a, b) => b.valeur - a.valeur);
    const toSortedMotifs = (map: Record<string, number>, cartonsMap: Record<string, number>): ReajMotif[] =>
      Object.entries(map).map(([motif, valeur]) => ({ motif, valeur, cartons: cartonsMap[motif] || 0 })).sort((a, b) => b.valeur - a.valeur);

    return {
      ventesValeur, ventesQte, ventesCartons, sortiesNettes, retoursSortieValeur,
      achatsValeur, achatsQte, achatsCartons, entreesNettes, retoursEntreeValeur,
      reajHausse, reajBaisse, reajHausseCartons, reajBaisseCartons,
      repSorties, repEntrees,
      donneesGraphique,
      hausse: { produits: toSortedProduits(reajProdHausseMap), parMotif: toSortedMotifs(reajMotifHausseMap, reajMotifHausseCartonsMap) },
      baisse: { produits: toSortedProduits(reajProdBaisseMap), parMotif: toSortedMotifs(reajMotifBaisseMap, reajMotifBaisseCartonsMap) },
    };
  }, [allMouvements, plage, partenaireTypeMap, modeGraphique, prodQpeMap, importationNomMap]);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-6">

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Tableau de bord</h1>
            <p className="text-gray-500 text-sm mt-1">Vue d'ensemble de ton activité</p>
          </div>
          <Link href="/rapport" className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
            <BarChart2 size={16} />
            Rapport
          </Link>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
          <FiltreDates onChange={setPlage} />
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* INDICATEURS */}
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Indicateurs clés</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">

                {/* Entrées */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium text-gray-500">Entrées nettes</span>
                    <div className="w-9 h-9 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                      <TrendingUp size={18} className="text-green-600" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatMontant(computed.entreesNettes)}</p>
                  <p className="text-sm text-gray-400 mt-1">{computed.achatsQte.toLocaleString('fr-FR')} unités <span className="text-gray-300">({Math.round(computed.achatsCartons)} cartons)</span></p>
                  {computed.retoursEntreeValeur > 0 && (
                    <p className="text-xs text-red-500 mt-0.5">Retours : −{formatMontant(computed.retoursEntreeValeur)}</p>
                  )}
                </div>

                {/* Sorties */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium text-gray-500">Sorties</span>
                    <div className="w-9 h-9 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                      <TrendingDown size={18} className="text-blue-600" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatMontant(computed.sortiesNettes)}</p>
                  <p className="text-sm text-gray-400 mt-1">{computed.ventesQte.toLocaleString('fr-FR')} unités <span className="text-gray-300">({Math.round(computed.ventesCartons)} cartons)</span></p>
                  {computed.retoursSortieValeur > 0 && (
                    <p className="text-xs text-orange-500 mt-0.5">dont {formatMontant(computed.retoursSortieValeur)} retournés</p>
                  )}
                </div>

                {/* Inventaire */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium text-gray-500">Inventaire</span>
                    <div className="w-9 h-9 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center">
                      <Package size={18} className="text-indigo-600" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatMontant(inventaireValeur)}</p>
                  <p className="text-sm text-gray-400 mt-1">{inventaireQte.toLocaleString('fr-FR')} unités <span className="text-gray-300">({Math.round(inventaireCartons)} cartons)</span></p>
                </div>

                {/* Réajustement */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium text-gray-500">Réajustement</span>
                    <div className="w-9 h-9 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
                      <ArrowUpDown size={18} className="text-orange-600" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-xs text-gray-500">Hausse</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold text-green-600">{formatMontant(computed.reajHausse)}</span>
                      {computed.reajHausseCartons > 0 && <span className="text-xs text-gray-400 ml-1">({Math.round(computed.reajHausseCartons)} cartons)</span>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-xs text-gray-500">Baisse</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold text-red-500">{formatMontant(computed.reajBaisse)}</span>
                      {computed.reajBaisseCartons > 0 && <span className="text-xs text-gray-400 ml-1">({Math.round(computed.reajBaisseCartons)} cartons)</span>}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ANALYSES */}
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Analyses</h2>
              <div className="space-y-3">
                <CarteReajustementHorizontale
                  reajHausse={computed.reajHausse}
                  reajBaisse={computed.reajBaisse}
                  hausse={computed.hausse}
                  baisse={computed.baisse}
                />
                <CarteRepartitionHorizontale
                  totalSorties={computed.sortiesNettes}
                  repartitionSorties={computed.repSorties}
                  totalEntrees={computed.entreesNettes}
                  repartitionEntrees={computed.repEntrees}
                />
              </div>
            </section>

            {/* GRAPHIQUE */}
            <section>
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-5">
                  Entrées vs Sorties {modeGraphique === 'annee' ? 'par année' : 'par mois'}
                </h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={computed.donneesGraphique} barGap={4} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="mois" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={formatMilliers} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={48} />
                      <Tooltip
                        formatter={(value: any, name: any) => [formatMontant(value as number), name as string]}
                        contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                      <Bar dataKey="Entrées" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Sorties" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}
