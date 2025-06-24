# Use official Node.js runtime as base image
FROM node:18-alpine

# Set working directory in container
WORKDIR /app

# Create logs directory
RUN mkdir -p /app/logs

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY bot.js ./

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S botuser -u 1001

# Change ownership of app directory
RUN chown -R botuser:nodejs /app

# Switch to non-root user
USER botuser

# Expose port (not strictly necessary for Discord bot, but good practice)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Bot health check')" || exit 1

# Start the application
CMD ["node", "bot.js"]