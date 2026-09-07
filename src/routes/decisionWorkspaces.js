const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const DecisionWorkspace = require("../models/DecisionWorkspace");
const DecisionWorkspaceMessage = require("../models/DecisionWorkspaceMessage");
const Property = require("../models/Property");

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 80, message: { error: "Too many workspace requests. Please try again shortly." } });
router.use(limiter);

const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const token = () => crypto.randomBytes(32).toString("base64url");
const visibleProperty = { $or: [{ status: { $in: ["approved", "published"] } }, { status: { $exists: false }, published: { $ne: false } }] };

function suppliedToken(req) {
  return String(req.get("X-Workspace-Token") || "").trim();
}

function suppliedParticipantId(req) {
  return String(req.get("X-Participant-Id") || "").trim().slice(0, 120);
}

function participantHash(workspaceId, participantId) {
  return hash(`${workspaceId}:${participantId}`);
}

async function loadWorkspace(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Workspace not found" });
  const plainToken = suppliedToken(req);
  if (!plainToken) return res.status(401).json({ error: "Workspace access token required" });
  const workspace = await DecisionWorkspace.findOne({ _id: req.params.id, expiresAt: { $gt: new Date() } })
    .select("+ownerTokenHash +shareTokenHash")
    .populate({ path: "items.property", match: visibleProperty, select: "title subtitle price pricePerSqft configs area propertyType builder image heroImages configurationDetails villaDetails possession possessionDetails locality reraRegistered reraPhases acquisitionCharges priceUpdatedAt priceSourceType" });
  if (!workspace) return res.status(404).json({ error: "Workspace not found or expired" });
  const candidate = hash(plainToken);
  const role = crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(workspace.ownerTokenHash)) ? "owner"
    : crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(workspace.shareTokenHash)) ? "contributor" : null;
  if (!role) return res.status(403).json({ error: "This workspace link is invalid" });
  req.workspace = workspace;
  req.workspaceRole = role;
  next();
}

function present(workspace, role) {
  const source = workspace.toObject ? workspace.toObject() : workspace;
  return {
    id: String(source._id),
    title: source.title,
    role,
    expiresAt: source.expiresAt,
    updatedAt: source.updatedAt,
    items: (source.items || []).filter((item) => item.property).map((item) => ({
      ...item,
      property: { ...item.property, id: String(item.property._id) },
    })),
  };
}

function presentMessage(message, req) {
  const source = message.toObject ? message.toObject() : message;
  const participantId = suppliedParticipantId(req);
  const isMine = Boolean(participantId) && source.participantHash === participantHash(req.workspace._id, participantId);
  return {
    id: String(source._id),
    nickname: source.nickname,
    message: source.deletedAt ? "" : source.message,
    propertyId: source.property ? String(source.property) : "",
    propertyTitle: source.propertyTitle || "",
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    deletedAt: source.deletedAt,
    isMine,
    canDelete: !source.deletedAt && (req.workspaceRole === "owner" || isMine),
  };
}

router.post("/", async (req, res) => {
  try {
    const ownerToken = token();
    const shareToken = token();
    const propertyIds = Array.isArray(req.body?.propertyIds) ? [...new Set(req.body.propertyIds.map(String))].slice(0, 3) : [];
    if (propertyIds.some((id) => !mongoose.isValidObjectId(id))) return res.status(400).json({ error: "One or more properties are invalid" });
    const validProperties = await Property.find({ _id: { $in: propertyIds }, ...visibleProperty }).select("_id").lean();
    const workspace = await DecisionWorkspace.create({
      title: String(req.body?.title || "Our home shortlist").trim().slice(0, 120),
      ownerTokenHash: hash(ownerToken),
      shareTokenHash: hash(shareToken),
      items: validProperties.map((property) => ({ property: property._id })),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
    return res.status(201).json({ workspaceId: String(workspace._id), ownerToken, shareToken, expiresAt: workspace.expiresAt });
  } catch (error) { console.error("Create decision workspace error:", error); return res.status(500).json({ error: "Unable to create family workspace" }); }
});

router.get("/:id", loadWorkspace, async (req, res) => {
  req.workspace.lastOpenedAt = new Date();
  await req.workspace.save();
  return res.json({ workspace: present(req.workspace, req.workspaceRole) });
});

router.patch("/:id", loadWorkspace, async (req, res) => {
  if (req.workspaceRole !== "owner") return res.status(403).json({ error: "Only the workspace owner can change workspace settings" });
  req.workspace.title = String(req.body?.title || req.workspace.title).trim().slice(0, 120);
  await req.workspace.save();
  return res.json({ workspace: present(req.workspace, req.workspaceRole) });
});

router.post("/:id/properties", loadWorkspace, async (req, res) => {
  try {
    const propertyId = String(req.body?.propertyId || "");
    if (!mongoose.isValidObjectId(propertyId)) return res.status(404).json({ error: "Property not found" });
    if (req.workspace.items.some((item) => String(item.property?._id || item.property) === propertyId)) return res.json({ workspace: present(req.workspace, req.workspaceRole) });
    if (req.workspace.items.length >= 3) return res.status(409).json({ error: "Remove a property before adding another. A workspace compares up to 3 projects." });
    const property = await Property.findOne({ _id: propertyId, ...visibleProperty });
    if (!property) return res.status(404).json({ error: "Property not found" });
    req.workspace.items.push({ property: property._id });
    await req.workspace.save();
    await req.workspace.populate({ path: "items.property", match: visibleProperty, select: "title subtitle price pricePerSqft configs area propertyType builder image heroImages configurationDetails villaDetails possession possessionDetails locality reraRegistered reraPhases acquisitionCharges priceUpdatedAt priceSourceType" });
    return res.status(201).json({ workspace: present(req.workspace, req.workspaceRole) });
  } catch (error) { console.error("Add workspace property error:", error); return res.status(500).json({ error: "Unable to add property to workspace" }); }
});

router.delete("/:id/properties/:propertyId", loadWorkspace, async (req, res) => {
  req.workspace.items = req.workspace.items.filter((item) => String(item.property?._id || item.property) !== req.params.propertyId);
  await req.workspace.save();
  return res.json({ workspace: present(req.workspace, req.workspaceRole) });
});

router.patch("/:id/properties/:propertyId", loadWorkspace, async (req, res) => {
  const item = req.workspace.items.find((row) => String(row.property?._id || row.property) === req.params.propertyId);
  if (!item) return res.status(404).json({ error: "Property is not in this workspace" });
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "note")) item.note = String(req.body.note || "").trim().slice(0, 2000);
  if (Array.isArray(req.body?.questions)) item.questions = req.body.questions.map((value) => String(value || "").trim().slice(0, 500)).filter(Boolean).slice(0, 20);
  await req.workspace.save();
  return res.json({ workspace: present(req.workspace, req.workspaceRole) });
});

router.post("/:id/properties/:propertyId/votes", loadWorkspace, async (req, res) => {
  const item = req.workspace.items.find((row) => String(row.property?._id || row.property) === req.params.propertyId);
  if (!item) return res.status(404).json({ error: "Property is not in this workspace" });
  const participantId = String(req.body?.participantId || "").trim().slice(0, 120);
  const nickname = String(req.body?.nickname || "").trim().slice(0, 60);
  const voteValue = String(req.body?.vote || "");
  if (!participantId || !nickname || !["prefer", "maybe", "not_preferred"].includes(voteValue)) return res.status(400).json({ error: "Nickname and a valid vote are required" });
  const existing = item.votes.find((vote) => vote.participantId === participantId);
  if (existing) Object.assign(existing, { nickname, vote: voteValue, votedAt: new Date() });
  else item.votes.push({ participantId, nickname, vote: voteValue, votedAt: new Date() });
  await req.workspace.save();
  return res.json({ workspace: present(req.workspace, req.workspaceRole) });
});

router.get("/:id/messages", loadWorkspace, async (req, res) => {
  const cursor = new Date();
  const after = req.query.after ? new Date(String(req.query.after)) : null;
  const filter = { workspace: req.workspace._id, updatedAt: { $lte: cursor } };
  if (after && Number.isFinite(after.getTime())) filter.updatedAt.$gt = after;
  const query = DecisionWorkspaceMessage.find(filter).sort(after ? { updatedAt: 1 } : { createdAt: -1 }).limit(100);
  const messages = await query.lean();
  if (!after) messages.reverse();
  return res.json({ messages: messages.map((message) => presentMessage(message, req)), cursor: cursor.toISOString() });
});

router.post("/:id/messages", loadWorkspace, async (req, res) => {
  const participantId = suppliedParticipantId(req);
  const nickname = String(req.body?.nickname || "").trim().slice(0, 60);
  const messageText = String(req.body?.message || "").trim().slice(0, 1500);
  const propertyId = String(req.body?.propertyId || "").trim();
  if (!participantId) return res.status(400).json({ error: "A family participant ID is required" });
  if (!nickname) return res.status(400).json({ error: "Enter your nickname before sending a message" });
  if (!messageText) return res.status(400).json({ error: "Enter a message" });
  let property = null;
  let propertyTitle = "";
  if (propertyId) {
    const item = req.workspace.items.find((row) => String(row.property?._id || row.property) === propertyId);
    if (!item?.property) return res.status(400).json({ error: "Choose a project from this family workspace" });
    property = item.property._id || item.property;
    propertyTitle = item.property.title || "";
  }
  const created = await DecisionWorkspaceMessage.create({
    workspace: req.workspace._id,
    participantHash: participantHash(req.workspace._id, participantId),
    nickname,
    message: messageText,
    property,
    propertyTitle,
    expiresAt: req.workspace.expiresAt,
  });
  return res.status(201).json({ message: presentMessage(created, req) });
});

router.delete("/:id/messages/:messageId", loadWorkspace, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(404).json({ error: "Message not found" });
  const message = await DecisionWorkspaceMessage.findOne({ _id: req.params.messageId, workspace: req.workspace._id });
  if (!message) return res.status(404).json({ error: "Message not found" });
  const participantId = suppliedParticipantId(req);
  const isMine = Boolean(participantId) && message.participantHash === participantHash(req.workspace._id, participantId);
  if (req.workspaceRole !== "owner" && !isMine) return res.status(403).json({ error: "You can remove only your own messages" });
  if (!message.deletedAt) {
    message.message = "Message removed";
    message.deletedAt = new Date();
    message.deletedByOwner = req.workspaceRole === "owner" && !isMine;
    await message.save();
  }
  return res.json({ message: presentMessage(message, req) });
});

router.get("/:id/summary", loadWorkspace, async (req, res) => {
  const workspace = present(req.workspace, req.workspaceRole);
  return res.json({
    summary: {
      title: workspace.title,
      generatedAt: new Date().toISOString(),
      expiresAt: workspace.expiresAt,
      properties: workspace.items.map((item) => ({
        title: item.property.title,
        builder: item.property.builder || "",
        location: item.property.subtitle || item.property.locality?.address || "",
        price: item.property.price || "",
        configurations: item.property.configs || [],
        possession: item.property.possessionDetails?.expectedCompletionDate || item.property.possessionDetails?.launchDate || item.property.possession || "",
        reraPhases: (item.property.reraPhases || []).map((phase) => ({ name: phase.name, reraNumber: phase.reraNumber })),
        note: item.note,
        questions: item.questions,
        votes: item.votes,
      })),
    },
  });
});

module.exports = router;
