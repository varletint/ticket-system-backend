const mongoose = require("mongoose");

const ticketTierSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: { type: String },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  soldCount: {
    type: Number,
    default: 0,
  },
  maxPerUser: {
    type: Number,
    default: 4,
  },
  saleStart: { type: Date },
  saleEnd: { type: Date },
});

const eventSchema = new mongoose.Schema(
  {
    organizer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: [true, "Event title is required"],
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    artist: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      enum: ["concert", "festival", "theater", "sports", "conference", "other"],
      default: "concert",
    },
    venue: {
      name: { type: String, required: true },
      address: { type: String },
      city: { type: String, required: true },
      state: { type: String },
      country: { type: String, default: "Nigeria" },
    },
    eventDate: {
      type: Date,
      required: [true, "Event date is required"],
    },
    doorsOpen: { type: Date },
    endTime: { type: Date },
    bannerImage: { type: String },

    status: {
      type: String,
      enum: ["draft", "published", "cancelled", "completed"],
      default: "draft",
    },

    ticketTiers: [ticketTierSchema],
    validators: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    totalTicketsSold: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },

    // Soft delete
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

eventSchema.index({ status: 1, eventDate: 1 });
eventSchema.index({ organizer: 1 });
eventSchema.index({ "venue.city": 1 });

eventSchema.virtual("isPast").get(function () {
  return this.eventDate < new Date();
});

module.exports = mongoose.model("Event", eventSchema);
