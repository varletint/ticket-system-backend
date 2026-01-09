const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;

const formatMessage = (level, message, meta = {}) => {
  const timestamp = new Date().toISOString();
  const metaStr =
    Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
};

const logger = {
  error: (message, meta = {}) => {
    if (currentLevel >= LOG_LEVELS.error) {
      console.error(formatMessage("error", message, meta));
    }
  },

  warn: (message, meta = {}) => {
    if (currentLevel >= LOG_LEVELS.warn) {
      console.warn(formatMessage("warn", message, meta));
    }
  },

  info: (message, meta = {}) => {
    if (currentLevel >= LOG_LEVELS.info) {
      console.log(formatMessage("info", message, meta));
    }
  },

  debug: (message, meta = {}) => {
    if (currentLevel >= LOG_LEVELS.debug) {
      console.log(formatMessage("debug", message, meta));
    }
  },

  requestLogger: (req, res, next) => {
    const start = Date.now();

    res.on("finish", () => {
      const duration = Date.now() - start;
      const meta = {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.clientIp,
      };

      if (res.statusCode >= 400) {
        logger.warn("Request completed with error", meta);
      } else {
        logger.info("Request completed", meta);
      }
    });

    next();
  },
};

module.exports = logger;
