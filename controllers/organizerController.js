const User = require("../models/User");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const paystackService = require("../services/paystackService");

const addSubAccount = asyncHandler(async (req, res) => {
  const { businessName, bankCode, accountNumber, percentageCharge } = req.body;

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
    percentageCharge: percentageCharge || 90,
  });

  if (!result.status) {
    throw ApiError.badRequest(
      result.message || "Failed to create Paystack subaccount"
    );
  }

  user.organizerProfile.paystack = {
    subaccountCode: result.data.subaccount_code,
    businessName: result.data.business_name,
    bankCode: bankCode,
    accountNumber: accountNumber,
    percentageCharge: result.data.percentage_charge,
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

module.exports = { addSubAccount, getBanks };
