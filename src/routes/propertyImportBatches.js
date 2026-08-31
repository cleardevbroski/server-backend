const express = require("express");
const PropertyImportBatch = require("../models/PropertyImportBatch");
const Property = require("../models/Property");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

const router = express.Router();
router.use(auth, adminOnly);

function presentBatch(batch, includeRecords = false) {
  const source = typeof batch.toObject === "function" ? batch.toObject() : batch;
  return {
    ...source,
    id: String(source._id),
    ...(includeRecords ? {} : { records: undefined }),
  };
}

router.get("/", async (_req, res) => {
  try {
    const batches = await PropertyImportBatch.find().sort("-updatedAt").lean();
    return res.json({ batches: batches.map((batch) => presentBatch(batch)) });
  } catch (error) {
    console.error("List property import batches error:", error);
    return res.status(500).json({ error: "Unable to load batch reports" });
  }
});

router.get("/rera-conflicts", async (_req, res) => {
  try {
    const batches = await PropertyImportBatch.find({ "sharedReraNumbers.0": { $exists: true } }).sort("-updatedAt").lean();
    const conflicts = [];
    for (const batch of batches) {
      for (const conflict of batch.sharedReraNumbers || []) {
        const properties = await Property.find({
          status: "recheck",
          "bulkImport.batchKey": batch.batchKey,
          title: { $in: conflict.projects || [] },
        }).select("title builder locality reraNumber reraPhases bulkImport status").lean();
        conflicts.push({
          batchId: String(batch._id),
          batchName: batch.name,
          reraNumber: conflict.reraNumber,
          projectNames: conflict.projects || [],
          properties: properties.map((property) => ({ ...property, id: String(property._id) })),
        });
      }
    }
    return res.json({ conflicts });
  } catch (error) {
    console.error("List RERA import conflicts error:", error);
    return res.status(500).json({ error: "Unable to load RERA conflicts" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const batch = await PropertyImportBatch.findById(req.params.id).lean();
    if (!batch) return res.status(404).json({ error: "Batch report not found" });
    return res.json({ batch: presentBatch(batch, true) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Batch report not found" });
    return res.status(500).json({ error: "Unable to load batch report" });
  }
});

module.exports = router;
