"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Image as ImageIcon, Plus, Search, Trash2, UploadCloud } from "lucide-react";
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
  relationshipWarning,
}: {
  companies: DocumentCompany[];
  documents: DocumentRecord[];
  loadError: string | null;
  information?: string;
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
  const [downloadingDocumentId, setDownloadingDocumentId] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<{ id: string; url: string } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [uploadClientError, setUploadClientError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadState, uploadAction, uploadPending] = useActionState(uploadDocument, initialState);

  useEffect(() => {
    if (uploadState.success) router.refresh();
  }, [router, uploadState.success]);

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
      setDownloadUrl(null);
      setDeleteSuccess(result.success);
      router.refresh();
    });
  }

  async function handleDownload(document: DocumentRecord) {
    if (downloadingDocumentId) return;
    setDownloadError(null);
    setDownloadUrl(null);
    setDownloadingDocumentId(document.id);
    try {
      const result = await createDocumentDownloadUrl(document.companyId, document.id);
      if (result.error || !result.url) {
        setDownloadError(result.error ?? "Le lien de consultation n’a pas pu être créé.");
        return;
      }
      setDownloadUrl({ id: document.id, url: result.url });
    } catch {
      console.error("Document signed URL request failed");
      setDownloadError("Le lien de consultation n’a pas pu être créé. Vérifiez votre connexion et réessayez.");
    } finally {
      setDownloadingDocumentId(null);
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

  function openFilePicker() {
    if (uploadPending) return;
    setShowUpload(true);
    setUploadClientError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

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
      <input
        ref={fileInputRef}
        className="sr-only"
        id="document-upload-file"
        name="file"
        type="file"
        form="document-upload-form"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        disabled={uploadPending}
        onChange={handleFileSelection}
        aria-label="Sélectionner un document PDF, JPG ou PNG"
      />
      <div className="page-intro invoice-page-intro">
        <div>
          <div className="eyebrow-row"><span className="eyebrow-dot" /><span>Gestion documentaire</span></div>
          <h1>Documents</h1>
          <p>Centralisez les pièces financières dans un stockage privé de vos espaces d’entreprise.</p>
        </div>
        <button className="primary-button" type="button" onClick={openFilePicker} disabled={Boolean(loadError) || companies.length === 0 || uploadPending}>
          <Plus size={17} /> Importer un document
        </button>
      </div>

      {information ? <p className="document-information" role="status">{information}</p> : null}
      {relationshipWarning ? <p className="document-information" role="status">{relationshipWarning}</p> : null}
      {loadError ? (
        <div className="document-error-state" role="alert">
          <p>{loadError}</p><button className="text-button" type="button" onClick={() => router.refresh()}>Réessayer</button>
        </div>
      ) : null}
      {deleteError ? <p className="auth-message is-error document-message" role="alert">{deleteError}</p> : null}
      {deleteSuccess ? <p className="auth-message is-success document-message" role="status">{deleteSuccess}</p> : null}
      {downloadError ? <p className="auth-message is-error document-message" role="alert">{downloadError}</p> : null}

      {showUpload && !loadError && companies.length ? (
        <section className="surface-panel document-upload-panel" aria-labelledby="document-upload-heading">
          <div className="invoice-form-title">
            <div><span className="panel-kicker">Stockage privé</span><h2 id="document-upload-heading">Importer un document</h2></div>
            <button className="text-button" type="button" onClick={() => setShowUpload(false)} disabled={uploadPending}>Fermer</button>
          </div>
          <form id="document-upload-form" action={uploadAction} className="document-upload-form">
            <label className="invoice-field">
              <span>Espace d’entreprise</span>
              <select name="companyId" defaultValue={companyId === "all" ? companies[0]?.id : companyId} required>
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
            <label className="invoice-field document-file-field">
              <span><label htmlFor="document-upload-file">Fichier (PDF, JPG ou PNG, 10 Mo maximum)</label></span>
              <span className="document-selected-file" aria-live="polite">{selectedFileName ?? "Aucun fichier sélectionné"}</span>
            </label>
            <button className="primary-button" type="submit" disabled={uploadPending}>
              <UploadCloud size={16} />{uploadPending ? "Import en cours…" : "Importer"}
            </button>
          </form>
          {uploadState.error ? <p className="auth-message is-error" role="alert">{uploadState.error}</p> : null}
          {uploadClientError ? <p className="auth-message is-error" role="alert">{uploadClientError}</p> : null}
          {uploadState.success ? <p className="auth-message is-success" role="status">{uploadState.success}</p> : null}
          <p className="document-upload-help">Les documents sont stockés dans un bucket privé. Aucun OCR ni analyse automatique n’est lancé.</p>
        </section>
      ) : null}

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
                  <tr>
                    <td className="document-name-cell">{document.fileType === "application/pdf" ? <FileText size={17} /> : <ImageIcon size={17} />}<strong>{document.fileName}</strong></td>
                    <td>{documentCategoryLabels[document.category]}</td>
                    <td><Badge tone={document.status === "validated" ? "success" : "neutral"}>{documentStatusLabels[document.status]}</Badge></td>
                    <td>{companies.find(({ id }) => id === document.companyId)?.name ?? "Espace entreprise"}</td>
                    <td><Badge tone="neutral">{fileTypeLabels[document.fileType]}</Badge></td>
                    <td>{formatDocumentSize(document.fileSize)}</td>
                    <td>{dateLabel(document.uploadedAt)}</td>
                    <td className="document-row-actions">
                      <button className="text-button" type="button" aria-expanded={detailsDocumentId === document.id} onClick={() => showDocumentDetails(document)}>Détails</button>
                      {downloadUrl?.id === document.id
                        ? <a className="text-button" href={downloadUrl.url} target="_blank" rel="noopener noreferrer">Ouvrir le document</a>
                        : <button className="text-button" type="button" disabled={downloadingDocumentId !== null} onClick={() => void handleDownload(document)}>
                          {downloadingDocumentId === document.id ? "Préparation du lien…" : "Consulter"}
                        </button>}
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
                            <div><dt>Entreprise propriétaire</dt><dd>{companies.find(({ id }) => id === document.companyId)?.name ?? "Espace entreprise"}</dd></div>
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
                          {document.category === "customer_invoice" || document.category === "supplier_invoice" ? (
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
          ) : (
            <EmptyState
              icon={documents.length ? <Search size={22} /> : <FileText size={22} />}
              title={documents.length ? "Aucun résultat" : "Aucun document enregistré"}
              description={documents.length ? "Modifiez la recherche ou les filtres pour afficher des documents." : "Importez un PDF ou une image pour commencer. Aucun document de démonstration n’est affiché."}
              action={!documents.length && companies.length ? <button className="primary-button" type="button" onClick={() => setShowUpload(true)}><Plus size={15} />Importer un document</button> : undefined}
            />
          )}
        </section>
      ) : null}
    </>
  );
}
