const requiredEnvVars = ["MONGODB_URI", "JWT_SECRET"];

const optionalEnvVars = [
  "PORT",
  "NODE_ENV",
  "CLIENT_URL",
  "PAYSTACK_SECRET_KEY",
];

const validateEnv = () => {
  const missing = [];
  const warnings = [];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  for (const envVar of optionalEnvVars) {
    if (!process.env[envVar]) {
      warnings.push(envVar);
    }
  }

  if (warnings.length > 0) {
    console.warn(`Optional env vars not set: ${warnings.join(", ")}`);
  }

  if (missing.length > 0) {
    console.error("Missing required environment variables:");
    missing.forEach((envVar) => {
      console.error(`   - ${envVar}`);
    });
    console.error(
      "\nPlease check your .env file and ensure all required variables are set."
    );
    process.exit(1);
  }

  console.log("Environment variables validated");
};

module.exports = validateEnv;
