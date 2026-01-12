const Ticket = require("../models/Ticket");
const Event = require("../models/Event");
const qrService = require("../services/qrService");

/**
 * Validate/scan a ticket QR code
 */
const scanTicket = async (req, res) => {
  try {
    const { qrCode, eventId } = req.body;

    if (!qrCode) {
      return res.status(400).json({
        success: false,
        status: "ERROR",
        message: "QR code required",
      });
    }

    // Step 1: Verify the cryptographic signature
    const verification = qrService.verifyTicketToken(qrCode);

    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        status: "INVALID",
        message: "Invalid QR code - possible fake ticket",
        error: verification.error,
      });
    }

    // Step 2: Find ticket in database
    const ticket = await Ticket.findOne({ qrCode })
      .populate("event", "title eventDate venue")
      .populate("user", "fullName email");

    if (!ticket) {
      return res.status(404).json({
        success: false,
        status: "NOT_FOUND",
        message: "Ticket not found in system",
      });
    }

    // Step 3: Verify ticket is for this event (if eventId provided)
    if (eventId && ticket.event._id.toString() !== eventId) {
      return res.status(400).json({
        success: false,
        status: "WRONG_EVENT",
        message: "This ticket is for a different event",
        ticketEvent: ticket.event.title,
      });
    }

    // Step 4: Check if validator is assigned to this event
    if (req.user.role === "validator") {
      const isAssigned = req.user.assignedEvents.some(
        (e) => e.toString() === ticket.event._id.toString()
      );
      if (!isAssigned) {
        return res.status(403).json({
          success: false,
          status: "NOT_ASSIGNED",
          message: "You are not assigned to validate this event",
        });
      }
    }

    // Step 5: Check ticket status
    if (ticket.status === "used") {
      return res.status(400).json({
        success: false,
        status: "ALREADY_USED",
        message: "Ticket already scanned",
        checkedInAt: ticket.checkedInAt,
        holderName: ticket.user.fullName,
      });
    }

    if (ticket.status === "cancelled") {
      return res.status(400).json({
        success: false,
        status: "CANCELLED",
        message: "This ticket has been cancelled",
      });
    }

    // Step 6: Mark ticket as used (atomic update to prevent race conditions)
    const updatedTicket = await Ticket.findOneAndUpdate(
      { _id: ticket._id, status: "valid" },
      {
        status: "used",
        checkedInAt: new Date(),
        checkedInBy: req.user._id,
      },
      { new: true }
    );

    if (!updatedTicket) {
      return res.status(400).json({
        success: false,
        status: "RACE_CONDITION",
        message: "Ticket was just scanned by another device",
      });
    }

    // Step 7: Return success
    res.json({
      success: true,
      status: "VALID",
      message: "Entry granted",
      ticket: {
        id: ticket._id,
        holderName: ticket.user.fullName,
        holderEmail: ticket.user.email,
        tierName: ticket.tierName,
        eventTitle: ticket.event.title,
        checkedInAt: updatedTicket.checkedInAt,
      },
    });
  } catch (error) {
    console.error("Scan ticket error:", error);
    res.status(500).json({
      success: false,
      status: "ERROR",
      message: "System error during validation",
    });
  }
};

/**
 * Get check-in statistics for an event
 */
const getEventCheckInStats = async (req, res) => {
  try {
    const { eventId } = req.params;

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const canView =
      req.user.role === "admin" ||
      event.organizer.toString() === req.user._id.toString() ||
      (req.user.role === "validator" &&
        req.user.assignedEvents.includes(eventId));

    if (!canView) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Get stats
    const totalTickets = await Ticket.countDocuments({
      event: eventId,
      status: { $ne: "cancelled" },
    });
    const checkedIn = await Ticket.countDocuments({
      event: eventId,
      status: "used",
    });
    const pending = await Ticket.countDocuments({
      event: eventId,
      status: "valid",
    });

    // Get recent check-ins
    const recentCheckIns = await Ticket.find({
      event: eventId,
      status: "used",
    })
      .populate("user", "fullName")
      .sort({ checkedInAt: -1 })
      .limit(10);

    res.json({
      event: {
        id: event._id,
        title: event.title,
      },
      stats: {
        total: totalTickets,
        checkedIn,
        pending,
        checkInRate:
          totalTickets > 0 ? ((checkedIn / totalTickets) * 100).toFixed(1) : 0,
      },
      recentCheckIns: recentCheckIns.map((t) => ({
        holderName: t.user.fullName,
        tierName: t.tierName,
        checkedInAt: t.checkedInAt,
      })),
    });
  } catch (error) {
    console.error("Get check-in stats error:", error);
    res.status(500).json({ message: "Error fetching statistics" });
  }
};

/**
 * Get validator's assigned events
 */
const getValidatorEvents = async (req, res) => {
  try {
    console.log("User assignedEvents:", req.user.assignedEvents);

    const events = await Event.find({
      _id: { $in: req.user.assignedEvents },
      // status: "published",
      // eventDate: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Temporarily removed for debugging
    }).select("title eventDate venue bannerImage");

    // console.log("Found events:", events);

    res.json({ events });
  } catch (error) {
    console.error("Get validator events error:", error);
    res.status(500).json({ message: "Error fetching assigned events" });
  }
};

module.exports = {
  scanTicket,
  getEventCheckInStats,
  getValidatorEvents,
};
