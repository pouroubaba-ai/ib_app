'use client';
import { useState } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';

export default function NouveauProduitPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [designation, setDesignation] = useState('');
  const [prixUnitaire, setPrixUnitaire] = useState('');
  const [qteParEmballage, setQteParEmballage] = useState('');
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!designation.trim()) { setErreur('Le nom du produit est requis.'); return; }
    if (!prixUnitaire || Number(prixUnitaire) <= 0) { setErreur('Le prix unitaire doit être supérieur à 0.'); return; }
    if (!qteParEmballage || Number(qteParEmballage) <= 0) { setErreur('La quantité par emballage doit être supérieure à 0.'); return; }

    setSaving(true);
    setErreur('');
    try {
      const doc = await addDoc(collection(db, 'Produits'), {
        designation: designation.trim(),
        prix_unitaire: Number(prixUnitaire),
        quantite_par_emballage: Number(qteParEmballage),
        quantite_unitaire_total: 0,
        userId: user.uid,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      router.push('/inventaire');
    } catch (e) {
      setErreur('Erreur lors de la création. Réessaie.');
      setSaving(false);
    }
  }

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto">
        <div className="mb-8 flex items-center gap-4">
          <Link href="/inventaire" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={18} className="text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Nouveau produit</h1>
            <p className="text-gray-500 text-sm mt-0.5">Ajouter un produit à l'inventaire</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Désignation du produit</label>
            <input
              value={designation}
              onChange={e => setDesignation(e.target.value)}
              placeholder="Ex: Ventilateur 12 pouces"
              required
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Prix unitaire (FCFA)</label>
            <input
              type="number"
              value={prixUnitaire}
              onChange={e => setPrixUnitaire(e.target.value)}
              placeholder="Ex: 15000"
              min="1"
              required
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Quantité par emballage
              <span className="text-gray-400 font-normal ml-1">(unités dans 1 carton)</span>
            </label>
            <input
              type="number"
              value={qteParEmballage}
              onChange={e => setQteParEmballage(e.target.value)}
              placeholder="Ex: 12"
              min="1"
              required
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {erreur && (
            <p className="text-sm text-red-500 bg-red-50 px-4 py-2.5 rounded-lg">{erreur}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Enregistrement...' : 'Créer le produit'}
          </button>
        </form>
      </div>
    </AppLayout>
  );
}
