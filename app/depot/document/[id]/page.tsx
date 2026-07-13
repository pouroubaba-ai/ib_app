'use client';
import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import DepotLayout from '@/components/DepotLayout';
import { formatDate } from '@/lib/format';
import { ArrowLeft, Truck, CheckCircle2, Clock, RotateCcw } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';

interface Mouvement {
  id: string;
  produitNom: string;
  quantite: number;
  typeUnite: string;
  typeTransaction: string;
}

interface DocumentInfo {
  id: string;
  numeroDocument: string;
  clientNom: string;
  statut: string;
  livraison: 'non_livre' | 'livre';
  date: any;
}

export default function DepotFicheDocumentPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [docInfo, setDocInfo] = useState<DocumentInfo | null>(null);
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingLivraison, setUpdatingLivraison] = useState(false);

  useEffect(() => {
    if (!profile || !id) return;
    async function load() {
      const [docSnap, mouvSnap] = await Promise.all([
        getDoc(doc(db, 'documents_stock', id)),
        getDocs(query(
          collection(db, 'mouvements'),
          where('documentId', '==', doc(db, 'documents_stock', id)),
        )),
      ]);

      if (docSnap.exists()) {
        const d = docSnap.data();
        setDocInfo({
          id: docSnap.id,
          numeroDocument: d.numeroDocument || '',
          clientNom: d.clientNom || '',
          statut: d.statut || 'En cours',
          livraison: d.livraison || 'non_livre',
          date: d.date,
        });
      }

      const mvts: Mouvement[] = mouvSnap.docs
        .map(m => ({
          id: m.id,
          produitNom: m.data().produitNom || '',
          quantite: m.data().quantite || 0,
          typeUnite: m.data().typeUnite || 'U',
          typeTransaction: m.data().typeTransaction || '',
        }));

      const originals = mvts.filter(m => m.typeTransaction !== 'Retour');
      const retours = mvts.filter(m => m.typeTransaction === 'Retour');

      // Merge : pour chaque original, calculer le retour
      const retourMap: Record<string, number> = {};
      retours.forEach(r => {
        retourMap[r.produitNom] = (retourMap[r.produitNom] || 0) + r.quantite;
      });

      setMouvements(originals.map(m => ({
        ...m,
        _retourQte: retourMap[m.produitNom] || 0,
      } as any)));
      setLoading(false);
    }
    load();
  }, [profile, id]);

  async function toggleLivraison() {
    if (!docInfo) return;
    setUpdatingLivraison(true);
    const newLivraison = docInfo.livraison === 'livre' ? 'non_livre' : 'livre';
    const newStatut = newLivraison === 'livre' ? 'Terminé' : 'En cours';
    await updateDoc(doc(db, 'documents_stock', id), {
      livraison: newLivraison,
      statut: newStatut,
      livraisonUpdatedAt: serverTimestamp(),
    });
    setDocInfo(prev => prev ? { ...prev, livraison: newLivraison, statut: newStatut } : prev);
    setUpdatingLivraison(false);
  }

  return (
    <DepotLayout>
      <div>
        {/* Header doc */}
        <div className="bg-white border-b border-gray-100 px-4 py-4">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => router.back()}
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
              <ArrowLeft size={18} className="text-gray-500" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-900">{docInfo?.clientNom || '—'}</p>
              <p className="text-xs text-gray-400">{docInfo?.numeroDocument} · {formatDate(docInfo?.date)}</p>
            </div>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0
              ${docInfo?.statut === 'Terminé' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
              {docInfo?.statut}
            </span>
          </div>

          {/* Bouton livraison */}
          <button onClick={toggleLivraison} disabled={updatingLivraison}
            className={`w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors
              ${docInfo?.livraison === 'livre'
                ? 'bg-green-50 border border-green-200 text-green-600'
                : 'bg-orange-500 text-white'}`}>
            {updatingLivraison ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : docInfo?.livraison === 'livre' ? (
              <><CheckCircle2 size={16} /> Livré — Appuyer pour annuler</>
            ) : (
              <><Truck size={16} /> Marquer comme livré</>
            )}
          </button>
        </div>

        {/* Produits */}
        <div className="px-4 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Produits ({mouvements.length})
          </p>

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {mouvements.map((m: any) => (
                <div key={m.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-gray-900">{m.produitNom}</p>
                    <div className="text-right">
                      <p className="font-bold text-gray-900">
                        {m.quantite.toLocaleString('fr-FR')}
                        <span className="text-xs font-normal text-gray-400 ml-1">{m.typeUnite}</span>
                      </p>
                    </div>
                  </div>
                  {m._retourQte > 0 && (
                    <div className="flex items-center gap-1.5 mt-2 text-orange-500">
                      <RotateCcw size={12} />
                      <p className="text-xs font-medium">
                        Retour : {m._retourQte.toLocaleString('fr-FR')} {m.typeUnite}
                        <span className="text-gray-400 ml-1">
                          (net : {(m.quantite - m._retourQte).toLocaleString('fr-FR')} {m.typeUnite})
                        </span>
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DepotLayout>
  );
}
