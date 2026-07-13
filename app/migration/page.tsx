'use client';
import { useState } from 'react';
import {
  collection, getDocs, query, where,
  writeBatch, doc, getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AppLayout from '@/components/AppLayout';
import { CheckCircle2, AlertCircle, Play, Loader2 } from 'lucide-react';

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

  /* ── Script 1 : importations ── */
  const [runningImp, setRunningImp] = useState(false);
  const [doneImp, setDoneImp] = useState(false);
  const [logsImp, setLogsImp] = useState<LogLine[]>([]);
  const [progressImp, setProgressImp] = useState({ done: 0, total: 0 });

  /* ── Script 2 : réajustements ── */
  const [runningReaj, setRunningReaj] = useState(false);
  const [doneReaj, setDoneReaj] = useState(false);
  const [logsReaj, setLogsReaj] = useState<LogLine[]>([]);
  const [progressReaj, setProgressReaj] = useState({ done: 0, total: 0 });

  function logImp(type: LogLine['type'], msg: string) {
    setLogsImp(prev => [...prev, { type, msg }]);
  }
  function logReaj(type: LogLine['type'], msg: string) {
    setLogsReaj(prev => [...prev, { type, msg }]);
  }

  /* ──────────────────────────────────────────────────────────
     Script 1 — Corriger nomClient des mouvements d'importation
     Cherche tous les mouvements Achat dont nomClient ≠ 'Importation'
     et les met à jour.
  ────────────────────────────────────────────────────────── */
  async function corrigerImportations() {
    if (!user) return;
    setRunningImp(true);
    setLogsImp([]);
    setProgressImp({ done: 0, total: 0 });

    try {
      logImp('info', `Recherche des mouvements d'importation…`);
      const snap = await getDocs(query(
        collection(db, 'mouvements'),
        where('userId', '==', user.uid),
        where('typeTransaction', '==', 'Achat'),
      ));
      logImp('info', `${snap.size} mouvement(s) Achat trouvé(s)`);

      const aCorreger = snap.docs.filter(d => d.data().nomClient !== 'Importation');
      logImp('info', `${aCorreger.length} mouvement(s) à corriger (nomClient ≠ 'Importation')`);
      setProgressImp({ done: 0, total: aCorreger.length });

      if (aCorreger.length === 0) {
        logImp('ok', 'Rien à corriger — tout est déjà à jour !');
        setDoneImp(true);
        return;
      }

      // Traiter par batch de 500 (limite Firestore)
      const BATCH_SIZE = 400;
      let done = 0;
      for (let i = 0; i < aCorreger.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const slice = aCorreger.slice(i, i + BATCH_SIZE);
        for (const d of slice) {
          const ancien = d.data().nomClient || '(vide)';
          batch.update(doc(db, 'mouvements', d.id), { nomClient: 'Importation' });
          logImp('ok', `✓ ${d.id.slice(0, 8)}… : "${ancien}" → "Importation"`);
          done++;
        }
        await batch.commit();
        setProgressImp({ done, total: aCorreger.length });
        logImp('info', `Batch ${Math.ceil((i + BATCH_SIZE) / BATCH_SIZE)} commité`);
      }

      logImp('ok', `✅ Terminé — ${done} mouvement(s) corrigé(s)`);
      setDoneImp(true);
    } catch (e: any) {
      logImp('error', `Erreur : ${e?.message ?? String(e)}`);
    } finally {
      setRunningImp(false);
    }
  }

  /* ──────────────────────────────────────────────────────────
     Script 2 — Corriger prix des réajustements sans prix
     Cherche les mouvements Reajustement avec prixUnitaireReel == 0
     ou absent, puis recalcule depuis le produit.
  ────────────────────────────────────────────────────────── */
  async function corrigerReajustements() {
    if (!user) return;
    setRunningReaj(true);
    setLogsReaj([]);
    setProgressReaj({ done: 0, total: 0 });

    try {
      logReaj('info', `Recherche des réajustements sans prix…`);
      const snap = await getDocs(query(
        collection(db, 'mouvements'),
        where('userId', '==', user.uid),
        where('typeTransaction', '==', 'Reajustement'),
      ));
      logReaj('info', `${snap.size} réajustement(s) trouvé(s) au total`);

      const aCorreger = snap.docs.filter(d => {
        const prix = d.data().prixUnitaireReel;
        return !prix || prix === 0;
      });
      logReaj('info', `${aCorreger.length} réajustement(s) sans prix à corriger`);
      setProgressReaj({ done: 0, total: aCorreger.length });

      if (aCorreger.length === 0) {
        logReaj('ok', 'Rien à corriger — tous les réajustements ont un prix !');
        setDoneReaj(true);
        return;
      }

      const BATCH_SIZE = 400;
      let done = 0;
      let erreurs = 0;

      for (let i = 0; i < aCorreger.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const slice = aCorreger.slice(i, i + BATCH_SIZE);

        for (const d of slice) {
          const data = d.data();
          const produitRef = data.produitId; // DocumentReference Firestore

          if (!produitRef) {
            logReaj('skip', `⚠ ${d.id.slice(0, 8)}… : pas de produitId, ignoré`);
            erreurs++;
            done++;
            continue;
          }

          try {
            const prodSnap = await getDoc(produitRef);
            if (!prodSnap.exists()) {
              logReaj('skip', `⚠ ${d.id.slice(0, 8)}… : produit introuvable, ignoré`);
              erreurs++;
              done++;
              continue;
            }

            const prod = prodSnap.data();
            const prixUnitaire: number = prod.prix_unitaire || 0;
            const qpe: number = prod.quantite_par_emballage || 1;
            const typeUnite: string = data.typeUnite || 'U';
            const quantite: number = data.quantite || 0;

            // Prix par unité toujours stocké tel quel
            const prixUnitaireReel = prixUnitaire;
            // Total : si C → quantite cartons × prix unitaire × unités/carton
            //         si U → quantite unités × prix unitaire
            const totalLigne = typeUnite === 'C'
              ? quantite * prixUnitaire * qpe
              : quantite * prixUnitaire;

            batch.update(doc(db, 'mouvements', d.id), {
              prixUnitaireReel,
              totalLigne,
            });

            logReaj('ok',
              `✓ ${prod.designation || d.id.slice(0, 8)}… : ` +
              `${quantite}${typeUnite} × ${prixUnitaire.toLocaleString('fr-FR')} ` +
              `= ${totalLigne.toLocaleString('fr-FR')} FCFA`,
            );
          } catch (e: any) {
            logReaj('error', `✗ ${d.id.slice(0, 8)}… : ${e?.message}`);
            erreurs++;
          }

          done++;
          setProgressReaj({ done, total: aCorreger.length });
        }

        await batch.commit();
        logReaj('info', `Batch ${Math.ceil((i + BATCH_SIZE) / BATCH_SIZE)} commité`);
      }

      logReaj('ok', `✅ Terminé — ${done - erreurs} corrigé(s), ${erreurs} ignoré(s)`);
      setDoneReaj(true);
    } catch (e: any) {
      logReaj('error', `Erreur : ${e?.message ?? String(e)}`);
    } finally {
      setRunningReaj(false);
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

        {/* ── Script 1 ── */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5 mb-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="font-bold text-gray-900 dark:text-gray-100">Script 1 — Importations</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Corrige le champ <span className="font-mono">nomClient</span> des mouvements d'achat
                (ex : "Conteneur 1" → "Importation")
              </p>
            </div>
            {doneImp && <CheckCircle2 size={20} className="text-green-500 shrink-0" />}
          </div>

          {progressImp.total > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${Math.round((progressImp.done / progressImp.total) * 100)}%` }} />
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {progressImp.done}/{progressImp.total}
              </span>
            </div>
          )}

          <LogPanel lines={logsImp} />

          <button onClick={corrigerImportations}
            disabled={runningImp || doneImp}
            className="mt-3 w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors">
            {runningImp
              ? <><Loader2 size={16} className="animate-spin" /> En cours…</>
              : doneImp
                ? <><CheckCircle2 size={16} /> Terminé</>
                : <><Play size={16} /> Lancer le script</>}
          </button>
        </div>

        {/* ── Script 2 ── */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="font-bold text-gray-900 dark:text-gray-100">Script 2 — Réajustements</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Recalcule <span className="font-mono">prixUnitaireReel</span> et{' '}
                <span className="font-mono">totalLigne</span> pour les réajustements
                sans prix, en lisant le prix actuel du produit
              </p>
            </div>
            {doneReaj && <CheckCircle2 size={20} className="text-green-500 shrink-0" />}
          </div>

          <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900/30 rounded-xl p-3 mb-3 flex gap-2">
            <AlertCircle size={15} className="text-orange-500 shrink-0 mt-0.5" />
            <p className="text-xs text-orange-700 dark:text-orange-300">
              Ce script utilise le prix <strong>actuel</strong> du produit dans l'inventaire.
              Si le prix a changé depuis le réajustement, la valeur historique sera mise à jour
              avec le prix d'aujourd'hui.
            </p>
          </div>

          {progressReaj.total > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${Math.round((progressReaj.done / progressReaj.total) * 100)}%` }} />
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {progressReaj.done}/{progressReaj.total}
              </span>
            </div>
          )}

          <LogPanel lines={logsReaj} />

          <button onClick={corrigerReajustements}
            disabled={runningReaj || doneReaj}
            className="mt-3 w-full py-3 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors">
            {runningReaj
              ? <><Loader2 size={16} className="animate-spin" /> En cours…</>
              : doneReaj
                ? <><CheckCircle2 size={16} /> Terminé</>
                : <><Play size={16} /> Lancer le script</>}
          </button>
        </div>
      </div>
    </AppLayout>
  );
}
