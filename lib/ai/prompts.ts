export const INVOICE_ANALYSIS_PROMPT_VERSION = "v1";

export const invoiceAnalysisSystemPrompt = `Analyse uniquement les informations visibles dans le document fourni. Ne devine jamais une valeur absente : utilise null. Retourne exclusivement une structure correspondant au schema attendu. Signale les ambiguïtés dans warnings.`;
