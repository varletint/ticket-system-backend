const mongoose = require("mongoose");

// Cache connection for serverless environments (Vercel)
let cachedConnection = null;
let connectionPromise = null;

const connectDB = async () => {
  // Return cached connection if already connected
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  // If already connecting, wait for that to complete
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    try {
      // Configure mongoose for serverless
      mongoose.set("bufferCommands", false);

      const conn = await mongoose.connect(process.env.MONGODB_URI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });

      cachedConnection = conn;
      console.log(`MongoDB Connected: ${conn.connection.host}`);
      return conn;
    } catch (error) {
      console.error(`MongoDB Connection Error: ${error.message}`);
      cachedConnection = null;
      connectionPromise = null;
      // Don't throw - let individual requests fail gracefully
      return null;
    }
  })();

  return connectionPromise;
};

module.exports = connectDB;
