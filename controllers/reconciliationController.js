const Order = require("../models/Order");
const Ticket = require("../models/Ticket");
const Event = require("../models/Event");
const Transaction = require("../models/Transaction");
const auditService = require("../services/auditService");

// Get reconciliation summary
const getSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const matchStage = {};
    if (startDate || endDate) matchStage.createdAt = dateFilter;
    const orderStats = await Order.aggregate([
      { $match: { ...matchStage, paymentStatus: "completed" } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: "$totalAmount" },
          totalTickets: { $sum: "$quantity" },
        },
      },
    ]);

    const ticketCount = await Ticket.countDocuments({
      ...matchStage,
      status: { $ne: "cancelled" },
    });

    const eventStats = await Event.aggregate([
      { $match: {} },
      {
        $group: {
          _id: null,
          totalEvents: { $sum: 1 },
          reportedTicketsSold: { $sum: "$totalTicketsSold" },
          reportedRevenue: { $sum: "$totalRevenue" },
        },
      },
    ]);

    const transactionStats = await Transaction.aggregate([
      { $match: { ...matchStage, status: "completed" } },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          totalRefunded: { $sum: "$totalRefunded" },
        },
      },
    ]);

    const orders = orderStats[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      totalTickets: 0,
    };
    const events = eventStats[0] || {
      totalEvents: 0,
      reportedTicketsSold: 0,
      reportedRevenue: 0,
    };
    const transactions = transactionStats[0] || {
      totalTransactions: 0,
      totalAmount: 0,
      totalRefunded: 0,
    };

    const ticketDiscrepancy = orders.totalTickets - ticketCount;
    const revenueDiscrepancy = orders.totalRevenue - events.reportedRevenue;
    const transactionDiscrepancy =
      orders.totalOrders - transactions.totalTransactions;

    res.json({
      success: true,
      data: {
        orders: {
          total: orders.totalOrders,
          revenue: orders.totalRevenue,
          ticketsExpected: orders.totalTickets,
        },
        tickets: {
          actual: ticketCount,
          discrepancy: ticketDiscrepancy,
          isHealthy: ticketDiscrepancy === 0,
        },
        events: {
          total: events.totalEvents,
          reportedTickets: events.reportedTicketsSold,
          reportedRevenue: events.reportedRevenue,
        },
        transactions: {
          total: transactions.totalTransactions,
          amount: transactions.totalAmount,
          refunded: transactions.totalRefunded,
          net: transactions.totalAmount - transactions.totalRefunded,
          discrepancy: transactionDiscrepancy,
          isHealthy: transactionDiscrepancy === 0,
        },
        health: {
          ticketsHealthy: ticketDiscrepancy === 0,
          revenueHealthy: Math.abs(revenueDiscrepancy) < 100, // Allow small rounding errors
          transactionsHealthy: transactionDiscrepancy === 0,
        },
      },
    });
  } catch (error) {
    console.error("Get reconciliation summary error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch reconciliation summary",
    });
  }
};

// Find mismatches
const getMismatches = async (req, res) => {
  try {
    const mismatches = [];

    // Find orders without corresponding tickets
    const ordersWithoutTickets = await Order.find({
      paymentStatus: "completed",
      tickets: { $size: 0 },
    })
      .populate("user", "email")
      .populate("event", "title")
      .limit(50);

    for (const order of ordersWithoutTickets) {
      mismatches.push({
        type: "order_missing_tickets",
        severity: "high",
        entity: "Order",
        entityId: order._id,
        description: `Order ${order._id} has no tickets but payment is completed`,
        details: {
          user: order.user?.email,
          event: order.event?.title,
          amount: order.totalAmount,
          quantity: order.quantity,
        },
      });
    }

    // Find events with mismatched sold counts
    const events = await Event.find({ status: "published" });
    for (const event of events) {
      const actualTickets = await Ticket.countDocuments({
        event: event._id,
        status: { $ne: "cancelled" },
      });

      if (actualTickets !== event.totalTicketsSold) {
        mismatches.push({
          type: "event_ticket_count_mismatch",
          severity: "medium",
          entity: "Event",
          entityId: event._id,
          description: `Event "${event.title}" shows ${event.totalTicketsSold} sold but has ${actualTickets} tickets`,
          details: {
            reported: event.totalTicketsSold,
            actual: actualTickets,
            difference: event.totalTicketsSold - actualTickets,
          },
        });
      }
    }

    // Find completed orders without transactions
    const completedOrders = await Order.find({
      paymentStatus: "completed",
    }).select("_id");
    const orderIds = completedOrders.map((o) => o._id);
    const transactionsForOrders = await Transaction.find({
      order: { $in: orderIds },
      status: "completed",
    }).select("order");
    const transactionOrderIds = new Set(
      transactionsForOrders.map((t) => t.order?.toString())
    );

    for (const order of completedOrders) {
      if (!transactionOrderIds.has(order._id.toString())) {
        mismatches.push({
          type: "order_missing_transaction",
          severity: "high",
          entity: "Order",
          entityId: order._id,
          description: `Order ${order._id} is completed but has no transaction record`,
        });
      }
    }

    // Find orphaned tickets (no valid order)
    const orphanedTickets = await Ticket.aggregate([
      {
        $lookup: {
          from: "orders",
          localField: "order",
          foreignField: "_id",
          as: "orderData",
        },
      },
      { $match: { orderData: { $size: 0 } } },
      { $limit: 50 },
    ]);

    for (const ticket of orphanedTickets) {
      mismatches.push({
        type: "orphaned_ticket",
        severity: "medium",
        entity: "Ticket",
        entityId: ticket._id,
        description: `Ticket ${ticket._id} references non-existent order`,
      });
    }

    res.json({
      success: true,
      data: {
        total: mismatches.length,
        mismatches,
        summary: {
          high: mismatches.filter((m) => m.severity === "high").length,
          medium: mismatches.filter((m) => m.severity === "medium").length,
          low: mismatches.filter((m) => m.severity === "low").length,
        },
      },
    });
  } catch (error) {
    console.error("Get mismatches error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to find mismatches" });
  }
};

// Fix a specific mismatch
const fixMismatch = async (req, res) => {
  try {
    const { type, entityId, action } = req.body;

    let result = { fixed: false, message: "" };

    switch (type) {
      case "event_ticket_count_mismatch": {
        const actualCount = await Ticket.countDocuments({
          event: entityId,
          status: { $ne: "cancelled" },
        });
        await Event.findByIdAndUpdate(entityId, {
          totalTicketsSold: actualCount,
        });
        result = {
          fixed: true,
          message: `Updated event ticket count to ${actualCount}`,
        };
        break;
      }

      case "order_missing_tickets": {
        // Would need to regenerate tickets - this is complex
        result = {
          fixed: false,
          message:
            "Manual intervention required - tickets need to be regenerated",
        };
        break;
      }

      case "order_missing_transaction": {
        // Create transaction record from order
        const order = await Order.findById(entityId).populate("event");
        if (order) {
          const transaction = new Transaction({
            idempotencyKey: `recovery-${order._id}-${Date.now()}`,
            status: "completed",
            user: order.user,
            order: order._id,
            event: order.event._id,
            amount: order.totalAmount,
            gateway: {
              provider: order.paymentMethod === "mock" ? "mock" : "paystack",
              reference: order.paystack?.reference,
            },
            completedAt: order.createdAt,
          });
          await transaction.save();
          result = {
            fixed: true,
            message: "Created transaction record from order",
          };
        }
        break;
      }

      default:
        result = { fixed: false, message: "Unknown mismatch type" };
    }

    // Log the fix attempt
    await auditService.logAdminAction(
      "admin.reconciliation_run",
      req.user,
      {
        type: "Reconciliation",
        id: entityId,
        name: type,
      },
      { action, result }
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Fix mismatch error:", error);
    res.status(500).json({ success: false, message: "Failed to fix mismatch" });
  }
};

// Run full reconciliation report
const runReconciliation = async (req, res) => {
  try {
    const startTime = Date.now();

    // Fix event ticket counts
    const events = await Event.find({});
    let eventsFixed = 0;

    for (const event of events) {
      const actualCount = await Ticket.countDocuments({
        event: event._id,
        status: { $ne: "cancelled" },
      });

      const actualRevenue = await Order.aggregate([
        { $match: { event: event._id, paymentStatus: "completed" } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]);

      const revenue = actualRevenue[0]?.total || 0;

      if (
        event.totalTicketsSold !== actualCount ||
        event.totalRevenue !== revenue
      ) {
        await Event.findByIdAndUpdate(event._id, {
          totalTicketsSold: actualCount,
          totalRevenue: revenue,
        });
        eventsFixed++;
      }
    }

    const duration = Date.now() - startTime;

    await auditService.logAdminAction(
      "admin.reconciliation_run",
      req.user,
      {
        type: "System",
        name: "Full Reconciliation",
      },
      { eventsFixed, duration }
    );

    res.json({
      success: true,
      data: {
        eventsProcessed: events.length,
        eventsFixed,
        duration: `${duration}ms`,
      },
    });
  } catch (error) {
    console.error("Run reconciliation error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to run reconciliation" });
  }
};

module.exports = {
  getSummary,
  getMismatches,
  fixMismatch,
  runReconciliation,
};
