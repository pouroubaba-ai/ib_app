'use client';
import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import FacturierLayout from '@/components/FacturierLayout';
import { Users, ChevronRight, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Client {
  id: string;
  nom: string;
  telephone?: string;
  type: string;
}

export default function FacturierClientsPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [recherche, setRecherche] = useState('');

  useEffect(() => {
    if (!profile) return;
    async function load() {
      const snap = await getDocs(query(
        collection(db, 'Partenaire'),
        where('userId', '==', profile!.adminUid),
      ));
      const data: Client[] = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Client))
        .filter(c => c.type !== 'importation');
      data.sort((a, b) => a.nom.localeCompare(b.nom));
      setClients(data);
      setLoading(false);
    }
    load();
  }, [profile]);

  const filtered = useMemo(() => {
    if (!recherche) return clients;
    const q = recherche.toLowerCase();
    return clients.filter(c => c.nom.toLowerCase().includes(q));
  }, [clients, recherche]);

  return (
    <FacturierLayout>
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-gray-900 text-lg">Clients</p>
          <p className="text-xs text-gray-400">{filtered.length} client(s)</p>
        </div>

        <div className="relative mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={recherche} onChange={e => setRecherche(e.target.value)}
            placeholder="Rechercher un client..."
            className="w-full pl-9 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
          {recherche && (
            <button onClick={() => setRecherche('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              <X size={14} />
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Users size={40} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">Aucun client</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(c => (
              <div key={c.id} onClick={() => router.push(`/partenaire/${c.id}`)}
                className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 cursor-pointer active:bg-gray-50 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{c.nom}</p>
                  {c.telephone && <p className="text-xs text-gray-400 mt-0.5">{c.telephone}</p>}
                  <p className="text-xs text-gray-300 mt-0.5 capitalize">{c.type}</p>
                </div>
                <ChevronRight size={15} className="text-gray-300" />
              </div>
            ))}
          </div>
        )}
      </div>
    </FacturierLayout>
  );
}
