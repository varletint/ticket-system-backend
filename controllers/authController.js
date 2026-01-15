const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const {
  logUserRegister,
  logUserLogin,
  logFailedLogin,
  logUserLogout,
} = require("../utils/auditHelper");

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "15m",
  });

  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || "7d",
  });

  return { accessToken, refreshToken };
};

const register = asyncHandler(async (req, res) => {
  const { email, password, fullName, phone, role } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw ApiError.badRequest("Email already registered");
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const userData = {
    email,
    password: hashedPassword,
    fullName,
    phone,
    role: role || "buyer",
  };

  if (role === "organizer") {
    userData.organizerProfile = {
      platformStatus: "pending",
    };
  }

  const user = await User.create(userData);

  const { accessToken, refreshToken } = generateTokens(user._id);

  user.refreshToken = refreshToken;
  await user.save();

  logUserRegister(req, user);

  res.status(201).json({
    message: "Registration successful",
    user: {
      id: user._id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizerProfile: user.organizerProfile,
    },
    accessToken,
    refreshToken,
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    // Log failed login attempt - user not found
    logFailedLogin(req, email, "User not found");
    throw ApiError.unauthorized("Invalid email or password");
  }

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    // Log failed login attempt - wrong password
    logFailedLogin(req, email, "Invalid password");
    throw ApiError.unauthorized("Invalid email or password");
  }

  const { accessToken, refreshToken } = generateTokens(user._id);

  user.refreshToken = refreshToken;
  await user.save();

  // Log successful login
  logUserLogin(req, user);

  res.json({
    message: "Login successful",
    user: {
      id: user._id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizerProfile: user.organizerProfile,
      assignedEvents: user.assignedEvents,
    },
    accessToken,
    refreshToken,
  });
});

const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.body;

  if (!token) {
    throw ApiError.unauthorized("Refresh token required");
  }

  const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

  const user = await User.findById(decoded.userId);
  if (!user || user.refreshToken !== token) {
    throw ApiError.unauthorized("Invalid refresh token");
  }

  const tokens = generateTokens(user._id);

  user.refreshToken = tokens.refreshToken;
  await user.save();

  res.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});

const getMe = asyncHandler(async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      email: req.user.email,
      fullName: req.user.fullName,
      phone: req.user.phone,
      role: req.user.role,
      organizerProfile: req.user.organizerProfile,
      assignedEvents: req.user.assignedEvents,
      createdAt: req.user.createdAt,
    },
  });
});

const logout = asyncHandler(async (req, res) => {
  logUserLogout(req, req.user);

  req.user.refreshToken = null;
  await req.user.save();
  res.json({ message: "Logged out successfully" });
});

const updateUserProfile = asyncHandler(async (req, res) => {
  const { fullName, phone, password, organizerProfile } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) {
    throw ApiError.notFound("User not found");
  }

  if (fullName) user.fullName = fullName;
  if (phone) user.phone = phone;

  if (password) {
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
  }

  if (user.role === "organizer" && organizerProfile) {
    if (organizerProfile.businessName) {
      user.organizerProfile.businessName = organizerProfile.businessName;
    }
    if (organizerProfile.description) {
      user.organizerProfile.description = organizerProfile.description;
    }
    if (organizerProfile.logo) {
      user.organizerProfile.logo = organizerProfile.logo;
    }
  }

  let wasAutoApproved = false;
  if (
    user.role === "organizer" &&
    user.organizerProfile?.platformStatus === "pending"
  ) {
    const isProfileComplete =
      user.organizerProfile.businessName &&
      user.organizerProfile.description &&
      user.phone;

    if (isProfileComplete) {
      user.organizerProfile.platformStatus = "approved";
      user.organizerProfile.platformApprovedAt = new Date();
      wasAutoApproved = true;
    }
  }

  await user.save();

  res.json({
    message: wasAutoApproved
      ? "Profile updated! Your organizer account has been approved."
      : "Profile updated successfully",
    wasAutoApproved,
    user: {
      id: user._id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      organizerProfile: user.organizerProfile,
    },
  });
});

module.exports = {
  register,
  login,
  refreshToken,
  getMe,
  logout,
  updateUserProfile,
};
