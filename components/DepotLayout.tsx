'use client';
import { useAuth } from '@/lib/auth-context';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { FileText, History, Ship, LogOut } from 'lucide-react';

export default function DepotLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [nbAttente, setNbAttente] = useState(0);
  const [nbImportationsEnCours, setNbImportationsEnCours] = useState(0);

  useEffect(() => {
    if (!loading && (!user || (profile && profile.role !== 'depot'))) {
      router.push('/login');
    }
  }, [user, profile, loading, router]);

  /* Charge les deux compteurs — se rafraîchit à chaque changement de page */
  useEffect(() => {
    if (!profile) return;
    async function loadBadges() {
      const [sortieSnap, impSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'documents_stock'),
          where('userId', '==', profile!.adminUid),
          where('typeDocument', '==', 'Sortie'),
          where('livraison', '==', 'non_livre'),
        )),
        getDocs(query(
          collection(db, 'importations'),
          where('userId', '==', profile!.adminUid),
          where('statut', '!=', 'termine'),
        )),
      ]);
      setNbAttente(sortieSnap.size);
      setNbImportationsEnCours(impSnap.size);

      // Badge icône PWA = total des deux
      const total = sortieSnap.size + impSnap.size;
      if ('setAppBadge' in navigator) {
        if (total > 0) navigator.setAppBadge(total);
        else navigator.clearAppBadge?.();
      }
    }
    loadBadges();
  }, [profile, pathname]);

  if (loading || !user || !profile) return (
    <div className="flex h-screen items-center justify-center">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const tabs = [
    { href: '/depot',             label: 'Documents',   icon: FileText, badge: nbAttente },
    { href: '/depot/historique',  label: 'Historique',  icon: History,  badge: 0 },
    { href: '/depot/importation', label: 'Importation', icon: Ship,     badge: nbImportationsEnCours },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-20">
        <div className="flex items-center justify-between px-4 py-3.5">
          <div>
            <p className="text-xs text-gray-400">Responsable Dépôt</p>
            <p className="font-bold text-gray-900 text-sm">{profile.nom}</p>
          </div>
          <button onClick={() => setConfirmLogout(true)}
            className="p-2 text-gray-400 hover:text-red-400 transition-colors">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-20">
        {children}
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-20">
        <div className="flex">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const active = pathname === tab.href;
            return (
              <button key={tab.href} onClick={() => router.push(tab.href)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors
                  ${active ? 'text-blue-600' : 'text-gray-400'}`}>
                <div className="relative">
                  <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                  {tab.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  )}
                </div>
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

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
