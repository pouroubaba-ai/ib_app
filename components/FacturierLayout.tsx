'use client';
import { useAuth } from '@/lib/auth-context';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { FileText, LogOut } from 'lucide-react';

export default function FacturierLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [nbNonGeres, setNbNonGeres] = useState(0);

  useEffect(() => {
    if (!loading && (!user || (profile && profile.role !== 'facturier'))) {
      router.push('/login');
    }
  }, [user, profile, loading, router]);

  /* Charge le nombre de documents non entièrement traités — se rafraîchit à chaque page */
  useEffect(() => {
    if (!profile) return;
    async function loadBadge() {
      const [docSnap, partSnap, retourSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'documents_stock'),
          where('userId', '==', profile!.adminUid),
          where('typeDocument', '==', 'Sortie'),
        )),
        getDocs(query(
          collection(db, 'Partenaire'),
          where('userId', '==', profile!.adminUid),
          where('type', '==', 'boutique'),
        )),
        getDocs(query(
          collection(db, 'mouvements'),
          where('userId', '==', profile!.adminUid),
          where('typeTransaction', '==', 'Retour'),
        )),
      ]);

      const boutiques = new Set<string>(
        partSnap.docs.map(d => (d.data().nom || '').toLowerCase())
      );

      // Grouper retours par docId
      const retourIdsByDoc: Record<string, string[]> = {};
      retourSnap.docs.forEach(r => {
        const docRef = r.data().documentId;
        const docId = docRef?.id || docRef;
        if (!docId) return;
        if (!retourIdsByDoc[docId]) retourIdsByDoc[docId] = [];
        retourIdsByDoc[docId].push(r.id);
      });

      let count = 0;
      docSnap.docs.forEach(d => {
        const data = d.data();
        // Ignorer les boutiques
        if (boutiques.has((data.clientNom || '').toLowerCase())) return;
        const traites: string[] = data.facturierTraites ?? [];
        const nbProd: number = data.nombreDeProduit || 0;
        const retoursVus: string[] = data.facturierRetoursVus ?? [];
        const retourIds = retourIdsByDoc[d.id] ?? [];
        const hasPendingRetour = retourIds.some(rid => !retoursVus.includes(rid));
        const toutTraite = nbProd > 0 && traites.length >= nbProd;
        // Non géré = pas tout traité OU retour en attente
        if (!toutTraite || hasPendingRetour) count++;
      });

      setNbNonGeres(count);

      // Badge icône PWA
      if ('setAppBadge' in navigator) {
        if (count > 0) navigator.setAppBadge(count);
        else navigator.clearAppBadge?.();
      }
    }
    loadBadge();
  }, [profile, pathname]);

  if (loading || !user || !profile) return (
    <div className="flex h-screen items-center justify-center">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-20">
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                <FileText size={16} className="text-blue-600" />
              </div>
              {nbNonGeres > 0 && (
                <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                  {nbNonGeres > 99 ? '99+' : nbNonGeres}
                </span>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-400">Facturier</p>
              <p className="font-bold text-gray-900 text-sm">{profile.nom}</p>
            </div>
          </div>
          <button onClick={() => setConfirmLogout(true)}
            className="p-2 text-gray-400 hover:text-red-400 transition-colors">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>

      {/* Confirm logout */}
      {confirmLogout && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmLogout(false)} />
          <div className="relative bg-white rounded-t-2xl w-full p-6 shadow-2xl">
            <p className="font-bold text-gray-900 text-center mb-1">Se déconnecter ?</p>
            <p className="text-sm text-gray-400 text-center mb-5">Tu seras redirigé vers la connexion.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmLogout(false)}
                className="flex-1 py-3 rounded-xl text-sm font-medium border border-gray-200 text-gray-600">
                Annuler
              </button>
              <button onClick={async () => { await signOut(auth); router.push('/login'); }}
                className="flex-1 py-3 rounded-xl text-sm font-medium bg-red-500 text-white">
                Déconnecter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
