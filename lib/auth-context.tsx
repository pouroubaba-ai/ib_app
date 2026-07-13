'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';

export type UserRole = 'admin' | 'depot' | 'facturier';

export interface UserProfile {
  uid: string;
  email: string;
  nom: string;
  role: UserRole;
  adminUid: string; // pour admin: son propre uid ; pour sous-comptes: uid de l'admin
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({ user: null, profile: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const ref = doc(db, 'users', u.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
        } else {
          // Premier login admin — crée le document profil
          const p: UserProfile = {
            uid: u.uid,
            email: u.email ?? '',
            nom: u.email ?? '',
            role: 'admin',
            adminUid: u.uid,
          };
          await setDoc(ref, { ...p, createdAt: serverTimestamp() });
          setProfile(p);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
  }, []);

  return <AuthContext.Provider value={{ user, profile, loading }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
