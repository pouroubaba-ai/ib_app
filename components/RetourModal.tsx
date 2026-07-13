'use client';
import { useEffect, useState } from 'react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatMontant } from '@/lib/format';
import { X, AlertTriangle, CheckCircle2, Clock, Package } from 'lucide-react';

interface RetourLigne {
  id: string;
  produitNom: string;
  quantite: number;
  typeUnite: string;
  totalLigne: number;
  confirmeParFacturier: boolean;
}

interface Props {
  docId: string;
  onClose: () => void;
}

export default function RetourModal({ docId, onClose }: Props) {
  const [lignes, setLignes] = useState<RetourLigne[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientNom, setClientNom] = useState('');
  const [numeroDocument, setNumeroDocument] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const docRef = doc(db, 'documents_stock', docId);
        const [docSnap, retourSnap] = await Promise.all([
          getDoc(docRef),
          getDocs(query(
            collection(db, 'mouvements'),
            where('documentId', '==', docRef),
            where('typeTransaction', '==', 'Retour'),
          )),
        ]);

        if (docSnap.exists()) {
          setClientNom(docSnap.data().clientNom || '');
          setNumeroDocument(docSnap.data().numeroDocument || '');
        }
        const retoursVus: string[] = docSnap.data()?.facturierRetoursVus ?? [];
        const vusSet = new Set(retoursVus);

        const data: RetourLigne[] = retourSnap.docs.map(r => ({
          id: r.id,
          produitNom: r.data().produitNom || '—',
          quantite: r.data().quantite || 0,
          typeUnite: r.data().typeUnite || 'U',
          totalLigne: r.data().totalLigne || 0,
          confirmeParFacturier: vusSet.has(r.id),
        }));

        // Tri : non confirmés en premier
        data.sort((a, b) => Number(a.confirmeParFacturier) - Number(b.confirmeParFacturier));
        setLignes(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [docId]);

  const nbConfirmes = lignes.filter(l => l.confirmeParFacturier).length;
  const nbTotal = lignes.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full sm:max-w-lg bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="p-2 bg-orange-50 dark:bg-orange-950/40 rounded-xl">
            <AlertTriangle size={20} className="text-orange-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 dark:text-gray-100">Retours — {clientNom || '…'}</p>
            <p className="text-xs font-mono text-gray-400 mt-0.5">{numeroDocument}</p>
            {!loading && (
              <p className="text-xs mt-1">
                <span className={nbConfirmes === nbTotal ? 'text-green-600 font-semibold' : 'text-orange-500 font-semibold'}>
                  {nbConfirmes}/{nbTotal} confirmé{nbTotal > 1 ? 's' : ''}
                </span>
                <span className="text-gray-400"> par le facturier</span>
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1">
            <X size={20} />
          </button>
        </div>

        {/* Corps */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-7 h-7 border-3 border-orange-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : lignes.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">Aucun retour enregistré</p>
          ) : (
            <div className="space-y-3">
              {lignes.map(l => (
                <div
                  key={l.id}
                  className={`rounded-2xl border p-4 ${
                    l.confirmeParFacturier
                      ? 'bg-green-50 dark:bg-green-950/20 border-green-100 dark:border-green-900/30'
                      : 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900/40'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`p-1.5 rounded-lg ${l.confirmeParFacturier ? 'bg-green-100 dark:bg-green-900/30' : 'bg-orange-100 dark:bg-orange-900/30'}`}>
                      <Package size={14} className={l.confirmeParFacturier ? 'text-green-600' : 'text-orange-500'} />
                    </div>
                    <p className={`font-bold text-sm flex-1 ${l.confirmeParFacturier ? 'text-gray-700 dark:text-gray-300' : 'text-gray-900 dark:text-gray-100'}`}>
                      {l.produitNom}
                    </p>
                    {l.confirmeParFacturier
                      ? <span className="flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded-full">
                          <CheckCircle2 size={11} /> Vu
                        </span>
                      : <span className="flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-100 dark:bg-orange-900/40 px-2 py-0.5 rounded-full">
                          <Clock size={11} /> En attente
                        </span>
                    }
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-2.5 text-center">
                      <p className="text-xs text-gray-400 mb-0.5">Qté retournée</p>
                      <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">
                        {l.quantite}
                        <span className="font-normal text-gray-400 text-xs ml-0.5">
                          {l.typeUnite === 'C' ? ' ctn' : ' u'}
                        </span>
                      </p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-2.5 text-center">
                      <p className="text-xs text-gray-400 mb-0.5">Prix unit.</p>
                      <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">
                        {l.quantite > 0
                          ? Math.round(l.totalLigne / l.quantite).toLocaleString('fr-FR')
                          : '—'}
                        <span className="font-normal text-gray-400 text-xs ml-0.5">FCFA</span>
                      </p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-2.5 text-center">
                      <p className="text-xs text-gray-400 mb-0.5">Valeur</p>
                      <p className="font-bold text-orange-600 text-sm">
                        {Math.round(l.totalLigne).toLocaleString('fr-FR')}
                        <span className="font-normal text-xs ml-0.5">FCFA</span>
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pied */}
        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 shrink-0">
          <button onClick={onClose}
            className="w-full py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-semibold">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
