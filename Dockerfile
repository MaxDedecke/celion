# Use an official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install any needed packages
# Use --force to overcome potential issues with fsevents on non-macOS
RUN npm install --force

# Copy the rest of the application's code
COPY . .

# Make port 8080 available to the world outside this container
EXPOSE 8080

# Run the app when the container launches
# Using --host to ensure it's accessible from outside the container
CMD ["npm", "run", "dev", "--", "--host"]
