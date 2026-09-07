'use client';
import { useEffect, useState, useMemo } from 'react';
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { formatMontant } from '@/lib/format';
import {
  Plus, X, Search, Eye, Trash2, Pencil, Loader2,
  Tag, ChevronDown,
} from 'lucide-react';

type Role = 'fournisseur' | 'client';
type Vue = 'fournisseurs' | 'clients';

interface Categorie {
  id: string;
  nom: string;
  role: Role;
  nbPartenaires: number;
}

interface Partenaire {
  id: string;
  nom: string;
  contact?: string;
  rolesFournisseur: boolean;
  rolesClient: boolean;
  categoriesFournisseur: string[];  // ids
  categoriesClient: string[];       // ids
  dette: number;
  creance: number;
  prochainRecouvrement?: string | null;
}

interface Props {
  siteId: string;
  userId: string;
}

function statutFournisseur(dette: number) {
  if (dette <= 0) return { label: 'Soldé', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
  return { label: 'Partiel', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
}
function statutClient(creance: number) {
  if (creance <= 0) return { label: 'Soldé', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
  return { label: 'Partiel', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
}

export default function OngletPartenaires({ siteId, userId }: Props) {
  const [vue, setVue] = useState<Vue>('clients');
  const [partenaires, setPartenaires] = useState<Partenaire[]>([]);
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  /* - Modal nouveau partenaire - */
  const [showModalPartenaire, setShowModalPartenaire] = useState(false);
  const [nom, setNom] = useState('');
  const [contact, setContact] = useState('');
  const [rolesFournisseur, setRolesFournisseur] = useState(false);
  const [rolesClient, setRolesClient] = useState(false);
  const [catsFournisseurSel, setCatsFournisseurSel] = useState<string[]>([]);
  const [catsClientSel, setCatsClientSel] = useState<string[]>([]);
  const [showDropdownF, setShowDropdownF] = useState(false);
  const [showDropdownC, setShowDropdownC] = useState(false);
  const [searchCatF, setSearchCatF] = useState('');
  const [searchCatC, setSearchCatC] = useState('');
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');

  /* - Modal catégories - */
  const [showModalCats, setShowModalCats] = useState(false);
  const [roleCats, setRoleCats] = useState<Role>('fournisseur');
  const [nouvelleCategorie, setNouvelleCategorie] = useState('');
  const [savingCat, setSavingCat] = useState(false);

  useEffect(() => { fetchAll(); }, [siteId]);

  async function fetchAll() {
    setLoading(true);
    const [partSnap, catSnap] = await Promise.all([
      getDocs(query(collection(db, 'partenaires'), where('siteId', '==', siteId), where('userId', '==', userId))),
      getDocs(query(collection(db, 'categories_partenaire'), where('siteId', '==', siteId), where('userId', '==', userId))),
    ]);
    const cats = catSnap.docs.map(d => ({ id: d.id, ...d.data() } as Categorie));
    const parts = partSnap.docs.map(d => ({ id: d.id, ...d.data() } as Partenaire));
    // Calculer nbPartenaires par catégorie
    const catsAvecNb = cats.map(c => ({
      ...c,
      nbPartenaires: parts.filter(p =>
        (c.role === 'fournisseur' ? p.categoriesFournisseur : p.categoriesClient)?.includes(c.id)
      ).length,
    }));
    setCategories(catsAvecNb);
    setPartenaires(parts);
    setLoading(false);
  }

  const filtrés = useMemo(() => {
    const q = search.toLowerCase();
    return partenaires.filter(p => {
      const matchVue = vue === 'fournisseurs' ? p.rolesFournisseur : p.rolesClient;
      const matchSearch = !q || p.nom.toLowerCase().includes(q);
      return matchVue && matchSearch;
    });
  }, [partenaires, vue, search]);

  const totalDette = partenaires.filter(p => p.rolesFournisseur).reduce((s, p) => s + (p.dette || 0), 0);
  const totalCreance = partenaires.filter(p => p.rolesClient).reduce((s, p) => s + (p.creance || 0), 0);
  const recouvrementAujourdhui = partenaires.filter(p => {
    if (!p.prochainRecouvrement) return false;
    return new Date(p.prochainRecouvrement).toDateString() === new Date().toDateString();
  }).length;

  function ouvrirModalPartenaire() {
    setNom(''); setContact(''); setRolesFournisseur(false); setRolesClient(false);
    setCatsFournisseurSel([]); setCatsClientSel([]); setErreur('');
    setShowModalPartenaire(true);
  }

  async function ajouterPartenaire() {
    if (!nom.trim()) { setErreur('Nom requis.'); return; }
    if (!rolesFournisseur && !rolesClient) { setErreur('Sélectionnez au moins un rôle.'); return; }
    setSaving(true); setErreur('');
    try {
      await addDoc(collection(db, 'partenaires'), {
        userId,
        siteId,
        nom: nom.trim(),
        contact: contact.trim(),
        rolesFournisseur,
        rolesClient,
        categoriesFournisseur: catsFournisseurSel,
        categoriesClient: catsClientSel,
        dette: 0,
        creance: 0,
        prochainRecouvrement: null,
        createdAt: serverTimestamp(),
      });
      setShowModalPartenaire(false);
      fetchAll();
    } catch (e: any) {
      setErreur(e?.message ?? 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  async function ajouterCategorie() {
    if (!nouvelleCategorie.trim()) return;
    setSavingCat(true);
    try {
      await addDoc(collection(db, 'categories_partenaire'), {
        userId, siteId,
        nom: nouvelleCategorie.trim(),
        role: roleCats,
        nbPartenaires: 0,
        createdAt: serverTimestamp(),
      });
      setNouvelleCategorie('');
      fetchAll();
    } finally {
      setSavingCat(false);
    }
  }

  async function supprimerCategorie(id: string) {
    await deleteDoc(doc(db, 'categories_partenaire', id));
    fetchAll();
  }

  const catsFournisseur = categories.filter(c => c.role === 'fournisseur');
  const catsClient = categories.filter(c => c.role === 'client');

  function toggleCat(role: 'f' | 'c', id: string) {
    if (role === 'f') {
      setCatsFournisseurSel(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    } else {
      setCatsClientSel(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }
  }

  function nomCat(id: string) {
    return categories.find(c => c.id === id)?.nom ?? id;
  }

  if (loading) return (
    <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-indigo-500" /></div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {/* Toggle Fournisseurs / Clients */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
            {(['clients', 'fournisseurs'] as Vue[]).map(v => (
              <button key={v} onClick={() => setVue(v)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all
                  ${vue === v
                    ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-gray-400 dark:text-gray-500'}`}>
                {v === 'fournisseurs' ? 'Fournisseurs' : 'Clients'}
              </button>
            ))}
          </div>
          {recouvrementAujourdhui > 0 && (
            <span className="flex items-center gap-1 px-3 py-1.5 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl text-xs font-medium text-orange-600 dark:text-orange-400">
              Recouvrement du jour ({recouvrementAujourdhui})
            </span>
          )}
        </div>
        <button onClick={ouvrirModalPartenaire}
          className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors">
          <Plus size={15} /> Nouveau partenaire
        </button>
      </div>

      {/* Barre résumé */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-4 mb-4">
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-xs font-bold uppercase text-gray-900 dark:text-gray-100">
              {vue === 'fournisseurs' ? 'Dettes à régler' : 'Créances à recouvrer'}
            </p>
            <p className={`text-2xl font-bold mt-0.5 ${vue === 'fournisseurs' ? 'text-red-600' : 'text-orange-500'}`}>
              {formatMontant(vue === 'fournisseurs' ? totalDette : totalCreance)}
            </p>
          </div>
          <span className="text-xs text-gray-400 uppercase">{vue === 'fournisseurs' ? 'Achat' : 'Vente'}</span>
        </div>
        <div className={`h-1.5 rounded-full mt-3 ${vue === 'fournisseurs' ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: '60%' }} />
      </div>

      {/* Recherche */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text" placeholder="Rechercher un partenaire par nom ou catégorie…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Tableau */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <p className="text-sm font-medium text-gray-500">{filtrés.length} {vue === 'fournisseurs' ? 'fournisseur' : 'client'}{filtrés.length > 1 ? 's' : ''}</p>
        </div>

        {filtrés.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">Aucun résultat</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-indigo-600 text-white">
                <th className="text-left px-4 py-3 font-medium">{vue === 'fournisseurs' ? 'Fournisseur' : 'Client'}</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">{vue === 'fournisseurs' ? 'Dette' : 'Créance'}</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Dernier versement</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Prochain recouvrement</th>
                <th className="text-left px-4 py-3 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {filtrés.map(p => {
                const montant = vue === 'fournisseurs' ? p.dette : p.creance;
                const statut = vue === 'fournisseurs' ? statutFournisseur(p.dette) : statutClient(p.creance);
                return (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{p.nom}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-gray-700 dark:text-gray-300">{formatMontant(montant)}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-400">—</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-400">
                      {p.prochainRecouvrement
                        ? <span>{new Date(p.prochainRecouvrement).toLocaleDateString('fr-FR')}</span>
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${statut.color}`}>
                        {statut.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal nouveau partenaire */}
      {showModalPartenaire && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md shadow-xl p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Nouveau partenaire</h2>
                <p className="text-xs text-gray-400 mt-0.5">Peut être fournisseur, client, ou les deux à la fois</p>
              </div>
              <button onClick={() => setShowModalPartenaire(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={18} />
              </button>
            </div>

            {/* Nom */}
            <p className="text-xs font-bold text-gray-400 uppercase mb-1">Nom</p>
            <input type="text" placeholder="Ex. Électro Import SARL" value={nom}
              onChange={e => setNom(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            {/* Rôle */}
            <p className="text-xs font-bold text-gray-400 uppercase mb-2">Rôle</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button onClick={() => setRolesFournisseur(v => !v)}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all
                  ${rolesFournisseur
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-400 text-gray-900 dark:text-gray-100'
                    : 'border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100'}`}>
                {rolesFournisseur && <span className="text-indigo-600">✓</span>} Fournisseur
              </button>
              <button onClick={() => setRolesClient(v => !v)}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all
                  ${rolesClient
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-400 text-gray-900 dark:text-gray-100'
                    : 'border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100'}`}>
                {rolesClient && <span className="text-indigo-600">✓</span>} Client
              </button>
            </div>

            {/* Catégories fournisseur */}
            {rolesFournisseur && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-bold text-gray-400 uppercase">Catégories fournisseur</p>
                  <button onClick={() => { setRoleCats('fournisseur'); setShowModalCats(true); }}
                    className="text-xs text-indigo-500 flex items-center gap-1 hover:text-indigo-700">
                    <Eye size={12} /> Voir
                  </button>
                </div>
                <div className="relative">
                  <div className="min-h-[40px] px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-wrap gap-1 cursor-pointer"
                    onClick={() => setShowDropdownF(v => !v)}>
                    {catsFournisseurSel.length === 0
                      ? <span className="text-sm text-gray-400">Aucune catégorie</span>
                      : catsFournisseurSel.map(id => (
                        <span key={id} className="bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs px-2 py-0.5 rounded-full">{nomCat(id)}</span>
                      ))
                    }
                  </div>
                  {showDropdownF && (
                    <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg">
                      <div className="p-2 border-b border-gray-100 dark:border-gray-800">
                        <input type="text" placeholder="Rechercher une catégorie…" value={searchCatF}
                          onChange={e => setSearchCatF(e.target.value)}
                          className="w-full px-2 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-lg focus:outline-none"
                        />
                      </div>
                      <div className="max-h-40 overflow-y-auto p-1">
                        {catsFournisseur.filter(c => c.nom.toLowerCase().includes(searchCatF.toLowerCase())).map(c => (
                          <label key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                            <input type="checkbox" checked={catsFournisseurSel.includes(c.id)}
                              onChange={() => toggleCat('f', c.id)} className="accent-indigo-600" />
                            <span className="text-sm text-gray-700 dark:text-gray-300">{c.nom}</span>
                          </label>
                        ))}
                        {catsFournisseur.length === 0 && <p className="text-xs text-gray-400 px-3 py-2">Aucune catégorie — créez-en via "Voir"</p>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Catégories client */}
            {rolesClient && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-bold text-gray-400 uppercase">Catégories client</p>
                  <button onClick={() => { setRoleCats('client'); setShowModalCats(true); }}
                    className="text-xs text-indigo-500 flex items-center gap-1 hover:text-indigo-700">
                    <Eye size={12} /> Voir
                  </button>
                </div>
                <div className="relative">
                  <div className="min-h-[40px] px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-wrap gap-1 cursor-pointer"
                    onClick={() => setShowDropdownC(v => !v)}>
                    {catsClientSel.length === 0
                      ? <span className="text-sm text-gray-400">Aucune catégorie</span>
                      : catsClientSel.map(id => (
                        <span key={id} className="bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs px-2 py-0.5 rounded-full">{nomCat(id)}</span>
                      ))
                    }
                  </div>
                  {showDropdownC && (
                    <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg">
                      <div className="p-2 border-b border-gray-100 dark:border-gray-800">
                        <input type="text" placeholder="Rechercher une catégorie…" value={searchCatC}
                          onChange={e => setSearchCatC(e.target.value)}
                          className="w-full px-2 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 rounded-lg focus:outline-none"
                        />
                      </div>
                      <div className="max-h-40 overflow-y-auto p-1">
                        {catsClient.filter(c => c.nom.toLowerCase().includes(searchCatC.toLowerCase())).map(c => (
                          <label key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                            <input type="checkbox" checked={catsClientSel.includes(c.id)}
                              onChange={() => toggleCat('c', c.id)} className="accent-indigo-600" />
                            <span className="text-sm text-gray-700 dark:text-gray-300">{c.nom}</span>
                          </label>
                        ))}
                        {catsClient.length === 0 && <p className="text-xs text-gray-400 px-3 py-2">Aucune catégorie — créez-en via "Voir"</p>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Contact */}
            <p className="text-xs font-bold text-gray-400 uppercase mb-1">Contact</p>
            <input type="tel" placeholder="Ex. +225 07 12 34 56 78" value={contact}
              onChange={e => setContact(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            {erreur && <p className="text-red-500 text-xs mb-3">{erreur}</p>}

            <div className="flex gap-3">
              <button onClick={() => setShowModalPartenaire(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-500">
                Annuler
              </button>
              <button onClick={ajouterPartenaire} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors">
                {saving ? <Loader2 size={15} className="animate-spin" /> : null} Ajouter le partenaire
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal catégories */}
      {showModalCats && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-sm shadow-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg flex items-center justify-center">
                  <Tag size={15} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    Catégories {roleCats === 'fournisseur' ? 'fournisseur' : 'client'}
                  </h2>
                </div>
              </div>
              <button onClick={() => setShowModalCats(false)} className="text-gray-400 hover:text-gray-600 p-1"><X size={16} /></button>
            </div>

            {/* Nouvelle catégorie */}
            <div className="flex gap-2 mb-4">
              <input type="text" placeholder="Nouvelle catégorie…" value={nouvelleCategorie}
                onChange={e => setNouvelleCategorie(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && ajouterCategorie()}
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button onClick={ajouterCategorie} disabled={savingCat || !nouvelleCategorie.trim()}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold rounded-xl flex items-center gap-1 transition-colors">
                <Plus size={14} /> Ajouter
              </button>
            </div>

            {/* Tableau */}
            <div className="rounded-xl overflow-hidden border border-gray-100 dark:border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-indigo-600 text-white">
                    <th className="text-left px-3 py-2 font-medium">Catégorie</th>
                    <th className="text-left px-3 py-2 font-medium">Partenaires</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {categories.filter(c => c.role === roleCats).map(c => (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100">{c.nom}</td>
                      <td className="px-3 py-2.5 text-gray-500">{c.nbPartenaires}</td>
                      <td className="px-3 py-2.5 flex items-center gap-2 justify-end">
                        <button className="text-gray-400 hover:text-gray-600 p-1"><Pencil size={13} /></button>
                        <button onClick={() => supprimerCategorie(c.id)} className="text-gray-400 hover:text-red-500 p-1"><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                  {categories.filter(c => c.role === roleCats).length === 0 && (
                    <tr><td colSpan={3} className="px-3 py-4 text-center text-gray-400 text-xs">Aucune catégorie</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <button onClick={() => setShowModalCats(false)}
              className="mt-4 w-full py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Overlay dropdowns */}
      {(showDropdownF || showDropdownC) && (
        <div className="fixed inset-0 z-10" onClick={() => { setShowDropdownF(false); setShowDropdownC(false); }} />
      )}
    </div>
  );
}
