"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import {
  Bell,
  Bot,
  Building2,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  CreditCard,
  FileChartColumn,
  FileText,
  Globe2,
  LayoutDashboard,
  Menu,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  Search,
  Settings,
  Sparkles,
  Sun,
  Users,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { localeLabels, locales, messages, type Locale } from "@/i18n/messages";
import { saveUserPreferences } from "@/app/settings/actions";
import { LogoutButton } from "@/database/components/auth/logout-button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Theme = "light" | "dark" | "system";
type Icon = typeof LayoutDashboard;

interface AppShellProps {
  children: ReactNode;
  pageTitle?: string;
  userName?: string;
  initialLocale?: Locale;
  initialTheme?: Theme;
}

const navigation: { group: keyof typeof messages.fr.groups; items: { key: keyof typeof messages.fr.nav; href: string; icon: Icon }[] }[] = [
  { group: "main", items: [{ key: "home", href: "/dashboard", icon: LayoutDashboard }] },
  { group: "finance", items: [{ key: "finance", href: "/finance", icon: WalletCards }, { key: "invoices", href: "/invoices", icon: ReceiptText }, { key: "expenses", href: "/expenses", icon: CreditCard }, { key: "revenue", href: "/revenue", icon: WalletCards }, { key: "dueDates", href: "/due-dates", icon: CalendarClock }] },
  { group: "company", items: [{ key: "documents", href: "/documents", icon: FileText }, { key: "customers", href: "/clients", icon: Users }, { key: "suppliers", href: "/suppliers", icon: Building2 }, { key: "team", href: "/team", icon: Users }] },
  { group: "intelligence", items: [{ key: "analytics", href: "/analytics", icon: FileChartColumn }, { key: "assistant", href: "/ai", icon: Bot }, { key: "aiCfo", href: "/ai-cfo", icon: Sparkles }, { key: "automations", href: "/automations", icon: Zap }] },
  { group: "system", items: [{ key: "settings", href: "/settings", icon: Settings }] },
];

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return (localStorage.getItem("ai-finance-theme") as Theme | null) ?? "light";
}

function getInitialLocale(): Locale {
  if (typeof window === "undefined") return "fr";
  const stored = localStorage.getItem("ai-finance-locale") as Locale | null;
  return stored && locales.includes(stored) ? stored : "fr";
}

export function AppShell({ children, pageTitle, userName = "Mon compte", initialLocale, initialTheme }: AppShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [locale, setLocale] = useState<Locale>(initialLocale ?? getInitialLocale);
  const [theme, setTheme] = useState<Theme>(initialTheme ?? getInitialTheme);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [isSavingPreference, startSavingPreference] = useTransition();
  const [activeUserName, setActiveUserName] = useState(userName);
  const copy = messages[locale];
  const userInitials = userName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("") || "M";

  useEffect(() => {
    localStorage.setItem("ai-finance-theme", theme);
    const resolved = theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
    document.documentElement.dataset.theme = resolved;
  }, [theme]);

  useEffect(() => {
    const onLocaleChange = (event: Event) => {
      const nextLocale = (event as CustomEvent<Locale>).detail;
      if (locales.includes(nextLocale)) setLocale(nextLocale);
    };
    const onPreferencesChange = (event: Event) => {
      const preferences = (event as CustomEvent<{ locale: Locale; theme: Theme }>).detail;
      if (!preferences || !locales.includes(preferences.locale) || !["light", "dark", "system"].includes(preferences.theme)) return;
      setLocale(preferences.locale);
      setTheme(preferences.theme);
    };
    const onProfileChange = (event: Event) => {
      const fullName = (event as CustomEvent<string>).detail;
      if (typeof fullName === "string" && fullName.trim()) setActiveUserName(fullName.trim());
    };
    window.addEventListener("ai-finance-locale-change", onLocaleChange);
    window.addEventListener("ai-finance-preferences-change", onPreferencesChange);
    window.addEventListener("ai-finance-profile-change", onProfileChange);
    return () => {
      window.removeEventListener("ai-finance-locale-change", onLocaleChange);
      window.removeEventListener("ai-finance-preferences-change", onPreferencesChange);
      window.removeEventListener("ai-finance-profile-change", onProfileChange);
    };
  }, []);

  useEffect(() => {
    async function loadAccountPreferences() {
      const { data, error } = await createSupabaseBrowserClient().auth.getUser();
      if (error) {
        setPreferenceError("Les préférences du compte n’ont pas pu être chargées. Les préférences locales restent actives.");
        return;
      }
      if (!data.user) return;
      const metadata = data.user.user_metadata;
      const storedPreferences = metadata.ai_finance_preferences;
      const nextLocale = storedPreferences?.locale;
      const nextTheme = storedPreferences?.theme;
      const fullName = metadata.full_name;
      if (typeof fullName === "string" && fullName.trim()) setActiveUserName(fullName.trim());
      if (!locales.includes(nextLocale) || !["light", "dark", "system"].includes(nextTheme)) return;
      setLocale(nextLocale);
      setTheme(nextTheme);
      localStorage.setItem("ai-finance-locale", nextLocale);
      localStorage.setItem("ai-finance-theme", nextTheme);
      document.documentElement.lang = nextLocale;
      window.dispatchEvent(new CustomEvent("ai-finance-preferences-change", { detail: { locale: nextLocale, theme: nextTheme } }));
    }
    void loadAccountPreferences();
  }, []);

  const currentTitle = useMemo(() => pageTitle ?? navigation.flatMap((group) => group.items).find((item) => pathname === item.href)?.key ?? "home", [pageTitle, pathname]);

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    localStorage.setItem("ai-finance-locale", nextLocale);
    window.dispatchEvent(new CustomEvent("ai-finance-locale-change", { detail: nextLocale }));
    persistPreferences(nextLocale, theme);
  }

  function changeTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    localStorage.setItem("ai-finance-theme", nextTheme);
    window.dispatchEvent(new CustomEvent("ai-finance-preferences-change", { detail: { locale, theme: nextTheme } }));
    persistPreferences(locale, nextTheme);
  }

  function persistPreferences(nextLocale: Locale, nextTheme: Theme) {
    setPreferenceError(null);
    startSavingPreference(async () => {
      const result = await saveUserPreferences(nextLocale, nextTheme);
      setPreferenceError(result.error ?? null);
    });
  }

  return (
    <div className="workspace-shell">
      <aside className={`workspace-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}>
        <div className="sidebar-topline">
          <Link href="/dashboard" className="workspace-brand" aria-label="AI Finance OS">
            <span className="brand-mark">A</span>
            {!collapsed ? <span><strong>AI Finance</strong><small>OS</small></span> : null}
          </Link>
          <button className="icon-button sidebar-close-mobile" onClick={() => setMobileOpen(false)} aria-label="Fermer le menu"><X size={18} /></button>
        </div>

        <nav className="workspace-nav" aria-label="Navigation de l’application">
          {navigation.map((section) => (
            <div className="nav-section" key={section.group}>
              {!collapsed ? <p className="nav-section-label">{copy.groups[section.group]}</p> : null}
              {section.items.map(({ key, href, icon: ItemIcon }) => {
                const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
                return <Link href={href} key={key} className={`workspace-nav-item ${active ? "is-active" : ""}`} onClick={() => setMobileOpen(false)} title={collapsed ? copy.nav[key] : undefined}>
                  <ItemIcon size={18} strokeWidth={active ? 2.1 : 1.8} /><span>{copy.nav[key]}</span>
                </Link>;
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          {!collapsed ? <div className="sidebar-plan"><div className="plan-icon"><Sparkles size={16} /></div><div><strong>Espace entreprise</strong><span>AI Finance OS</span></div><MoreHorizontal size={16} /></div> : null}
          <button className="workspace-nav-item collapse-button" onClick={() => setCollapsed((value) => !value)} title={collapsed ? "Agrandir la barre latérale" : "Réduire la barre latérale"}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}<span>{collapsed ? "" : "Réduire"}</span>
          </button>
        </div>
      </aside>

      {mobileOpen ? <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Fermer la navigation" /> : null}

      <div className={`workspace-main ${collapsed ? "sidebar-collapsed" : ""}`}>
        <header className="workspace-header">
          <div className="header-left"><button className="icon-button mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu"><Menu size={20} /></button><span className="header-context">{copy.nav[currentTitle as keyof typeof copy.nav] ?? copy.nav.home}</span></div>
          <div className="workspace-search"><Search size={17} /><input aria-label={copy.common.search} placeholder={copy.common.search} /><kbd>⌘ K</kbd></div>
          <div className="header-actions">
            <LanguagePicker locale={locale} onChange={changeLocale} />
            <button className="icon-button" title={copy.common.theme} onClick={() => changeTheme(theme === "dark" ? "light" : "dark")} aria-label={copy.common.theme} aria-busy={isSavingPreference}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
            {preferenceError ? <span className="sr-only" role="alert">{preferenceError}</span> : null}
            <Link className="icon-button notification-button" href="/alerts" title="Alertes opérationnelles" aria-label="Alertes opérationnelles"><Bell size={18} /></Link>
            <div className="header-popover-wrap"><button className="profile-trigger" onClick={() => setProfileOpen((value) => !value)} aria-expanded={profileOpen}><span className="avatar">{activeUserName.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toLocaleUpperCase() || userInitials}</span><span className="profile-copy"><strong>{activeUserName}</strong><small>{copy.common.company}</small></span><ChevronDown size={15} /></button>{profileOpen ? <div className="header-popover profile-popover"><div className="popover-profile"><span className="avatar large">{activeUserName.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toLocaleUpperCase() || userInitials}</span><div><strong>{activeUserName}</strong><small>{copy.common.company}</small></div></div><div className="popover-divider" /><Link href="/settings" onClick={() => setProfileOpen(false)}><Settings size={15} />{copy.nav.settings}</Link><button><CircleHelp size={15} />Centre d’aide</button><LogoutButton /></div> : null}</div>
          </div>
        </header>
        <main className="workspace-content">{children}</main>
      </div>
    </div>
  );
}

export function LanguagePicker({ locale, onChange }: { locale: Locale; onChange: (locale: Locale) => void }) {
  return <label className="language-picker"><Globe2 size={16} /><select value={locale} onChange={(event) => onChange(event.target.value as Locale)} aria-label="Langue de l’application">{locales.map((item) => <option value={item} key={item}>{localeLabels[item]}</option>)}</select></label>;
}

export function ThemeIcon({ theme }: { theme: Theme }) {
  return theme === "dark" ? <Moon size={16} /> : theme === "system" ? <Globe2 size={16} /> : <Sun size={16} />;
}

export { locales, localeLabels, messages };
export type { Locale, Theme };