class PaystackService {
  constructor() {
    this.baseUrl = "https://api.paystack.co";
    this.secretKey = process.env.PAYSTACK_SECRET_KEY;
    this.isMock = !this.secretKey || this.secretKey.includes("sk_test_1");
  }

  async createSubaccount(organizer, bankDetails) {
    if (this.isMock) {
      return {
        success: true,
        data: {
          subaccount_code: `ACCT_mock_${Date.now()}`,
          business_name: bankDetails.businessName,
          percentage_charge: bankDetails.percentageCharge || 90,
          settlement_bank: bankDetails.bankCode,
          account_number: bankDetails.accountNumber,
          active: true,
        },
      };
    }

    // Real Paystack API call
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
        percentage_charge: bankDetails.percentageCharge || 90,
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
    // if (this.isMock) {
    //   const mockRef = reference || `ref_mock_${Date.now()}`;
    //   return {
    //     success: true,
    //     data: {
    //       authorization_url: `http://localhost:5173/mock-checkout?ref=${mockRef}&amount=${amount}`,
    //       access_code: `access_mock_${Date.now()}`,
    //       reference: mockRef,
    //     },
    //   };
    // }

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
    if (this.isMock) {
      const success = Math.random() > 0.1;
      return {
        success: true,
        data: {
          status: success ? "success" : "failed",
          reference,
          amount: 1000000,
          channel: "card",
          paid_at: new Date().toISOString(),
          metadata: {},
        },
      };
    }

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
    if (this.isMock) {
      return {
        success: true,
        data: [
          { code: "044", name: "Access Bank" },
          { code: "023", name: "Citibank Nigeria" },
          { code: "050", name: "Ecobank Nigeria" },
          { code: "084", name: "Enterprise Bank" },
          { code: "070", name: "Fidelity Bank" },
          { code: "011", name: "First Bank of Nigeria" },
          { code: "214", name: "First City Monument Bank" },
          { code: "058", name: "Guaranty Trust Bank" },
          { code: "030", name: "Heritage Bank" },
          { code: "301", name: "Jaiz Bank" },
          { code: "082", name: "Keystone Bank" },
          { code: "014", name: "MainStreet Bank" },
          { code: "076", name: "Polaris Bank" },
          { code: "039", name: "Stanbic IBTC Bank" },
          { code: "232", name: "Sterling Bank" },
          { code: "032", name: "Union Bank of Nigeria" },
          { code: "033", name: "United Bank For Africa" },
          { code: "215", name: "Unity Bank" },
          { code: "035", name: "Wema Bank" },
          { code: "057", name: "Zenith Bank" },
        ],
      };
    }

    const response = await fetch(`${this.baseUrl}/bank`, {
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
