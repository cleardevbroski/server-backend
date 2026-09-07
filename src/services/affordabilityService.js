const AffordabilityRule = require("../models/AffordabilityRule");
const AffordabilitySettings = require("../models/AffordabilitySettings");

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseIndianPrice(value) {
  const source = String(value || "").trim();
  if (!source || /(?:-|–|—)|\bto\b/i.test(source)) return null;
  const cleaned = source
    .replace(/(?:₹|inr|rs\.?)/gi, " ")
    .replace(/\+\s*charges?/gi, " ")
    .replace(/\b(?:starting|from|onwards|approximately|approx\.?|about)\b/gi, " ")
    .replace(/,/g, " ")
    .trim();
  const matches = [...cleaned.matchAll(/(\d+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lac|l)?\b/gi)];
  if (matches.length !== 1) return null;
  const amount = Number(matches[0][1]);
  const unit = String(matches[0][2] || "").toLowerCase();
  const multiplier = unit.startsWith("cr") || unit.startsWith("crore") ? 10_000_000 : unit.startsWith("l") ? 100_000 : 1;
  const result = amount * multiplier;
  return Number.isFinite(result) && result > 0 ? result : null;
}

function parseArea(value) {
  const match = String(value || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? finite(match[0], 0) : 0;
}

function monthlyEmi(principal, annualInterestRate, tenureYears) {
  const payments = Math.round(finite(tenureYears) * 12);
  const loan = finite(principal);
  const annualRate = finite(annualInterestRate);
  if (loan <= 0 || payments <= 0 || annualRate < 0) return 0;
  const rate = annualRate / 1200;
  if (rate === 0) return loan / payments;
  const growth = Math.pow(1 + rate, payments);
  return loan * rate * growth / (growth - 1);
}

function principalFromEmi(emi, annualInterestRate, tenureYears) {
  const payment = finite(emi);
  const payments = Math.round(finite(tenureYears) * 12);
  const annualRate = finite(annualInterestRate);
  if (payment <= 0 || payments <= 0 || annualRate < 0) return 0;
  const rate = annualRate / 1200;
  if (rate === 0) return payment * payments;
  const growth = Math.pow(1 + rate, payments);
  return payment * (growth - 1) / (rate * growth);
}

async function getSettings() {
  const existing = await AffordabilitySettings.findOne({ key: "default" }).lean();
  if (existing) return existing;
  return {
    key: "default",
    defaultInterestRate: 8.5,
    defaultTenureYears: 20,
    comfortableIncomeRatioMin: 0.3,
    comfortableIncomeRatioMax: 0.4,
    defaultState: "Karnataka",
    disclaimer: "Planning estimate only. This is not a bank quotation or loan eligibility decision.",
  };
}

function propertyConfigurations(property) {
  if (property.propertyType === "Villa") {
    return (property.villaDetails?.configurationDetails || []).map((row) => ({
      name: row.configuration,
      bedrooms: finite(row.bedrooms, finite(String(row.configuration || "").match(/\d+/)?.[0])),
      price: parseIndianPrice(row.price),
      area: parseArea(row.builtUpArea || row.superArea || row.carpetArea),
      raw: row,
    }));
  }
  if (property.propertyType === "Plot") {
    return (property.plotDetails?.plotSizeDetails || []).map((row) => ({
      name: row.plotSize,
      bedrooms: 0,
      price: finite(row.totalPrice) || null,
      area: finite(row.areaSqft),
      raw: row,
    }));
  }
  return (property.configurationDetails || []).map((row) => ({
    name: row.configuration,
    bedrooms: finite(row.bedrooms, finite(String(row.configuration || "").match(/\d+/)?.[0])),
    price: parseIndianPrice(row.price),
    area: parseArea(row.builtUpArea || row.superBuiltUpArea || row.carpetArea),
    raw: row,
  }));
}

function ruleApplies(rule, property, basePrice, asOf, defaultState = "Karnataka") {
  if (!rule.active || new Date(rule.effectiveFrom) > asOf) return false;
  if (rule.effectiveTo && new Date(rule.effectiveTo) < asOf) return false;
  if (rule.state && String(rule.state).toLowerCase() !== String(property.locality?.state || defaultState).toLowerCase()) return false;
  if (rule.city && String(rule.city).toLowerCase() !== String(property.locality?.city || "").toLowerCase()) return false;
  if (rule.propertyTypes?.length && !rule.propertyTypes.includes(property.propertyType)) return false;
  if (rule.possessionStatuses?.length && !rule.possessionStatuses.includes(property.possessionDetails?.status || property.possession || "")) return false;
  if (basePrice < finite(rule.minPropertyValue)) return false;
  if (rule.maxPropertyValue != null && basePrice > finite(rule.maxPropertyValue)) return false;
  return true;
}

function calculateRule(rule, { basePrice, agreementValue, area }) {
  const basisValue = rule.basis === "built_up_area" ? area : rule.basis === "agreement_value" ? agreementValue : basePrice;
  if (rule.calculationType === "fixed") return finite(rule.fixedAmount);
  if (rule.calculationType === "per_sqft") return basisValue * finite(rule.rate);
  if (rule.calculationType === "percentage") return basisValue * finite(rule.rate) / 100;
  if (rule.calculationType === "slab") {
    const slab = (rule.slabs || []).find((item) => basisValue >= finite(item.minValue) && (item.maxValue == null || basisValue <= finite(item.maxValue)));
    return slab ? finite(slab.fixedAmount) + basisValue * finite(slab.rate) / 100 : 0;
  }
  return 0;
}

function projectChargeApplies(charge, configurationName) {
  return !charge.appliesToConfiguration || String(charge.appliesToConfiguration).trim().toLowerCase() === String(configurationName || "").trim().toLowerCase();
}

function calculateProjectCharge(charge, { basePrice, agreementValue, area }) {
  if (["included", "not_applicable"].includes(charge.calculationType)) return 0;
  const basisValue = charge.basis === "built_up_area" ? area : charge.basis === "agreement_value" ? agreementValue : basePrice;
  if (charge.calculationType === "percentage") return basisValue * finite(charge.value) / 100;
  if (charge.calculationType === "per_sqft") return basisValue * finite(charge.value);
  return finite(charge.value);
}

async function affordabilityForProperty(property, options = {}) {
  const settings = await getSettings();
  const configurations = propertyConfigurations(property);
  const selected = configurations.find((row) => String(row.name).toLowerCase() === String(options.configurationName || "").toLowerCase())
    || configurations.find((row) => row.price)
    || { name: "Project starting price", price: parseIndianPrice(property.price) || finite(property.priceValue) || null, area: parseArea(property.area) };
  const basePrice = finite(options.basePrice, selected.price);
  if (basePrice <= 0) return { available: false, missing: ["Base price"], settings };
  const area = finite(options.area, selected.area);
  const projectChargeRows = (property.acquisitionCharges || [])
    .filter((charge) => projectChargeApplies(charge, selected.name))
    .map((charge) => ({
      code: charge.code || "other",
      label: charge.name,
      amount: Math.round(calculateProjectCharge(charge, { basePrice, agreementValue: basePrice, area })),
      sourceType: charge.sourceType || "developer_supplied",
      sourceNote: charge.sourceNote || "",
      timing: charge.paymentTiming,
      optional: Boolean(charge.optional),
      calculationType: charge.calculationType,
    }));
  const agreementValue = basePrice + projectChargeRows.filter((row) => !row.optional && row.timing !== "monthly").reduce((sum, row) => sum + row.amount, 0);
  const asOf = options.asOf ? new Date(options.asOf) : new Date();
  const rules = await AffordabilityRule.find({ active: true, effectiveFrom: { $lte: asOf }, $or: [{ effectiveTo: null }, { effectiveTo: { $gte: asOf } }] }).sort({ priority: 1, effectiveFrom: -1 }).lean();
  const governmentRows = rules.filter((rule) => ruleApplies(rule, property, basePrice, asOf, settings.defaultState)).map((rule) => ({
    code: rule.code,
    label: rule.name,
    amount: Math.round(calculateRule(rule, { basePrice, agreementValue, area })),
    sourceType: "government_rule_estimate",
    sourceNote: rule.sourceLabel || "",
    sourceUrl: rule.sourceUrl || "",
    effectiveFrom: rule.effectiveFrom,
    calculationType: rule.calculationType,
  }));
  const initialCharges = [...projectChargeRows.filter((row) => row.timing !== "monthly"), ...governmentRows];
  const monthlyCharges = projectChargeRows.filter((row) => row.timing === "monthly");
  const totalCharges = initialCharges.filter((row) => !row.optional).reduce((sum, row) => sum + row.amount, 0);
  const totalPurchaseCost = basePrice + totalCharges;
  const loanAmount = Math.max(0, Math.min(finite(options.loanAmount, totalPurchaseCost - finite(options.downPayment)), totalPurchaseCost));
  const interestRate = finite(options.interestRate, settings.defaultInterestRate);
  const tenureYears = finite(options.tenureYears, settings.defaultTenureYears);
  const emi = loanAmount > 0 ? monthlyEmi(loanAmount, interestRate, tenureYears) : 0;
  const ratioMin = finite(settings.comfortableIncomeRatioMin, 0.3);
  const ratioMax = finite(settings.comfortableIncomeRatioMax, 0.4);
  const canonical = [
    ["gst", "GST"],
    ["stamp_duty", "Stamp duty"],
    ["registration", "Registration"],
    ["parking", "Parking"],
    ["floor_rise", "Floor-rise charges"],
    ["clubhouse", "Clubhouse / amenity charges"],
    ["maintenance_deposit", "Maintenance deposit"],
    ["monthly_maintenance", "Monthly maintenance"],
    ["other_developer_charges", "Other developer charges"],
  ];
  const allChargeRows = [...projectChargeRows, ...governmentRows];
  const usedIndexes = new Set();
  const lineItems = canonical.map(([code, label]) => {
    const matches = allChargeRows.map((row, index) => ({ row, index })).filter(({ row }) => row.code === code);
    matches.forEach(({ index }) => usedIndexes.add(index));
    if (!matches.length) return { code, label, amount: null, sourceType: "missing" };
    const rows = matches.map(({ row }) => row);
    return {
      code,
      label,
      amount: Math.round(rows.reduce((sum, row) => sum + row.amount, 0)),
      sourceType: rows[0].sourceType,
      sourceNote: rows.map((row) => row.sourceNote).filter(Boolean).join("; "),
      sourceUrl: rows.find((row) => row.sourceUrl)?.sourceUrl || "",
      timing: rows[0].timing,
      optional: rows.every((row) => row.optional),
    };
  });
  allChargeRows.forEach((row, index) => {
    if (!usedIndexes.has(index)) lineItems.push(row);
  });
  return {
    available: true,
    configurationName: selected.name,
    basePrice: Math.round(basePrice),
    basePriceSourceType: property.priceSourceType || "developer_supplied",
    priceUpdatedAt: property.priceUpdatedAt || null,
    area,
    projectCharges: projectChargeRows,
    governmentCharges: governmentRows,
    monthlyCharges,
    lineItems,
    totalCharges: Math.round(totalCharges),
    totalPurchaseCost: Math.round(totalPurchaseCost),
    initialPayment: Math.round(Math.max(0, totalPurchaseCost - loanAmount)),
    loanAmount: Math.round(loanAmount),
    interestRate,
    tenureYears,
    monthlyEmi: Math.round(emi),
    suggestedMonthlyIncome: emi > 0 ? { min: Math.round(emi / ratioMax), max: Math.round(emi / ratioMin) } : null,
    assumptions: { interestRate, tenureYears, incomeRatioMin: ratioMin, incomeRatioMax: ratioMax, asOf: asOf.toISOString() },
    disclaimer: settings.disclaimer,
    missing: [
      ...(!property.acquisitionCharges?.length ? ["Developer charges"] : []),
      ...(!governmentRows.length ? ["Applicable government-charge rules"] : []),
    ],
  };
}

module.exports = {
  affordabilityForProperty,
  getSettings,
  monthlyEmi,
  parseArea,
  parseIndianPrice,
  principalFromEmi,
  propertyConfigurations,
};
