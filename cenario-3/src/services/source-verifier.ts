// Camada 2 do harness (Verification Loops): verifica se o documento citado
// na resposta do assistente existe na base documental válida da NovaTech.
// Se não existir, a resposta é marcada como suspeita antes de chegar ao atendente.

import { logger } from "../../cenario-2/src/shared/logger";

const VALID_DOCUMENT_IDS = [
  "POL-001",
  "PROC-042",
  "PROC-042-v2",
  "SLA-2024",
  "FAQ-Atendimento",
] as const;

type ValidDocumentId = (typeof VALID_DOCUMENT_IDS)[number];

export interface SourceVerificationResult {
  isValid: boolean;
  documentId: string;
  originalSource: string;
  reason?: string;
}

/**
 * Extrai o ID do documento de uma string como "POL-001, seção 3.2"
 * e verifica se está na lista de documentos válidos da NovaTech.
 *
 * Retorna isValid: false quando:
 * - sourceDocument está vazio ou é "not_found"
 * - o ID extraído não está na lista de documentos válidos
 */
export function verifySourceDocument(
  sourceDocument: string,
  queryId?: string,
): SourceVerificationResult {
  if (!sourceDocument || sourceDocument.trim() === "" || sourceDocument === "not_found") {
    const result: SourceVerificationResult = {
      isValid: false,
      documentId: "",
      originalSource: sourceDocument,
      reason: "source_document is absent or not_found — response has no traceable source",
    };
    logger.warn({ queryId, result }, "source verification failed: no source");
    return result;
  }

  // Extrai o ID antes da primeira vírgula e normaliza espaços
  const documentId = sourceDocument.split(",")[0].trim();

  const isValid = (VALID_DOCUMENT_IDS as readonly string[]).includes(documentId);

  const result: SourceVerificationResult = {
    isValid,
    documentId,
    originalSource: sourceDocument,
    reason: isValid
      ? undefined
      : `Document ID "${documentId}" is not in the NovaTech valid document list`,
  };

  if (!isValid) {
    logger.warn({ queryId, documentId, originalSource: sourceDocument }, "source verification failed: unknown document");
  }

  return result;
}

/**
 * Verifica se uma resposta do assistente deve ser bloqueada com base
 * na validação da fonte citada. Retorna true se a resposta é segura para envio.
 */
export function isResponseSafeToDeliver(
  sourceDocument: string,
  queryId?: string,
): boolean {
  const verification = verifySourceDocument(sourceDocument, queryId);
  return verification.isValid;
}
