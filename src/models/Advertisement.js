const mongoose = require("mongoose");

const advertisementSchema = new mongoose.Schema(
  {
    image: { type: String, required: true, trim: true },
    alt: { type: String, default: "Advertisement", trim: true, maxlength: 120 },
    link: { type: String, default: "", trim: true },
    placement: { type: String, enum: ["left", "right"], required: true },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

advertisementSchema.index({ placement: 1, active: 1, order: 1 });

module.exports = mongoose.model("Advertisement", advertisementSchema);
