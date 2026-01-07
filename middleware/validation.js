const { ApiError } = require("./errorHandler");

// Valid categories from Event model
const VALID_CATEGORIES = [
  "concert",
  "festival",
  "theater",
  "sports",
  "conference",
  "other",
];

/**
 * Validate create event request
 */
const validateCreateEvent = (req, res, next) => {
  const { title, description, category, venue, eventDate, ticketTiers } =
    req.body;

  // Required fields check
  if (!title || !description || !venue || !eventDate) {
    throw ApiError.badRequest(
      "Missing required fields: title, description, venue, eventDate"
    );
  }

  // Title validation
  if (typeof title !== "string" || title.trim().length < 3) {
    throw ApiError.badRequest("Title must be at least 3 characters");
  }
  if (title.length > 200) {
    throw ApiError.badRequest("Title cannot exceed 200 characters");
  }

  // Description validation
  if (typeof description !== "string" || description.trim().length < 20) {
    throw ApiError.badRequest("Description must be at least 20 characters");
  }

  // Category validation (only if provided, since it has a default)
  if (category && !VALID_CATEGORIES.includes(category)) {
    throw ApiError.badRequest(
      `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`
    );
  }

  // Venue validation
  if (!venue.name || !venue.city) {
    throw ApiError.badRequest("Venue must include name and city");
  }

  // Event date validation
  const eventDateTime = new Date(eventDate);
  if (isNaN(eventDateTime.getTime())) {
    throw ApiError.badRequest("Invalid event date format");
  }
  if (eventDateTime <= new Date()) {
    throw ApiError.badRequest("Event date must be in the future");
  }

  // Ticket tiers validation (if provided)
  if (ticketTiers && Array.isArray(ticketTiers)) {
    validateTicketTiers(ticketTiers);
  }

  next();
};

/**
 * Validate update event request
 */
const validateUpdateEvent = (req, res, next) => {
  const { title, description, category, venue, eventDate, ticketTiers } =
    req.body;

  // Title validation (if provided)
  if (title !== undefined) {
    if (typeof title !== "string" || title.trim().length < 3) {
      throw ApiError.badRequest("Title must be at least 3 characters");
    }
    if (title.length > 200) {
      throw ApiError.badRequest("Title cannot exceed 200 characters");
    }
  }

  // Description validation (if provided)
  if (description !== undefined) {
    if (typeof description !== "string" || description.trim().length < 20) {
      throw ApiError.badRequest("Description must be at least 20 characters");
    }
  }

  // Category validation (if provided)
  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    throw ApiError.badRequest(
      `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`
    );
  }

  // Venue validation (if provided)
  if (venue !== undefined) {
    if (!venue.name || !venue.city) {
      throw ApiError.badRequest("Venue must include name and city");
    }
  }

  // Event date validation (if provided)
  if (eventDate !== undefined) {
    const eventDateTime = new Date(eventDate);
    if (isNaN(eventDateTime.getTime())) {
      throw ApiError.badRequest("Invalid event date format");
    }
    if (eventDateTime <= new Date()) {
      throw ApiError.badRequest("Event date must be in the future");
    }
  }

  // Ticket tiers validation (if provided)
  if (ticketTiers !== undefined && Array.isArray(ticketTiers)) {
    validateTicketTiers(ticketTiers);
  }

  next();
};

/**
 * Helper: Validate ticket tiers array
 */
const validateTicketTiers = (ticketTiers) => {
  for (let i = 0; i < ticketTiers.length; i++) {
    const tier = ticketTiers[i];

    if (!tier.name || typeof tier.name !== "string") {
      throw ApiError.badRequest(`Ticket tier ${i + 1}: name is required`);
    }

    if (tier.price === undefined || typeof tier.price !== "number") {
      throw ApiError.badRequest(
        `Ticket tier ${i + 1}: price is required and must be a number`
      );
    }

    if (tier.price < 0) {
      throw ApiError.badRequest(
        `Ticket tier ${i + 1}: price cannot be negative`
      );
    }

    if (!tier.quantity || typeof tier.quantity !== "number") {
      throw ApiError.badRequest(
        `Ticket tier ${i + 1}: quantity is required and must be a number`
      );
    }

    if (tier.quantity < 1) {
      throw ApiError.badRequest(
        `Ticket tier ${i + 1}: quantity must be at least 1`
      );
    }

    if (tier.maxPerUser !== undefined && tier.maxPerUser < 1) {
      throw ApiError.badRequest(
        `Ticket tier ${i + 1}: maxPerUser must be at least 1`
      );
    }
  }
};

/**
 * Validate MongoDB ObjectId parameter
 */
const validateObjectId = (paramName = "id") => {
  return (req, res, next) => {
    const id = req.params[paramName];
    const objectIdRegex = /^[0-9a-fA-F]{24}$/;

    if (!id || !objectIdRegex.test(id)) {
      throw ApiError.badRequest(`Invalid ${paramName} format`);
    }

    next();
  };
};

/**
 * Generic required fields validator factory
 * Usage: validateRequired(['field1', 'field2'])
 */
const validateRequired = (fields) => {
  return (req, res, next) => {
    const missing = fields.filter((field) => {
      const value = req.body[field];
      return value === undefined || value === null || value === "";
    });

    if (missing.length > 0) {
      throw ApiError.badRequest(
        `Missing required fields: ${missing.join(", ")}`
      );
    }

    next();
  };
};

module.exports = {
  validateCreateEvent,
  validateUpdateEvent,
  validateObjectId,
  validateRequired,
  VALID_CATEGORIES,
};
