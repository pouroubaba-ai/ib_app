'use client';
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, MapPin, Phone, Store, Warehouse, Loader2 } from 'lucide-react';

type TypeSite = 'boutique' | 'depot';
type EtatSite = 'actif' | 'inactif';
type Onglet = 'partenaire' | 'employe' | 'inventaire';

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

const onglets: { key: Onglet; label: string }[] = [
  { key: 'partenaire', label: 'Partenaire' },
  { key: 'employe', label: 'Employé' },
  { key: 'inventaire', label: 'Inventaire' },
];

export default function SiteFichePage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const siteId = params.id as string;

  const [site, setSite] = useState<Site | null>(null);
  const [loading, setLoading] = useState(true);
  const [onglet, setOnglet] = useState<Onglet>('partenaire');

  useEffect(() => {
    if (!user || !siteId) return;
    getDoc(doc(db, 'sites', siteId)).then(snap => {
      if (snap.exists()) setSite({ id: snap.id, ...snap.data() } as Site);
      setLoading(false);
    });
  }, [user, siteId]);

  if (loading) return (
    <AppLayout>
      <div className="flex justify-center py-20">
        <Loader2 size={28} className="animate-spin text-indigo-500" />
      </div>
    </AppLayout>
  );

  if (!site) return (
    <AppLayout>
      <div className="text-center py-20 text-gray-400">Site introuvable.</div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto">

        {/* Retour */}
        <button onClick={() => router.push('/site')}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 mb-4 transition-colors">
          <ArrowLeft size={15} /> Sites
        </button>

        {/* Header site */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden mb-4">
          <div className="h-40 bg-gray-100 dark:bg-gray-800 relative">
            {site.imageUrl
              ? <img src={site.imageUrl} alt={site.nom} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-gray-300 dark:text-gray-600">
                  {site.type === 'boutique' ? <Store size={48} /> : <Warehouse size={48} />}
                </div>
            }
            <div className="absolute top-3 left-3 flex gap-1.5">
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
            </div>
          </div>

          <div className="p-4">
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">{site.nom}</h1>
            <div className="flex flex-wrap gap-3 mt-1.5">
              <p className="text-sm text-gray-400 flex items-center gap-1">
                <MapPin size={13} /> {site.adresse}
              </p>
              {site.numero && (
                <p className="text-sm text-gray-400 flex items-center gap-1">
                  <Phone size={13} /> {site.numero}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Onglets */}
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-4">
          {onglets.map(o => (
            <button key={o.key} onClick={() => setOnglet(o.key)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                ${onglet === o.key
                  ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}>
              {o.label}
            </button>
          ))}
        </div>

        {/* Contenu onglets */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6 min-h-64 flex items-center justify-center">
          <p className="text-gray-300 dark:text-gray-600 text-sm">
            {onglet === 'partenaire' && 'Partenaires du site — à venir'}
            {onglet === 'employe' && 'Employés du site — à venir'}
            {onglet === 'inventaire' && 'Inventaire du site — à venir'}
          </p>
        </div>

      </div>
    </AppLayout>
  );
}
