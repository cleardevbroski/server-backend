const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const DocumentExtraction = require("../models/DocumentExtraction");
const Property = require("../models/Property");
const { PROPERTY_DOCUMENT_MAX_BYTES } = require("../utils/propertyMediaLimits");

const execFileAsync = promisify(execFile);
const BINARIES = {
  pdftotext: process.env.PDFTOTEXT_BINARY || "/usr/bin/pdftotext",
  pdfinfo: process.env.PDFINFO_BINARY || "/usr/bin/pdfinfo",
  pdftoppm: process.env.PDFTOPPM_BINARY || "/usr/bin/pdftoppm",
  tesseract: process.env.TESSERACT_BINARY || "/usr/bin/tesseract",
};
const MAX_PAGES = Math.min(Math.max(Number(process.env.DOCUMENT_OCR_MAX_PAGES) || 80, 1), 200);
const MAX_CHARACTERS = 750000;

function clean(value) { return String(value || "").trim(); }
function fingerprint(document) {
  return crypto.createHash("sha256").update([document.fileUrl, document.fileSize, document.mimeType].join("|")).digest("hex");
}

function collectDocuments(property) {
  const documents = [];
  (property.reraPhases || []).forEach((phase, phaseIndex) => {
    const phaseId = clean(phase._id) || `phase-${phaseIndex + 1}`;
    const phaseName = clean(phase.name) || `Phase ${phaseIndex + 1}`;
    for (const [field, sourceKind] of [["reraDocuments", "rera_document"], ["projectDocuments", "project_document"]]) {
      (phase[field] || []).forEach((document, index) => {
        if (!document.fileUrl || !["application/pdf", "image/jpeg", "image/png"].includes(document.mimeType)) return;
        const stableId = clean(document._id) || clean(document.key) || `${index + 1}-${document.fileName}`;
        documents.push({
          property: property._id, phaseId, phaseName, sourceKind,
          documentKey: `${sourceKind}:${phaseId}:${stableId}`,
          label: document.label || document.fileName,
          fileName: document.fileName,
          fileUrl: document.fileUrl,
          mimeType: document.mimeType,
          fileSize: Number(document.fileSize) || 0,
        });
      });
    }
  });
  (property.projectDownloads || []).forEach((document, index) => {
    if (document.mimeType !== "application/pdf" || !document.fileUrl) return;
    const stableId = clean(document._id) || `${index + 1}-${document.fileName}`;
    documents.push({ property: property._id, sourceKind: "project_download", documentKey: `project_download:${stableId}`, label: document.label || document.fileName, fileName: document.fileName, fileUrl: document.fileUrl, mimeType: document.mimeType, fileSize: Number(document.fileSize) || 0 });
  });
  if (property.brochure) {
    documents.push({ property: property._id, sourceKind: "brochure", documentKey: "brochure:primary", label: "Project brochure", fileName: property.brochureName || "Project brochure.pdf", fileUrl: property.brochure, mimeType: "application/pdf", fileSize: 0 });
  }
  return documents;
}

async function syncPropertyDocuments(propertyId) {
  const property = await Property.findById(propertyId).lean();
  if (!property) throw Object.assign(new Error("Property not found"), { status: 404 });
  const discovered = collectDocuments(property);
  let created = 0;
  let changed = 0;
  for (const document of discovered) {
    const documentFingerprint = fingerprint(document);
    const existing = await DocumentExtraction.findOne({ property: property._id, documentKey: document.documentKey });
    if (!existing) {
      await DocumentExtraction.create({ ...document, documentFingerprint });
      created += 1;
      continue;
    }
    const didChange = existing.documentFingerprint !== documentFingerprint;
    existing.set({ ...document, documentFingerprint });
    if (didChange) {
      existing.status = "queued";
      existing.pages = [];
      existing.pageCount = 0;
      existing.characterCount = 0;
      existing.extractionMethod = "";
      existing.error = "";
      existing.extractedAt = null;
      existing.reviewedBy = null;
      existing.reviewedAt = null;
      changed += 1;
    }
    await existing.save();
  }
  return { property, discovered: discovered.length, created, changed };
}

async function binaryAvailable(binary) {
  try { await fs.access(binary); return true; } catch { return false; }
}

async function extractionCapabilities() {
  const status = Object.fromEntries(await Promise.all(Object.entries(BINARIES).map(async ([name, binary]) => [name, await binaryAvailable(binary)])));
  return { ...status, pdfText: status.pdftotext && status.pdfinfo, pdfOcr: status.pdftoppm && status.tesseract, imageOcr: status.tesseract, maxPages: MAX_PAGES };
}

function assertSafeDocumentUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com") throw new Error("Only ClearTitle Cloudinary documents can be extracted");
  return url;
}

async function downloadDocument(fileUrl, target) {
  const source = assertSafeDocumentUrl(fileUrl);
  const response = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body) throw new Error(`Document download returned ${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (declared > PROPERTY_DOCUMENT_MAX_BYTES) throw new Error("Document exceeds the extraction size limit");
  let bytes = 0;
  const limiter = new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > PROPERTY_DOCUMENT_MAX_BYTES) throw new Error("Document exceeds the extraction size limit");
      controller.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body.pipeThrough(limiter)), require("fs").createWriteStream(target));
}

async function run(binary, args, options = {}) {
  if (!(await binaryAvailable(binary))) throw new Error(`${path.basename(binary)} is not installed on this server`);
  return execFileAsync(binary, args, { timeout: options.timeout || 120000, maxBuffer: options.maxBuffer || 12 * 1024 * 1024 });
}

async function pdfPageCount(input) {
  const { stdout } = await run(BINARIES.pdfinfo, [input]);
  const match = stdout.match(/^Pages:\s+(\d+)/mi);
  return Math.min(Number(match?.[1]) || 1, MAX_PAGES);
}

async function ocrPdfPage(input, directory, pageNumber) {
  const prefix = path.join(directory, `page-${pageNumber}`);
  await run(BINARIES.pdftoppm, ["-f", String(pageNumber), "-l", String(pageNumber), "-r", "180", "-jpeg", "-singlefile", input, prefix], { timeout: 120000 });
  const image = `${prefix}.jpg`;
  const { stdout } = await run(BINARIES.tesseract, [image, "stdout", "-l", "eng"], { timeout: 120000 });
  return clean(stdout);
}

async function extractPdf(input, directory) {
  const output = path.join(directory, "embedded.txt");
  const count = await pdfPageCount(input);
  await run(BINARIES.pdftotext, ["-f", "1", "-l", String(count), "-layout", input, output]);
  const embedded = await fs.readFile(output, "utf8").catch(() => "");
  const pageTexts = embedded.split("\f");
  const pages = [];
  for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
    const embeddedText = clean(pageTexts[pageNumber - 1]);
    if (embeddedText.replace(/\s/g, "").length >= 40) {
      pages.push({ pageNumber, originalText: embeddedText, reviewedText: embeddedText, method: "embedded_text" });
      continue;
    }
    const ocrText = await ocrPdfPage(input, directory, pageNumber);
    pages.push({ pageNumber, originalText: ocrText, reviewedText: ocrText, method: "ocr" });
  }
  return pages;
}

async function extractImage(input) {
  const { stdout } = await run(BINARIES.tesseract, [input, "stdout", "-l", "eng"], { timeout: 120000 });
  const value = clean(stdout);
  return [{ pageNumber: 1, originalText: value, reviewedText: value, method: "ocr" }];
}

async function processDocumentExtraction(extractionId) {
  const extraction = await DocumentExtraction.findOneAndUpdate(
    { _id: extractionId, status: { $ne: "processing" } },
    { $set: { status: "processing", error: "" } },
    { new: true },
  );
  if (!extraction) {
    const exists = await DocumentExtraction.exists({ _id: extractionId });
    throw Object.assign(new Error(exists ? "Document extraction is already running" : "Document extraction not found"), { status: exists ? 409 : 404 });
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cleartitle-document-"));
  const extension = extraction.mimeType === "application/pdf" ? ".pdf" : extraction.mimeType === "image/png" ? ".png" : ".jpg";
  const input = path.join(directory, `source${extension}`);
  try {
    await downloadDocument(extraction.fileUrl, input);
    let pages = extraction.mimeType === "application/pdf" ? await extractPdf(input, directory) : await extractImage(input);
    let remaining = MAX_CHARACTERS;
    pages = pages.map((page) => {
      if (remaining <= 0) return { ...page, originalText: "", reviewedText: "" };
      const originalText = clean(page.originalText).slice(0, remaining);
      remaining -= originalText.length;
      return { ...page, originalText, reviewedText: originalText };
    }).filter((page) => page.originalText);
    if (!pages.length) throw new Error("No readable text was found in this document");
    const methods = new Set(pages.map((page) => page.method));
    extraction.pages = pages;
    extraction.pageCount = pages.length;
    extraction.characterCount = pages.reduce((sum, page) => sum + page.originalText.length, 0);
    extraction.extractionMethod = methods.size > 1 ? "mixed" : [...methods][0];
    extraction.status = "review_required";
    extraction.extractedAt = new Date();
    await extraction.save();
    return extraction;
  } catch (error) {
    extraction.status = "failed";
    extraction.error = clean(error.message || error).slice(0, 2000);
    await extraction.save();
    throw error;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

module.exports = { collectDocuments, syncPropertyDocuments, extractionCapabilities, processDocumentExtraction };
