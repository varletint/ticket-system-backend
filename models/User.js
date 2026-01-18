const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
    },
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
      enum: ["buyer", "organizer", "validator", "admin"],
      default: "buyer",
    },
    refreshToken: {
      type: String,
    },

    organizerProfile: {
      businessName: { type: String, trim: true },
      description: { type: String },
      logo: { type: String },

      platformStatus: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending",
      },
      platformApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      platformApprovedAt: { type: Date },
      platformRejectionReason: { type: String },

      paystack: {
        subaccountCode: { type: String },
        businessName: { type: String },
        bankCode: { type: String },
        accountNumber: { type: String },
        percentageCharge: { type: Number, default: 90 },
        isActive: { type: Boolean, default: false },
      },

      platformFeePercent: { type: Number, default: 10 },
    },

    assignedEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: "Event" }],

    createdByOrganizer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 });
userSchema.index({ role: 1 });

module.exports = mongoose.model("User", userSchema);
