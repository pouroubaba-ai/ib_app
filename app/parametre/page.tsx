'use client';
import { useState, useEffect } from 'react';
import {
  collection, query, where, getDocs, doc, setDoc, deleteDoc, serverTimestamp, getDoc,
} from 'firebase/firestore';
import { createUserWithEmailAndPassword, deleteUser as fbDeleteUser } from 'firebase/auth';
import { db, authSecondary } from '@/lib/firebase';
import { useAuth, UserRole } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import {
  User, Mail, Plus, Trash2, X, Eye, EyeOff,
  Warehouse, Receipt, ShieldCheck, Store, Save,
} from 'lucide-react';

interface SousCompte {
  uid: string;
  email: string;
  nom: string;
  role: 'depot' | 'facturier';
}

const ROLE_LABELS: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  depot:     { label: 'Responsable Dépôt', color: 'bg-blue-100 text-blue-700',   icon: Warehouse },
  facturier: { label: 'Facturier',         color: 'bg-purple-100 text-purple-700', icon: Receipt },
};

export default function ParametrePage() {
  const { user, profile } = useAuth();

  // Infos boutique
  const [boutique, setBoutique] = useState({ nom: '', telephone: '', adresse: '' });
  const [savingBoutique, setSavingBoutique] = useState(false);
  const [boutiqueOk, setBoutiqueOk] = useState(false);

  const [sousComptes, setSousComptes] = useState<SousCompte[]>([]);
  const [loadingComptes, setLoadingComptes] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SousCompte | null>(null);

  // Form
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'depot' | 'facturier'>('depot');
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');

  async function chargerSousComptes() {
    if (!profile) return;
    const snap = await getDocs(query(
      collection(db, 'users'),
      where('adminUid', '==', profile.adminUid),
      where('role', 'in', ['depot', 'facturier']),
    ));
    setSousComptes(snap.docs.map(d => d.data() as SousCompte));
    setLoadingComptes(false);
  }

  useEffect(() => {
    chargerSousComptes();
    if (user?.uid) {
      getDoc(doc(db, 'boutiques', user.uid)).then(snap => {
        if (snap.exists()) setBoutique(snap.data() as any);
      });
    }
  }, [profile, user]);

  async function sauvegarderBoutique() {
    if (!user?.uid) return;
    setSavingBoutique(true);
    await setDoc(doc(db, 'boutiques', user.uid), boutique);
    setSavingBoutique(false);
    setBoutiqueOk(true);
    setTimeout(() => setBoutiqueOk(false), 2000);
  }

  async function creerCompte() {
    if (!nom.trim() || !email.trim() || password.length < 6 || !profile) return;
    setSaving(true);
    setErreur('');
    try {
      const cred = await createUserWithEmailAndPassword(authSecondary, email, password);
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid: cred.user.uid,
        email,
        nom: nom.trim(),
        role,
        adminUid: profile.adminUid,
        createdAt: serverTimestamp(),
      });
      // Déconnecter l'instance secondaire immédiatement
      await authSecondary.signOut();
      setShowModal(false);
      setNom(''); setEmail(''); setPassword(''); setRole('depot');
      chargerSousComptes();
    } catch (err: any) {
      setErreur(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function supprimerCompte(sc: SousCompte) {
    setDeleting(sc.uid);
    await deleteDoc(doc(db, 'users', sc.uid));
    setSousComptes(prev => prev.filter(c => c.uid !== sc.uid));
    setConfirmDelete(null);
    setDeleting(null);
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Paramètres</h1>

        {/* Profil admin */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center">
              <ShieldCheck size={24} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">Compte Admin</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mt-0.5">
                <Mail size={13} /> {user?.email}
              </p>
            </div>
          </div>
          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            <p className="text-xs text-gray-400">ID utilisateur</p>
            <p className="text-xs font-mono text-gray-600 dark:text-gray-400 mt-1 break-all">{user?.uid}</p>
          </div>
        </div>

        {/* Infos boutique */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3 mb-1">
            <Store size={18} className="text-indigo-600" />
            <p className="font-semibold text-gray-900 dark:text-gray-100">Informations boutique</p>
          </div>
          <p className="text-xs text-gray-400">Ces informations apparaissent sur les devis PDF et WhatsApp.</p>
          <div className="space-y-3">
            {[
              { key: 'nom', label: 'Nom de la boutique', placeholder: 'IBD Kunda' },
              { key: 'telephone', label: 'Téléphone', placeholder: '+223 00 00 00 00' },
              { key: 'adresse', label: 'Adresse', placeholder: 'Quartier, Ville' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">{f.label}</label>
                <input
                  value={(boutique as any)[f.key]}
                  onChange={e => setBoutique(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
            ))}
          </div>
          <button
            onClick={sauvegarderBoutique}
            disabled={savingBoutique}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors
              ${boutiqueOk ? 'bg-green-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'} disabled:opacity-50`}
          >
            <Save size={15} />
            {boutiqueOk ? 'Enregistré !' : savingBoutique ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>

        {/* Gestion des comptes */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">Comptes associés</p>
              <p className="text-xs text-gray-400 mt-0.5">Responsables dépôt et facturiers</p>
            </div>
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
              <Plus size={15} /> Nouveau compte
            </button>
          </div>

          {loadingComptes ? (
            <div className="flex justify-center py-10">
              <div className="w-7 h-7 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sousComptes.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <User size={36} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Aucun compte associé</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {sousComptes.map(sc => {
                const meta = ROLE_LABELS[sc.role];
                const Icon = meta.icon;
                return (
                  <div key={sc.uid} className="flex items-center gap-4 px-6 py-4">
                    <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center shrink-0">
                      <Icon size={18} className="text-gray-500 dark:text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{sc.nom}</p>
                      <p className="text-xs text-gray-400 truncate">{sc.email}</p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${meta.color}`}>
                      {meta.label}
                    </span>
                    <button onClick={() => setConfirmDelete(sc)}
                      className="p-2 text-gray-300 hover:text-red-400 transition-colors shrink-0">
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal création */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">Nouveau compte</p>
              <button onClick={() => setShowModal(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Rôle */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Type de compte</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['depot', 'facturier'] as const).map(r => {
                    const meta = ROLE_LABELS[r];
                    const Icon = meta.icon;
                    return (
                      <button key={r} onClick={() => setRole(r)}
                        className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-colors
                          ${role === r ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'}`}>
                        <Icon size={16} className="shrink-0" />
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Nom</label>
                <input value={nom} onChange={e => setNom(e.target.value)} placeholder="Prénom Nom"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="compte@email.com"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Mot de passe</label>
                <div className="relative">
                  <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="6 caractères minimum"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 dark:text-gray-100" />
                  <button type="button" onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {erreur && <p className="text-red-500 text-xs">{erreur}</p>}

              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  Annuler
                </button>
                <button onClick={creerCompte}
                  disabled={saving || !nom.trim() || !email.trim() || password.length < 6}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:text-gray-400 text-white transition-colors">
                  {saving ? 'Création...' : 'Créer le compte'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm suppression */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-red-500" />
            </div>
            <p className="font-bold text-gray-900 dark:text-gray-100 mb-1">Supprimer le compte ?</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              <span className="font-medium">{confirmDelete.nom}</span> ne pourra plus se connecter.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
                Annuler
              </button>
              <button onClick={() => supprimerCompte(confirmDelete)} disabled={!!deleting}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white">
                {deleting ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
