const User = require("../models/User");
const Event = require("../models/Event");
const bcrypt = require("bcryptjs");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const paystackService = require("../services/paystackService");

const addSubAccount = asyncHandler(async (req, res) => {
  const { businessName, bankCode, accountNumber, platformFee } = req.body;

  if (!businessName || !bankCode || !accountNumber) {
    throw ApiError.badRequest(
      "Business name, bank code, and account number are required"
    );
  }

  if (!/^\d{10}$/.test(accountNumber)) {
    throw ApiError.badRequest("Account number must be 10 digits");
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    throw ApiError.notFound("User not found");
  }

  if (user.organizerProfile?.paystack?.isActive) {
    throw ApiError.badRequest(
      "Paystack subaccount already exists. Contact support to update."
    );
  }

  const result = await paystackService.createSubaccount(user, {
    businessName,
    bankCode,
    accountNumber,
    platformFeePercentage: platformFee || 10,
  });

  if (!result.status) {
    throw ApiError.badRequest(
      result.message || "Failed to create Paystack subaccount"
    );
  }

  user.organizerProfile.platformFeePercent = result.data.percentage_charge;
  user.organizerProfile.paystack = {
    subaccountCode: result.data.subaccount_code,
    businessName: result.data.business_name,
    bankCode: bankCode,
    accountNumber: accountNumber,
    percentageCharge: 100 - result.data.percentage_charge, // Platform's cut (10%)
    isActive: true,
  };

  await user.save();

  res.status(201).json({
    message: "Paystack subaccount created successfully",
    paystack: {
      subaccountCode: result.data.subaccount_code,
      businessName: result.data.business_name,
      isActive: true,
    },
  });
});

const getBanks = asyncHandler(async (req, res) => {
  const result = await paystackService.getBanks();

  if (!result.status) {
    throw ApiError.badRequest("Failed to fetch banks");
  }

  res.json({ banks: result.data });
});

/**
 * Create a validator for an event
 * POST /api/organizer/events/:eventId/validators
 */
const createValidator = asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  const { email, password, fullName, phone } = req.body;

  // Validate required fields
  if (!email || !password || !fullName) {
    throw ApiError.badRequest("Email, password, and full name are required");
  }

  // Verify organizer owns this event
  const event = await Event.findById(eventId);
  if (!event) {
    throw ApiError.notFound("Event not found");
  }

  if (event.organizer.toString() !== req.user._id.toString()) {
    throw ApiError.forbidden("You can only add validators to your own events");
  }

  // Check if user with this email already exists
  let validator = await User.findOne({ email: email.toLowerCase() });

  if (validator) {
    // If user exists but is not a validator, reject
    if (validator.role !== "validator") {
      throw ApiError.badRequest(
        "A user with this email already exists with a different role"
      );
    }

    // If already assigned to this event, reject
    if (validator.assignedEvents.includes(eventId)) {
      throw ApiError.badRequest(
        "This validator is already assigned to this event"
      );
    }

    // Assign existing validator to this event
    validator.assignedEvents.push(eventId);
    await validator.save();

    if (!event.validators.includes(validator._id)) {
      event.validators.push(validator._id);
      await event.save();
    }

    return res.json({
      message: "Existing validator assigned to event",
      validator: {
        id: validator._id,
        fullName: validator.fullName,
        email: validator.email,
      },
    });
  }

  // Create new validator user
  const hashedPassword = await bcrypt.hash(password, 10);

  validator = new User({
    email: email.toLowerCase(),
    password: hashedPassword,
    fullName,
    phone,
    role: "validator",
    createdByOrganizer: req.user._id,
    assignedEvents: [eventId],
  });

  await validator.save();

  // Add validator to event
  event.validators.push(validator._id);
  await event.save();

  res.status(201).json({
    message: "Validator created and assigned to event",
    validator: {
      id: validator._id,
      fullName: validator.fullName,
      email: validator.email,
    },
  });
});

/**
 * Get all validators for an event
 * GET /api/organizer/events/:eventId/validators
 */
const getEventValidators = asyncHandler(async (req, res) => {
  const { eventId } = req.params;

  // Verify organizer owns this event
  const event = await Event.findById(eventId).populate(
    "validators",
    "fullName email phone createdAt"
  );

  if (!event) {
    throw ApiError.notFound("Event not found");
  }

  if (event.organizer.toString() !== req.user._id.toString()) {
    throw ApiError.forbidden(
      "You can only view validators for your own events"
    );
  }

  res.json({
    event: {
      id: event._id,
      title: event.title,
    },
    validators: event.validators,
  });
});

/**
 * Remove a validator from an event
 * DELETE /api/organizer/events/:eventId/validators/:validatorId
 */
const removeValidatorFromEvent = asyncHandler(async (req, res) => {
  const { eventId, validatorId } = req.params;

  // Verify organizer owns this event
  const event = await Event.findById(eventId);
  if (!event) {
    throw ApiError.notFound("Event not found");
  }

  if (event.organizer.toString() !== req.user._id.toString()) {
    throw ApiError.forbidden(
      "You can only remove validators from your own events"
    );
  }

  // Remove from event's validators
  event.validators = event.validators.filter(
    (v) => v.toString() !== validatorId
  );
  await event.save();

  // Remove from validator's assignedEvents
  const validator = await User.findById(validatorId);
  if (validator) {
    validator.assignedEvents = validator.assignedEvents.filter(
      (e) => e.toString() !== eventId
    );
    await validator.save();
  }

  res.json({
    message: "Validator removed from event",
  });
});

module.exports = {
  addSubAccount,
  getBanks,
  createValidator,
  getEventValidators,
  removeValidatorFromEvent,
};
