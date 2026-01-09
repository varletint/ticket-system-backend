/**
 * Subaccount Split Payment Verification Script
 *
 * Run this script to verify that your Paystack subaccount setup is working correctly.
 * Usage: node scripts/verify-subaccount.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const Event = require("../models/Event");
const Transaction = require("../models/Transaction");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/ticket-system";

async function verifySubaccountSetup() {
  try {
    console.log("\n🔍 PAYSTACK SUBACCOUNT VERIFICATION\n");
    console.log("=".repeat(50));

    // 1. Check Paystack API key
    console.log("\n1️⃣ Checking Paystack API Key...");
    if (!process.env.PAYSTACK_SECRET_KEY) {
      console.log("   ❌ PAYSTACK_SECRET_KEY not found in .env");
      return;
    }
    const keyPrefix = process.env.PAYSTACK_SECRET_KEY.substring(0, 10);
    console.log(`   ✅ API Key found: ${keyPrefix}...`);
    console.log(
      `   📝 Key type: ${
        process.env.PAYSTACK_SECRET_KEY.includes("test") ? "TEST" : "LIVE"
      }`
    );

    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log("\n2️⃣ Connected to MongoDB");

    // 2. Find organizers with subaccounts
    console.log("\n3️⃣ Checking Organizers with Subaccounts...");
    const organizersWithSubaccount = await User.find({
      role: "organizer",
      "organizerProfile.paystack.subaccountCode": { $exists: true, $ne: null },
    }).select(
      "fullName email organizerProfile.paystack organizerProfile.platformStatus"
    );

    if (organizersWithSubaccount.length === 0) {
      console.log("   ⚠️  No organizers with subaccounts found!");
      console.log("   📝 To create a subaccount:");
      console.log("      1. Approve an organizer via admin panel");
      console.log("      2. POST /api/admin/organizers/:id/create-subaccount");
    } else {
      console.log(
        `   ✅ Found ${organizersWithSubaccount.length} organizer(s) with subaccounts:\n`
      );
      organizersWithSubaccount.forEach((org, i) => {
        console.log(`   ${i + 1}. ${org.fullName} (${org.email})`);
        console.log(`      Status: ${org.organizerProfile?.platformStatus}`);
        console.log(
          `      Subaccount: ${org.organizerProfile?.paystack?.subaccountCode}`
        );
        console.log(`      Bank: ${org.organizerProfile?.paystack?.bankCode}`);
        console.log(
          `      Account: ${org.organizerProfile?.paystack?.accountNumber}`
        );
        console.log(
          `      Percentage: ${org.organizerProfile?.paystack?.percentageCharge}%`
        );
        console.log("");
      });
    }

    // 3. Check events linked to organizers with subaccounts
    console.log("4️⃣ Checking Events with Split Payment Enabled...");
    const organizerIds = organizersWithSubaccount.map((o) => o._id);
    const eventsWithSplit = await Event.find({
      organizer: { $in: organizerIds },
      status: "published",
    })
      .select("title organizer")
      .populate(
        "organizer",
        "fullName organizerProfile.paystack.subaccountCode"
      );

    if (eventsWithSplit.length === 0) {
      console.log(
        "   ⚠️  No published events from organizers with subaccounts"
      );
    } else {
      console.log(
        `   ✅ Found ${eventsWithSplit.length} event(s) with split payment:\n`
      );
      eventsWithSplit.forEach((event, i) => {
        console.log(`   ${i + 1}. ${event.title}`);
        console.log(`      Organizer: ${event.organizer?.fullName}`);
        console.log(
          `      Subaccount: ${event.organizer?.organizerProfile?.paystack?.subaccountCode}`
        );
        console.log("");
      });
    }

    // 4. Check recent transactions with split data
    console.log("5️⃣ Checking Recent Transactions with Split Data...");
    const recentTransactions = await Transaction.find({
      status: "completed",
      "splits.organizerSubaccountCode": { $exists: true },
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("amount splits gateway.reference createdAt")
      .populate("event", "title");

    if (recentTransactions.length === 0) {
      console.log("   ⚠️  No completed transactions with split data found");
      console.log("   📝 This could mean:");
      console.log("      - No payments have been made yet");
      console.log("      - Payments were made before split tracking was added");
      console.log("      - Split data extraction is not working");
    } else {
      console.log(
        `   ✅ Found ${recentTransactions.length} transaction(s) with split data:\n`
      );
      recentTransactions.forEach((tx, i) => {
        console.log(`   ${i + 1}. Ref: ${tx.gateway?.reference}`);
        console.log(`      Event: ${tx.event?.title}`);
        console.log(`      Total: ₦${tx.amount?.toLocaleString()}`);
        console.log(
          `      Platform: ₦${tx.splits?.platformAmount?.toLocaleString() || 0}`
        );
        console.log(
          `      Organizer: ₦${
            tx.splits?.organizerAmount?.toLocaleString() || 0
          }`
        );
        console.log(
          `      Fees: ₦${tx.splits?.paystackFees?.toLocaleString() || 0}`
        );
        console.log(
          `      Subaccount: ${tx.splits?.organizerSubaccountCode || "N/A"}`
        );
        console.log("");
      });
    }

    console.log("=".repeat(50));
    console.log("\n✅ Verification Complete!\n");
  } catch (error) {
    console.error("❌ Verification failed:", error.message);
  } finally {
    await mongoose.disconnect();
  }
}

verifySubaccountSetup();
