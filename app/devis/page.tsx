'use client';
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { useRouter } from 'next/navigation';
import { formatMontant, formatDate } from '@/lib/format';
import { FileText, Plus, Clock, CheckCircle2, XCircle, ChevronRight, Package } from 'lucide-react';

type StatutDevis = 'brouillon' | 'envoye' | 'confirme' | 'annule';

interface Devis {
  id: string;
  numeroDevis: string;
  clientNom: string;
  totalGeneral: number;
  totalDepot: number;
  totalHorsDepot: number;
  statut: StatutDevis;
  date: any;
  nbLignes: number;
  nbLignesHorsDepot: number;
}

const STATUT_CONFIG: Record<StatutDevis, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  brouillon: { label: 'Brouillon',  color: 'text-gray-500',  bg: 'bg-gray-100',   icon: Clock },
  envoye:    { label: 'Envoyé',     color: 'text-blue-600',  bg: 'bg-blue-100',   icon: FileText },
  confirme:  { label: 'Confirmé',   color: 'text-green-600', bg: 'bg-green-100',  icon: CheckCircle2 },
  annule:    { label: 'Annulé',     color: 'text-red-500',   bg: 'bg-red-100',    icon: XCircle },
};

type Filtre = 'tous' | StatutDevis;

export default function DevisPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [devis, setDevis] = useState<Devis[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexManquant, setIndexManquant] = useState(false);
  const [filtre, setFiltre] = useState<Filtre>('tous');

  const adminUid = profile?.role === 'admin' ? user?.uid : profile?.adminUid;

  useEffect(() => {
    if (!adminUid) return;
    async function load() {
      try {
        const snap = await getDocs(query(
          collection(db, 'devis'),
          where('adminUid', '==', adminUid),
          orderBy('date', 'desc'),
        ));
        setDevis(snap.docs.map(d => ({ id: d.id, ...d.data() } as Devis)));
      } catch (e: any) {
        if (e?.code === 'failed-precondition' || e?.message?.includes('index')) {
          setIndexManquant(true);
        }
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [adminUid]);

  const liste = useMemo(() =>
    filtre === 'tous' ? devis : devis.filter(d => d.statut === filtre),
    [devis, filtre]
  );

  const stats = useMemo(() => {
    const confirmes  = devis.filter(d => d.statut === 'confirme');
    const enAttente  = devis.filter(d => d.statut === 'envoye' || d.statut === 'brouillon');
    const annules    = devis.filter(d => d.statut === 'annule');
    return {
      total:              devis.length,
      totalMontant:       devis.reduce((s, d) => s + (d.totalGeneral || 0), 0),
      confirme:           confirmes.length,
      confirmeMontant:    confirmes.reduce((s, d) => s + (d.totalGeneral || 0), 0),
      enAttente:          enAttente.length,
      enAttenteMontant:   enAttente.reduce((s, d) => s + (d.totalGeneral || 0), 0),
      annule:             annules.length,
      annuleMontant:      annules.reduce((s, d) => s + (d.totalGeneral || 0), 0),
      valeurHorsDepot:        confirmes.reduce((s, d) => s + (d.totalHorsDepot || 0), 0),
      valeurHorsDepotAttente: enAttente.reduce((s, d) => s + (d.totalHorsDepot || 0), 0),
    };
  }, [devis]);

  const FILTRES: { key: Filtre; label: string }[] = [
    { key: 'tous',     label: 'Tous' },
    { key: 'brouillon', label: 'Brouillon' },
    { key: 'envoye',   label: 'Envoyés' },
    { key: 'confirme', label: 'Confirmés' },
    { key: 'annule',   label: 'Annulés' },
  ];

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* En-tête */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Devis</h1>
            <p className="text-sm text-gray-400 mt-0.5">Propositions commerciales et bons de commande</p>
          </div>
          <button
            onClick={() => router.push('/devis/nouveau')}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            <Plus size={16} />
            Nouveau devis
          </button>
        </div>

        {/* Indicateurs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Total',      nb: stats.total,     montant: stats.totalMontant,    color: 'text-gray-900 dark:text-gray-100', bg: 'bg-white dark:bg-gray-900',        border: 'border-gray-100 dark:border-gray-800' },
            { label: 'Confirmés',  nb: stats.confirme,  montant: stats.confirmeMontant,  color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20',   border: 'border-green-100 dark:border-green-800' },
            { label: 'En attente', nb: stats.enAttente, montant: stats.enAttenteMontant, color: 'text-blue-600',  bg: 'bg-blue-50 dark:bg-blue-900/20',     border: 'border-blue-100 dark:border-blue-800' },
            { label: 'Annulés',    nb: stats.annule,    montant: stats.annuleMontant,    color: 'text-red-500',   bg: 'bg-red-50 dark:bg-red-900/20',       border: 'border-red-100 dark:border-red-800' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-2xl border ${s.border} p-4`}>
              <p className="text-xs text-gray-400 font-medium">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.nb}</p>
              <p className={`text-xs font-semibold mt-1 ${s.color} opacity-80`}>{formatMontant(s.montant)}</p>
            </div>
          ))}
        </div>

        {/* Indicateur hors dépôt */}
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Package size={16} className="text-amber-600" />
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Produits hors dépôt</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-amber-600/70 dark:text-amber-400/70">Valeur confirmée</p>
              <p className="text-lg font-bold text-amber-700 dark:text-amber-400 mt-0.5">{formatMontant(stats.valeurHorsDepot)}</p>
            </div>
            <div>
              <p className="text-xs text-amber-600/70 dark:text-amber-400/70">En attente</p>
              <p className="text-lg font-bold text-amber-700 dark:text-amber-400 mt-0.5">{formatMontant(stats.valeurHorsDepotAttente)}</p>
            </div>
          </div>
        </div>

        {/* Filtres */}
        <div className="flex gap-2 flex-wrap">
          {FILTRES.map(f => (
            <button
              key={f.key}
              onClick={() => setFiltre(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                ${filtre === f.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-indigo-300'
                }`}
            >
              {f.label}
              {f.key !== 'tous' && (
                <span className="ml-1.5 opacity-70">
                  {devis.filter(d => d.statut === f.key).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Liste */}
        {indexManquant ? (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-5 text-center space-y-2">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Index Firestore en cours de création</p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/70">Firebase doit créer un index avant de pouvoir charger les devis. Clique sur le lien ci-dessous pour le créer, puis reviens dans 1-2 minutes.</p>
            <a
              href="https://console.firebase.google.com/v1/r/project/ibappp-k7kaq0/firestore/indexes?create_composite=Cktwcm9qZWN0cy9pYmFwcHAtazdrYXEwL2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9kZXZpcy9pbmRleGVzL18QARoMCghhZG1pblVpZBABGggKBGRhdGUQAhoMCghfX25hbWVfXxAC"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Créer l'index Firebase →
            </a>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : liste.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <FileText size={40} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">Aucun devis {filtre !== 'tous' ? `"${FILTRES.find(f => f.key === filtre)?.label}"` : ''}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {liste.map(d => {
              const cfg = STATUT_CONFIG[d.statut];
              const StatutIcon = cfg.icon;
              return (
                <div
                  key={d.id}
                  onClick={() => router.push(`/devis/${d.id}`)}
                  className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-4 cursor-pointer hover:border-indigo-200 dark:hover:border-indigo-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-bold text-gray-900 dark:text-gray-100 truncate">{d.clientNom || '—'}</p>
                        <span className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
                          <StatutIcon size={10} />
                          {cfg.label}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-gray-400">{d.numeroDevis}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <p className="text-xs text-gray-400">{formatDate(d.date)}</p>
                        {d.nbLignesHorsDepot > 0 && (
                          <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                            <Package size={11} />
                            {d.nbLignesHorsDepot} hors dépôt
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="font-bold text-indigo-600">{formatMontant(d.totalGeneral)}</p>
                      <ChevronRight size={15} className="text-gray-300" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
