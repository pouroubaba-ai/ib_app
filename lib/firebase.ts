import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDRHDCVuH1urAUOEkWNedysPNlwvN7v-ys",
  authDomain: "ibappp-k7kaq0.firebaseapp.com",
  projectId: "ibappp-k7kaq0",
  storageBucket: "ibappp-k7kaq0.firebasestorage.app",
  messagingSenderId: "574017996063",
  appId: "1:574017996063:web:15da5480406ed0f95d9c2a",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Instance secondaire pour créer des sous-comptes sans déconnecter l'admin
const secondaryApp = getApps().find(a => a.name === 'secondary') ?? initializeApp(firebaseConfig, 'secondary');
export const authSecondary = getAuth(secondaryApp);
