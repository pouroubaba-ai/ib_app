'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function Home() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.push('/login'); return; }
    // Attendre que le profil soit chargé pour rediriger vers la bonne route
    if (!profile) return;
    if (profile.role === 'depot') router.push('/depot');
    else if (profile.role === 'facturier') router.push('/facturier');
    else router.push('/dashboard');
  }, [user, profile, loading, router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
