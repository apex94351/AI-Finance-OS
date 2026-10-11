"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Fragment } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FileText, Image as ImageIcon, Plus, Search, Trash2, UploadCloud, X } from "lucide-react";
import {
  createDocumentDownloadUrl,
  deleteDocument,
  updateDocumentClassification,
  uploadDocument,
  type DocumentActionState,
} from "@/app/documents/actions";
import { Badge } from "@/database/components/ui/badge";
import { EmptyState } from "@/database/components/ui/empty-state";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_MAX_SIZE,
  DOCUMENT_MIME_TYPES,
  DOCUMENT_STATUSES,
  documentUploadMetadataSchema,
  documentCategoryLabels,
  documentStatusLabels,
  filterDocuments,
  formatDocumentSize,
  type DocumentCategory,
  type DocumentRecord,
  type DocumentStatus,
} from "@/services/documents";
import type { DocumentCompany } from "@/services/documents";

const initialState: DocumentActionState = {};
type DocumentPreviewState = {
  document: DocumentRecord;
  status: "loading" | "ready" | "error";
  url?: string;
  fileType?: (typeof DOCUMENT_MIME_TYPES)[number];
  error?: string;
};

type PickerDiagnostic = {
  triggerRendered: boolean | null;
  triggerClickReceived: boolean | null;
  triggerDefaultPrevented: boolean | null;
  inputFound: boolean | null;
  inputClickReceived: boolean | null;
  inputClickTrusted: boolean | null;
  changeEventReceived: boolean | null;
  fileSelectionReceived: boolean | null;
  inputEnabled: boolean | null;
  labelAssociated: boolean | null;
};

function diagnosticValue(value: boolean | null) {
  return value === null ? "À vérifier" : value ? "Oui" : "Non";
}

const fileTypeLabels: Record<(typeof DOCUMENT_MIME_TYPES)[number], string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
};

function dateLabel(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export function DocumentManager({
  companies,
  documents,
  loadError,
  information,
  documentWarning,
  relationshipWarning,
}: {
  companies: DocumentCompany[];
  documents: DocumentRecord[];
  loadError: string | null;
  information?: string;
  documentWarning?: string | null;
  relationshipWarning?: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [fileType, setFileType] = useState("all");
  const [companyId, setCompanyId] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sort, setSort] = useState<"name-asc" | "date-desc">("date-desc");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [showUpload, setShowUpload] = useState(false);
  const [detailsDocumentId, setDetailsDocumentId] = useState<string | null>(null);
  const [draftCategory, setDraftCategory] = useState<DocumentCategory>("other");
  const [draftStatus, setDraftStatus] = useState<DocumentStatus>("to_process");
  const [classificationFeedback, setClassificationFeedback] = useState<DocumentActionState>({});
  const [savingClassification, startSavingClassification] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();
  const [documentPreview, setDocumentPreview] = useState<DocumentPreviewState | null>(null);
  const previewRequestId = useRef(0);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [uploadClientError, setUploadClientError] = useState<string | null>(null);
  const [uploadState, uploadAction, uploadPending] = useActionState(uploadDocument, initialState);
  const uploadDisabled = uploadPending;
  const showPickerDiagnostic = process.env.NODE_ENV === "development";
  const [pickerDiagnostic, setPickerDiagnostic] = useState<PickerDiagnostic>({
    triggerRendered: null,
    triggerClickReceived: null,
    triggerDefaultPrevented: null,
    inputFound: null,
    inputClickReceived: null,
    inputClickTrusted: null,
    changeEventReceived: null,
    fileSelectionReceived: null,
    inputEnabled: null,
    labelAssociated: null,
  });

  useEffect(() => {
    if (uploadState.success) router.refresh();
  }, [router, uploadState.success]);

  useEffect(() => {
    if (!documentPreview) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        previewRequestId.current += 1;
        setDocumentPreview(null);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [documentPreview]);

  const visibleDocuments = useMemo(() => filterDocuments(
    documents, query, fileType, companyId, startDate, endDate, sort, category, status,
  ), [category, companyId, documents, endDate, fileType, query, sort, startDate, status]);

  function handleDelete(document: DocumentRecord) {
    if (!window.confirm(`Supprimer définitivement le fichier « ${document.fileName} » et retirer sa fiche du registre ? Cette action est irréversible.`)) return;
    setDeleteError(null);
    setDeleteSuccess(null);
    startDeleting(async () => {
      const result = await deleteDocument(document.companyId, document.id);
      if (result.error) {
        setDeleteError(result.error);
        return;
      }
      if (!result.success) {
        setDeleteError("La suppression n’a pas été confirmée. Actualisez le registre avant de réessayer.");
        return;
      }
      if (documentPreview?.document.id === document.id) closeDocumentPreview();
      setDeleteSuccess(result.success);
      router.refresh();
    });
  }

  function closeDocumentPreview() {
    previewRequestId.current += 1;
    setDocumentPreview(null);
  }

  async function handlePreview(document: DocumentRecord) {
    const requestId = ++previewRequestId.current;
    setDocumentPreview({ document, status: "loading" });
    try {
      const result = await createDocumentDownloadUrl(document.companyId, document.id);
      if (requestId !== previewRequestId.current) return;
      if (result.error || !result.url || !result.fileType) {
        setDocumentPreview({
          document,
          status: "error",
          error: result.error ?? "Le lien de consultation n’a pas pu être créé.",
        });
        return;
      }
      setDocumentPreview({ document, status: "ready", url: result.url, fileType: result.fileType });
    } catch {
      if (requestId !== previewRequestId.current) return;
      console.error("Document signed URL request failed");
      setDocumentPreview({
        document,
        status: "error",
        error: "Le lien de consultation n’a pas pu être créé. Vérifiez votre connexion et réessayez.",
      });
    }
  }

  function showDocumentDetails(document: DocumentRecord) {
    if (detailsDocumentId === document.id) {
      setDetailsDocumentId(null);
      return;
    }
    setDetailsDocumentId(document.id);
    setDraftCategory(document.category);
    setDraftStatus(document.status);
    setClassificationFeedback({});
  }

  function saveClassification(document: DocumentRecord) {
    setClassificationFeedback({});
    startSavingClassification(async () => {
      const result = await updateDocumentClassification(document.companyId, document.id, draftCategory, draftStatus);
      setClassificationFeedback(result);
      if (result.success) router.refresh();
    });
  }

  function inspectUploadPicker() {
    const labelElement = document.getElementById("document-upload-trigger-label");
    const label = labelElement instanceof HTMLLabelElement ? labelElement : null;
    const candidate = document.getElementById("document-upload-file");
    const input = candidate instanceof HTMLInputElement && candidate.type === "file" ? candidate : null;

    setPickerDiagnostic((current) => ({
      ...current,
      triggerRendered: Boolean(label?.isConnected),
      inputFound: Boolean(input?.isConnected),
      inputEnabled: input ? !input.disabled : false,
      labelAssociated: Boolean(label && input && Array.from(input.labels ?? []).includes(label)),
    }));
  }

  function handleUploadTriggerClick(event: React.MouseEvent<HTMLLabelElement>) {
    if (showPickerDiagnostic) {
      const input = document.getElementById("document-upload-file");
      setPickerDiagnostic((current) => ({
        ...current,
        triggerRendered: true,
        triggerClickReceived: true,
        triggerDefaultPrevented: event.defaultPrevented,
        inputFound: input instanceof HTMLInputElement && input.type === "file",
        inputEnabled: input instanceof HTMLInputElement && !input.disabled,
        labelAssociated: input instanceof HTMLInputElement
          && Array.from(input.labels ?? []).some((label) => label.htmlFor === "document-upload-file"),
      }));
    }
  }

  function openFilePicker(event: React.MouseEvent<HTMLInputElement>) {
    if (uploadPending) return;
    if (showPickerDiagnostic) {
      setPickerDiagnostic((current) => ({
        ...current,
        inputClickReceived: true,
        inputClickTrusted: event.nativeEvent.isTrusted,
      }));
    }
    event.currentTarget.value = "";
    setShowUpload(true);
    setUploadClientError(null);
  }

  function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    if (showPickerDiagnostic) {
      setPickerDiagnostic((current) => ({ ...current, changeEventReceived: true }));
    }
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (showPickerDiagnostic) {
      setPickerDiagnostic((current) => ({ ...current, fileSelectionReceived: true }));
    }

    const validation = documentUploadMetadataSchema.safeParse(file);
    if (!validation.success) {
      setSelectedFileName(null);
      setUploadClientError(
        file.size > DOCUMENT_MAX_SIZE
          ? "Le fichier dépasse la taille maximale autorisée de 10 Mo."
          : validation.error.issues[0]?.message ?? "Sélectionnez un fichier PDF, JPG ou PNG valide.",
      );
      event.currentTarget.value = "";
      return;
    }

    setSelectedFileName(file.name);
    setUploadClientError(null);
  }

  return (
    <>
      <form id="document-upload-form" action={uploadAction}>
        <div className="page-intro invoice-page-intro">
          <div>
            <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Gestion documentaire</span></div>
            <h1>Documents</h1>
            <p>Centralisez vos pièces financières dans un espace privé, avec ou sans entreprise associée.</p>
          </div>
          <div className="document-upload-actions">
            <span className="document-upload-trigger">
              <label
                id="document-upload-trigger-label"
                className={`primary-button document-upload-trigger-visual${uploadDisabled ? " disabled-button" : ""}`}
                htmlFor="document-upload-file"
                aria-disabled={uploadDisabled}
                onClick={handleUploadTriggerClick}
              >
                <Plus size={17} /> Importer un document
              </label>
              <input
                className="sr-only"
                id="document-upload-file"
                name="file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                disabled={uploadDisabled}
                onClick={openFilePicker}
                onChange={handleFileSelection}
                aria-label="Sélectionner un document PDF, JPG ou PNG"
                aria-describedby="document-upload-file-help"
              />
            </span>
            {showPickerDiagnostic ? (
              <details className="document-upload-diagnostic">
                <summary>Diagnostic du sélecteur de fichiers</summary>
                <div aria-live="polite">
                  <p>Bouton rendu : {diagnosticValue(pickerDiagnostic.triggerRendered)}</p>
                  <p>Clic reçu : {diagnosticValue(pickerDiagnostic.triggerClickReceived)}</p>
                  <p>Action native du clic annulée : {diagnosticValue(pickerDiagnostic.triggerDefaultPrevented)}</p>
                  <p>Input fichier trouvé : {diagnosticValue(pickerDiagnostic.inputFound)}</p>
                  <p>Input activé : {diagnosticValue(pickerDiagnostic.inputEnabled)}</p>
                  <p>Label associé à l’input : {diagnosticValue(pickerDiagnostic.labelAssociated)}</p>
                  <p>Événement click de l’input reçu : {diagnosticValue(pickerDiagnostic.inputClickReceived)}</p>
                  <p>Clic de l’input issu d’un geste navigateur : {diagnosticValue(pickerDiagnostic.inputClickTrusted)}</p>
                  <p>Événement change reçu : {diagnosticValue(pickerDiagnostic.changeEventReceived)}</p>
                  <p>Sélection de fichier reçue : {diagnosticValue(pickerDiagnostic.fileSelectionReceived)}</p>
                  <p>Un clic input ne prouve pas que la fenêtre native est apparue.</p>
                  <button className="text-button" type="button" onClick={inspectUploadPicker}>Vérifier bouton, input et label</button>
                </div>
              </details>
            ) : null}
          </div>
        </div>

        {information ? <p className="document-information" role="status">{information}</p> : null}
        {documentWarning ? <p className="document-information" role="status">{documentWarning}</p> : null}
        {relationshipWarning ? <p className="document-information" role="status">{relationshipWarning}</p> : null}
        {loadError ? (
          <div className="document-error-state" role="alert">
            <p>{loadError}</p><button className="text-button" type="button" onClick={() => router.refresh()}>Réessayer</button>
          </div>
        ) : null}
        {deleteError ? <p className="auth-message is-error document-message" role="alert">{deleteError}</p> : null}
        {deleteSuccess ? <p className="auth-message is-success document-message" role="status">{deleteSuccess}</p> : null}
        <section
          className="surface-panel document-upload-panel"
          aria-labelledby="document-upload-heading"
          hidden={!showUpload}
        >
          <div className="invoice-form-title">
            <div><span className="panel-kicker">Stockage privé</span><h2 id="document-upload-heading">Importer un document</h2></div>
            <button className="text-button" type="button" onClick={() => setShowUpload(false)} disabled={uploadPending}>Fermer</button>
          </div>
          <div className="document-upload-form">
            <label className="invoice-field">
              <span>Espace de stockage</span>
              <select name="companyId" defaultValue={companies.length ? (companyId === "all" ? companies[0].id : companyId) : ""}>
                <option value="">Espace personnel</option>
                {companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
              </select>
            </label>
            <label className="invoice-field">
              <span>Catégorie documentaire</span>
              <select name="category" defaultValue="other" required>
                {DOCUMENT_CATEGORIES.map((value) => <option value={value} key={value}>{documentCategoryLabels[value]}</option>)}
              </select>
            </label>
            <label className="invoice-field">
              <span>Statut documentaire</span>
              <select name="status" defaultValue="to_process" required>
                {DOCUMENT_STATUSES.map((value) => <option value={value} key={value}>{documentStatusLabels[value]}</option>)}
              </select>
            </label>
            <div className="invoice-field document-file-field">
              <span id="document-upload-file-help">Fichier (PDF, JPG ou PNG, 10 Mo maximum)</span>
              <span className="document-selected-file" aria-live="polite">{selectedFileName ?? "Aucun fichier sélectionné"}</span>
            </div>
            <button className="primary-button" type="submit" disabled={uploadPending}>
              <UploadCloud size={16} />{uploadPending ? "Import en cours…" : "Importer"}
            </button>
          </div>
          {uploadState.error ? <p className="auth-message is-error" role="alert">{uploadState.error}</p> : null}
          {uploadClientError ? <p className="auth-message is-error" role="alert">{uploadClientError}</p> : null}
          {uploadState.success ? <p className="auth-message is-success" role="status">{uploadState.success}</p> : null}
          <p className="document-upload-help">Les documents sont stockés dans un bucket privé. Aucun OCR ni analyse automatique n’est lancé.</p>
        </section>
      </form>

      {!loadError ? (
        <section className="surface-panel invoice-list-panel document-list-panel" aria-labelledby="document-list-heading">
          <div className="invoice-list-heading">
            <div><span className="panel-kicker">Registre</span><h2 id="document-list-heading">Documents accessibles</h2></div>
            <span className="coming-soon-pill">{visibleDocuments.length} document{visibleDocuments.length === 1 ? "" : "s"}</span>
          </div>
          <div className="invoice-filters document-filters">
            <label className="invoice-search"><Search size={16} /><input type="search" aria-label="Rechercher un document" placeholder="Rechercher par nom de fichier" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <select aria-label="Filtrer par type de fichier" value={fileType} onChange={(event) => setFileType(event.target.value)}>
              <option value="all">Tous les types</option>{DOCUMENT_MIME_TYPES.map((type) => <option value={type} key={type}>{fileTypeLabels[type]}</option>)}
            </select>
            <select aria-label="Filtrer par catégorie documentaire" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">Toutes les catégories</option>{DOCUMENT_CATEGORIES.map((value) => <option value={value} key={value}>{documentCategoryLabels[value]}</option>)}
            </select>
            <select aria-label="Filtrer par statut documentaire" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">Tous les statuts</option>{DOCUMENT_STATUSES.map((value) => <option value={value} key={value}>{documentStatusLabels[value]}</option>)}
            </select>
            <select aria-label="Filtrer par espace" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
              <option value="all">Tous les espaces</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}
            </select>
            <label className="document-date-filter"><span>Ajouté après</span><input type="date" aria-label="Ajouté après" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="document-date-filter"><span>Ajouté avant</span><input type="date" aria-label="Ajouté avant" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
            <select aria-label="Trier les documents" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              <option value="date-desc">Date · plus récente</option><option value="name-asc">Nom · A à Z</option>
            </select>
          </div>

          {visibleDocuments.length ? (
            <div className="invoice-table-scroll">
              <table className="invoice-table document-table">
                <thead><tr><th>Nom du fichier</th><th>Catégorie</th><th>Statut</th><th>Espace</th><th>Format</th><th>Taille</th><th>Ajouté le</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{visibleDocuments.map((document) => (
                  <Fragment key={document.id}>
                  <tr id={`document-${document.id}`}>
                    <td className="document-name-cell">{document.fileType === "application/pdf" ? <FileText size={17} /> : <ImageIcon size={17} />}<strong>{document.fileName}</strong></td>
                    <td>{documentCategoryLabels[document.category]}</td>
                    <td><Badge tone={document.status === "validated" ? "success" : "neutral"}>{documentStatusLabels[document.status]}</Badge></td>
                    <td>{document.companyId ? companies.find(({ id }) => id === document.companyId)?.name ?? "Espace entreprise" : "Espace personnel"}</td>
                    <td><Badge tone="neutral">{fileTypeLabels[document.fileType]}</Badge></td>
                    <td>{formatDocumentSize(document.fileSize)}</td>
                    <td>{dateLabel(document.uploadedAt)}</td>
                    <td className="document-row-actions">
                      <button className="text-button" type="button" aria-expanded={detailsDocumentId === document.id} onClick={() => showDocumentDetails(document)}>Détails</button>
                      <button
                        className="text-button"
                        type="button"
                        disabled={documentPreview?.status === "loading"}
                        onClick={() => void handlePreview(document)}
                      >
                        {documentPreview?.document.id === document.id && documentPreview.status === "loading" ? "Ouverture…" : "Lire"}
                      </button>
                      <button className="invoice-delete-button" type="button" aria-label={`Supprimer ${document.fileName}`} disabled={deleting} onClick={() => handleDelete(document)}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                  {detailsDocumentId === document.id ? (
                    <tr key={`${document.id}-details`}>
                      <td colSpan={8}>
                        <section className="document-details" aria-label={`Détails de ${document.fileName}`}>
                          <dl>
                            <div><dt>Nom du fichier</dt><dd>{document.fileName}</dd></div>
                            <div><dt>Type de document</dt><dd>{documentCategoryLabels[document.category]}</dd></div>
                            <div><dt>Statut documentaire</dt><dd>{documentStatusLabels[document.status]}</dd></div>
                            <div><dt>Format et taille</dt><dd>{fileTypeLabels[document.fileType]} · {formatDocumentSize(document.fileSize)}</dd></div>
                            <div><dt>Date d’import</dt><dd>{dateLabel(document.uploadedAt)}</dd></div>
                            <div><dt>Propriétaire</dt><dd>{document.companyId ? companies.find(({ id }) => id === document.companyId)?.name ?? "Espace entreprise" : "Espace personnel"}</dd></div>
                          </dl>
                          <div className="document-related-records">
                            <h3>Relations disponibles</h3>
                            {document.relatedInvoices.length ? document.relatedInvoices.map((invoice) => (
                              <p key={invoice.id}>
                                Facture liée{invoice.invoiceNumber ? ` n° ${invoice.invoiceNumber}` : ` (${invoice.id})`}
                                {invoice.customerName ? ` · Client : ${invoice.customerName}` : ""}
                                {invoice.supplierName ? ` · Fournisseur : ${invoice.supplierName}` : ""}
                                {invoice.customerId && !invoice.customerName ? ` · Client lié (${invoice.customerId})` : ""}
                                {invoice.supplierId && !invoice.supplierName ? ` · Fournisseur lié (${invoice.supplierId})` : ""}
                              </p>
                            )) : <p>Aucune facture directement liée.</p>}
                            <p>Le schéma actuel ne définit pas de relation directe entre document et dépense ou devis.</p>
                          </div>
                          {document.companyId && (document.category === "customer_invoice" || document.category === "supplier_invoice") ? (
                            <div className="document-related-records">
                              <h3>Créer ou compléter une facture</h3>
                              <p>Aucune extraction automatique n’est disponible. Les informations devront être saisies et vérifiées manuellement à partir du document.</p>
                              <Link
                                className="primary-button"
                                href={`/invoices?documentId=${encodeURIComponent(document.id)}&companyId=${encodeURIComponent(document.companyId)}`}
                              >
                                {document.relatedInvoices.length ? "Ouvrir la facture liée" : "Saisir la facture depuis ce document"}
                              </Link>
                            </div>
                          ) : null}
                          <div className="document-classification-editor">
                            <label>
                              <span>Catégorie documentaire</span>
                              <select value={draftCategory} onChange={(event) => setDraftCategory(event.target.value as DocumentCategory)}>
                                {DOCUMENT_CATEGORIES.map((value) => <option value={value} key={value}>{documentCategoryLabels[value]}</option>)}
                              </select>
                            </label>
                            <label>
                              <span>Statut documentaire</span>
                              <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as DocumentStatus)}>
                                {DOCUMENT_STATUSES.map((value) => <option value={value} key={value}>{documentStatusLabels[value]}</option>)}
                              </select>
                            </label>
                            <button className="primary-button" type="button" disabled={savingClassification} onClick={() => saveClassification(document)}>
                              {savingClassification ? "Enregistrement…" : "Enregistrer le classement"}
                            </button>
                            {classificationFeedback.error ? <p className="auth-message is-error" role="alert">{classificationFeedback.error}</p> : null}
                            {classificationFeedback.success ? <p className="auth-message is-success" role="status">{classificationFeedback.success}</p> : null}
                          </div>
                        </section>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                ))}</tbody>
              </table>
            </div>
          ) : documentWarning ? (
            <div className="document-information" role="status">
              Le registre n’a pas pu être vérifié complètement. Aucun état « aucun document » n’est affiché. {documentWarning}
            </div>
          ) : (
            <EmptyState
              icon={documents.length ? <Search size={22} /> : <FileText size={22} />}
              title={documents.length ? "Aucun résultat" : "Aucun document enregistré"}
              description={documents.length ? "Modifiez la recherche ou les filtres pour afficher des documents." : "Importez un PDF ou une image pour commencer. Aucun document de démonstration n’est affiché."}
              action={!documents.length ? <button className="primary-button" type="button" onClick={() => setShowUpload(true)}><Plus size={15} />Importer un document</button> : undefined}
            />
          )}
        </section>
      ) : null}
      {documentPreview ? (
        <div
          className="document-reader-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDocumentPreview();
          }}
        >
          <section
            className="document-reader"
            role="dialog"
            aria-modal="true"
            aria-labelledby="document-reader-title"
          >
            <header className="document-reader-header">
              <div>
                <h2 id="document-reader-title">{documentPreview.document.fileName}</h2>
                <p>{documentCategoryLabels[documentPreview.document.category]}</p>
              </div>
              <button className="document-reader-close" type="button" onClick={closeDocumentPreview} aria-label="Fermer le lecteur">
                <X size={18} />
              </button>
            </header>
            <div className="document-reader-content">
              {documentPreview.status === "loading" ? (
                <p role="status">Chargement du document…</p>
              ) : documentPreview.status === "error" ? (
                <p className="document-reader-error" role="alert">{documentPreview.error}</p>
              ) : documentPreview.fileType === "application/pdf" && documentPreview.url ? (
                <iframe
                  className="document-reader-pdf"
                  src={documentPreview.url}
                  title={`Lecture de ${documentPreview.document.fileName}`}
                  referrerPolicy="no-referrer"
                />
              ) : (documentPreview.fileType === "image/jpeg" || documentPreview.fileType === "image/png")
                && documentPreview.url ? (
                <Image
                  className="document-reader-image"
                  src={documentPreview.url}
                  alt={documentPreview.document.fileName}
                  fill
                  unoptimized
                  sizes="(max-width: 560px) 100vw, 1100px"
                  referrerPolicy="no-referrer"
                  onError={() => setDocumentPreview((current) => current?.document.id === documentPreview.document.id
                    ? { ...current, status: "error", error: "Le fichier image est introuvable ou n’a pas pu être chargé." }
                    : current)}
                />
              ) : <p role="alert">Le type de document n’est pas autorisé pour la lecture.</p>}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
