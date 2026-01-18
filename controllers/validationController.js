const Ticket = require("../models/Ticket");
const Event = require("../models/Event");
const qrService = require("../services/qrService");

const scanTicket = async (req, res) => {
  try {
    const { qrCode, eventId } = req.body;
    if (!qrCode)
      return res
        .status(400)
        .json({ success: false, status: "ERROR", message: "QR code required" });

    const verification = qrService.verifyTicketToken(qrCode);
    if (!verification.valid)
      return res
        .status(400)
        .json({
          success: false,
          status: "INVALID",
          message: "Invalid QR code - possible fake ticket",
          error: verification.error,
        });

    const ticket = await Ticket.findOne({ qrCode })
      .populate("event", "title eventDate venue")
      .populate("user", "fullName email");
    if (!ticket)
      return res
        .status(404)
        .json({
          success: false,
          status: "NOT_FOUND",
          message: "Ticket not found in system",
        });

    if (eventId && ticket.event._id.toString() !== eventId)
      return res
        .status(400)
        .json({
          success: false,
          status: "WRONG_EVENT",
          message: "This ticket is for a different event",
          ticketEvent: ticket.event.title,
        });

    if (req.user.role === "validator") {
      const isAssigned = req.user.assignedEvents.some(
        (e) => e.toString() === ticket.event._id.toString()
      );
      if (!isAssigned)
        return res
          .status(403)
          .json({
            success: false,
            status: "NOT_ASSIGNED",
            message: "You are not assigned to validate this event",
          });
    }

    if (ticket.status === "used")
      return res
        .status(400)
        .json({
          success: false,
          status: "ALREADY_USED",
          message: "Ticket already scanned",
          checkedInAt: ticket.checkedInAt,
          holderName: ticket.user.fullName,
        });
    if (ticket.status === "cancelled")
      return res
        .status(400)
        .json({
          success: false,
          status: "CANCELLED",
          message: "This ticket has been cancelled",
        });

    const updatedTicket = await Ticket.findOneAndUpdate(
      { _id: ticket._id, status: "valid" },
      { status: "used", checkedInAt: new Date(), checkedInBy: req.user._id },
      { new: true }
    );
    if (!updatedTicket)
      return res
        .status(400)
        .json({
          success: false,
          status: "RACE_CONDITION",
          message: "Ticket was just scanned by another device",
        });

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
    res
      .status(500)
      .json({
        success: false,
        status: "ERROR",
        message: "System error during validation",
      });
  }
};

const getEventCheckInStats = async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const canView =
      req.user.role === "admin" ||
      event.organizer.toString() === req.user._id.toString() ||
      (req.user.role === "validator" &&
        req.user.assignedEvents.includes(eventId));
    if (!canView) return res.status(403).json({ message: "Not authorized" });

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
    const recentCheckIns = await Ticket.find({ event: eventId, status: "used" })
      .populate("user", "fullName")
      .sort({ checkedInAt: -1 })
      .limit(10);

    res.json({
      event: { id: event._id, title: event.title },
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

const getValidatorEvents = async (req, res) => {
  try {
    console.log("User assignedEvents:", req.user.assignedEvents);
    const events = await Event.find({
      _id: { $in: req.user.assignedEvents },
      status: "published",
    }).select("title eventDate venue bannerImage");
    res.json({ events });
  } catch (error) {
    console.error("Get validator events error:", error);
    res.status(500).json({ message: "Error fetching assigned events" });
  }
};

module.exports = { scanTicket, getEventCheckInStats, getValidatorEvents };
