'use client';
import { useState } from 'react';
import {
  collection, getDocs, query, where,
  writeBatch, doc, getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { CheckCircle2, Play, Loader2 } from 'lucide-react';

interface LogLine {
  type: 'info' | 'ok' | 'skip' | 'error';
  msg: string;
}

function LogPanel({ lines }: { lines: LogLine[] }) {
  const colors: Record<string, string> = {
    info: 'text-gray-400',
    ok: 'text-green-500',
    skip: 'text-gray-500',
    error: 'text-red-500',
  };
  return (
    <div className="bg-gray-950 rounded-xl p-4 h-64 overflow-y-auto font-mono text-xs space-y-0.5">
      {lines.length === 0
        ? <p className="text-gray-600">En attente…</p>
        : lines.map((l, i) => (
          <p key={i} className={colors[l.type]}>{l.msg}</p>
        ))
      }
    </div>
  );
}

export default function MigrationPage() {
  const { user } = useAuth();

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  function log(type: LogLine['type'], msg: string) {
    setLogs(prev => [...prev, { type, msg }]);
  }

  /* -
     Script — Corriger nomClient manquant sur les mouvements Sortie issus de devis
     Pour chaque mouvement Sortie sans nomClient, lit le document_stock lié
     via documentId et récupère clientNom.
  - */
  async function corrigerNomClient() {
    if (!user) return;
    setRunning(true);
    setLogs([]);
    setProgress({ done: 0, total: 0 });

    try {
      log('info', 'Recherche des mouvements Sortie sans nomClient…');
      const snap = await getDocs(query(
        collection(db, 'mouvements'),
        where('userId', '==', user.uid),
        where('typeTransaction', '==', 'Sortie'),
      ));
      log('info', `${snap.size} mouvement(s) Sortie trouvé(s) au total`);

      const aCorreger = snap.docs.filter(d => !d.data().nomClient);
      log('info', `${aCorreger.length} mouvement(s) sans nomClient à corriger`);
      setProgress({ done: 0, total: aCorreger.length });

      if (aCorreger.length === 0) {
        log('ok', 'Rien à corriger — tous les mouvements ont déjà nomClient !');
        setDone(true);
        return;
      }

      const BATCH_SIZE = 400;
      let doneCnt = 0;
      let erreurs = 0;

      for (let i = 0; i < aCorreger.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const slice = aCorreger.slice(i, i + BATCH_SIZE);

        for (const d of slice) {
          const data = d.data();
          const documentRef = data.documentId; // DocumentReference vers documents_stock

          if (!documentRef) {
            log('skip', `⚠ ${d.id.slice(0, 8)}… : pas de documentId, ignoré`);
            erreurs++;
            doneCnt++;
            setProgress({ done: doneCnt, total: aCorreger.length });
            continue;
          }

          try {
            const docSnap = await getDoc(documentRef);
            if (!docSnap.exists()) {
              log('skip', `⚠ ${d.id.slice(0, 8)}… : document_stock introuvable, ignoré`);
              erreurs++;
              doneCnt++;
              setProgress({ done: doneCnt, total: aCorreger.length });
              continue;
            }

            const clientNom: string = (docSnap.data() as any).clientNom || '';
            if (!clientNom) {
              log('skip', `⚠ ${d.id.slice(0, 8)}… : clientNom vide dans le document, ignoré`);
              erreurs++;
              doneCnt++;
              setProgress({ done: doneCnt, total: aCorreger.length });
              continue;
            }

            batch.update(doc(db, 'mouvements', d.id), { nomClient: clientNom });
            log('ok', `✓ ${data.produitNom || d.id.slice(0, 8)}… → "${clientNom}"`);
          } catch (e: any) {
            log('error', `✗ ${d.id.slice(0, 8)}… : ${e?.message}`);
            erreurs++;
          }

          doneCnt++;
          setProgress({ done: doneCnt, total: aCorreger.length });
        }

        await batch.commit();
        log('info', `Batch ${Math.ceil((i + BATCH_SIZE) / BATCH_SIZE)} commité`);
      }

      log('ok', `✅ Terminé — ${doneCnt - erreurs} corrigé(s), ${erreurs} ignoré(s)`);
      setDone(true);
    } catch (e: any) {
      log('error', `Erreur : ${e?.message ?? String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Migration des données</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Scripts de correction sur le compte <span className="font-mono">{user?.uid?.slice(0, 12)}…</span>
          </p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="font-bold text-gray-900 dark:text-gray-100">Corriger nomClient — Mouvements Devis</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Ajoute <span className="font-mono">nomClient</span> sur les mouvements Sortie
                issus de confirmations de devis, en lisant le <span className="font-mono">clientNom</span> du document lié
              </p>
            </div>
            {done && <CheckCircle2 size={20} className="text-green-500 shrink-0" />}
          </div>

          {progress.total > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 rounded-full transition-all"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {progress.done}/{progress.total}
              </span>
            </div>
          )}

          <LogPanel lines={logs} />

          <button onClick={corrigerNomClient}
            disabled={running || done}
            className="mt-3 w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors">
            {running
              ? <><Loader2 size={16} className="animate-spin" /> En cours…</>
              : done
                ? <><CheckCircle2 size={16} /> Terminé</>
                : <><Play size={16} /> Lancer le script</>}
          </button>
        </div>
      </div>
    </AppLayout>
  );
}
