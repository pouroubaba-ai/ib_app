'use client';
import { useState } from 'react';
import { Calendar } from 'lucide-react';

export interface PlageDates {
  debut: Date | null;  // null = pas de limite
  fin: Date | null;
}

interface Props {
  onChange: (plage: PlageDates) => void;
  defaut?: Raccourci;
}

type Raccourci = 'tout' | 'aujourdhui' | 'semaine' | 'mois' | 'annee' | 'custom';

function debutJour(d: Date) {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
function finJour(d: Date) {
  const r = new Date(d); r.setHours(23, 59, 59, 999); return r;
}

export default function FiltreDates({ onChange, defaut = 'annee' }: Props) {
  const [actif, setActif] = useState<Raccourci>(defaut);
  const [showCustom, setShowCustom] = useState(false);
  const [debutStr, setDebutStr] = useState('');
  const [finStr, setFinStr] = useState('');

  function select(r: Raccourci) {
    setActif(r);
    setShowCustom(r === 'custom');
    const now = new Date();
    if (r === 'tout') {
      onChange({ debut: null, fin: null });
    } else if (r === 'aujourdhui') {
      onChange({ debut: debutJour(now), fin: finJour(now) });
    } else if (r === 'semaine') {
      const lundi = new Date(now);
      lundi.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      onChange({ debut: debutJour(lundi), fin: finJour(now) });
    } else if (r === 'mois') {
      onChange({ debut: new Date(now.getFullYear(), now.getMonth(), 1), fin: finJour(now) });
    } else if (r === 'annee') {
      onChange({ debut: new Date(now.getFullYear(), 0, 1), fin: finJour(now) });
    }
  }

  function applyCustom() {
    if (!debutStr || !finStr) return;
    const debut = new Date(debutStr); debut.setHours(0, 0, 0, 0);
    const fin = new Date(finStr); fin.setHours(23, 59, 59, 999);
    onChange({ debut, fin });
  }

  const raccourcis: { key: Raccourci; label: string }[] = [
    { key: 'tout', label: 'Tout' },
    { key: 'aujourdhui', label: "Aujourd'hui" },
    { key: 'semaine', label: 'Cette semaine' },
    { key: 'mois', label: 'Ce mois' },
    { key: 'annee', label: 'Cette année' },
    { key: 'custom', label: 'Personnalisé' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {raccourcis.map(r => (
        <button
          key={r.key}
          onClick={() => select(r.key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
            ${actif === r.key ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          {r.key === 'custom' && <Calendar size={13} />}
          {r.label}
        </button>
      ))}

      {showCustom && (
        <div className="flex flex-wrap items-center gap-2 mt-2 w-full sm:w-auto sm:mt-0">
          <input
            type="date"
            value={debutStr}
            onChange={e => setDebutStr(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-gray-400 text-sm">→</span>
          <input
            type="date"
            value={finStr}
            onChange={e => setFinStr(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={applyCustom}
            disabled={!debutStr || !finStr}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-indigo-700 transition-colors"
          >
            Appliquer
          </button>
        </div>
      )}
    </div>
  );
}
