const mongoose = require("mongoose");
const transactionSchema = new mongoose.Schema(
  {
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        "initiated",
        "processing",
        "completed",
        "failed",
        "refunded",
        "partially_refunded",
      ],
      default: "initiated",
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "NGN",
    },
    description: {
      type: String,
    },

    gateway: {
      provider: {
        type: String,
        enum: ["paystack", "mock"],
        default: "mock",
      },
      reference: { type: String },
      transactionId: { type: String },
      authorizationCode: { type: String },
      channel: { type: String },
      cardType: { type: String },
      last4: { type: String },
      bank: { type: String },
      gatewayResponse: { type: String },
    },

    splits: {
      platformAmount: { type: Number, default: 0 },
      organizerAmount: { type: Number, default: 0 },
      organizerSubaccountCode: { type: String },
    },

    retryCount: {
      type: Number,
      default: 0,
    },
    maxRetries: {
      type: Number,
      default: 3,
    },
    lastRetryAt: { type: Date },
    nextRetryAt: { type: Date },

    failureReason: { type: String },
    failureCode: { type: String },
    failureDetails: { type: mongoose.Schema.Types.Mixed },

    refunds: [
      {
        amount: { type: Number, required: true },
        reason: { type: String },
        processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        processedAt: { type: Date, default: Date.now },
        gatewayRefundId: { type: String },
      },
    ],

    totalRefunded: {
      type: Number,
      default: 0,
    },

    initiatedAt: { type: Date, default: Date.now },
    processingAt: { type: Date },
    completedAt: { type: Date },
    failedAt: { type: Date },

    metadata: {
      ipAddress: { type: String },
      userAgent: { type: String },
      tierName: { type: String },
      quantity: { type: Number },
    },
  },
  { timestamps: true }
);

transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ status: 1, createdAt: -1 });
transactionSchema.index({ event: 1, status: 1 });
transactionSchema.index({ "gateway.reference": 1 });
transactionSchema.index({ createdAt: -1 });

transactionSchema.virtual("netAmount").get(function () {
  return this.amount - this.totalRefunded;
});

transactionSchema.methods.canRetry = function () {
  return this.status === "failed" && this.retryCount < this.maxRetries;
};

transactionSchema.methods.isRefundable = function () {
  return this.status === "completed" && this.netAmount > 0;
};

transactionSchema.statics.findOrCreateByIdempotencyKey = async function (
  idempotencyKey,
  data
) {
  let transaction = await this.findOne({ idempotencyKey });

  if (transaction) {
    return { transaction, isNew: false };
  }

  transaction = new this({ idempotencyKey, ...data });
  await transaction.save();
  return { transaction, isNew: true };
};

transactionSchema.set("toJSON", { virtuals: true });
transactionSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Transaction", transactionSchema);
