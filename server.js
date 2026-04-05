require("dotenv").config();

const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const crypto = require("crypto");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();

/* ---------- MIDDLEWARE ---------- */
app.use(cors());
app.use(express.json());

/* ---------- MONGODB ---------- */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

/* ---------- MODELS ---------- */
const Order = mongoose.model("Order", new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  address: String,
  items: Array,
  amount: Number,
  paymentId: String,
  date: { type: Date, default: Date.now }
}));

const Stock = mongoose.model("Stock", new mongoose.Schema({
  color: String,
  size: String,
  stock: Number
}));

/* ---------- RAZORPAY ---------- */
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

/* ===================================================== */
/* ===================== TEST ROUTE ===================== */
/* ===================================================== */

app.get("/api", (req, res) => {
  res.send("API is working 🚀");
});

/* ===================================================== */
/* ===================== API ROUTES ===================== */
/* ===================================================== */

/* ---------- GET STOCK ---------- */
app.get("/api/stock", async (req, res) => {
  try {
    const stock = await Stock.find();
    res.json(stock);
  } catch (err) {
    res.status(500).json({ message: "Stock fetch error" });
  }
});

/* ---------- CREATE ORDER ---------- */
app.post("/api/create-order", async (req, res) => {
  try {
    const { amount } = req.body;

    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: "INR",
      receipt: "order_" + Date.now()
    });

    res.json(order);

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Error creating order" });
  }
});

/* ---------- VERIFY PAYMENT + STOCK ---------- */
app.post("/api/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      items,
      amount,
      customer
    } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false });
    }

    /* ---------- STOCK CHECK ---------- */
    for (let item of items) {
      const stockItem = await Stock.findOne({
        color: item.color,
        size: item.size
      });

      if (!stockItem || stockItem.stock < item.quantity) {
        return res.status(400).json({
          error: `${item.color} ${item.size} out of stock`
        });
      }
    }

    /* ---------- SAVE ORDER ---------- */
    await Order.create({
      name: customer?.name || "N/A",
      phone: customer?.phone || "N/A",
      email: customer?.email || "N/A",
      address: customer?.address || "N/A",
      items,
      amount,
      paymentId: razorpay_payment_id
    });

    /* ---------- REDUCE STOCK ---------- */
    for (let item of items) {
      await Stock.findOneAndUpdate(
        { color: item.color, size: item.size },
        { $inc: { stock: -item.quantity } }
      );
    }

    res.json({ success: true });

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Verification failed" });
  }
});

/* ---------- ADMIN LOGIN ---------- */
app.post("/api/admin-login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = jwt.sign(
      { role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({ token });
  } else {
    res.status(401).json({ message: "Invalid credentials" });
  }
});

/* ---------- AUTH ---------- */
function verifyAdmin(req, res, next) {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(403).json({ message: "Access denied" });
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

/* ---------- GET ORDERS ---------- */
app.get("/api/orders", verifyAdmin, async (req, res) => {
  try {
    const orders = await Order.find().sort({ date: -1 });
    res.json(orders);
  } catch {
    res.status(500).json({ message: "Error fetching orders" });
  }
});

/* ===================================================== */
/* ================= FRONTEND SERVE ===================== */
/* ===================================================== */

app.use(express.static(path.join(__dirname, "../civv-frontend")));

/* ---------- FALLBACK ---------- */
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "../civv-frontend/index.html"));
});

/* ---------- SERVER ---------- */
app.listen(process.env.PORT || 5000, () => {
  console.log("Server running 🚀");
});