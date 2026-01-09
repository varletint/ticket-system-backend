const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

class PDFService {
  async generateTicketPDF({ ticket, event, user, qrImageDataUrl }) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: [400, 600],
          margin: 30,
        });

        // Collect data in chunks
        let buffers = [];
        doc.on("data", buffers.push.bind(buffers));
        doc.on("end", () => {
          let pdfBuffer = Buffer.concat(buffers);
          resolve(pdfBuffer);
        });

        // Header background
        doc.rect(0, 0, 400, 120).fill("#1a1a2e");

        // Event title
        doc
          .fillColor("#ffffff")
          .fontSize(20)
          .font("Helvetica-Bold")
          .text(event.title, 30, 30, { width: 340, align: "center" });

        // Artist
        if (event.artist) {
          doc
            .fontSize(14)
            .font("Helvetica")
            .text(event.artist, 30, 60, { width: 340, align: "center" });
        }

        // Date and time
        const eventDate = new Date(event.eventDate);
        const dateStr = eventDate.toLocaleDateString("en-NG", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        const timeStr = eventDate.toLocaleTimeString("en-NG", {
          hour: "2-digit",
          minute: "2-digit",
        });

        doc.fontSize(12).text(`${dateStr} at ${timeStr}`, 30, 85, {
          width: 340,
          align: "center",
        });

        // Ticket details section
        doc.fillColor("#333333");

        // Venue
        doc.fontSize(11).font("Helvetica-Bold").text("VENUE", 30, 140);
        doc.font("Helvetica").text(`${event.venue.name}`, 30, 155);
        doc
          .fontSize(10)
          .fillColor("#666666")
          .text(`${event.venue.address || ""} ${event.venue.city}`, 30, 170);

        // Ticket holder
        doc
          .fillColor("#333333")
          .fontSize(11)
          .font("Helvetica-Bold")
          .text("TICKET HOLDER", 30, 200);
        doc.font("Helvetica").text(user.fullName, 30, 215);
        doc.fontSize(10).fillColor("#666666").text(user.email, 30, 230);

        // Ticket type
        doc
          .fillColor("#333333")
          .fontSize(11)
          .font("Helvetica-Bold")
          .text("TICKET TYPE", 220, 200);
        doc.font("Helvetica").text(ticket.tierName, 220, 215);
        doc
          .fontSize(10)
          .fillColor("#666666")
          .text(`₦${ticket.price.toLocaleString()}`, 220, 230);

        // Divider line
        doc.moveTo(30, 260).lineTo(370, 260).stroke("#cccccc");

        // QR Code section
        doc
          .fillColor("#333333")
          .fontSize(11)
          .font("Helvetica-Bold")
          .text("SCAN FOR ENTRY", 30, 280, { width: 340, align: "center" });

        // Add QR code image
        if (qrImageDataUrl) {
          const base64Data = qrImageDataUrl.replace(
            /^data:image\/png;base64,/,
            ""
          );
          const qrBuffer = Buffer.from(base64Data, "base64");
          doc.image(qrBuffer, 125, 300, { width: 150, height: 150 });
        }

        // Ticket ID
        doc
          .fontSize(8)
          .fillColor("#999999")
          .text(`Ticket ID: ${ticket._id}`, 30, 460, {
            width: 340,
            align: "center",
          });

        // Footer
        doc.rect(0, 500, 400, 100).fill("#f5f5f5");

        doc
          .fillColor("#666666")
          .fontSize(8)
          .text(
            "IMPORTANT: This ticket is valid for one-time entry only.",
            30,
            520,
            { width: 340, align: "center" }
          )
          .text(
            "Screenshot or copy of this ticket will not be accepted.",
            30,
            535,
            { width: 340, align: "center" }
          )
          .text("Present this QR code at the venue entrance.", 30, 550, {
            width: 340,
            align: "center",
          });

        doc
          .fillColor("#999999")
          .fontSize(7)
          .text("Powered by Ticket System", 30, 565, {
            width: 340,
            align: "center",
          });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = new PDFService();
