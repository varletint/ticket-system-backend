const QRCode = require("qrcode");
const crypto = require("crypto");

const SECRET_KEY = process.env.QR_SECRET_KEY || "default-secret";

class QRService {
  /**
   * Generate a cryptographically signed ticket token
   */
  generateTicketToken(ticketId, eventId) {
    const payload = {
      tid: ticketId.toString(),
      eid: eventId.toString(),
      iat: Date.now(),
    };

    const dataString = JSON.stringify(payload);
    const signature = crypto
      .createHmac("sha256", SECRET_KEY)
      .update(dataString)
      .digest("hex")
      .substring(0, 16);

    // Combine payload + signature and encode
    const token = Buffer.from(
      JSON.stringify({
        ...payload,
        sig: signature,
      })
    ).toString("base64url");

    return token;
  }

  /**
   * Verify a scanned ticket token
   */
  verifyTicketToken(token) {
    try {
      // Decode the token
      const decoded = JSON.parse(Buffer.from(token, "base64url").toString());

      const { sig, ...payload } = decoded;

      // Recreate signature and compare
      const expectedSig = crypto
        .createHmac("sha256", SECRET_KEY)
        .update(JSON.stringify(payload))
        .digest("hex")
        .substring(0, 16);

      if (sig !== expectedSig) {
        return {
          valid: false,
          error: "Invalid signature - potential fake ticket",
        };
      }

      return {
        valid: true,
        ticketId: payload.tid,
        eventId: payload.eid,
        issuedAt: payload.iat,
      };
    } catch (error) {
      return { valid: false, error: "Malformed token" };
    }
  }

  /**
   * Generate QR code as base64 data URL
   */
  async generateQRImage(token, options = {}) {
    const qrOptions = {
      errorCorrectionLevel: "M",
      type: "png",
      width: options.width || 300,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    };

    const qrDataUrl = await QRCode.toDataURL(token, qrOptions);
    return qrDataUrl;
  }

  /**
   * Generate QR code and save to file
   */
  async generateQRFile(token, filePath) {
    await QRCode.toFile(filePath, token, {
      errorCorrectionLevel: "H",
      width: 400,
      margin: 2,
    });
    return filePath;
  }
}

module.exports = new QRService();
