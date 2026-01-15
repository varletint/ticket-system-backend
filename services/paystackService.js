class PaystackService {
  constructor() {
    this.baseUrl = "https://api.paystack.co";
    this.secretKey = process.env.PAYSTACK_SECRET_KEY;
  }

  async createSubaccount(organizer, bankDetails) {
    const response = await fetch(`${this.baseUrl}/subaccount`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        business_name: bankDetails.businessName,
        settlement_bank: bankDetails.bankCode,
        account_number: bankDetails.accountNumber,
        percentage_charge: bankDetails.platformFee || 10, // Platform takes 10%, organizer gets 90%
        description: `Organizer: ${organizer.fullName}`,
      }),
    });

    return await response.json();
  }

  async initializePayment({
    email,
    amount,
    subaccountCode,
    reference,
    metadata,
  }) {
    const response = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amount * 100, // Paystack uses kobo
        reference,
        subaccount: subaccountCode,
        metadata,
      }),
    });

    return await response.json();
  }

  async verifyPayment(reference) {
    const response = await fetch(
      `${this.baseUrl}/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
        },
      }
    );

    return await response.json();
  }

  async getBanks() {
    const response = await fetch(`https://api.paystack.co/bank`, {
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
      },
    });

    return await response.json();
  }

  calculateSplit(totalAmount, organizerPercentage = 90) {
    const organizerAmount = Math.floor(
      (totalAmount * organizerPercentage) / 100
    );
    const platformAmount = totalAmount - organizerAmount;
    return { organizerAmount, platformAmount };
  }
}

module.exports = new PaystackService();
