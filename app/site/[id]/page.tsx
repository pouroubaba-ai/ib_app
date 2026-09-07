'use client';
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Settings, Users, Handshake, ShoppingCart,
  RefreshCw, Package, ClipboardList, Store, Warehouse, Loader2,
} from 'lucide-react';

type TypeSite = 'boutique' | 'depot';
type EtatSite = 'actif' | 'inactif';
type Onglet = 'configuration' | 'employes' | 'partenaires' | 'vente' | 'cycle-vente' | 'inventaire' | 'audit';

interface Site {
  id: string;
  nom: string;
  type: TypeSite;
  etat: EtatSite;
  adresse: string;
  numero?: string;
  imageUrl?: string;
  nbEmployes: number;
  remunerationMensuelle: number;
}

const onglets: { key: Onglet; label: string; icon: React.ElementType }[] = [
  { key: 'configuration', label: 'Configuration', icon: Settings },
  { key: 'employes',      label: 'Employés',      icon: Users },
  { key: 'partenaires',   label: 'Partenaires',   icon: Handshake },
  { key: 'vente',         label: 'Vente',         icon: ShoppingCart },
  { key: 'cycle-vente',   label: 'Cycle de vente',icon: RefreshCw },
  { key: 'inventaire',    label: 'Inventaire',    icon: Package },
  { key: 'audit',         label: 'Audit',         icon: ClipboardList },
];

export default function SiteFichePage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const siteId = params.id as string;

  const [site, setSite] = useState<Site | null>(null);
  const [loading, setLoading] = useState(true);
  const [onglet, setOnglet] = useState<Onglet>('configuration');

  useEffect(() => {
    if (!user || !siteId) return;
    getDoc(doc(db, 'sites', siteId)).then(snap => {
      if (snap.exists()) setSite({ id: snap.id, ...snap.data() } as Site);
      setLoading(false);
    });
  }, [user, siteId]);

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
      <Loader2 size={28} className="animate-spin text-indigo-500" />
    </div>
  );

  if (!site) return (
    <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 text-gray-400">
      Site introuvable.
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="max-w-5xl mx-auto p-4 sm:p-6">

        {/* Retour avec nom + badge */}
        <button onClick={() => router.push('/site')}
          className="flex items-center gap-2 mb-5 group">
          <ArrowLeft size={15} className="text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-200 transition-colors" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
            {site.nom}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold
            ${site.type === 'boutique'
              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'}`}>
            {site.type === 'boutique' ? 'Boutique' : 'Dépôt'}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold
            ${site.etat === 'actif'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
              : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'}`}>
            {site.etat === 'actif' ? 'Actif' : 'Inactif'}
          </span>
        </button>

        {/* Onglets */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 mb-5 border-b border-gray-100 dark:border-gray-800">
          {onglets.map(o => {
            const Icon = o.icon;
            const actif = onglet === o.key;
            return (
              <button key={o.key} onClick={() => setOnglet(o.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all shrink-0
                  ${actif
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                <Icon size={14} />
                {o.label}
              </button>
            );
          })}
        </div>

        {/* Contenu */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6 min-h-64 flex items-center justify-center">
          <p className="text-gray-300 dark:text-gray-600 text-sm">
            {onglets.find(o => o.key === onglet)?.label} — à venir
          </p>
        </div>

      </div>
    </div>
  );
}
