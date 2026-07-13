'use client';
import { useEffect, useState } from 'react';
import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { formatMontant, formatDate } from '@/lib/format';
import { ArrowLeft, FileText } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';

interface DocumentStock {
  id: string;
  numeroDocument: string;
  clientNom: string;
  totalGeneral: number;
  nombreDeProduit: number;
  statut: string;
  typeDocument: string;
  date: any;
}

interface Ligne {
  id: string;
  produitNom: string;
  quantite: number;
  prixUnitaireReel: number;
  totalLigne: number;
  typeUnite?: string;
  typeTransaction?: string;
}

export default function FicheDocumentPage() {
  const { user } = useAuth();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [document, setDocument] = useState<DocumentStock | null>(null);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [retourMap, setRetourMap] = useState<Record<string, number>>({}); // produitNom → qte retournée
  const [retourValeurMap, setRetourValeurMap] = useState<Record<string, number>>({}); // produitNom → valeur retournée
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const docRef = doc(db, 'documents_stock', id);
      const [docSnap, mouvSnap] = await Promise.all([
        getDoc(docRef),
        getDocs(query(collection(db, 'mouvements'), where('documentId', '==', docRef))),
      ]);

      if (!docSnap.exists()) { setLoading(false); return; }
      setDocument({ id: docSnap.id, ...docSnap.data() } as DocumentStock);

      const all: Ligne[] = mouvSnap.docs.map(d => ({ id: d.id, ...d.data() } as Ligne));

      // Séparer originals et retours
      const originals = all.filter(l => l.typeTransaction !== 'Retour');
      const retours = all.filter(l => l.typeTransaction === 'Retour');

      originals.sort((a, b) => (a.produitNom || '').localeCompare(b.produitNom || ''));
      setLignes(originals);

      // Prix unitaire par produit depuis les lignes originales (fallback si totalLigne retour est 0)
      const prixOrigMap: Record<string, number> = {};
      originals.forEach(o => {
        if (o.prixUnitaireReel) prixOrigMap[o.produitNom] = o.prixUnitaireReel;
      });

      // Construire maps produitNom → quantité/valeur retournée
      const rMap: Record<string, number> = {};
      const rValMap: Record<string, number> = {};
      retours.forEach(r => {
        rMap[r.produitNom] = (rMap[r.produitNom] || 0) + (r.quantite || 0);
        const prix = r.prixUnitaireReel || prixOrigMap[r.produitNom] || 0;
        const val = r.totalLigne || (r.quantite * prix);
        rValMap[r.produitNom] = (rValMap[r.produitNom] || 0) + val;
      });
      setRetourMap(rMap);
      setRetourValeurMap(rValMap);
      setLoading(false);
    }
    load();
  }, [user, id]);

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!document) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">
      Document introuvable.
    </div>
  );

  const isEntree = document.typeDocument === 'Entrée';
  const couleur = isEntree ? 'text-green-600' : 'text-blue-600';
  const couleurBg = isEntree ? 'bg-green-600' : 'bg-blue-600';

  return (
    <div className="min-h-screen bg-gray-50">

      {/* EN-TÊTE */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400">Document {document.typeDocument}</p>
            <p className="font-bold text-gray-900 truncate font-mono text-sm">{document.numeroDocument}</p>
          </div>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${document.statut === 'Terminé' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
            {document.statut}
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* INFOS DOCUMENT */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 ${couleurBg} rounded-xl flex items-center justify-center shrink-0`}>
              <FileText size={22} className="text-white" />
            </div>
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">{isEntree ? 'Fournisseur' : 'Client'}</p>
                <p className="font-semibold text-gray-900 text-sm">{document.clientNom}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Date</p>
                <p className="font-semibold text-gray-900 text-sm">{formatDate(document.date)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Nb produits</p>
                <p className="font-semibold text-gray-900 text-sm">{document.nombreDeProduit}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Total général</p>
                <p className={`font-bold text-sm ${couleur}`}>{formatMontant(document.totalGeneral)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* LIGNES PRODUITS */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Détail des produits</h2>
              <p className="text-xs text-gray-400 mt-0.5">{lignes.length} ligne(s)</p>
            </div>
            {Object.keys(retourMap).length > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 bg-orange-100 text-orange-600 rounded-full">
                ↩ {Object.keys(retourMap).length} produit(s) avec retour
              </span>
            )}
          </div>

          {lignes.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">Aucune ligne trouvée</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-5 py-3 font-medium text-gray-500">#</th>
                      <th className="text-left px-5 py-3 font-medium text-gray-500">Produit</th>
                      <th className="text-right px-5 py-3 font-medium text-gray-500">Quantité</th>
                      <th className="text-right px-5 py-3 font-medium text-orange-400">Retour</th>
                      <th className="text-right px-5 py-3 font-medium text-orange-400">Val. retour</th>
                      <th className="text-right px-5 py-3 font-medium text-gray-500">Prix unit.</th>
                      <th className="text-right px-5 py-3 font-medium text-gray-500">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {lignes.map((l, i) => {
                      const qteRetour = retourMap[l.produitNom] || 0;
                      const valRetour = retourValeurMap[l.produitNom] || 0;
                      const unit = l.typeUnite === 'C' ? 'ctn' : l.typeUnite || 'u';
                      return (
                        <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3 text-xs font-bold text-gray-300">{i + 1}</td>
                          <td className="px-5 py-3 font-medium text-gray-900">
                            <div className="flex items-center gap-2">
                              {l.produitNom}
                              {qteRetour > 0 && (
                                <span className="text-xs font-semibold px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded-full shrink-0">
                                  ↩
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right text-gray-700">
                            {l.quantite?.toLocaleString('fr-FR')}
                            <span className="text-xs text-gray-400 ml-1">{unit}</span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            {qteRetour > 0 ? (
                              <span className="text-orange-500 font-medium">
                                {qteRetour} {unit}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {valRetour > 0 ? (
                              <span className="text-orange-500 font-medium">
                                {formatMontant(valRetour)}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right text-gray-600">
                            {l.quantite ? Math.round(l.totalLigne / l.quantite).toLocaleString('fr-FR') : '—'}
                            <span className="text-xs text-gray-400 ml-1">/{unit}</span>
                          </td>
                          <td className={`px-5 py-3 text-right font-semibold ${couleur}`}>
                            {formatMontant(l.totalLigne)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-200">
                    {(() => {
                      const totalRetourVal = Object.values(retourValeurMap).reduce((s, v) => s + v, 0);
                      return totalRetourVal > 0 ? (
                        <tr className="border-b border-gray-200">
                          <td colSpan={4} className="px-5 py-2 text-sm font-semibold text-orange-500">Total retours</td>
                          <td className="px-5 py-2 text-right font-bold text-orange-500">{formatMontant(totalRetourVal)}</td>
                          <td colSpan={2} />
                        </tr>
                      ) : null;
                    })()}
                    <tr>
                      <td colSpan={6} className="px-5 py-3 font-bold text-gray-900">Total général</td>
                      <td className={`px-5 py-3 text-right font-bold text-lg ${couleur}`}>
                        {formatMontant(document.totalGeneral)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>

      </main>
    </div>
  );
}
