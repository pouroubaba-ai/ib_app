'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import {
  LayoutDashboard, Package, PlusCircle, ArrowUpCircle, ArrowDownCircle,
  FileText, RotateCcw, Users, Settings, LogOut, ChevronLeft, ChevronRight,
  ChevronDown, History, Sun, Moon, Ship, ClipboardList, ScrollText,
} from 'lucide-react';
import { useState, useRef, useCallback, useEffect } from 'react';

type NavChild = { label: string; href: string; icon: React.ElementType };
type NavItem =
  | { type: 'link'; label: string; href: string; icon: React.ElementType }
  | { type: 'accordion'; label: string; icon: React.ElementType; children: NavChild[] };

const nav: NavItem[] = [
  { type: 'link', label: 'Tableau de bord', href: '/dashboard', icon: LayoutDashboard },
  { type: 'link', label: 'Inventaire', href: '/inventaire', icon: Package },
  { type: 'link', label: 'Nouvelle opération', href: '/nouvelle-operation', icon: PlusCircle },
  { type: 'link', label: 'Retour', href: '/retour', icon: RotateCcw },
  { type: 'link', label: 'Importation', href: '/importation', icon: Ship },
  { type: 'link', label: 'Devis', href: '/devis', icon: ScrollText },
  {
    type: 'accordion', label: 'Historique', icon: History,
    children: [
      { label: 'Entrées', href: '/historique-entrees', icon: ArrowUpCircle },
      { label: 'Sorties', href: '/historique-sorties', icon: ArrowDownCircle },
    ],
  },
  {
    type: 'accordion', label: 'Documents', icon: FileText,
    children: [
      { label: 'Entrées', href: '/documents-entrees', icon: ArrowUpCircle },
      { label: 'Sorties', href: '/documents-sorties', icon: ArrowDownCircle },
    ],
  },
  { type: 'link', label: 'Contrôle Facturier', href: '/facturier-controle', icon: ClipboardList },
  { type: 'link', label: 'Partenaire', href: '/partenaire', icon: Users },
  { type: 'link', label: 'Paramètre', href: '/parametre', icon: Settings },
];

/* -
   Popup fixe (tooltip ou flyout accordéon)
   position: fixed → échappe à tout overflow:hidden
- */
type PopupState =
  | { kind: 'tooltip'; label: string; y: number }
  | { kind: 'flyout'; label: string; children: NavChild[]; y: number }
  | null;

function FixedPopup({ popup, pathname, onMouseEnter, onMouseLeave }: {
  popup: PopupState;
  pathname: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  if (!popup) return null;
  const LEFT = 68; // 64px sidebar + 4px gap

  if (popup.kind === 'tooltip') {
    return (
      <div
        style={{ position: 'fixed', left: LEFT, top: popup.y, transform: 'translateY(-50%)', zIndex: 9999 }}
        className="pointer-events-none"
      >
        <div className="relative bg-gray-900 dark:bg-gray-700 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
          <span className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-gray-900 dark:border-r-gray-700" />
          {popup.label}
        </div>
      </div>
    );
  }

  // flyout accordéon
  return (
    <div
      style={{ position: 'fixed', left: LEFT, top: popup.y, zIndex: 9999 }}
      className="pointer-events-auto"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl min-w-[160px] py-1.5">
        <p className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          {popup.label}
        </p>
        {popup.children.map(child => {
          const ChildIcon = child.icon;
          const active = pathname === child.href;
          return (
            <Link
              key={child.href}
              href={child.href}
              className={`flex items-center gap-2.5 px-3 py-2 text-sm font-medium transition-colors
                ${active ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
            >
              <ChildIcon size={15} className="shrink-0" />
              {child.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* -
   Accordéon (menu déplié)
- */
function AccordionItem({ item, pathname, open, onToggle }: {
  item: Extract<NavItem, { type: 'accordion' }>;
  pathname: string;
  open: boolean;
  onToggle: () => void;
}) {
  const isChildActive = item.children.some(c => pathname === c.href);
  const Icon = item.icon;
  return (
    <div>
      <button
        onClick={onToggle}
        className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
          ${isChildActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}
      >
        <Icon size={18} className="shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown size={15} className={`text-gray-400 dark:text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="ml-4 mt-0.5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
          {item.children.map(child => {
            const ChildIcon = child.icon;
            const active = pathname === child.href;
            return (
              <Link
                key={child.href}
                href={child.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                  ${active ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}
              >
                <ChildIcon size={15} className="shrink-0" />
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -
   Sidebar
- */
export default function Sidebar({ mobileOpen = false, onMobileClose = () => {} }: { mobileOpen?: boolean; onMobileClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { theme, toggle } = useTheme();

  // Fermer le drawer mobile à chaque changement de route
  useEffect(() => { onMobileClose(); }, [pathname]);

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });

  const [accordionOpen, setAccordionOpen] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem('sidebar-accordions') || '{}'); }
    catch { return {}; }
  });

  const [popup, setPopup] = useState<PopupState>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPopup = useCallback((e: React.MouseEvent, p: PopupState) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!p) return;
    setPopup({ ...p, y: p.kind === 'flyout' ? rect.top : rect.top + rect.height / 2 });
  }, []);

  const hidePopup = useCallback(() => {
    hideTimer.current = setTimeout(() => setPopup(null), 80);
  }, []);

  const keepPopup = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      if (next) setPopup(null);
      return next;
    });
  }

  function toggleAccordion(label: string) {
    setAccordionOpen(prev => {
      const next = { ...prev, [label]: !prev[label] };
      localStorage.setItem('sidebar-accordions', JSON.stringify(next));
      return next;
    });
  }

  async function handleLogout() {
    setConfirmLogout(false);
    await signOut(auth);
    router.push('/login');
  }

  const mobileNavItems = (
    <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
      {nav.map((item, i) => {
        if (item.type === 'accordion') {
          return (
            <AccordionItem
              key={i}
              item={item}
              pathname={pathname}
              open={!!accordionOpen[item.label]}
              onToggle={() => toggleAccordion(item.label)}
            />
          );
        }
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
              ${active ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}>
            <Icon size={18} className="shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* - Drawer mobile (< md) - */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onMobileClose} />
          {/* Panneau */}
          <div className="relative w-72 max-w-[85vw] flex flex-col bg-white dark:bg-gray-900 h-full shadow-2xl">
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 dark:border-gray-700">
              <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">IB APP</span>
              <button onClick={onMobileClose}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
                <ChevronLeft size={20} />
              </button>
            </div>
            {user && (
              <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                <p className="text-xs text-gray-400 truncate">{user.email}</p>
              </div>
            )}
            {mobileNavItems}
            <div className="px-2 py-3 border-t border-gray-100 dark:border-gray-700 space-y-1">
              <button onClick={toggle}
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50">
                {theme === 'dark' ? <Sun size={18} className="text-yellow-400" /> : <Moon size={18} />}
                <span>{theme === 'dark' ? 'Mode clair' : 'Mode sombre'}</span>
              </button>
              <button onClick={() => setConfirmLogout(true)}
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                <LogOut size={18} />
                <span>Se déconnecter</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* - Sidebar desktop (>= md) - */}
      <aside className={`hidden md:flex flex-col shrink-0 overflow-hidden bg-white dark:bg-gray-900
        border-r border-gray-200 dark:border-gray-700 transition-all duration-200
        ${collapsed ? 'w-16' : 'w-64'}`}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-5 border-b border-gray-100 dark:border-gray-700 min-h-[64px]">
          {!collapsed && <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">IB APP</span>}
          <button onClick={toggleCollapsed}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 ml-auto shrink-0">
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* User */}
        {!collapsed && (
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
          {nav.map((item, i) => {
            if (item.type === 'accordion') {
              if (collapsed) {
                const isChildActive = item.children.some(c => pathname === c.href);
                const Icon = item.icon;
                return (
                  <div key={i}
                    onMouseEnter={e => showPopup(e, { kind: 'flyout', label: item.label, children: item.children, y: 0 })}
                    onMouseLeave={hidePopup}>
                    <button className={`flex items-center justify-center w-full px-3 py-2.5 rounded-lg transition-colors
                      ${isChildActive ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}>
                      <Icon size={18} />
                    </button>
                  </div>
                );
              }
              return (
                <AccordionItem
                  key={i}
                  item={item}
                  pathname={pathname}
                  open={!!accordionOpen[item.label]}
                  onToggle={() => toggleAccordion(item.label)}
                />
              );
            }

            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <div key={item.href}
                onMouseEnter={collapsed ? e => showPopup(e, { kind: 'tooltip', label: item.label, y: 0 }) : undefined}
                onMouseLeave={collapsed ? hidePopup : undefined}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                    ${active ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}
                >
                  <Icon size={18} className="shrink-0" />
                  {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
                </Link>
              </div>
            );
          })}
        </nav>

        {/* Bas */}
        <div className="px-2 py-3 border-t border-gray-100 dark:border-gray-700 space-y-1">
          <div
            onMouseEnter={collapsed ? e => showPopup(e, { kind: 'tooltip', label: theme === 'dark' ? 'Mode clair' : 'Mode sombre', y: 0 }) : undefined}
            onMouseLeave={collapsed ? hidePopup : undefined}>
            <button onClick={toggle}
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium
                text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors">
              {theme === 'dark' ? <Sun size={18} className="shrink-0 text-yellow-400" /> : <Moon size={18} className="shrink-0" />}
              {!collapsed && <span className="whitespace-nowrap">{theme === 'dark' ? 'Mode clair' : 'Mode sombre'}</span>}
            </button>
          </div>

          <div
            onMouseEnter={collapsed ? e => showPopup(e, { kind: 'tooltip', label: 'Se déconnecter', y: 0 }) : undefined}
            onMouseLeave={collapsed ? hidePopup : undefined}>
            <button onClick={() => setConfirmLogout(true)}
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium
                text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <LogOut size={18} className="shrink-0" />
              {!collapsed && <span className="whitespace-nowrap">Se déconnecter</span>}
            </button>
          </div>
        </div>
      </aside>

      {/* Popup rendu EN DEHORS du aside — position:fixed, aucun overflow ne peut le couper */}
      {collapsed && (
        <FixedPopup
          popup={popup}
          pathname={pathname}
          onMouseEnter={keepPopup}
          onMouseLeave={hidePopup}
        />
      )}

      {/* Confirmation déconnexion */}
      {confirmLogout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setConfirmLogout(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-80 mx-4">
            <div className="flex flex-col items-center gap-3 mb-5">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <LogOut size={22} className="text-red-500" />
              </div>
              <p className="text-base font-bold text-gray-900 dark:text-gray-100 text-center">Se déconnecter ?</p>
              <p className="text-sm text-gray-400 text-center">Tu seras redirigé vers la page de connexion.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmLogout(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                Déconnecter
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
