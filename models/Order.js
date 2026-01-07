const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },

    tickets: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Ticket",
      },
    ],

    tierName: { type: String, required: true },
    tierId: { type: mongoose.Schema.Types.ObjectId, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true },
    totalAmount: { type: Number, required: true },

    paymentStatus: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
    },

    paymentMethod: {
      type: String,
      enum: ["card", "bank_transfer", "ussd", "mock"],
      default: "card",
    },

    paystack: {
      reference: { type: String },
      transactionId: { type: String },
      channel: { type: String },
      paidAt: { type: Date },
    },

    splits: {
      platformAmount: { type: Number },
      organizerAmount: { type: Number },
    },
  },
  { timestamps: true }
);

// Indexes
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ event: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ "paystack.reference": 1 });

module.exports = mongoose.model("Order", orderSchema);
