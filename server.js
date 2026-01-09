require("dotenv").config();

const express = require("express");
const connectDB = require("./config/db");
const app = express();

app.get("/", (req, res) => {
  res.send("Hello World!");
});

connectDB();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
