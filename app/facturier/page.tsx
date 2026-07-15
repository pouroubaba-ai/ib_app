'use client';
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import FacturierLayout from '@/components/FacturierLayout';
import { formatMontant } from '@/lib/format';
import { FileText, ChevronRight, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import RetourModal from '@/components/RetourModal';

interface DocSortie {
  id: string;
  numeroDocument: string;
  clientNom: string;
  totalGeneral: number;
  nombreDeProduit: number;
  facturierTraites: string[];
  facturierPendingRetour?: boolean;
  date: any;
}

function isToday(ts: any): boolean {
  if (!ts?.seconds) return false;
  const d = new Date(ts.seconds * 1000);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

type Onglet = 'en_cours' | 'termine' | 'retours';

export default function FacturierDocumentsPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const [docs, setDocs] = useState<DocSortie[]>([]);
  const [loading, setLoading] = useState(true);
  const [onglet, setOnglet] = useState<Onglet>('en_cours');
  const [retourModalDocId, setRetourModalDocId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.adminUid) return;
    async function load() {
      const adminUid = profile!.adminUid;
      try {
        const docSnap = await getDocs(query(
          collection(db, 'documents_stock'),
          where('userId', '==', adminUid),
          where('typeDocument', '==', 'Sortie'),
        ));

        const data: DocSortie[] = docSnap.docs
          .map(d => ({
            id: d.id,
            numeroDocument: d.data().numeroDocument || '',
            clientNom: d.data().clientNom || '',
            totalGeneral: d.data().totalGeneral || 0,
            nombreDeProduit: d.data().nombreDeProduit || 0,
            facturierTraites: d.data().facturierTraites ?? [],
            facturierPendingRetour: d.data().facturierPendingRetour ?? false,
            date: d.data().date,
          }))
          .filter(d => {
            if (d.facturierPendingRetour) return true;
            const today = isToday(d.date);
            const traite = d.facturierTraites.length >= d.nombreDeProduit && d.nombreDeProduit > 0;
            if (today) return true;
            return !traite;
          });

        data.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
        setDocs(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [profile]);

  const enCours = useMemo(() =>
    docs.filter(d => d.facturierTraites.length < d.nombreDeProduit && !d.facturierPendingRetour), [docs]);
  const avecRetour = useMemo(() =>
    docs.filter(d => d.facturierPendingRetour), [docs]);
  const termine = useMemo(() =>
    docs.filter(d => d.nombreDeProduit > 0 && d.facturierTraites.length >= d.nombreDeProduit && !d.facturierPendingRetour), [docs]);

  const liste = onglet === 'en_cours' ? enCours : onglet === 'retours' ? avecRetour : termine;

  return (
    <FacturierLayout>
      {retourModalDocId && (
        <RetourModal docId={retourModalDocId} onClose={() => setRetourModalDocId(null)} />
      )}
      <div className="px-4 pt-5 pb-4">
        <div className="mb-4">
          <p className="font-bold text-gray-900 text-lg">Documents</p>
          <p className="text-xs text-gray-400 mt-0.5">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>

        {/* Onglets */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <button onClick={() => setOnglet('en_cours')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors
              ${onglet === 'en_cours' ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-500'}`}>
            <Clock size={15} />
            En cours
            {enCours.length > 0 && (
              <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center
                ${onglet === 'en_cours' ? 'bg-white/30 text-white' : 'bg-orange-100 text-orange-600'}`}>
                {enCours.length}
              </span>
            )}
          </button>

          {/* Bouton Retours — visible seulement s'il y a des retours en attente */}
          {avecRetour.length > 0 && (
            <button onClick={() => setOnglet('retours')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors
                ${onglet === 'retours' ? 'bg-amber-500 text-white' : 'bg-amber-50 border border-amber-300 text-amber-600'}`}>
              <AlertTriangle size={15} />
              Retours
              <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center
                ${onglet === 'retours' ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-600'}`}>
                {avecRetour.length}
              </span>
            </button>
          )}

          <button onClick={() => setOnglet('termine')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors
              ${onglet === 'termine' ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-500'}`}>
            <CheckCircle2 size={15} />
            Terminé
            {termine.length > 0 && (
              <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center
                ${onglet === 'termine' ? 'bg-white/30 text-white' : 'bg-green-100 text-green-600'}`}>
                {termine.length}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : liste.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <FileText size={40} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">
              {onglet === 'en_cours' ? 'Tout est traité !' :
               onglet === 'retours' ? 'Aucun retour en attente' :
               'Aucun document terminé'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {liste.map(d => {
              const nb = d.facturierTraites.length;
              const total = d.nombreDeProduit;
              const pct = total > 0 ? Math.round((nb / total) * 100) : 0;
              const pendingRetour = d.facturierPendingRetour;
              return (
                <div key={d.id} onClick={() => router.push(`/facturier/document/${d.id}`)}
                  className={`bg-white rounded-2xl border shadow-sm p-4 cursor-pointer active:bg-gray-50
                    ${pendingRetour ? 'border-amber-400' :
                      nb >= total && total > 0 ? 'border-green-200' : 'border-orange-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-bold text-gray-900 truncate">{d.clientNom || '—'}</p>
                        {pendingRetour && (
                          <button
                            onClick={e => { e.stopPropagation(); setRetourModalDocId(d.id); }}
                            className="shrink-0 p-0.5 rounded-full hover:bg-amber-100 transition-colors"
                          >
                            <AlertTriangle size={15} className="text-amber-500" />
                          </button>
                        )}
                      </div>
                      <p className="text-xs font-mono text-gray-400">{d.numeroDocument}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="font-bold text-blue-600">{formatMontant(d.totalGeneral)}</span>
                      <ChevronRight size={15} className="text-gray-300" />
                    </div>
                  </div>
                  {/* Barre de progression */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${nb >= total ? 'bg-green-500' : 'bg-orange-400'}`}
                        style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-gray-500 shrink-0">{nb}/{total}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </FacturierLayout>
  );
}
