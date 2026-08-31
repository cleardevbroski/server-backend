const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const cloudinary = require("cloudinary").v2;
const Property = require("../models/Property");
const PropertyImportBatch = require("../models/PropertyImportBatch");
const User = require("../models/User");
const { parsePropertyTemplate } = require("./propertyTemplateParser");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ACCEPTED_STATUS = new Set(["approved", "downloaded"]);
// Cloudinary Free currently caps both image and raw uploads at 10 MB. Leave
// headroom for provider-side multipart accounting.
const CLOUDINARY_FREE_FILE_BYTES = (10 * 1024 * 1024) - (16 * 1024);
const MEDIA_UPLOAD_CONCURRENCY = 5;
const DOCUMENT_UPLOAD_CONCURRENCY = 3;
const CLOUDINARY_UPLOAD_TIMEOUT_MS = 180_000;

function clean(value) { return String(value ?? "").trim(); }
function slug(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "property"; }
function ext(value) { return path.extname(clean(value)).toLowerCase(); }
function hash(value) { return crypto.createHash("sha1").update(value).digest("hex").slice(0, 16); }
function accepted(row) { return ACCEPTED_STATUS.has(clean(row?.status).toLowerCase()) && clean(row?.saved_as); }

function isTransientNetworkError(error) {
  const message = errorMessage(error);
  const code = String(error?.code || "");
  const httpCode = Number(error?.http_code || error?.statusCode || 0);
  return ["EAI_AGAIN", "ENOTFOUND", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"].includes(code)
    || /EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|getaddrinfo|server selection|MongoServerSelectionError|socket hang up|network|fetch failed|request timeout|TimeoutError|timed?\s*out|connection.*closed/i.test(message)
    || httpCode === 408 || httpCode === 429 || httpCode === 499 || httpCode >= 500
    || /"http_code"\s*:\s*(?:408|429|499|5\d\d)/.test(message);
}

function errorMessage(error) {
  if (typeof error === "string") return error;
  if (typeof error?.message === "string") return error.message;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], ...options });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exited with code ${code}`)));
  });
}

async function extractArchiveEntry(zipPath, archivePath, outputPath) {
  await new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-p", zipPath, archivePath], { stdio: ["ignore", "pipe", "pipe"] });
    const output = fs.createWriteStream(outputPath, { flags: "wx" });
    let stderr = "";
    let processClosed = false;
    let outputClosed = false;
    const finish = () => { if (processClosed && outputClosed) resolve(); };
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    output.on("error", reject);
    output.on("close", () => { outputClosed = true; finish(); });
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `Unable to extract ${archivePath}`));
      processClosed = true;
      finish();
    });
    child.stdout.pipe(output);
  });
  return outputPath;
}

async function uploadLocalFile({ filePath, folder, resourceType, packageKey, identity, extension = path.extname(filePath) }) {
  const identifier = hash(`${packageKey}:${identity}`);
  const publicId = resourceType === "raw" ? `${identifier}${extension || ".bin"}` : identifier;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const result = await cloudinary.uploader.upload(filePath, {
        resource_type: resourceType,
        folder,
        public_id: publicId,
        unique_filename: false,
        overwrite: true,
        invalidate: false,
        use_filename: false,
        timeout: CLOUDINARY_UPLOAD_TIMEOUT_MS,
      });
      return { url: result.secure_url, bytes: Number(result.bytes) || 0, publicId: result.public_id, resourceType: result.resource_type };
    } catch (error) {
      if (attempt === 4 || !isTransientNetworkError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw new Error(`Unable to upload ${path.basename(filePath)}`);
}

async function optimizeOversizedImage(inputPath, outputPath) {
  const attempts = [
    ["-auto-orient", "-resize", "3200x3200>", "-quality", "88"],
    ["-auto-orient", "-resize", "2600x2600>", "-quality", "82"],
    ["-auto-orient", "-resize", "2200x2200>", "-quality", "78"],
  ];
  for (const args of attempts) {
    await runProcess("convert", [inputPath, ...args, outputPath]);
    if ((await fs.promises.stat(outputPath)).size <= CLOUDINARY_FREE_FILE_BYTES) return outputPath;
  }
  throw new Error(`Image remains larger than Cloudinary's free per-file limit after optimization: ${path.basename(inputPath)}`);
}

async function renderPdfPageTiles(pagePath, tempFolder, pageIndex) {
  const rendered = path.join(tempFolder, `rendered-page-${String(pageIndex + 1).padStart(6, "0")}.jpg`);
  await runProcess("gs", [
    "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=jpeg", "-r180", "-dJPEGQ=90",
    "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4", `-sOutputFile=${rendered}`, pagePath,
  ]);
  if ((await fs.promises.stat(rendered)).size <= CLOUDINARY_FREE_FILE_BYTES) return [{ filePath: rendered, extension: ".jpg" }];
  const tilePattern = path.join(tempFolder, `rendered-page-${String(pageIndex + 1).padStart(6, "0")}-tile-%02d.jpg`);
  await runProcess("convert", [rendered, "-crop", "2x2@", "+repage", "-quality", "90", tilePattern]);
  const tiles = (await fs.promises.readdir(tempFolder))
    .filter((name) => new RegExp(`^rendered-page-${String(pageIndex + 1).padStart(6, "0")}-tile-\\d+\\.jpg$`).test(name))
    .sort()
    .map((name) => path.join(tempFolder, name));
  if (!tiles.length) throw new Error(`Unable to tile oversized PDF page ${pageIndex + 1}`);
  const results = [];
  for (const [tileIndex, tile] of tiles.entries()) {
    if ((await fs.promises.stat(tile)).size <= CLOUDINARY_FREE_FILE_BYTES) results.push({ filePath: tile, extension: ".jpg" });
    else {
      const optimized = path.join(tempFolder, `rendered-page-${String(pageIndex + 1).padStart(6, "0")}-tile-${tileIndex + 1}-optimized.jpg`);
      await optimizeOversizedImage(tile, optimized);
      results.push({ filePath: optimized, extension: ".jpg" });
    }
  }
  return results;
}

async function uploadMediaTask({ task, zipPath, folder, packageKey }) {
  const tempFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "property-media-"));
  try {
    const sourcePath = path.join(tempFolder, `source${ext(task.archivePath) || ".bin"}`);
    await extractArchiveEntry(zipPath, task.archivePath, sourcePath);
    let uploadPath = sourcePath;
    let optimized = false;
    if ((await fs.promises.stat(sourcePath)).size > CLOUDINARY_FREE_FILE_BYTES) {
      uploadPath = path.join(tempFolder, "optimized.jpg");
      await optimizeOversizedImage(sourcePath, uploadPath);
      optimized = true;
    }
    return {
      ...task,
      ...(await uploadLocalFile({ filePath: uploadPath, folder, resourceType: "image", packageKey, identity: task.archivePath, extension: path.extname(uploadPath) })),
      optimized,
    };
  } finally {
    await fs.promises.rm(tempFolder, { recursive: true, force: true });
  }
}

async function splitPdfToFreeSizedParts(inputPath, tempFolder) {
  const pagePattern = path.join(tempFolder, "page-%06d.pdf");
  await runProcess("pdfseparate", [inputPath, pagePattern]);
  const pages = (await fs.promises.readdir(tempFolder)).filter((name) => /^page-\d+\.pdf$/.test(name)).sort().map((name) => path.join(tempFolder, name));
  if (!pages.length) throw new Error(`Unable to split oversized PDF: ${path.basename(inputPath)}`);
  const normalizedPages = [];
  for (const [index, page] of pages.entries()) {
    if ((await fs.promises.stat(page)).size <= CLOUDINARY_FREE_FILE_BYTES) { normalizedPages.push({ filePath: page, extension: ".pdf" }); continue; }
    let optimized = "";
    for (const [attempt, resolution] of [240, 200, 150, 120, 96].entries()) {
      const candidate = path.join(tempFolder, `optimized-page-${String(index + 1).padStart(6, "0")}-${attempt + 1}.pdf`);
      await runProcess("gs", [
        "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.4",
        "-dDetectDuplicateImages=true", "-dCompressFonts=true",
        "-dDownsampleColorImages=true", "-dDownsampleGrayImages=true", "-dDownsampleMonoImages=true",
        `-dColorImageResolution=${resolution}`, `-dGrayImageResolution=${resolution}`, `-dMonoImageResolution=${Math.max(300, resolution)}`,
        `-sOutputFile=${candidate}`, page,
      ]);
      if ((await fs.promises.stat(candidate)).size <= CLOUDINARY_FREE_FILE_BYTES) { optimized = candidate; break; }
    }
    if (optimized) normalizedPages.push({ filePath: optimized, extension: ".pdf" });
    else normalizedPages.push(...await renderPdfPageTiles(page, tempFolder, index));
  }
  const groups = [];
  let group = [];
  let groupBytes = 0;
  const flushGroup = () => { if (group.length) groups.push({ kind: "pdf", pages: group }); group = []; groupBytes = 0; };
  for (const page of normalizedPages) {
    if (page.extension !== ".pdf") { flushGroup(); groups.push({ kind: "file", page }); continue; }
    const pageBytes = (await fs.promises.stat(page.filePath)).size;
    if (group.length && groupBytes + pageBytes > 9 * 1024 * 1024) flushGroup();
    group.push(page.filePath); groupBytes += pageBytes;
  }
  flushGroup();
  const parts = [];
  for (const [index, entry] of groups.entries()) {
    if (entry.kind === "file") { parts.push(entry.page); continue; }
    const pagesInGroup = entry.pages;
    const output = path.join(tempFolder, `part-${String(index + 1).padStart(3, "0")}.pdf`);
    await runProcess("pdfunite", [...pagesInGroup, output]);
    if ((await fs.promises.stat(output)).size > CLOUDINARY_FREE_FILE_BYTES) {
      // pdfunite adds a little overhead. Fall back to one page per part for
      // this group, which is still lossless for pages that did not need GS.
      for (const page of pagesInGroup) parts.push({ filePath: page, extension: ".pdf" });
    } else parts.push({ filePath: output, extension: ".pdf" });
  }
  return parts;
}

function documentMimeType(fileName) {
  const extension = ext(fileName);
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".png") return "image/png";
  return "application/pdf";
}

async function uploadDocumentTask({ task, zipPath, folder, packageKey }) {
  const tempFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "property-document-"));
  try {
    const extension = ext(task.archivePath) || ".pdf";
    const sourcePath = path.join(tempFolder, `source${extension}`);
    await extractArchiveEntry(zipPath, task.archivePath, sourcePath);
    const sourceBytes = (await fs.promises.stat(sourcePath)).size;
    let parts = [{ filePath: sourcePath, extension }];
    if (sourceBytes > CLOUDINARY_FREE_FILE_BYTES) {
      if (extension === ".pdf") parts = await splitPdfToFreeSizedParts(sourcePath, tempFolder);
      else if ([".jpg", ".jpeg", ".png"].includes(extension)) {
        const optimized = path.join(tempFolder, "optimized.jpg");
        await optimizeOversizedImage(sourcePath, optimized);
        parts = [{ filePath: optimized, extension: ".jpg" }];
      } else throw new Error(`RERA document exceeds Cloudinary's free per-file limit and cannot be split: ${path.basename(task.archivePath)}`);
    }
    const results = [];
    for (const [partIndex, part] of parts.entries()) {
      results.push({
        ...task,
        partIndex,
        partCount: parts.length,
        sourceBytes,
        outputExtension: part.extension,
        ...(await uploadLocalFile({ filePath: part.filePath, folder, resourceType: "raw", packageKey, identity: `${task.archivePath}:part:${partIndex + 1}`, extension: part.extension })),
      });
    }
    return results;
  } finally {
    await fs.promises.rm(tempFolder, { recursive: true, force: true });
  }
}

function numericArea(value) {
  return clean(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0] || "";
}

function matchConfigurationIndex(rows, label, savedAs) {
  const source = `${label} ${savedAs}`;
  const bhk = source.match(/\b(\d+(?:\.5)?)\s*BHK\b/i)?.[1];
  const area = source.match(/\b(\d{3,5})\s*(?:Sq\.?\s*Ft\.?|sqft)\b/i)?.[1];
  if (!bhk && !area) return -1;
  let index = rows.findIndex((row) => (!bhk || clean(row.configuration).startsWith(`${Number(bhk)} BHK`)) && (!area || numericArea(row.builtUpArea || row.superBuiltUpArea || row.carpetArea) === area));
  if (index < 0 && bhk) index = rows.findIndex((row) => clean(row.configuration).startsWith(`${Number(bhk)} BHK`));
  return index;
}

function resolvedPath(staged, manifestPath, savedAs) {
  const exact = (staged.resolvedManifestFiles || []).find((row) => row.manifest === manifestPath && row.savedAs === savedAs);
  if (!exact?.archivePath) throw new Error(`Manifest file is not resolved: ${manifestPath} -> ${savedAs}`);
  return exact.archivePath;
}

function documentKey(label, index) {
  return `${slug(label).slice(0, 70) || "document"}-${index + 1}`;
}

function isReraDocument(row) {
  return /rera\s*(details|registration)|registration\s*certificate/i.test(`${row.category || ""} ${row.label || ""} ${row.saved_as || ""}`);
}

function mediaTasks(staged, payload) {
  const rows = (staged.assetManifest || []).filter(accepted);
  const configurations = payload.configurationDetails || [];
  const firstKind = new Map();
  rows.forEach((row, index) => {
    const kind = clean(row.kind).toLowerCase();
    if (!firstKind.has(kind)) firstKind.set(kind, index);
  });
  return rows.flatMap((row, index) => {
    const kind = clean(row.kind).toLowerCase();
    if (["project_images", "brochure", "walkthrough"].includes(kind)) return [];
    if (["master_plan", "developer_logo"].includes(kind) && firstKind.get(kind) !== index) return [];
    let configurationIndex = -1;
    if (["floor_plan", "3d_plan"].includes(kind)) {
      configurationIndex = matchConfigurationIndex(configurations, clean(row.label), clean(row.saved_as));
      if (configurationIndex < 0) return [];
    }
    if (!["gallery", "master_plan", "developer_logo", "floor_plan", "3d_plan"].includes(kind)) return [];
    return [{
      kind,
      label: clean(row.label),
      archivePath: resolvedPath(staged, staged.assetManifestPath, clean(row.saved_as)),
      configurationIndex,
    }];
  });
}

function documentTasks(staged) {
  const tasks = [];
  (staged.reraPhases || []).forEach((phase, phaseIndex) => {
    (phase.documents || []).filter(accepted).forEach((row, documentIndex) => {
      tasks.push({
        phaseIndex,
        documentIndex,
        row,
        archivePath: resolvedPath(staged, phase.manifestPath, clean(row.saved_as)),
      });
    });
  });
  return tasks;
}

async function mapConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function uploadPackageMedia({ staged, payload, zipPath, batchKey }) {
  const projectSlug = slug(payload.title);
  const root = `clear-title/properties/batches/${slug(batchKey)}/${projectSlug}`;
  const media = mediaTasks(staged, payload);
  const documents = documentTasks(staged);
  const mediaResults = await mapConcurrency(media, MEDIA_UPLOAD_CONCURRENCY, (task) => uploadMediaTask({ task, zipPath, folder: `${root}/${task.kind}`, packageKey: staged.package.packageKey }));
  const documentResults = (await mapConcurrency(documents, DOCUMENT_UPLOAD_CONCURRENCY, (task) => uploadDocumentTask({ task, zipPath, folder: `${root}/documents`, packageKey: staged.package.packageKey }))).flat();

  const gallery = mediaResults.filter((row) => row.kind === "gallery").map((row) => row.url);
  if (gallery.length) {
    payload.image = gallery[0];
    payload.heroImages = gallery.slice(0, 3);
    payload.images = gallery;
  }
  const master = mediaResults.find((row) => row.kind === "master_plan");
  if (master) payload.masterPlan = { ...(payload.masterPlan || {}), imageUrl: master.url };
  const logo = mediaResults.find((row) => row.kind === "developer_logo");
  if (logo) payload.developerLogoUrl = logo.url;
  const configurations = (payload.configurationDetails || []).map((row) => ({ ...row }));
  mediaResults.filter((row) => row.configurationIndex >= 0).forEach((row) => {
    const config = configurations[row.configurationIndex];
    if (!config) return;
    if (row.kind === "3d_plan") config.floorPlan3dUrl = row.url;
    else config.floorPlan2dUrl = row.url;
  });
  if (configurations.length) payload.configurationDetails = configurations;

  const phases = (payload.reraPhases || []).map((phase) => ({ ...phase, reraDocuments: [], projectDocuments: [] }));
  const downloads = [];
  documentResults.forEach((result, index) => {
    const row = result.row;
    const partSuffix = result.partCount > 1 ? ` (Part ${result.partIndex + 1} of ${result.partCount})` : "";
    const document = {
      key: documentKey(clean(row.label) || path.basename(result.archivePath), index),
      label: `${clean(row.label) || path.basename(result.archivePath)}${partSuffix}`,
      annexure: clean(row.category),
      fileName: result.partCount > 1 ? `${path.basename(result.archivePath, path.extname(result.archivePath))}-part-${result.partIndex + 1}${result.outputExtension}` : `${path.basename(result.archivePath, path.extname(result.archivePath))}${result.outputExtension}`,
      fileUrl: result.url,
      mimeType: documentMimeType(result.outputExtension),
      fileSize: result.bytes,
    };
    const phase = phases[result.phaseIndex] || phases[0];
    if (!phase) return;
    (isReraDocument(row) ? phase.reraDocuments : phase.projectDocuments).push(document);
    if (!downloads.length && document.mimeType === "application/pdf" && /brochure/i.test(`${row.label || ""} ${row.saved_as || ""}`)) {
      downloads.push({ kind: "brochure", label: "Project Brochure", fileName: document.fileName, fileUrl: document.fileUrl, mimeType: "application/pdf", fileSize: document.fileSize });
    }
  });
  payload.reraPhases = phases;
  if (downloads.length) payload.projectDownloads = downloads;
  return {
    payload,
    mediaCount: mediaResults.length,
    mediaBytes: mediaResults.reduce((total, row) => total + row.bytes, 0),
    documentCount: documentResults.length,
    documentBytes: documentResults.reduce((total, row) => total + row.bytes, 0),
  };
}

function cloudinaryMediaUrls(value, urls = new Set()) {
  if (typeof value === "string" && value.includes("res.cloudinary.com")) urls.add(value);
  else if (Array.isArray(value)) value.forEach((item) => cloudinaryMediaUrls(item, urls));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => cloudinaryMediaUrls(item, urls));
  return [...urls];
}

function batchRecords(summary) {
  return summary.records.map((record) => ({
    packageKey: `${record.packageName.toLowerCase()}::${record.packageSize}`,
    packageName: record.packageName,
    projectName: record.projectName,
    reviewFile: record.reviewFile,
    status: "awaiting",
    reraNumbers: record.reraNumbers || [],
    warnings: record.warnings || [],
  }));
}

async function prepareBatch({ summary, batchKey, batchName }) {
  const conflicts = Object.entries(summary.sharedReraNumbers || {}).map(([reraNumber, projects]) => ({ reraNumber, projects }));
  let batch = await PropertyImportBatch.findOne({ batchKey });
  if (!batch) {
    batch = await PropertyImportBatch.create({
      batchKey, name: batchName, sourceFolder: summary.sourceFolder, reviewFolder: summary.outputFolder,
      status: "staged", packageCount: summary.packageCount, sharedReraNumbers: conflicts, records: batchRecords(summary),
    });
  }
  return batch;
}

async function importStagedBatch({ summaryPath, execute = false, limit = Infinity, only = "", onProgress = () => {} }) {
  const absoluteSummary = path.resolve(summaryPath);
  const reviewFolder = path.dirname(absoluteSummary);
  const summary = JSON.parse(fs.readFileSync(absoluteSummary, "utf8"));
  const batchKey = slug(path.basename(summary.sourceFolder || reviewFolder));
  const batchName = path.basename(summary.sourceFolder || reviewFolder);
  const selectedRecords = only
    ? summary.records.filter((record) => [record.projectName, record.packageName].some((value) => clean(value).toLowerCase() === clean(only).toLowerCase()))
    : summary.records;
  const stagedFiles = selectedRecords.slice(0, limit).map((record) => ({ record, path: path.join(reviewFolder, record.reviewFile) }));
  if (only && !stagedFiles.length) throw new Error(`No staged package matches: ${only}`);
  const dryRun = { batchKey, batchName, packageCount: summary.packageCount, selectedCount: stagedFiles.length, sharedReraCount: Object.keys(summary.sharedReraNumbers || {}).length };
  if (!execute) return dryRun;

  const usage = await cloudinary.api.usage();
  const usedCredits = Number(usage.credits?.usage || 0);
  const limitCredits = Number(usage.credits?.limit || 0);
  if (limitCredits && limitCredits - usedCredits < 10) throw new Error(`Cloudinary has only ${(limitCredits - usedCredits).toFixed(2)} credits remaining; at least 10 are required before this import.`);
  const admin = await User.findOne({ role: "admin" }).select("_id").lean();
  const batch = await prepareBatch({ summary, batchKey, batchName });
  batch.status = "importing";
  batch.startedAt ||= new Date();
  batch.cloudinaryCreditsBefore ??= usedCredits;
  await batch.save();

  for (const [index, source] of stagedFiles.entries()) {
    const staged = JSON.parse(fs.readFileSync(source.path, "utf8"));
    const record = batch.records.find((row) => row.packageKey === staged.package.packageKey);
    if (!record) throw new Error(`Batch record missing for ${staged.package.packageName}`);
    const existing = await Property.findOne({ "bulkImport.packageKey": staged.package.packageKey });
    if (existing?.bulkImport?.importState === "complete") {
      if (record.status !== "imported") record.status = "skipped";
      record.property = existing._id;
      record.updatedAt = new Date();
      await batch.save();
      onProgress({ index: index + 1, total: stagedFiles.length, projectName: staged.package.projectName, status: "skipped" });
      continue;
    }
    record.status = "uploading";
    record.error = "";
    record.updatedAt = new Date();
    await batch.save();
    try {
      const parsed = parsePropertyTemplate(staged);
      const basePayload = {
        ...parsed.payload,
        status: "recheck", published: false, verified: false, submittedBy: "admin", postedBy: admin?._id,
        postedDate: new Date().toISOString(),
        bulkImport: {
          packageKey: staged.package.packageKey, packageName: staged.package.packageName, packageSize: staged.package.packageSize,
          batchName, batchKey, importState: "uploading", importedAt: new Date(),
        },
      };
      let property = existing;
      if (!property) property = await Property.create(basePayload);
      else { property.set(basePayload); await property.save(); }
      const zipPath = path.join(summary.sourceFolder, staged.package.packageName);
      const uploaded = await uploadPackageMedia({ staged, payload: basePayload, zipPath, batchKey });
      uploaded.payload.bulkImport.importState = "complete";
      uploaded.payload.bulkImport.importError = "";
      uploaded.payload.mediaAssets = cloudinaryMediaUrls(uploaded.payload);
      property.set(uploaded.payload);
      await property.save();
      record.status = "imported";
      record.property = property._id;
      record.mediaCount = uploaded.mediaCount;
      record.mediaBytes = uploaded.mediaBytes;
      record.documentCount = uploaded.documentCount;
      record.documentBytes = uploaded.documentBytes;
      record.warnings = parsed.warnings;
      record.updatedAt = new Date();
      onProgress({ index: index + 1, total: stagedFiles.length, projectName: staged.package.projectName, status: "imported", mediaCount: uploaded.mediaCount, documentCount: uploaded.documentCount });
    } catch (error) {
      if (isTransientNetworkError(error)) throw error;
      record.status = "failed";
      record.error = errorMessage(error).slice(0, 2000);
      record.updatedAt = new Date();
      onProgress({ index: index + 1, total: stagedFiles.length, projectName: staged.package.projectName, status: "failed", error: record.error });
      await Property.updateOne({ "bulkImport.packageKey": staged.package.packageKey }, { $set: { "bulkImport.importState": "failed", "bulkImport.importError": record.error } });
    }
    batch.importedCount = batch.records.filter((row) => row.status === "imported").length;
    batch.skippedCount = batch.records.filter((row) => row.status === "skipped").length;
    batch.failedCount = batch.records.filter((row) => row.status === "failed").length;
    batch.mediaCount = batch.records.reduce((total, row) => total + row.mediaCount, 0);
    batch.mediaBytes = batch.records.reduce((total, row) => total + row.mediaBytes, 0);
    batch.documentCount = batch.records.reduce((total, row) => total + row.documentCount, 0);
    batch.documentBytes = batch.records.reduce((total, row) => total + row.documentBytes, 0);
    await batch.save();
    if ((index + 1) % 10 === 0) {
      const checkpoint = await cloudinary.api.usage();
      const checkpointUsed = Number(checkpoint.credits?.usage || 0);
      const checkpointLimit = Number(checkpoint.credits?.limit || 0);
      batch.cloudinaryCreditsAfter = checkpointUsed;
      if (checkpointLimit && checkpointLimit - checkpointUsed < 2) {
        batch.status = "partial";
        await batch.save();
        throw new Error(`Cloudinary import paused with only ${(checkpointLimit - checkpointUsed).toFixed(2)} credits remaining.`);
      }
      await batch.save();
    }
  }
  const remaining = batch.records.filter((row) => ["awaiting", "uploading"].includes(row.status)).length;
  batch.status = remaining ? "partial" : batch.failedCount ? "partial" : "completed";
  if (!remaining) batch.completedAt = new Date();
  const after = await cloudinary.api.usage();
  batch.cloudinaryCreditsAfter = Number(after.credits?.usage || 0);
  await batch.save();
  return { ...dryRun, batchId: String(batch._id), status: batch.status, importedCount: batch.importedCount, skippedCount: batch.skippedCount, failedCount: batch.failedCount };
}

module.exports = { importStagedBatch, mediaTasks, documentTasks, matchConfigurationIndex, isTransientNetworkError, errorMessage };
