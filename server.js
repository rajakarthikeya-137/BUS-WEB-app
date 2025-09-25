// --------------------
// server.js
// Render-ready Node.js + MongoDB backend
// --------------------

import dotenv from "dotenv";
dotenv.config(); // load env variables

import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import multer from "multer";
import path from "path";
import fs from "fs";
import QRCode from "qrcode";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --------------------
// Ensure uploads folder exists
// --------------------
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

app.use("/uploads", express.static(uploadDir));

// --------------------
// MongoDB Connection
// --------------------
const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("❌ MONGO_URI not set in environment variables");
  process.exit(1);
}

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 5000, // fail fast
  tls: true, // enforce TLS
});

let applications, tickets;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db("mahalakshmiBusDB");
    applications = db.collection("applications");
    tickets = db.collection("tickets");
    console.log("✅ Connected to MongoDB Atlas");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1); // stop server if DB fails
  }
}
connectDB();

// --------------------
// File Upload Setup
// --------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// --------------------
// Generate 8-digit unique pass ID
// --------------------
function generateUniquePassId() {
  const randomNum = Math.floor(10000000 + Math.random() * 90000000);
  return `TSRTC-${randomNum}`;
}

// --------------------
// Routes
// --------------------

// 1️⃣ Apply
app.post(
  "/apply",
  upload.fields([{ name: "photo" }, { name: "aadharFile" }]),
  async (req, res) => {
    try {
      if (!applications) return res.status(500).json({ error: "DB not connected yet" });

      const passId = generateUniquePassId();
      const qrDataUrl = await QRCode.toDataURL(passId);
      const phoneNumber = req.body.phone || req.body.whatsapp || req.body.number;

      const doc = {
        passId,
        qrCode: qrDataUrl,
        name: req.body.name,
        fatherName: req.body.fatherName,
        dob: req.body.dob,
        gender: req.body.gender,
        age: {
          years: req.body.ageYears,
          months: req.body.ageMonths,
          days: req.body.ageDays,
        },
        aadhar: req.body.aadhar,
        phone: phoneNumber,
        whatsapp: req.body.whatsapp || phoneNumber,
        number: req.body.number || phoneNumber,
        email: req.body.email,
        photo: req.files?.photo ? `/uploads/${req.files.photo[0].filename}` : "",
        aadharFile: req.files?.aadharFile ? `/uploads/${req.files.aadharFile[0].filename}` : "",
        address: req.body.address,
        district: req.body.district,
        mandal: req.body.mandal,
        village: req.body.village,
        pincode: req.body.pincode,
        city: req.body.city,
        passType: req.body.passType,
        paymentMode: "FREE SCHEME",
        deliveryMode: "Bus Pass Counter",
        counter: req.body.counter,
        createdAt: new Date(),
      };

      const result = await applications.insertOne(doc);

      res.json({
        success: true,
        message: "✅ Application stored in MongoDB",
        id: result.insertedId,
        passId,
        qrCode: qrDataUrl,
      });
    } catch (err) {
      console.error("❌ Error inserting application:", err.message);
      res.status(500).json({ success: false, error: "Failed to save application" });
    }
  }
);

// 2️⃣ Verify by phone
app.get("/verify/:phone", async (req, res) => {
  try {
    if (!applications) return res.status(500).json({ success: false, error: "DB not connected" });

    const phone = req.params.phone;
    const applicant = await applications.findOne({
      $or: [{ phone }, { whatsapp: phone }, { number: phone }],
    });

    res.json(applicant ? { success: true, id: applicant._id } : { success: false });
  } catch (err) {
    console.error("❌ Verify error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// 3️⃣ Fetch by Mongo _id
app.get("/applicant/:id", async (req, res) => {
  try {
    if (!applications) return res.status(500).json({ success: false, error: "DB not connected" });

    const applicant = await applications.findOne({ _id: new ObjectId(req.params.id) });
    res.json(applicant ? { success: true, applicant } : { success: false });
  } catch (err) {
    console.error("❌ Fetch error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// 4️⃣ Fetch by Pass ID (QR scan)
app.get("/getApplicant/:passId", async (req, res) => {
  try {
    const applicant = await applications.findOne({ passId: req.params.passId });
    res.status(applicant ? 200 : 404).json(applicant || { success: false, msg: "Not found" });
  } catch (err) {
    console.error("❌ Fetch by PassID error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5️⃣ Book Ticket
app.post("/bookTicket", async (req, res) => {
  try {
    const { applicantId, source, destination, paymentType, amount } = req.body;
    if (!applicantId || !source || !destination || !paymentType)
      return res.json({ success: false, msg: "Missing fields" });

    const ticketDoc = {
      applicantId: new ObjectId(applicantId),
      source,
      destination,
      paymentType,
      amount: paymentType === "PAID" ? Number(amount) : 0,
      bookedAt: new Date(),
    };

    const result = await tickets.insertOne(ticketDoc);
    res.json({ success: true, ticket: result.ops?.[0] || ticketDoc });
  } catch (err) {
    console.error("❌ Ticket booking error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --------------------
// Start server
// --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
