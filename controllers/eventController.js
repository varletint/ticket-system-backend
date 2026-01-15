const Event = require("../models/Event");
const mongoose = require("mongoose");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const {
  logAudit,
  logCreateEvent,
  logUpdateEvent,
  logDeleteEvent,
} = require("../utils/auditHelper");

/**
 * Get all published events (public)
 * GET /api/events
 */

const getEvents = asyncHandler(async (req, res) => {
  const { city, category, search, page = 1, limit = 12 } = req.query;

  const query = {
    status: "published",
    eventDate: { $gte: new Date() },
    deletedAt: null,
  };

  if (city) query["venue.city"] = new RegExp(city, "i");
  if (category) query.category = category;
  if (search) {
    query.$or = [
      { title: new RegExp(search, "i") },
      { artist: new RegExp(search, "i") },
    ];
  }

  const [events, totalEvents] = await Promise.all([
    Event.find(query)
      .populate(
        "organizer",
        "fullName organizerProfile.businessName organizerProfile.logo"
      )
      .sort({ eventDate: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit)),
    Event.countDocuments(query),
  ]);

  res.json({
    events,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      totalEvents,
      pages: Math.ceil(totalEvents / limit),
    },
  });
});

/**
 * Get single event by ID (public)
 * GET /api/events/:id
 */

const getEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id).populate(
    "organizer",
    "fullName organizerProfile.businessName organizerProfile.logo"
  );

  if (!event) throw ApiError.notFound("Event not found");
  if (event.deletedAt) throw ApiError.notFound("Event not found");
  if (event.status !== "published") {
    if (
      !req.user ||
      (req.user.role !== "admin" &&
        event.organizer._id.toString() !== req.user._id.toString())
    ) {
      throw ApiError.notFound("Event not found");
    }
  }

  res.json({ event });
});

/**
 * Create new event (organizer only)
 * POST /api/events
 */

const createEvent = asyncHandler(async (req, res) => {
  // Check if organizer has set up payout account
  if (!req.user.organizerProfile?.paystack?.isActive) {
    throw ApiError.badRequest(
      "Please set up your payout account before creating events"
    );
  }

  const {
    title,
    description,
    artist,
    category,
    venue,
    eventDate,
    doorsOpen,
    endTime,
    ticketTiers,
    bannerImage,
  } = req.body;

  const event = await Event.create({
    organizer: req.user._id,
    title,
    description,
    artist,
    category,
    venue,
    eventDate: new Date(eventDate),
    doorsOpen,
    endTime,
    ticketTiers: ticketTiers || [],
    bannerImage,
    status: "published",
  });

  await logCreateEvent(req, event);

  res.status(201).json({
    message: "Event created successfully",
    event,
  });
});

const deleteEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);

  if (!event) throw ApiError.notFound("Event not found");

  if (
    event.organizer.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    throw ApiError.forbidden("Not authorized to delete this event");
  }

  if (event.deletedAt) {
    throw ApiError.badRequest("Event is already deleted");
  }

  // Soft delete
  event.deletedAt = new Date();
  event.deletedBy = req.user._id;
  await event.save();

  await logDeleteEvent(req, event);

  res.json({ message: "Event deleted", event });
});

/**
 * Update event (organizer only)
 * PUT /api/events/:id
 */

const updateEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) throw ApiError("Event not found");
  if (
    event.organizer.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    throw ApiError.forbidden("Not authorized to update ths event");
  }
  if (["completed", "cancelled"].includes(event.status)) {
    throw ApiError.badRequest(`Cannot edit ${event.status} event`);
  }

  const allowedFields = [
    "title",
    "description",
    "artist",
    "category",
    "venue",
    "eventDate",
    "doorsOpen",
    "endTime",
    "ticketTiers",
    "bannerImage",
  ];
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      event[field] = req.body[field];
    }
  });

  await event.save();

  await logUpdateEvent(req, event);

  res.json({ message: "Event updated", event });
});

/**
 * Publish event (approved organizer only)
 * POST /api/events/:id/publish
 */
const publishEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (
      event.organizer.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (event.status !== "draft") {
      return res
        .status(400)
        .json({ message: "Only draft events can be published" });
    }

    // Validate event has required fields
    if (!event.ticketTiers || event.ticketTiers.length === 0) {
      return res
        .status(400)
        .json({ message: "Event must have at least one ticket tier" });
    }

    event.status = "published";
    await event.save();

    await logAudit({
      action: "event.publish",
      req,
      user: req.user,
      entity: { type: "Event", id: event._id, name: event.title },
    });

    res.json({ message: "Event published successfully", event });
  } catch (error) {
    console.error("Publish event error:", error);
    res.status(500).json({ message: "Error publishing event" });
  }
};

/**
 * Cancel event (organizer only)
 * POST /api/events/:id/cancel
 */

const cancelEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);

  if (!event) {
    throw ApiError.notFound("Event not found");
  }

  if (
    event.organizer.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    throw ApiError.forbidden("Not authorized");
  }

  event.status = "cancelled";
  await event.save();

  await logAudit({
    action: "event.cancel",
    req,
    user: req.user,
    entity: { type: "Event", id: event._id, name: event.title },
  });

  // TODO: Handle refunds for sold tickets

  res.json({ message: "Event cancelled", event });
});

/**
 * Get organizer's own events
 * GET /api/events/my-events
 */
const getMyEvents = asyncHandler(async (req, res) => {
  const events = await Event.find({ organizer: req.user._id }).sort({
    createdAt: -1,
  });

  res.json({ events });
});

/**
 * Get event analytics (organizer only)
 * GET /api/events/:id/analytics
 */
const getEventAnalytics = asyncHandler(async (req, res) => {
  const eventId = new mongoose.Types.ObjectId(req.params.id);

  const [result] = await Event.aggregate([
    // Match the specific event
    { $match: { _id: eventId, deletedAt: null } },

    // Unwind ticket tiers to process each tier
    { $unwind: { path: "$ticketTiers", preserveNullAndEmptyArrays: true } },

    // Group back and calculate stats
    {
      $group: {
        _id: "$_id",
        title: { $first: "$title" },
        status: { $first: "$status" },
        eventDate: { $first: "$eventDate" },
        organizer: { $first: "$organizer" },
        totalTicketsSold: { $first: "$totalTicketsSold" },
        totalRevenue: { $first: "$totalRevenue" },
        tiers: {
          $push: {
            name: "$ticketTiers.name",
            price: "$ticketTiers.price",
            quantity: "$ticketTiers.quantity",
            sold: "$ticketTiers.soldCount",
            available: {
              $subtract: ["$ticketTiers.quantity", "$ticketTiers.soldCount"],
            },
            revenue: {
              $multiply: ["$ticketTiers.soldCount", "$ticketTiers.price"],
            },
          },
        },
      },
    },

    // Shape the final output
    {
      $project: {
        _id: 0,
        event: {
          id: "$_id",
          title: "$title",
          status: "$status",
          eventDate: "$eventDate",
        },
        stats: {
          totalTicketsSold: "$totalTicketsSold",
          totalRevenue: "$totalRevenue",
          tiers: "$tiers",
        },
        organizer: "$organizer",
      },
    },
  ]);

  if (!result) {
    throw ApiError.notFound("Event not found");
  }

  // Authorization check
  if (
    result.organizer.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    throw ApiError.forbidden("Not authorized");
  }

  // Remove organizer from response
  delete result.organizer;

  res.json(result);
});

module.exports = {
  getEvents,
  getEvent,
  createEvent,
  updateEvent,
  publishEvent,
  cancelEvent,
  getMyEvents,
  getEventAnalytics,
};
