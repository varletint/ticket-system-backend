const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    tierName: { type: String, required: true },
    tierId: { type: mongoose.Schema.Types.ObjectId, required: true },
    price: { type: Number, required: true },

    qrCode: {
      type: String,
      required: true,
      unique: true,
    },

    seatNumber: { type: String },
    section: { type: String },

    status: {
      type: String,
      enum: ["valid", "used", "cancelled", "transferred"],
      default: "valid",
    },

    checkedInAt: { type: Date },
    checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    pdfUrl: { type: String },
    qrImageUrl: { type: String },
  },
  { timestamps: true }
);

ticketSchema.index({ qrCode: 1 });
ticketSchema.index({ user: 1, status: 1 });
ticketSchema.index({ event: 1, status: 1 });
ticketSchema.index({ order: 1 });

module.exports = mongoose.model("Ticket", ticketSchema);
