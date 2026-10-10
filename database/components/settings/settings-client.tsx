"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { Building2, Check, Globe2, LockKeyhole, Palette, UserRound } from "lucide-react";
import { saveCompanyProfile, saveUserPreferences, saveUserProfile, type SaveCompanyProfileState, type SaveSettingsState } from "@/app/settings/actions";
import { AppShell, LanguagePicker, ThemeIcon, type Theme } from "@/database/components/app-shell";
import { LogoutButton } from "@/database/components/auth/logout-button";
import { CreateCompanyForm } from "@/database/components/company/create-company-form";
import type { CompanyProfile } from "@/types/company";
import { localeLabels, locales, messages, type Locale, type Messages } from "@/i18n/messages";

const sections = [
  ["profile", UserRound],
  ["company", Building2],
  ["appearance", Palette],
  ["language", Globe2],
  ["security", LockKeyhole],
] as const;

interface SettingsClientProps {
  companies: CompanyProfile[];
  editableCompanyIds?: string[];
  companyLoadError: string | null;
  profile?: { firstName: string; lastName: string; email: string; phone: string; country: string; locale: Locale };
  savedPreferences?: { locale: Locale; theme: Theme } | null;
}

export default function SettingsClient({
  companies,
  editableCompanyIds = [],
  companyLoadError,
  profile = { firstName: "", lastName: "", email: "", phone: "", country: "", locale: "fr" },
  savedPreferences = null,
}: SettingsClientProps) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (savedPreferences) return savedPreferences.locale;
    if (typeof window === "undefined") return "fr";
    const stored = localStorage.getItem("ai-finance-locale") as Locale | null;
    return stored && locales.includes(stored) ? stored : "fr";
  });
  const [theme, setTheme] = useState<Theme>(() => {
    if (savedPreferences) return savedPreferences.theme;
    if (typeof window === "undefined") return "light";
    const stored = localStorage.getItem("ai-finance-theme") as Theme | null;
    return stored && ["light", "dark", "system"].includes(stored) ? stored : "light";
  });
  const [preferenceFeedback, setPreferenceFeedback] = useState<SaveSettingsState>({});
  const [preferencesPersisted, setPreferencesPersisted] = useState(Boolean(savedPreferences));
  const [isSavingPreferences, startSavingPreferences] = useTransition();
  const [section, setSection] = useState("appearance");
  const copy = messages[locale];
  const handleProfileSaved = useCallback((
    savedProfile: NonNullable<SaveSettingsState["profile"]>,
    preferences: NonNullable<SaveSettingsState["preferences"]>,
  ) => {
    window.dispatchEvent(new CustomEvent("ai-finance-profile-change", {
      detail: `${savedProfile.firstName} ${savedProfile.lastName}`.trim(),
    }));
    window.dispatchEvent(new CustomEvent("ai-finance-preferences-change", { detail: preferences }));
    setLocale(savedProfile.locale);
    setTheme(preferences.theme);
    localStorage.setItem("ai-finance-locale", savedProfile.locale);
    localStorage.setItem("ai-finance-theme", preferences.theme);
  }, []);

  useEffect(() => {
    if (!savedPreferences) return;
    localStorage.setItem("ai-finance-locale", savedPreferences.locale);
    localStorage.setItem("ai-finance-theme", savedPreferences.theme);
    document.documentElement.lang = savedPreferences.locale;
    const resolved = savedPreferences.theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : savedPreferences.theme;
    document.documentElement.dataset.theme = resolved;
    window.dispatchEvent(new CustomEvent("ai-finance-preferences-change", { detail: savedPreferences }));
  }, [savedPreferences]);

  useEffect(() => {
    const updateLocaleFromShell = (event: Event) => {
      const nextLocale = (event as CustomEvent<Locale>).detail;
      if (locales.includes(nextLocale)) setLocale(nextLocale);
    };
    const updatePreferencesFromShell = (event: Event) => {
      const next = (event as CustomEvent<{ locale: Locale; theme: Theme }>).detail;
      if (!next || !locales.includes(next.locale) || !["light", "dark", "system"].includes(next.theme)) return;
      setLocale(next.locale);
      setTheme(next.theme);
    };
    window.addEventListener("ai-finance-locale-change", updateLocaleFromShell);
    window.addEventListener("ai-finance-preferences-change", updatePreferencesFromShell);
    return () => {
      window.removeEventListener("ai-finance-locale-change", updateLocaleFromShell);
      window.removeEventListener("ai-finance-preferences-change", updatePreferencesFromShell);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    const resolved = theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    document.documentElement.dataset.theme = resolved;
  }, [locale, theme]);

  function updateLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    localStorage.setItem("ai-finance-locale", nextLocale);
    window.dispatchEvent(new CustomEvent("ai-finance-locale-change", { detail: nextLocale }));
    const storedTheme = localStorage.getItem("ai-finance-theme") as Theme | null;
    persistPreferences(nextLocale, storedTheme && ["light", "dark", "system"].includes(storedTheme) ? storedTheme : theme);
  }

  function updateTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    localStorage.setItem("ai-finance-theme", nextTheme);
    const storedLocale = localStorage.getItem("ai-finance-locale") as Locale | null;
    const nextLocale = storedLocale && locales.includes(storedLocale) ? storedLocale : locale;
    window.dispatchEvent(new CustomEvent("ai-finance-preferences-change", { detail: { locale: nextLocale, theme: nextTheme } }));
    persistPreferences(nextLocale, nextTheme);
  }

  function persistPreferences(nextLocale: Locale, nextTheme: Theme) {
    setPreferenceFeedback({});
    startSavingPreferences(async () => {
      const result = await saveUserPreferences(nextLocale, nextTheme);
      setPreferenceFeedback(result);
      setPreferencesPersisted(Boolean(result.success));
    });
  }

  return (
    <AppShell pageTitle="settings" initialLocale={locale} initialTheme={theme}>
      <div className="page-intro settings-intro">
        <div>
          <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Profil et préférences</span></div>
          <h1>{copy.settings.title}</h1>
          <p>{copy.settings.subtitle}</p>
        </div>
      </div>
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <p className="settings-sidebar-title">{copy.settings.title}</p>
          {sections.map(([key, Icon]) => (
            <button className={section === key ? "is-active" : ""} onClick={() => setSection(key)} key={key}>
              <Icon size={17} />{copy.settings[key as keyof typeof copy.settings] as string}
            </button>
          ))}
        </aside>
        <section className="settings-content">
          {section === "profile" ? (
            <ProfilePanel profile={profile} onProfileSaved={handleProfileSaved} />
          ) : section === "appearance" ? (
            <AppearancePanel copy={copy} theme={theme} onThemeChange={updateTheme} saving={isSavingPreferences} feedback={preferenceFeedback} persisted={preferencesPersisted} />
          ) : section === "language" ? (
            <LanguagePanel copy={copy} locale={locale} onLocaleChange={updateLocale} saving={isSavingPreferences} feedback={preferenceFeedback} persisted={preferencesPersisted} />
          ) : section === "company" ? (
            <CompanyPanel companies={companies} editableCompanyIds={editableCompanyIds} loadError={companyLoadError} />
          ) : (
            <SecurityPanel copy={copy} />
          )}
        </section>
      </div>
    </AppShell>
  );
}

function AppearancePanel({ copy, theme, onThemeChange, saving, feedback, persisted }: { copy: Messages; theme: Theme; onThemeChange: (theme: Theme) => void; saving: boolean; feedback: SaveSettingsState; persisted: boolean }) {
  const options: [Theme, string, string][] = [
    ["light", copy.settings.light, "Une interface lumineuse et calme"],
    ["dark", copy.settings.dark, "Une interface sombre et contrastée"],
    ["system", copy.settings.system, "Suit les préférences de votre appareil"],
  ];
  return (
    <div className="settings-panel">
      <div className="settings-panel-heading">
        <div><span className="panel-kicker">{copy.settings.appearance}</span><h2>{copy.settings.appearanceTitle}</h2><p>{copy.settings.appearanceCopy}</p></div>
        <Palette size={20} />
      </div>
      <div className="settings-field">
        <label>{copy.settings.theme}</label>
        <div className="theme-options">
          {options.map(([value, label, description]) => (
            <button type="button" disabled={saving} aria-pressed={theme === value} className={`theme-option ${theme === value ? "is-selected" : ""}`} onClick={() => onThemeChange(value)} key={value}>
              <span className="theme-option-icon"><ThemeIcon theme={value} /></span>
              <span><strong>{label}</strong><small>{description}</small></span>
              {theme === value ? <span className="selected-check"><Check size={14} /></span> : null}
            </button>
          ))}
        </div>
      </div>
      <PreferenceStatus saving={saving} feedback={feedback} persisted={persisted} />
    </div>
  );
}

function LanguagePanel({ copy, locale, onLocaleChange, saving, feedback, persisted }: { copy: Messages; locale: Locale; onLocaleChange: (locale: Locale) => void; saving: boolean; feedback: SaveSettingsState; persisted: boolean }) {
  return (
    <div className="settings-panel">
      <div className="settings-panel-heading">
        <div><span className="panel-kicker">{copy.settings.language}</span><h2>{copy.settings.languageTitle}</h2><p>{copy.settings.languageCopy}</p></div>
        <Globe2 size={20} />
      </div>
      <div className="settings-field"><label>{copy.settings.languageTitle}</label><LanguagePicker locale={locale} onChange={onLocaleChange} /></div>
      <div className="language-list">
        {locales.map((item) => (
          <button type="button" disabled={saving} aria-pressed={locale === item} className={locale === item ? "is-selected" : ""} onClick={() => onLocaleChange(item)} key={item}>
            <span className="language-flag">{item === "fr" ? "🇫🇷" : item === "en" ? "🇬🇧" : item === "es" ? "🇪🇸" : item === "pt" ? "🇵🇹" : item === "it" ? "🇮🇹" : item === "de" ? "🇩🇪" : "🇨🇳"}</span>
            <span>{localeLabels[item]}</span>{locale === item ? <Check size={16} /> : null}
          </button>
        ))}
      </div>
      <PreferenceStatus saving={saving} feedback={feedback} persisted={persisted} />
    </div>
  );
}

function PreferenceStatus({ saving, feedback, persisted }: { saving: boolean; feedback: SaveSettingsState; persisted: boolean }) {
  if (saving) return <p className="settings-demo-note" role="status">Enregistrement de la préférence sur votre compte…</p>;
  if (feedback.error) return <p className="auth-message is-error" role="alert">{feedback.error}</p>;
  if (feedback.success) return <p className="auth-message is-success" role="status">{feedback.success}</p>;
  return persisted
    ? <p className="settings-demo-note"><Check size={16} /><span>Cette préférence est synchronisée avec votre compte.</span></p>
    : <p className="settings-demo-note">Aucune préférence n’est encore enregistrée sur le compte ; ce choix reste local jusqu’à sa sauvegarde.</p>;
}

function ProfilePanel({
  profile,
  onProfileSaved,
}: {
  profile: NonNullable<SettingsClientProps["profile"]>;
  onProfileSaved: (
    profile: NonNullable<SaveSettingsState["profile"]>,
    preferences: NonNullable<SaveSettingsState["preferences"]>,
  ) => void;
}) {
  const [state, formAction, pending] = useActionState(saveUserProfile, {} as SaveSettingsState);
  useEffect(() => {
    if (state.profile && state.preferences) {
      onProfileSaved(state.profile, state.preferences);
    }
  }, [onProfileSaved, state.profile, state.preferences]);
  return (
    <div className="settings-panel">
      <div className="settings-panel-heading">
        <div><span className="panel-kicker">Compte personnel</span><h2>Profil utilisateur</h2><p>Ces informations sont associées à votre compte AI Finance OS.</p></div>
        <UserRound size={20} />
      </div>
      <form action={formAction} className="company-profile-form">
        <div className="company-profile-grid">
          <div className="settings-field">
            <label htmlFor="profile-first-name">Prénom</label>
            <input id="profile-first-name" name="firstName" required maxLength={80} autoComplete="given-name" defaultValue={profile.firstName} aria-invalid={Boolean(state.fieldErrors?.firstName)} aria-describedby={state.fieldErrors?.firstName ? "profile-first-name-error" : undefined} />
            {state.fieldErrors?.firstName ? <small id="profile-first-name-error" className="auth-message is-error">{state.fieldErrors.firstName}</small> : null}
          </div>
          <div className="settings-field">
            <label htmlFor="profile-last-name">Nom</label>
            <input id="profile-last-name" name="lastName" required maxLength={80} autoComplete="family-name" defaultValue={profile.lastName} aria-invalid={Boolean(state.fieldErrors?.lastName)} aria-describedby={state.fieldErrors?.lastName ? "profile-last-name-error" : undefined} />
            {state.fieldErrors?.lastName ? <small id="profile-last-name-error" className="auth-message is-error">{state.fieldErrors.lastName}</small> : null}
          </div>
          <div className="settings-field">
            <label htmlFor="profile-email">Adresse e-mail du compte</label>
            <input id="profile-email" type="email" value={profile.email} readOnly />
            <small>La modification d’adresse e-mail nécessite un parcours de confirmation distinct.</small>
          </div>
          <div className="settings-field">
            <label htmlFor="profile-phone">Téléphone</label>
            <input id="profile-phone" name="phone" type="tel" maxLength={40} autoComplete="tel" defaultValue={profile.phone} aria-invalid={Boolean(state.fieldErrors?.phone)} aria-describedby={state.fieldErrors?.phone ? "profile-phone-error" : undefined} />
            {state.fieldErrors?.phone ? <small id="profile-phone-error" className="auth-message is-error">{state.fieldErrors.phone}</small> : null}
          </div>
          <div className="settings-field">
            <label htmlFor="profile-country">Pays de résidence</label>
            <input id="profile-country" name="country" maxLength={100} autoComplete="country-name" defaultValue={profile.country} aria-invalid={Boolean(state.fieldErrors?.country)} aria-describedby={state.fieldErrors?.country ? "profile-country-error" : undefined} />
            {state.fieldErrors?.country ? <small id="profile-country-error" className="auth-message is-error">{state.fieldErrors.country}</small> : null}
          </div>
          <div className="settings-field">
            <label htmlFor="profile-locale">Langue préférée</label>
            <select id="profile-locale" name="locale" defaultValue={profile.locale} aria-invalid={Boolean(state.fieldErrors?.locale)} aria-describedby={state.fieldErrors?.locale ? "profile-locale-error" : undefined}>
              {locales.map((item) => <option key={item} value={item}>{localeLabels[item]}</option>)}
            </select>
            {state.fieldErrors?.locale ? <small id="profile-locale-error" className="auth-message is-error">{state.fieldErrors.locale}</small> : null}
          </div>
        </div>
        {state.error ? <p className="auth-message is-error" role="alert">{state.error}</p> : null}
        {state.success ? <p className="auth-message is-success" role="status">{state.success}</p> : null}
        <button className="primary-button" type="submit" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer les modifications"}</button>
      </form>
      <div className="mt-6 border-t border-[var(--workspace-line)] pt-5">
        <h3 className="mb-2 font-semibold text-[var(--workspace-text)]">Session</h3>
        <p className="mb-4 text-sm text-[var(--workspace-muted)]">Déconnectez ce compte de l’application sur cet appareil.</p>
        <LogoutButton className="primary-button danger-action" />
      </div>
    </div>
  );
}

function SecurityPanel({ copy }: { copy: Messages }) {
  return (
    <div className="settings-panel empty-settings">
      <span className="empty-settings-icon"><LockKeyhole size={20} /></span>
      <h2>{copy.settings.security}</h2>
      <p>Pour modifier votre mot de passe, utilisez le parcours sécurisé de réinitialisation associé à votre adresse de compte.</p>
      <Link className="primary-button" href="/forgot-password">Réinitialiser mon mot de passe</Link>
    </div>
  );
}

function CompanyPanel({ companies, editableCompanyIds, loadError }: { companies: CompanyProfile[]; editableCompanyIds: string[]; loadError: string | null }) {
  const [selectedId, setSelectedId] = useState(companies[0]?.id ?? "");
  const selectedCompany = companies.find((company) => company.id === selectedId) ?? companies[0];

  return (
    <div className="settings-panel">
      <div className="settings-panel-heading">
        <div><span className="panel-kicker">Entreprise</span><h2>Informations de l’entreprise</h2><p>Les informations sont enregistrées dans l’espace de l’entreprise sélectionnée.</p></div>
        <Building2 size={20} />
      </div>
      {loadError ? <p className="auth-message is-error" role="alert">{loadError}</p> : null}
      {!loadError && companies.length === 0 ? (
        <div className="company-settings-empty">
          <h3>Aucune entreprise associée</h3>
          <p>L’espace entreprise est facultatif. Vous pouvez continuer à utiliser votre espace personnel ou créer une entreprise maintenant.</p>
          <CreateCompanyForm />
        </div>
      ) : null}
      {selectedCompany ? (
        <>
          {companies.length > 1 ? (
            <div className="settings-field company-select-field">
              <label htmlFor="company-select">Entreprise à modifier</label>
              <select id="company-select" value={selectedCompany.id} onChange={(event) => setSelectedId(event.target.value)}>
                {companies.map((company) => <option value={company.id} key={company.id}>{company.legalName}</option>)}
              </select>
            </div>
          ) : null}
          <CompanyProfileForm key={selectedCompany.id} company={selectedCompany} editable={editableCompanyIds.includes(selectedCompany.id)} />
        </>
      ) : null}
    </div>
  );
}

function CompanyProfileForm({ company, editable }: { company: CompanyProfile; editable: boolean }) {
  const initialState: SaveCompanyProfileState = {};
  const [state, formAction, pending] = useActionState(saveCompanyProfile, initialState);

  return (
    <form action={formAction} className="company-profile-form">
      <input type="hidden" name="companyId" value={company.id} />
      <fieldset disabled={!editable} className="company-profile-section">
        <legend>Identité de l’entreprise</legend>
        <div className="company-profile-grid">
        <CompanyField label="Nom légal de l’entreprise" name="legalName" value={company.legalName} required autoComplete="organization" error={state.fieldErrors?.legalName} />
        <CompanyField label="Nom commercial" name="tradeName" value={company.tradeName} disabled={!editable} />
        <CompanyField label="Forme juridique" name="legalForm" value={company.legalForm} placeholder="SAS, SARL…" disabled={!editable} />
        <CompanyField label="Secteur d’activité" name="industry" value={company.industry} />
        </div>
      </fieldset>
      <fieldset disabled={!editable} className="company-profile-section">
        <legend>Informations légales</legend>
        <div className="company-profile-grid">
          <CompanyField label="SIRET (si applicable)" name="siret" value={company.siret} maxLength={32} error={state.fieldErrors?.siret} />
          <CompanyField label="SIREN (si applicable)" name="siren" value={company.siren} maxLength={32} error={state.fieldErrors?.siren} />
          <CompanyField label="Numéro de TVA intracommunautaire (si applicable)" name="vatNumber" value={company.vatNumber} error={state.fieldErrors?.vatNumber} />
          <CompanyField label="Numéro d’immatriculation local (si applicable)" name="registrationNumber" value={company.registrationNumber} error={state.fieldErrors?.registrationNumber} />
        </div>
      </fieldset>
      <fieldset disabled={!editable} className="company-profile-section">
        <legend>Adresse</legend>
        <div className="company-profile-grid">
          <CompanyField label="Adresse" name="address" value={company.address} autoComplete="street-address" error={state.fieldErrors?.address} />
          <CompanyField label="Complément d’adresse" name="addressComplement" value={company.addressComplement} error={state.fieldErrors?.addressComplement} />
          <CompanyField label="Code postal" name="postalCode" value={company.postalCode} autoComplete="postal-code" error={state.fieldErrors?.postalCode} />
          <CompanyField label="Ville" name="city" value={company.city} autoComplete="address-level2" error={state.fieldErrors?.city} />
          <CompanyField label="Pays (code ISO à 2 lettres)" name="country" value={company.country} required maxLength={2} pattern="[A-Za-z]{2}" error={state.fieldErrors?.country} />
        </div>
      </fieldset>
      <fieldset disabled={!editable} className="company-profile-section">
        <legend>Coordonnées</legend>
        <div className="company-profile-grid">
          <CompanyField label="Téléphone professionnel" name="phone" value={company.phone} type="tel" autoComplete="tel" error={state.fieldErrors?.phone} />
          <CompanyField label="Adresse e-mail professionnelle" name="email" value={company.email} type="email" autoComplete="email" error={state.fieldErrors?.email} />
        </div>
      </fieldset>
      <fieldset disabled={!editable} className="company-profile-section">
        <legend>Préférences financières</legend>
        <div className="company-profile-grid">
          <div className="settings-field">
            <label htmlFor="company-currency">Devise principale</label>
            <select id="company-currency" name="currency" defaultValue={company.currency} required aria-invalid={Boolean(state.fieldErrors?.currency)} aria-describedby={state.fieldErrors?.currency ? "company-currency-error" : undefined}>
              {[...new Set([company.currency, "EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY"].filter(Boolean))].map((currency) => <option key={currency} value={currency}>{currency}</option>)}
            </select>
            {state.fieldErrors?.currency ? <small className="auth-message is-error" id="company-currency-error">{state.fieldErrors.currency}</small> : null}
          </div>
        </div>
      </fieldset>
      {!editable ? <p className="auth-message" role="status">Seul le propriétaire peut modifier les informations partagées de cette entreprise.</p> : null}
      {state.error ? <p className="auth-message is-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="auth-message is-success" role="status">{state.success}</p> : null}
      {editable ? <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer les modifications"}
      </button> : null}
    </form>
  );
}

type CompanyFieldName = Exclude<keyof CompanyProfile, "id">;

function CompanyField({
  label,
  name,
  value,
  type = "text",
  error,
  ...inputProps
}: {
  label: string;
  name: CompanyFieldName;
  value: string;
  type?: "text" | "email" | "tel";
  required?: boolean;
  maxLength?: number;
  pattern?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "numeric";
  disabled?: boolean;
  error?: string;
}) {
  const id = `company-${name}`;
  return (
    <div className="settings-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} type={type} defaultValue={value} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...inputProps} />
      {error ? <small id={`${id}-error`} className="auth-message is-error">{error}</small> : null}
    </div>
  );
}
