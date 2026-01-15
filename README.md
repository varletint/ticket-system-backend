# Ticket System - MERN Stack

A full-stack concert ticketing platform with QR code generation, PDF tickets, Paystack integration, and role-based dashboards.

## Tech Stack

- **Frontend**: React + Vite + TailwindCSS
- **Backend**: Node.js + Express
- **Database**: MongoDB Atlas
- **Auth**: JWT + Argon2
- **Payments**: Paystack (mock by default)

## Features

- 🎫 Browse and purchase concert tickets
- 📱 QR code generation for each ticket
- 📄 PDF ticket download with event details
- 🔒 Secure password hashing with Argon2
- 💳 Paystack payment integration (mock included)
- 👥 Role-based dashboards:
  - **Buyer**: Browse events, purchase, download tickets
  - **Organizer**: Create events, manage sales, view analytics
  - **Validator**: Scan QR codes at venue entry
  - **Admin**: Approve organizers, manage users, platform stats

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB Atlas account

### Backend Setup

```bash
cd server
npm install
cp .env.example .env
# Edit .env with your MongoDB URI
npm run dev
```

### Frontend Setup

```bash
cd client
npm install
npm run dev
```

### Default Ports

- Frontend: http://localhost:5173
- Backend: http://localhost:5000

## Environment Variables

### Server (.env)

```
PORT=5000
MONGODB_URI=your-mongodb-atlas-uri
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret
QR_SECRET_KEY=your-qr-signing-key
PAYSTACK_SECRET_KEY=sk_test_xxx (optional)
CLIENT_URL=http://localhost:5173
```

## User Roles

| Role      | Capabilities                                  |
| --------- | --------------------------------------------- |
| Buyer     | Browse, purchase, download tickets            |
| Organizer | Create events, view sales (requires approval) |
| Validator | Scan and validate tickets                     |
| Admin     | Full platform access, approve organizers      |

---

## Development Journal

### January 15, 2026

**Payout Setup Requirement for Event Creation**

- Organizers must now set up their payout account before creating events
- Backend validation in `eventController.js` checks `paystack.isActive`
- Frontend blocker UI in `CreateEvent.jsx` redirects to payout setup
- Added "Setup Payout" quick link to Organizer Dashboard

**Fixed Paystack Subaccount Split Configuration**

- **Issue**: Paystack dashboard showed wrong split percentages
- **Fix**: Changed from `share: 90` to `percentage_charge: 10`
- Platform fee = 10%, Organizer receives = 90%

**AuthContext Improvements**

- Added `refreshUser()` function to re-fetch user data from API
- Fixed profile data not refreshing after updates

**Organizer Profile Enhancements**

- Added `platformFeePercent` field to track platform percentage
- Fixed businessName and description loading in Profile page
