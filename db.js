// db.js
const { MongoClient } = require("mongodb");
// require('dotenv').config();
let db;

async function connectToMongoDB(mongoURI) {
  try {
    const client = new MongoClient(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    await client.connect();
    console.log("Connected to MongoDB");

    // Extracting the database name from the URI
    const dbName = new URL(mongoURI).pathname.substr(1);
    db = client.db(dbName);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
}

function getDb() {
  return db;
}

module.exports = { connectToMongoDB, getDb };
