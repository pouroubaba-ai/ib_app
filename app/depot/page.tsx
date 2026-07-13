'use client';
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import DepotLayout from '@/components/DepotLayout';
import { formatDate } from '@/lib/format';
import { Search, X, ChevronRight, Truck, Clock, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Document {
  id: string;
  numeroDocument: string;
  clientNom: string;
  nombreDeProduit: number;
  statut: string;
  livraison: 'non_livre' | 'livre';
  date: any;
}

export default function DepotDocumentsPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [recherche, setRecherche] = useState('');
  const [onglet, setOnglet] = useState<'en_attente' | 'livre'>('en_attente');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    async function load() {
      const snap = await getDocs(query(
        collection(db, 'documents_stock'),
        where('userId', '==', profile!.adminUid),
        where('typeDocument', '==', 'Sortie'),
      ));
      const data: Document[] = snap.docs.map(d => ({
        id: d.id,
        numeroDocument: d.data().numeroDocument || '',
        clientNom: d.data().clientNom || '',
        nombreDeProduit: d.data().nombreDeProduit || 0,
        statut: d.data().statut || 'En cours',
        livraison: d.data().livraison || 'non_livre',
        date: d.data().date,
      }));
      data.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
      setDocs(data);
      setLoading(false);
    }
    load();
  }, [profile]);

  async function toggleLivraison(d: Document) {
    setUpdatingId(d.id);
    const newLivraison = d.livraison === 'livre' ? 'non_livre' : 'livre';
    const newStatut = newLivraison === 'livre' ? 'Terminé' : 'En cours';
    await updateDoc(doc(db, 'documents_stock', d.id), {
      livraison: newLivraison,
      statut: newStatut,
      livraisonUpdatedAt: serverTimestamp(),
    });
    setDocs(prev => prev.map(x => x.id === d.id ? { ...x, livraison: newLivraison, statut: newStatut } : x));
    setUpdatingId(null);
  }

  const filtered = useMemo(() => docs.filter(d => {
    const okRecherche = !recherche ||
      (d.clientNom || '').toLowerCase().includes(recherche.toLowerCase()) ||
      (d.numeroDocument || '').toLowerCase().includes(recherche.toLowerCase());
    const okOnglet = onglet === 'livre' ? d.livraison === 'livre' : d.livraison !== 'livre';
    return okRecherche && okOnglet;
  }), [docs, recherche, onglet]);

  const nbAttente = docs.filter(d => d.livraison !== 'livre').length;
  const nbLivre = docs.filter(d => d.livraison === 'livre').length;

  /* Badge icône PWA */
  useEffect(() => {
    if ('setAppBadge' in navigator) {
      if (nbAttente > 0) navigator.setAppBadge(nbAttente);
      else navigator.clearAppBadge();
    }
  }, [nbAttente]);

  return (
    <DepotLayout>
      <div className="px-4 pt-5 pb-4">
        {/* Onglets */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setOnglet('en_attente')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors
              ${onglet === 'en_attente' ? 'bg-orange-500 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-500'}`}>
            <Clock size={15} />
            En attente
            {nbAttente > 0 && (
              <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center
                ${onglet === 'en_attente' ? 'bg-white/30 text-white' : 'bg-orange-100 text-orange-600'}`}>
                {nbAttente}
              </span>
            )}
          </button>
          <button onClick={() => setOnglet('livre')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors
              ${onglet === 'livre' ? 'bg-green-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-500'}`}>
            <Truck size={15} />
            Livré
            {nbLivre > 0 && (
              <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center
                ${onglet === 'livre' ? 'bg-white/30 text-white' : 'bg-green-100 text-green-600'}`}>
                {nbLivre}
              </span>
            )}
          </button>
        </div>

        {/* Recherche */}
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={recherche} onChange={e => setRecherche(e.target.value)}
            placeholder="Rechercher un client ou N° doc..."
            className="w-full pl-9 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
          {recherche && (
            <button onClick={() => setRecherche('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Liste */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Truck size={40} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">Aucun document {onglet === 'livre' ? 'livré' : 'en attente'}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map(d => (
              <div key={d.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* En-tête carte */}
                <div className="flex items-center gap-3 px-4 pt-4 pb-3"
                  onClick={() => router.push(`/depot/document/${d.id}`)}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                    ${d.livraison === 'livre' ? 'bg-green-100' : 'bg-orange-50'}`}>
                    {d.livraison === 'livre'
                      ? <CheckCircle2 size={20} className="text-green-600" />
                      : <Clock size={20} className="text-orange-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 truncate">{d.clientNom || '—'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {d.numeroDocument} · {d.nombreDeProduit} produit(s) · {formatDate(d.date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                      ${d.statut === 'Terminé' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                      {d.statut}
                    </span>
                    <ChevronRight size={15} className="text-gray-300" />
                  </div>
                </div>

                {/* Bouton livraison */}
                <div className="border-t border-gray-50 px-4 py-2.5">
                  <button
                    onClick={() => toggleLivraison(d)}
                    disabled={updatingId === d.id}
                    className={`w-full py-2 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2
                      ${d.livraison === 'livre'
                        ? 'bg-green-50 text-green-600 border border-green-200'
                        : 'bg-orange-500 text-white'}`}>
                    {updatingId === d.id ? (
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : d.livraison === 'livre' ? (
                      <><CheckCircle2 size={15} /> Livré — Annuler</>
                    ) : (
                      <><Truck size={15} /> Marquer comme livré</>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DepotLayout>
  );
}
